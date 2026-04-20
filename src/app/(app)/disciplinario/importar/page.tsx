"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload, AlertTriangle, CheckCircle2, FileSpreadsheet, FileWarning } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
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
  rowsHistorial: number;
  rowsTratamiento: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsSkipped: number;
  errorsJson: { sheet: string; row: number; message: string }[] | null;
  createdAt: string;
  uploadedBy: { name: string; email: string };
}

export default function DisciplinarioImportPage() {
  const { data: session, status } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<ImportResultData | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const queryClient = useQueryClient();

  const isAdmin = session?.user?.role === "ADMIN";

  const { data: batchesData } = useQuery<{ data: BatchRow[] }>({
    queryKey: ["disciplinary-batches"],
    queryFn: () => fetch("/api/disciplinary/import/batches").then((r) => r.json()),
    enabled: isAdmin,
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
            Importar Excel disciplinario
          </h1>
          <p className="text-sm text-slate-500">
            Suba el archivo .xlsx exportado por la app de escritorio. El sistema agrega los
            apercibimientos nuevos y fusiona las fechas de omisión adicionales. Si el archivo
            ya fue subido antes, se detecta y se rechaza automáticamente.
          </p>
        </div>

        <Card>
          <CardContent className="p-6 space-y-4">
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
                    <th className="px-3 py-2 text-left">Subido por</th>
                    <th className="px-3 py-2 text-right">Historial</th>
                    <th className="px-3 py-2 text-right">Estadísticas</th>
                    <th className="px-3 py-2 text-right">Insertados</th>
                    <th className="px-3 py-2 text-right">Errores</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batchesData.data.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">{formatDate(b.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">{b.filename}</td>
                      <td className="px-3 py-2 text-xs">{b.uploadedBy.name}</td>
                      <td className="px-3 py-2 text-right">{b.rowsHistorial}</td>
                      <td className="px-3 py-2 text-right">{b.rowsTratamiento}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{b.rowsInserted}</td>
                      <td className="px-3 py-2 text-right text-rose-700">
                        {b.errorsJson?.length ?? 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
