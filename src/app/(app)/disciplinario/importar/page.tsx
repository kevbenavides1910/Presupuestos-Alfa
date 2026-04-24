"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, FileWarning, Users, Mail, Eye, Trash2,
  Printer,
} from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeZoneCatalogKey } from "@/lib/business/disciplinary-zone-key";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils/format";

interface ImportResultData {
  batchId: string;
  rowsHistorial: number;
  rowsTratamiento: number;
  apercibimientosInserted: number;
  apercibimientosUpdated: number;
  apercibimientosSkipped: number;
  omisionesInserted: number;
  omisionesDeleted: number;
  treatmentsInserted: number;
  treatmentsUpdated: number;
  treatmentsSkipped: number;
  errors: { sheet: string; row: number; message: string }[];
}

interface ImportResponse {
  data?: ImportResultData;
  error?: {
    code?: string;
    message: string;
    previousBatch?: {
      id: string;
      filename: string;
      createdAt: string;
      uploadedByName: string | null;
    };
  };
}

interface DuplicateInfo {
  message: string;
  previousBatch: {
    id: string;
    filename: string;
    createdAt: string;
    uploadedByName: string | null;
  };
}

interface BatchRow {
  id: string;
  filename: string;
  notes: string | null;
  rowsHistorial: number;
  rowsTratamiento: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errorsJson: { sheet: string; row: number; message: string }[] | null;
  createdAt: string;
  uploadedBy: { name: string; email: string };
  _count: { apercibimientos: number };
}

interface MarcasImportData {
  batchId: string;
  rowsSheet: number;
  apercibimientosInserted: number;
  omisionesInserted: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: { row: number; message: string }[];
}

interface MarcasPlannedRow {
  codigo: string;
  nombre: string;
  cedula: string | null;
  zona: string | null;
  zonaMaestro: string | null;
  zonaExcel: string | null;
  sucursal: string | null;
  administrador: string | null;
  emailEmpleado: string | null;
  emailCcZona: string | null;
  omisionesCount: number;
  omisionesResumen: string;
  fechaEmision: string;
  numeroPreliminar: string;
  estado: string;
  vigencia: string;
}

interface MarcasPreviewData {
  checksum: string;
  rowsSheet: number;
  inspeccionMode: boolean;
  planned: MarcasPlannedRow[];
  wouldInsert: number;
  wouldSkipOmisiones: number;
  errors: { row: number; message: string }[];
}

const ESTADO_MARCAS_LABEL: Record<string, string> = {
  EMITIDO: "Emitido",
  ENTREGADO: "Entregado",
  FIRMADO: "Firmado",
  ANULADO: "Anulado",
};

const VIGENCIA_MARCAS_LABEL: Record<string, string> = {
  VIGENTE: "Vigente",
  VENCIDO: "Vencido",
  PRESCRITO: "Prescrito",
  FINALIZADO: "Finalizado",
  ANULADO: "Anulado",
};

interface EmployeeMasterResult {
  rowsProcessed: number;
  upserted: number;
  errors: { row: number; message: string }[];
}

interface RetrofillPuntoData {
  batchId: string;
  apercibimientosConCambios: number;
  omisionesActualizadas: number;
  omisionesSinCoincidencia: number;
  avisos: string[];
}

export default function DisciplinarioImportPage() {
  const { data: session, status } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const marcasInputRef = useRef<HTMLInputElement>(null);
  const retroPuntoInputRef = useRef<HTMLInputElement>(null);
  const employeeCsvRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<ImportResultData | null>(null);
  const [marcasResult, setMarcasResult] = useState<MarcasImportData | null>(null);
  const [marcasPreview, setMarcasPreview] = useState<MarcasPreviewData | null>(null);
  const [pendingMarcasFile, setPendingMarcasFile] = useState<File | null>(null);
  const [pdfPreviewCodigo, setPdfPreviewCodigo] = useState<string | null>(null);
  const [employeeResult, setEmployeeResult] = useState<EmployeeMasterResult | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [duplicateMarcas, setDuplicateMarcas] = useState<DuplicateInfo | null>(null);
  const [batchDeleteTarget, setBatchDeleteTarget] = useState<BatchRow | null>(null);
  /** Zona/sucursal por código antes de registrar (coinciden con lo enviado en zoneOverrides). */
  const [marcasZoneEdits, setMarcasZoneEdits] = useState<Record<string, { zona: string; sucursal: string }>>({});
  const [marcasMainTab, setMarcasMainTab] = useState("import");
  const [bulkPdfBatchId, setBulkPdfBatchId] = useState("");
  const [selectedBulkZoneKeys, setSelectedBulkZoneKeys] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const isAdmin = session?.user?.role === "ADMIN";

  const { data: zonesCatalog } = useQuery({
    queryKey: ["admin-zones-catalog"],
    queryFn: async () => {
      const res = await fetch("/api/admin/catalogs/zones");
      const json = (await res.json()) as {
        data?: { name: string; disciplinaryAdministratorEmail: string | null }[];
      };
      if (!res.ok) return [];
      return json.data ?? [];
    },
    enabled: status === "authenticated",
  });

  useEffect(() => {
    if (!marcasPreview) return;
    setMarcasZoneEdits(
      Object.fromEntries(
        marcasPreview.planned.map((p) => [
          p.codigo,
          { zona: p.zona ?? "", sucursal: p.sucursal ?? "" },
        ]),
      ),
    );
  }, [marcasPreview?.checksum]);

  const zoneRows = zonesCatalog ?? [];
  const resolveLiveEmailCc = (
    zonaText: string,
    emailEmpleado: string | null | undefined,
  ): string | null => {
    const key = normalizeZoneCatalogKey(zonaText);
    if (!key) return null;
    const z = zoneRows.find((r) => normalizeZoneCatalogKey(r.name) === key);
    const cc = z?.disciplinaryAdministratorEmail?.trim();
    if (!cc) return null;
    const emp = emailEmpleado?.trim();
    if (emp && cc.toLowerCase() === emp.toLowerCase()) return null;
    return cc;
  };

  const { data: batchesData } = useQuery<{ data: BatchRow[] }>({
    queryKey: ["disciplinary-batches"],
    queryFn: () => fetch("/api/disciplinary/import/batches").then((r) => r.json()),
    enabled: isAdmin,
  });

  const marcasBatches = useMemo(
    () => (batchesData?.data ?? []).filter((b) => b.notes?.startsWith("import_marcas")),
    [batchesData?.data],
  );

  const { data: batchZonesEmail, isLoading: batchZonesLoading } = useQuery({
    queryKey: ["disciplinary-batch-zones-email", bulkPdfBatchId],
    queryFn: async () => {
      const res = await fetch(
        `/api/disciplinary/import/batches/${bulkPdfBatchId}/zones-email-sent`,
      );
      const json = (await res.json()) as {
        data?: { zones: { key: string; label: string; count: number }[] };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "No se pudieron listar las zonas");
      return json.data?.zones ?? [];
    },
    enabled: isAdmin && Boolean(bulkPdfBatchId),
  });

  const retroPuntoMutation = useMutation({
    mutationFn: async ({ file, batchId }: { file: File; batchId: string }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("batchId", batchId);
      const res = await fetch("/api/disciplinary/import/marcas/retrofill-punto", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as { data?: RetrofillPuntoData; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? `Error ${res.status}`);
      if (!json.data) throw new Error("Respuesta inesperada");
      return json.data;
    },
    onSuccess: (data) => {
      const msg = `${data.omisionesActualizadas} omisión(es) actualizadas en ${data.apercibimientosConCambios} apercibimiento(s). Sin coincidencia: ${data.omisionesSinCoincidencia}.`;
      if (data.omisionesSinCoincidencia > 0 || data.avisos.length > 0) {
        toast.info("Retroactualización terminada (revise avisos)", msg);
      } else {
        toast.success("Punto omitido actualizado", msg);
      }
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
      if (retroPuntoInputRef.current) retroPuntoInputRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkPdfByZonesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/disciplinary/import/batches/${bulkPdfBatchId}/bulk-pdf-zones`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneKeys: selectedBulkZoneKeys }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(json.error?.message ?? `Error ${res.status}`);
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `apercibimientos-zonas-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.rel = "noopener";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF descargado", "Un solo archivo con todos los apercibimientos de las zonas elegidas.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (marcasResult?.batchId) setBulkPdfBatchId(marcasResult.batchId);
  }, [marcasResult?.batchId]);

  useEffect(() => {
    setSelectedBulkZoneKeys([]);
  }, [bulkPdfBatchId]);

  const deleteBatchMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/disciplinary/import/batches/${id}`, { method: "DELETE" });
      const json = (await res.json()) as {
        data?: { apercibimientosDeleted?: number };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "No se pudo eliminar el lote");
      return json.data;
    },
    onSuccess: (data) => {
      const n = data?.apercibimientosDeleted ?? 0;
      toast.success("Lote eliminado", `${n} apercibimiento(s) quitados. Ya puede volver a subir el mismo archivo.`);
      setBatchDeleteTarget(null);
      setDuplicateMarcas(null);
      queryClient.invalidateQueries({ queryKey: ["disciplinary-batches"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-resumen"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/disciplinary/import", { method: "POST", body: fd });
      const json: ImportResponse = await res.json();
      if (!res.ok) {
        // Propagamos el código para que onError decida si es duplicado.
        const err = new Error(json.error?.message ?? "Error al importar") as Error & {
          code?: string;
          previousBatch?: DuplicateInfo["previousBatch"];
        };
        err.code = json.error?.code;
        err.previousBatch = json.error?.previousBatch;
        throw err;
      }
      if (!json.data) throw new Error("Respuesta inesperada del servidor");
      return json.data;
    },
    onSuccess: (result) => {
      setLastResult(result);
      setDuplicateInfo(null);
      const totalImported =
        result.apercibimientosInserted + result.apercibimientosUpdated +
        result.treatmentsInserted + result.treatmentsUpdated +
        result.omisionesInserted;
      if (result.errors.length > 0) {
        toast.info(
          "Importación parcial",
          `${totalImported} registro(s) procesados, ${result.errors.length} con error.`,
        );
      } else {
        toast.success(
          "Importación completa",
          `${totalImported} registro(s) procesados.`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["disciplinary-batches"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: Error & { code?: string; previousBatch?: DuplicateInfo["previousBatch"] }) => {
      if (e.code === "DUPLICATE_IMPORT" && e.previousBatch) {
        setDuplicateInfo({ message: e.message, previousBatch: e.previousBatch });
        setLastResult(null);
        toast.info("Archivo repetido", e.message);
      } else {
        toast.error(e.message);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  const marcasPreviewMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/disciplinary/import/marcas/preview", { method: "POST", body: fd });
      const json = (await res.json()) as { data?: MarcasPreviewData; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "No se pudo analizar el archivo");
      if (!json.data) throw new Error("Respuesta inesperada");
      return json.data;
    },
    onSuccess: (data) => {
      setMarcasPreview(data);
      setDuplicateMarcas(null);
      if (data.errors.length > 0) {
        toast.info("Análisis con avisos", `${data.planned.length} apercibimiento(s) previstos, ${data.errors.length} mensaje(s) en el log.`);
      } else {
        toast.success("Vista previa lista", `${data.planned.length} apercibimiento(s) a emitir.`);
      }
    },
    onError: (e: Error) => {
      setMarcasPreview(null);
      toast.error(e.message);
    },
  });

  const marcasMutation = useMutation({
    mutationFn: async (opts: {
      file: File;
      sendEmail: boolean;
      zoneOverrides: Record<string, { zona: string; sucursal: string }>;
    }) => {
      const fd = new FormData();
      fd.append("file", opts.file);
      fd.append("sendEmail", opts.sendEmail ? "true" : "false");
      fd.append("zoneOverrides", JSON.stringify(opts.zoneOverrides));
      const res = await fetch("/api/disciplinary/import/marcas", { method: "POST", body: fd });
      const json: ImportResponse & { data?: MarcasImportData } = await res.json();
      if (!res.ok) {
        const err = new Error(json.error?.message ?? "Error al importar marcas") as Error & {
          code?: string;
          previousBatch?: DuplicateInfo["previousBatch"];
        };
        err.code = json.error?.code;
        err.previousBatch = json.error?.previousBatch;
        throw err;
      }
      if (!json.data) throw new Error("Respuesta inesperada del servidor");
      return json.data;
    },
    onSuccess: (result, variables) => {
      setMarcasResult(result);
      setMarcasPreview(null);
      setPendingMarcasFile(null);
      setDuplicateMarcas(null);
      const mailPart =
        variables.sendEmail && (result.emailsSent > 0 || result.emailsSkipped > 0)
          ? ` Correos enviados: ${result.emailsSent}. Sin enviar (sin correo o SMTP): ${result.emailsSkipped}.`
          : "";
      if (result.errors.length > 0) {
        toast.info(
          "Importación de marcas parcial",
          `${result.apercibimientosInserted} apercibimiento(s), ${result.errors.length} aviso(s).${mailPart}`,
        );
      } else {
        toast.success(
          variables.sendEmail ? "Marcas importadas y correos procesados" : "Marcas importadas",
          `${result.apercibimientosInserted} apercibimiento(s), ${result.omisionesInserted} omisión(es).${mailPart}`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["disciplinary-batches"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-list"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["disciplinary-batch-zones-email"] });
      if (marcasInputRef.current) marcasInputRef.current.value = "";
    },
    onError: (e: Error & { code?: string; previousBatch?: DuplicateInfo["previousBatch"] }) => {
      if (e.code === "DUPLICATE_IMPORT" && e.previousBatch) {
        setDuplicateMarcas({ message: e.message, previousBatch: e.previousBatch });
        setMarcasResult(null);
        toast.info("Archivo repetido", e.message);
      } else {
        toast.error(e.message);
      }
      if (marcasInputRef.current) marcasInputRef.current.value = "";
    },
  });

  async function openMarcasPdfPreview(codigo: string) {
    if (!pendingMarcasFile) {
      toast.error("Seleccione de nuevo el archivo para generar la vista previa del PDF.");
      return;
    }
    const planRow = marcasPreview?.planned.find((x) => x.codigo === codigo);
    const ed = marcasZoneEdits[codigo] ?? {
      zona: planRow?.zona ?? "",
      sucursal: planRow?.sucursal ?? "",
    };
    setPdfPreviewCodigo(codigo);
    try {
      const fd = new FormData();
      fd.append("file", pendingMarcasFile);
      fd.append("codigo", codigo);
      fd.append("zona", ed.zona);
      fd.append("sucursal", ed.sucursal);
      const res = await fetch("/api/disciplinary/import/marcas/preview-pdf", { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el PDF");
    } finally {
      setPdfPreviewCodigo(null);
    }
  }

  const employeeMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/disciplinary/employees-master", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Error al importar CSV");
      if (!json.data) throw new Error("Respuesta inesperada");
      return json.data as EmployeeMasterResult;
    },
    onSuccess: (result) => {
      setEmployeeResult(result);
      if (result.errors.length > 0) {
        toast.info("Maestro actualizado con avisos", `${result.upserted} fila(s), ${result.errors.length} error(es).`);
      } else {
        toast.success("Maestro de empleados", `${result.upserted} registro(s) guardados.`);
      }
      if (employeeCsvRef.current) employeeCsvRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (status === "loading") return null;
  if (!isAdmin) {
    return (
      <>
        <Topbar title="Disciplinario" />
        <div className="p-6">
          <div className="text-rose-600">Solo los administradores pueden importar lotes.</div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Disciplinario" />
      <div className="p-6 space-y-4">
        <Link href="/disciplinario" className="inline-flex items-center text-sm text-slate-600 hover:text-blue-600 gap-1">
          <ArrowLeft className="h-4 w-4" /> Volver al listado
        </Link>

        <div>
          <h1 className="text-2xl font-semibold text-slate-800 flex items-center gap-2">
            <Upload className="h-6 w-6 text-blue-600" />
            Importar disciplinario
          </h1>
          <p className="text-sm text-slate-500">
            Tres flujos: Excel de la app de escritorio (Historial/Estadísticas), carga masiva de
            marcas (primera hoja), y maestro de empleados en CSV para nombres y correos. Los
            archivos duplicados (mismo contenido) se rechazan.{" "}
            <Link href="/disciplinario/proceso" className="text-blue-600 hover:underline">
              Guía del flujo paso a paso
            </Link>
            .
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Maestro de empleados (CSV)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-3">
            <p className="text-sm text-slate-600">
              Suba el reporte de RRHH (por ejemplo cuentas bancarias) con columnas como{" "}
              <span className="font-mono text-xs">Código</span>,{" "}
              <span className="font-mono text-xs">Nombre</span>,{" "}
              <span className="font-mono text-xs">Correo</span>,{" "}
              <span className="font-mono text-xs">Cédula</span>. Se usa para completar datos, la cédula en el PDF y
              enviar apercibimientos por correo al importar marcas.
            </p>
            <input
              ref={employeeCsvRef}
              type="file"
              accept=".csv,text/csv"
              className="block text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-emerald-50 file:text-emerald-800 hover:file:bg-emerald-100"
              disabled={employeeMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                employeeMutation.mutate(file);
              }}
            />
            {employeeMutation.isPending && (
              <div className="text-sm text-slate-500">Procesando CSV…</div>
            )}
            {employeeResult && (
              <div className="text-sm rounded border border-slate-200 bg-slate-50 p-3">
                <div>
                  <span className="font-medium text-slate-800">{employeeResult.upserted}</span>{" "}
                  empleados actualizados de {employeeResult.rowsProcessed} filas.
                </div>
                {employeeResult.errors.length > 0 && (
                  <div className="mt-2 text-xs text-rose-700 max-h-32 overflow-auto">
                    {employeeResult.errors.slice(0, 8).map((er, i) => (
                      <div key={i}>Fila {er.row}: {er.message}</div>
                    ))}
                    {employeeResult.errors.length > 8 && (
                      <div>… y {employeeResult.errors.length - 8} más</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-amber-600" />
              Carga masiva de marcas (.xlsx)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            <Tabs value={marcasMainTab} onValueChange={setMarcasMainTab} className="w-full">
              <TabsList className="mb-3 h-auto w-full max-w-xl flex flex-wrap justify-start gap-1 p-1">
                <TabsTrigger value="import">Importar / vista previa</TabsTrigger>
                <TabsTrigger value="bulk-pdf">PDF por zona (tras correo)</TabsTrigger>
              </TabsList>
              <TabsContent value="import" className="space-y-4 mt-0 outline-none">
            <p className="text-sm text-slate-600">
              Acepta dos formatos: (1) export con hoja de <strong>detalle de inspecciones</strong>{" "}
              (<span className="font-mono text-xs">Usr Marca</span>,{" "}
              <span className="font-mono text-xs">Estado</span>,{" "}
              <span className="font-mono text-xs">Fec Marca</span>) — se toman solo las filas con
              Estado «No Realizada»; (2) tabla plana por empleado con fechas de omisión en columnas.
              Si el libro trae una «Hoja1» solo con totales por ubicación, el sistema busca la hoja de
              detalle automáticamente. Un apercibimiento por empleado con todas las omisiones del archivo.
            </p>
            <input
              ref={marcasInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-amber-50 file:text-amber-900 hover:file:bg-amber-100"
              disabled={marcasMutation.isPending || marcasPreviewMutation.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPendingMarcasFile(file);
                setMarcasResult(null);
                setMarcasPreview(null);
                setDuplicateMarcas(null);
                marcasPreviewMutation.mutate(file);
              }}
            />
            {(marcasPreviewMutation.isPending || marcasMutation.isPending) && (
              <div className="text-sm text-slate-500">
                {marcasPreviewMutation.isPending ? "Analizando archivo…" : "Importando marcas…"}
              </div>
            )}
            {marcasPreview && pendingMarcasFile && (() => {
              const n = marcasPreview.planned.length;
              const withEmail = marcasPreview.planned.filter((p) => p.emailEmpleado?.trim()).length;
              return (
              <div className="space-y-2 pt-2">
                <p className="text-xs text-slate-600">
                  Elija si solo guarda los apercibimientos o también intenta enviar el PDF por correo
                  (SMTP en <strong>Disciplinario → Ajustes → Configuración</strong> y correo en el maestro CSV).
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    marcasMutation.isPending ||
                    marcasPreviewMutation.isPending ||
                    n === 0
                  }
                  onClick={() =>
                    marcasMutation.mutate({
                      file: pendingMarcasFile,
                      sendEmail: false,
                      zoneOverrides: marcasZoneEdits,
                    })
                  }
                >
                  Solo registrar ({n} apercibimiento{n === 1 ? "" : "s"})
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  disabled={
                    marcasMutation.isPending ||
                    marcasPreviewMutation.isPending ||
                    n === 0 ||
                    withEmail === 0
                  }
                  title={
                    withEmail === 0
                      ? "Ninguna fila tiene correo en el maestro. Importe el CSV con columna Correo."
                      : `Enviará PDF a ${withEmail} destinatario(s) que tengan correo (y CC zona si aplica).`
                  }
                  onClick={() =>
                    marcasMutation.mutate({
                      file: pendingMarcasFile,
                      sendEmail: true,
                      zoneOverrides: marcasZoneEdits,
                    })
                  }
                >
                  <Mail className="h-4 w-4" />
                  Registrar y enviar correos ({withEmail} con correo)
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={marcasMutation.isPending || marcasPreviewMutation.isPending}
                  onClick={() => {
                    setMarcasPreview(null);
                    setPendingMarcasFile(null);
                    setMarcasZoneEdits({});
                    if (marcasInputRef.current) marcasInputRef.current.value = "";
                  }}
                >
                  Descartar
                </Button>
                </div>
              </div>
              );
            })()}

        {marcasPreview && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Eye className="h-5 w-5 text-amber-600" />
                Resumen — apercibimientos a emitir
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-slate-600">
                Revise la lista antes de confirmar. El <strong>N° preliminar</strong> usa un código fijo de
                vista previa; al importar, los últimos caracteres del número serán los del id del lote (el
                aviso queda registrado con el número definitivo). La <strong>zona</strong> se toma del maestro
                de empleados (CSV) y, si no hay, del Excel; puede corregirla en la tabla antes de registrar.
                El CC de zona se actualiza según el catálogo de zonas cuando cambia el texto.
              </p>
              <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                <span>
                  <strong>{marcasPreview.planned.length}</strong> apercibimiento(s) con omisiones
                </span>
                <span>
                  Filas en hoja: <strong>{marcasPreview.rowsSheet}</strong>
                </span>
                {marcasPreview.inspeccionMode ? (
                  <span className="text-amber-800">Modo: detalle de inspecciones</span>
                ) : (
                  <span>Modo: tabla plana</span>
                )}
                {marcasPreview.wouldSkipOmisiones > 0 && (
                  <span className="text-rose-700">
                    Grupos sin fechas de omisión: {marcasPreview.wouldSkipOmisiones}
                  </span>
                )}
              </div>
              <div className="max-h-96 overflow-auto border rounded">
                <datalist id="marcas-zonas-list">
                  {zoneRows.map((z) => (
                    <option key={z.name} value={z.name} />
                  ))}
                </datalist>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b sticky top-0">
                    <tr className="text-left text-slate-600">
                      <th className="px-2 py-2">Código</th>
                      <th className="px-2 py-2">Empleado</th>
                      <th className="px-2 py-2">Cédula</th>
                      <th className="px-2 py-2 min-w-[12rem]">Zona / Suc.</th>
                      <th className="px-2 py-2 text-right">Om.</th>
                      <th className="px-2 py-2">Fechas (muestra)</th>
                      <th className="px-2 py-2">Correo / CC</th>
                      <th className="px-2 py-2">N° (auto.)</th>
                      <th className="px-2 py-2">Estado</th>
                      <th className="px-2 py-2">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {marcasPreview.planned.map((p) => {
                      const zoneRow = marcasZoneEdits[p.codigo] ?? {
                        zona: p.zona ?? "",
                        sucursal: p.sucursal ?? "",
                      };
                      const ccShown =
                        resolveLiveEmailCc(zoneRow.zona, p.emailEmpleado) ?? p.emailCcZona;
                      const zoneHint = `Maestro: ${p.zonaMaestro ?? "—"} · Excel: ${p.zonaExcel ?? "—"}`;
                      return (
                      <tr key={p.codigo} className="hover:bg-slate-50/80">
                        <td className="px-2 py-1.5 font-mono">{p.codigo}</td>
                        <td className="px-2 py-1.5 max-w-[10rem] truncate" title={p.nombre}>
                          {p.nombre}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px] whitespace-nowrap">
                          {p.cedula ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 align-top text-slate-700">
                          <div className="flex flex-col gap-1 min-w-[10.5rem]" title={zoneHint}>
                            <Input
                              className="h-8 text-[10px] px-1.5"
                              list="marcas-zonas-list"
                              value={zoneRow.zona}
                              placeholder="Zona"
                              aria-label={`Zona (${p.codigo})`}
                              onChange={(e) =>
                                setMarcasZoneEdits((prev) => ({
                                  ...prev,
                                  [p.codigo]: {
                                    zona: e.target.value,
                                    sucursal: prev[p.codigo]?.sucursal ?? p.sucursal ?? "",
                                  },
                                }))
                              }
                            />
                            <Input
                              className="h-8 text-[10px] px-1.5"
                              value={zoneRow.sucursal}
                              placeholder="Sucursal (Excel)"
                              aria-label={`Sucursal (${p.codigo})`}
                              onChange={(e) =>
                                setMarcasZoneEdits((prev) => ({
                                  ...prev,
                                  [p.codigo]: {
                                    zona: prev[p.codigo]?.zona ?? p.zona ?? "",
                                    sucursal: e.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{p.omisionesCount}</td>
                        <td className="px-2 py-1.5 max-w-[14rem] text-slate-600" title={p.omisionesResumen}>
                          {p.omisionesResumen || "—"}
                        </td>
                        <td className="px-2 py-1.5 max-w-[9rem] truncate text-slate-600" title={`${p.emailEmpleado ?? ""} CC: ${ccShown ?? ""}`}>
                          {p.emailEmpleado ?? "—"}
                          {ccShown ? (
                            <span className="block text-[10px] text-slate-500">CC: {ccShown}</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[10px]">{p.numeroPreliminar}</td>
                        <td className="px-2 py-1.5 text-[10px] text-slate-600 whitespace-nowrap">
                          {ESTADO_MARCAS_LABEL[p.estado] ?? p.estado}
                          <span className="text-slate-400"> · </span>
                          {VIGENCIA_MARCAS_LABEL[p.vigencia] ?? p.vigencia}
                        </td>
                        <td className="px-2 py-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 gap-1"
                            disabled={pdfPreviewCodigo === p.codigo}
                            onClick={() => openMarcasPdfPreview(p.codigo)}
                            title="Vista previa del PDF"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Ver
                          </Button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {marcasPreview.errors.length > 0 && (
                <div className="max-h-40 overflow-auto border border-amber-200 rounded bg-amber-50/50 text-xs p-2">
                  <div className="font-medium text-amber-900 mb-1">Avisos del análisis</div>
                  {marcasPreview.errors.slice(0, 40).map((er, i) => (
                    <div key={i} className="text-amber-900">
                      Fila {er.row}: {er.message}
                    </div>
                  ))}
                  {marcasPreview.errors.length > 40 && (
                    <div className="text-amber-800">… y {marcasPreview.errors.length - 40} más</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {duplicateMarcas && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-3">
              <FileWarning className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-amber-900">Archivo de marcas ya importado</div>
                <div className="text-amber-800 mt-1">{duplicateMarcas.message}</div>
                <div className="text-xs text-amber-700 mt-2">
                  Subido originalmente como{" "}
                  <strong>{duplicateMarcas.previousBatch.filename}</strong>
                  {duplicateMarcas.previousBatch.uploadedByName && (
                    <> por {duplicateMarcas.previousBatch.uploadedByName}</>
                  )}{" "}
                  el {formatDate(duplicateMarcas.previousBatch.createdAt)}.
                </div>
                <p className="text-xs text-amber-800 mt-3">
                  Para volver a procesar el mismo archivo, elimine ese lote en{" "}
                  <strong>Historial de importaciones</strong> (abajo), luego suba de nuevo el Excel.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {marcasResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {marcasResult.errors.length === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                Resultado — importación de marcas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Apercibimientos</div>
                  <div className="text-base font-semibold text-emerald-700">
                    {marcasResult.apercibimientosInserted}
                  </div>
                </div>
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Omisiones</div>
                  <div className="text-base font-semibold">{marcasResult.omisionesInserted}</div>
                </div>
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Correos enviados</div>
                  <div className="text-base font-semibold">{marcasResult.emailsSent}</div>
                  <div className="text-xs text-slate-500">Omitidos: {marcasResult.emailsSkipped}</div>
                </div>
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Filas hoja</div>
                  <div className="text-base font-semibold">{marcasResult.rowsSheet}</div>
                  <div className="text-xs font-mono truncate">{marcasResult.batchId}</div>
                </div>
              </div>
              {marcasResult.errors.length > 0 && (
                <div className="max-h-48 overflow-auto border rounded text-xs">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b">
                      <tr className="text-left text-slate-500">
                        <th className="px-2 py-1">Fila</th>
                        <th className="px-2 py-1">Mensaje</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {marcasResult.errors.map((e, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1">{e.row}</td>
                          <td className="px-2 py-1 text-rose-700">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
              </TabsContent>

              <TabsContent value="bulk-pdf" className="space-y-4 mt-0 outline-none">
                <p className="text-sm text-slate-600">
                  Solo incluye apercibimientos del lote de marcas cuyo <strong>correo ya fue enviado</strong>, para
                  que el PDF lleve el <strong>N° consecutivo definitivo</strong>. Elija el lote (p. ej. el que acaba
                  de importar), marque una o varias zonas y descargue un único PDF con todos los documentos en
                  orden.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-end max-w-2xl">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Lote de importación de marcas</label>
                    <Select
                      value={bulkPdfBatchId ? bulkPdfBatchId : undefined}
                      onValueChange={(v) => setBulkPdfBatchId(v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Seleccione un lote…" />
                      </SelectTrigger>
                      <SelectContent>
                        {marcasBatches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {`${formatDate(b.createdAt)} — ${b.filename} (${b._count.apercibimientos})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {marcasResult && marcasResult.emailsSent > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        setBulkPdfBatchId(marcasResult.batchId);
                        setMarcasMainTab("bulk-pdf");
                      }}
                    >
                      Usar lote actual
                    </Button>
                  )}
                </div>
                {!bulkPdfBatchId ? (
                  <p className="text-xs text-slate-500">Seleccione un lote para ver las zonas disponibles.</p>
                ) : batchZonesLoading ? (
                  <p className="text-sm text-slate-500">Cargando zonas…</p>
                ) : batchZonesEmail && batchZonesEmail.length === 0 ? (
                  <p className="text-sm text-amber-800 rounded border border-amber-200 bg-amber-50/80 p-3">
                    No hay apercibimientos con correo enviado en este lote. Use{" "}
                    <strong>Registrar y enviar correos</strong> al importar marcas (con SMTP y correos en el
                    maestro) para poder imprimir aquí con el número definitivo.
                  </p>
                ) : (
                  <div className="space-y-3 rounded border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-xs font-medium text-slate-700">Zonas (con al menos un correo enviado)</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 max-h-48 overflow-auto">
                      {(batchZonesEmail ?? []).map((z) => (
                        <label
                          key={z.key}
                          className="flex items-center gap-2 text-sm cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300"
                            checked={selectedBulkZoneKeys.includes(z.key)}
                            onChange={(e) => {
                              setSelectedBulkZoneKeys((prev) =>
                                e.target.checked
                                  ? prev.includes(z.key)
                                    ? prev
                                    : [...prev, z.key]
                                  : prev.filter((k) => k !== z.key),
                              );
                            }}
                          />
                          <span>
                            {z.label}{" "}
                            <span className="text-slate-500">({z.count})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="gap-2"
                      disabled={
                        bulkPdfByZonesMutation.isPending ||
                        selectedBulkZoneKeys.length === 0 ||
                        !bulkPdfBatchId
                      }
                      onClick={() => bulkPdfByZonesMutation.mutate()}
                    >
                      <Printer className="h-4 w-4" />
                      Descargar PDF único
                    </Button>
                  </div>
                )}
                <div className="rounded border border-blue-200 bg-blue-50/50 p-3 space-y-2 max-w-2xl">
                  <div className="text-sm font-medium text-slate-800">
                    Retroactualizar «punto omitido» (apercibimientos ya guardados)
                  </div>
                  <p className="text-xs text-slate-600">
                    Seleccione el <strong>mismo lote</strong> en el selector de arriba y adjunte el{" "}
                    <strong>mismo Excel de marcas</strong> (por ejemplo «21 de abril marcas.xlsx»). El sistema
                    empareja cada omisión por <strong>fecha y hora</strong> y escribe el punto omitido leído del
                    archivo. Así se corrigen los ya emitidos sin volver a importar el lote.
                  </p>
                  <input
                    ref={retroPuntoInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="block text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-blue-100 file:text-blue-900 hover:file:bg-blue-200 disabled:opacity-50"
                    disabled={!bulkPdfBatchId || retroPuntoMutation.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file || !bulkPdfBatchId) return;
                      retroPuntoMutation.mutate({ file, batchId: bulkPdfBatchId });
                      e.target.value = "";
                    }}
                  />
                  {retroPuntoMutation.isPending && (
                    <p className="text-xs text-slate-500">Procesando Excel y actualizando omisiones…</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Excel app de escritorio (Historial / Estadísticas)</CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            <div>
              <div className="text-sm font-medium text-slate-700 mb-1">Archivo .xlsx</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="block text-sm text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                disabled={importMutation.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  importMutation.mutate(file);
                }}
              />
              <div className="text-xs text-slate-500 mt-2">
                Política de importación: apercibimientos nuevos se insertan; si un N°
                ya existe se deja intacto (el seguimiento se hace desde la web) y solo
                se agregan fechas de omisión nuevas que el Excel reporte. Nada se borra.
              </div>
            </div>

            {importMutation.isPending && (
              <div className="text-sm text-slate-500">Procesando archivo…</div>
            )}
          </CardContent>
        </Card>

        {duplicateInfo && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4 flex items-start gap-3">
              <FileWarning className="h-5 w-5 text-amber-600 mt-0.5" />
              <div className="text-sm">
                <div className="font-medium text-amber-900">Archivo ya importado</div>
                <div className="text-amber-800 mt-1">{duplicateInfo.message}</div>
                <div className="text-xs text-amber-700 mt-2">
                  Subido originalmente como{" "}
                  <strong>{duplicateInfo.previousBatch.filename}</strong>
                  {duplicateInfo.previousBatch.uploadedByName && (
                    <> por {duplicateInfo.previousBatch.uploadedByName}</>
                  )}{" "}
                  el {formatDate(duplicateInfo.previousBatch.createdAt)}.
                </div>
                <div className="text-xs text-amber-800 mt-2">
                  Si necesitas volver a cargar el mismo archivo, elimina ese lote en{" "}
                  <strong>Historial de importaciones</strong> (acción Eliminar lote) y
                  vuelve a subirlo.
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {lastResult && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {lastResult.errors.length === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                Resultado de la última importación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Apercibimientos</div>
                  <div className="text-base font-semibold">
                    <span className="text-emerald-700">{lastResult.apercibimientosInserted}</span> nuevos
                    {" · "}
                    <span className="text-slate-500">{lastResult.apercibimientosSkipped}</span> ya existían
                  </div>
                  <div className="text-xs text-slate-500 mt-1">de {lastResult.rowsHistorial} filas</div>
                </div>
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Fechas de omisión</div>
                  <div className="text-base font-semibold">
                    <span className="text-emerald-700">{lastResult.omisionesInserted}</span> agregadas
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Merge sin pérdida</div>
                </div>
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Tratamientos</div>
                  <div className="text-base font-semibold">
                    <span className="text-emerald-700">{lastResult.treatmentsInserted}</span> nuevos
                    {" · "}
                    <span className="text-slate-500">{lastResult.treatmentsSkipped}</span> ya existían
                  </div>
                  <div className="text-xs text-slate-500 mt-1">de {lastResult.rowsTratamiento} filas</div>
                </div>
                <div className="bg-slate-50 rounded p-3">
                  <div className="text-xs text-slate-500">Errores</div>
                  <div className="text-base font-semibold text-rose-700">{lastResult.errors.length}</div>
                </div>
                <div className="bg-slate-50 rounded p-3 md:col-span-4">
                  <div className="text-xs text-slate-500">Batch</div>
                  <div className="text-xs font-mono text-slate-600 truncate">{lastResult.batchId}</div>
                </div>
              </div>

              {lastResult.errors.length > 0 && (
                <div>
                  <div className="font-medium text-sm text-rose-700 mb-1">
                    {lastResult.errors.length} fila(s) con error
                  </div>
                  <div className="max-h-64 overflow-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b">
                        <tr className="text-left text-slate-500">
                          <th className="px-2 py-1">Hoja</th>
                          <th className="px-2 py-1">Fila</th>
                          <th className="px-2 py-1">Mensaje</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lastResult.errors.map((e, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1">{e.sheet}</td>
                            <td className="px-2 py-1">{e.row}</td>
                            <td className="px-2 py-1 text-rose-700">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Historial de batches */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              Historial de importaciones
            </CardTitle>
            <p className="text-xs text-slate-500 font-normal">
              Eliminar un lote borra los apercibimientos vinculados y libera el archivo duplicado para poder
              importarlo otra vez.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {!batchesData?.data?.length ? (
              <div className="p-6 text-center text-slate-400 text-sm">Aún no hay importaciones registradas.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Archivo</th>
                    <th className="px-3 py-2 text-left">Tipo</th>
                    <th className="px-3 py-2 text-left">Subido por</th>
                    <th className="px-3 py-2 text-right">Historial</th>
                    <th className="px-3 py-2 text-right">Estadísticas</th>
                    <th className="px-3 py-2 text-right">Insertados</th>
                    <th className="px-3 py-2 text-right">Apercib.</th>
                    <th className="px-3 py-2 text-right">Errores</th>
                    <th className="px-3 py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batchesData.data.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">{formatDate(b.createdAt)}</td>
                      <td className="px-3 py-2 text-xs max-w-[14rem] truncate" title={b.filename}>
                        {b.filename}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {b.notes?.startsWith("import_marcas") ? "Marcas" : "Escritorio"}
                      </td>
                      <td className="px-3 py-2 text-xs">{b.uploadedBy.name}</td>
                      <td className="px-3 py-2 text-right">{b.rowsHistorial}</td>
                      <td className="px-3 py-2 text-right">{b.rowsTratamiento}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{b.rowsInserted}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b._count?.apercibimientos ?? 0}</td>
                      <td className="px-3 py-2 text-right text-rose-700">
                        {b.errorsJson?.length ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          onClick={() => setBatchDeleteTarget(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar lote
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!batchDeleteTarget} onOpenChange={(o) => !o && setBatchDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Eliminar lote de importación</DialogTitle>
              <DialogDescription asChild>
                <div className="text-sm text-slate-600 space-y-2 pt-1">
                  <p>
                    Se eliminará el registro del lote y{" "}
                    <strong>{batchDeleteTarget?._count?.apercibimientos ?? 0} apercibimiento(s)</strong>{" "}
                    asociados (y todas sus omisiones). No afecta altas manuales ni otros lotes.
                  </p>
                  <p className="font-mono text-xs bg-slate-100 p-2 rounded">{batchDeleteTarget?.filename}</p>
                  <p className="text-amber-800 text-xs">
                    Después podrá volver a subir el mismo archivo sin el aviso de duplicado.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setBatchDeleteTarget(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleteBatchMutation.isPending}
                onClick={() => batchDeleteTarget && deleteBatchMutation.mutate(batchDeleteTarget.id)}
              >
                {deleteBatchMutation.isPending ? "Eliminando…" : "Eliminar lote"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
