import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  pickCell,
  rowToNormalized,
  parseDateCell,
  readSheetsByAliases,
} from "@/lib/import/xlsx-read";
import {
  calculateVigencia,
  normalizeEmployeeCode,
  normalizeLicitacion,
  parseClosedCyclesJson,
  parseDisciplinaryStatus,
  parseOmisionesEntries,
  type OmisionEntry,
} from "@/lib/business/disciplinary";
import { pickPuntoOmitidoFromRow } from "@/lib/business/disciplinary-punto-omitido";
import { defaultsForZoneText, loadZoneDisciplinaryDefaultsMap } from "@/lib/server/disciplinary-zone-defaults";

export interface DisciplinaryImportResult {
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

/**
 * Error tirado cuando se intenta subir un archivo ya procesado (mismo checksum).
 * La API lo convierte en un HTTP 409 con mensaje amigable para el usuario.
 */
export class DuplicateImportError extends Error {
  readonly previousBatch: {
    id: string;
    filename: string;
    createdAt: Date;
    uploadedByName: string | null;
  };

  constructor(previousBatch: DuplicateImportError["previousBatch"]) {
    super(
      `Este archivo ya fue importado el ${previousBatch.createdAt.toLocaleString()}` +
        ` (batch ${previousBatch.id}). No se procesó de nuevo.`,
    );
    this.name = "DuplicateImportError";
    this.previousBatch = previousBatch;
  }
}

/** Calcula el SHA-256 del contenido en hexadecimal (minúsculas). */
function sha256Hex(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function toIntFlexible(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toDateOrNull(v: unknown): Date | null {
  const ymd = parseDateCell(v);
  if (!ymd) return null;
  // ymd viene como YYYY-MM-DD; lo construimos en hora local 00:00 para evitar saltos de huso.
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toDateRequired(v: unknown): Date | null {
  return toDateOrNull(v);
}

/**
 * Importa un Excel del módulo disciplinario.
 *
 * Comportamiento simplificado (un solo modo):
 * - Si el archivo ya fue subido antes (mismo SHA-256), se RECHAZA con
 *   {@link DuplicateImportError} y nada se escribe.
 * - Apercibimientos nuevos (por N°) se INSERTAN.
 * - Apercibimientos que ya existen se DEJAN INTACTOS (el seguimiento es de la web),
 *   pero sus fechas de omisión se MERGEAN (solo se agregan las fechas nuevas que
 *   el Excel reporte; nunca se borran las existentes).
 * - Tratamientos: se INSERTAN solo si el código no tenía tratamiento aún. Nunca se
 *   sobreescribe el tratamiento ni se borran los ciclos cerrados.
 *
 * Las filas con error no abortan toda la importación; se reportan y el resto se aplica.
 */
export async function importDisciplinaryWorkbook(
  buffer: ArrayBuffer,
  filename: string,
  uploadedById: string,
): Promise<DisciplinaryImportResult> {
  // 0a) Calculamos el checksum antes de tocar nada, y rechazamos si ya existe.
  const checksum = sha256Hex(buffer);
  const previous = await prisma.disciplinaryImportBatch.findUnique({
    where: { checksum },
    select: {
      id: true,
      filename: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
  });
  if (previous) {
    throw new DuplicateImportError({
      id: previous.id,
      filename: previous.filename,
      createdAt: previous.createdAt,
      uploadedByName: previous.uploadedBy?.name ?? null,
    });
  }

  const sheets = readSheetsByAliases(buffer, {
    historial: ["Historial", "Apercibimientos"],
    stats: ["Estadisticas", "Estadísticas", "Tratamiento", "Stats", "Estadistica"],
  });

  if (!sheets.historial && !sheets.stats) {
    throw new Error(
      'El Excel no contiene las hojas esperadas. Se requiere al menos "Historial" o "Estadísticas".',
    );
  }

  const errors: DisciplinaryImportResult["errors"] = [];

  // ── 0) Cache de contratos para resolver cliente desde el N° de licitación.
  //   Cargamos todos en memoria una sola vez: hay como mucho cientos.
  const allContracts = await prisma.contract.findMany({
    where: { deletedAt: null },
    select: { licitacionNo: true, client: true },
  });
  const contractClientByLicitacion = new Map<string, string>();
  for (const c of allContracts) {
    const key = normalizeLicitacion(c.licitacionNo);
    if (key) contractClientByLicitacion.set(key, c.client);
  }
  function resolveClienteByContrato(contratoNorm: string | null): string | null {
    if (!contratoNorm) return null;
    return contractClientByLicitacion.get(contratoNorm) ?? null;
  }

  // Contadores agregados de omisiones procesadas, expuestos al final del import.
  let omInserted = 0;
  let omDeleted = 0;

  /**
   * Sincroniza las fechas de omisión de un apercibimiento REEMPLAZANDO la
   * lista completa por la que reporta el Excel.
   *
   * Por qué reemplazar y no mergear:
   *   · Una persona puede tener VARIAS omisiones distintas el mismo día
   *     (ej.: no marcó entrada y no marcó salida). Las guardamos como filas
   *     independientes (sin unique por fecha) preservando la cardinalidad.
   *   · Como las omisiones del mismo día son indistinguibles entre sí, un
   *     merge no puede decidir cuántas son "nuevas" y cuántas son las que ya
   *     teníamos. Reemplazar la lista completa con lo que dice el Excel es
   *     determinístico y refleja exactamente lo registrado por la app de
   *     escritorio (que es la fuente autoritaria de las omisiones).
   *   · Si la celda del Excel viene VACÍA, NO tocamos lo existente: asumimos
   *     que es ausencia de información, no un borrado intencional.
   *   · El checksum del archivo evita reprocesar la misma exportación y, por
   *     tanto, evita reescrituras innecesarias.
   */
  async function replaceOmisiones(
    apercibimientoId: string,
    entries: OmisionEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const del = await prisma.disciplinaryOmission.deleteMany({
      where: { apercibimientoId },
    });
    omDeleted += del.count;
    const result = await prisma.disciplinaryOmission.createMany({
      data: entries.map((e, idx) => ({
        apercibimientoId,
        fecha: e.fecha,
        hora: e.hora,
        puntoOmitido: e.puntoOmitido?.trim() || null,
        secuencia: idx,
      })),
    });
    omInserted += result.count;
  }

  // ── 1) Crear el batch primero, para enlazar las filas que se importen.
  //   Guardamos el checksum aquí: el UNIQUE a nivel de DB es la red de seguridad
  //   por si dos subidas exactamente simultáneas pasaran el check de arriba.
  const batch = await prisma.disciplinaryImportBatch.create({
    data: {
      filename,
      checksum,
      uploadedById,
      rowsHistorial: sheets.historial?.length ?? 0,
      rowsTratamiento: sheets.stats?.length ?? 0,
    },
  });

  const zoneDisciplineDefaults = await loadZoneDisciplinaryDefaultsMap();

  // ── 2) Procesar Historial (upsert por N°).
  let apInserted = 0;
  const apUpdated = 0;
  let apSkipped = 0;

  if (sheets.historial) {
    let sheetRow = 2; // fila 1 son encabezados
    for (const raw of sheets.historial) {
      const norm = rowToNormalized(raw);
      const numero = emptyToNull(
        pickCell(norm, ["N° Apercibimiento", "No Apercibimiento", "Numero", "N° Apercibimiento "]),
      );
      // Filas vacías se saltan silenciosamente.
      const codigoRaw = pickCell(norm, ["Código", "Codigo", "Código Empleado", "Codigo Empleado"]);
      const nombreRaw = pickCell(norm, ["Nombre", "Nombre Empleado"]);
      const fechaRaw = pickCell(norm, ["Fecha Emisión", "Fecha Emision", "Fecha de Emisión", "Fecha"]);
      if (!numero && !codigoRaw && !nombreRaw && !fechaRaw) {
        sheetRow++;
        continue;
      }

      try {
        if (!numero) throw new Error("Falta N° Apercibimiento");
        const fechaEmision = toDateRequired(fechaRaw);
        if (!fechaEmision) throw new Error("Fecha de Emisión inválida o vacía");
        const codigo = normalizeEmployeeCode(codigoRaw);
        if (!codigo) throw new Error("Código de empleado vacío");
        const nombre = emptyToNull(nombreRaw);
        if (!nombre) throw new Error("Nombre del empleado vacío");

        const estado = parseDisciplinaryStatus(pickCell(norm, ["Estado"]));
        const vigencia = calculateVigencia(fechaEmision, estado);

        const contratoRaw = emptyToNull(
          pickCell(norm, [
            "Contrato",
            "Contrato/Licitación",
            "Licitación",
            "Licitacion",
            "N° Licitación",
            "No Licitacion",
            "Numero Licitacion",
            "N° Contrato",
            "Numero Contrato",
          ]),
        );
        const contratoNormalizado = normalizeLicitacion(contratoRaw);
        const cliente = resolveClienteByContrato(contratoNormalizado);

        // La celda de fecha de omisión puede contener 1..N fechas separadas por coma/;/|/newline.
        const puntoFila = pickPuntoOmitidoFromRow(norm);
        const omisionEntries: OmisionEntry[] = parseOmisionesEntries(
          pickCell(norm, [
            "Fecha de Omisión",
            "Fecha de Omision",
            "Fechas de Omisión",
            "Fechas de Omision",
            "Fecha Omisión",
            "Fecha Omision",
            "Fechas Omisión",
            "Fechas Omisiones",
            "Omisión Fechas",
          ]),
        ).map((e) => ({ ...e, puntoOmitido: e.puntoOmitido ?? puntoFila }));

        const zonaVal = emptyToNull(pickCell(norm, ["Zona"]));
        let administrador = emptyToNull(pickCell(norm, ["Administrador"]));
        if (!administrador && zonaVal) {
          const zd = defaultsForZoneText(zoneDisciplineDefaults, zonaVal);
          if (zd?.administrator) administrador = zd.administrator;
        }

        const data = {
          numero,
          fechaEmision,
          codigoEmpleado: codigo,
          codigoEmpleadoRaw: emptyToNull(codigoRaw),
          nombreEmpleado: nombre,
          zona: zonaVal,
          sucursal: emptyToNull(pickCell(norm, ["Sucursal"])),
          cantidadOmisiones: toIntFlexible(pickCell(norm, ["Omisiones", "Cantidad Omisiones", "Cantidad de Omisiones"])),
          administrador,
          correoEnviadoA: emptyToNull(pickCell(norm, ["Correo", "Correo Enviado A"])),
          rutaPdf: emptyToNull(pickCell(norm, ["PDF", "Ruta PDF", "Ruta del PDF"])),
          estado,
          vigencia,
          batchExterno: emptyToNull(pickCell(norm, ["Batch ID", "BatchId", "Batch"])),
          plantilla: emptyToNull(pickCell(norm, ["Plantilla"])),
          planoOrigen: emptyToNull(pickCell(norm, ["Plano", "Plano Origen"])),
          motivoAnulacion: emptyToNull(pickCell(norm, ["Motivo anulación", "Motivo Anulacion"])),
          evidenciaAnulacion: emptyToNull(pickCell(norm, ["Evidencia", "Evidencia anulación", "Evidencia Anulacion"])),
          contrato: contratoRaw,
          contratoNormalizado,
          cliente,
          importBatchId: batch.id,
        };

        const existing = await prisma.disciplinaryApercibimiento.findUnique({
          where: { numero },
          select: { id: true, cliente: true, clienteSetManual: true },
        });

        // Política única: si el apercibimiento no existe, se INSERTA (con sus fechas de
        // omisión); si ya existe, NO se toca el apercibimiento (el seguimiento se hace
        // desde la web) pero SÍ se MERGEAN fechas de omisión nuevas que el Excel reporte.
        if (existing) {
          await replaceOmisiones(existing.id, omisionEntries);
          apSkipped++;
        } else {
          const created = await prisma.disciplinaryApercibimiento.create({
            data,
            select: { id: true },
          });
          await replaceOmisiones(created.id, omisionEntries);
          apInserted++;
        }
      } catch (e) {
        apSkipped++;
        errors.push({
          sheet: "Historial",
          row: sheetRow,
          message: e instanceof Error ? e.message : "Error desconocido",
        });
      }
      sheetRow++;
    }
  }

  // ── 3) Procesar Estadísticas / Tratamiento.
  //   Política única: solo se INSERTA el tratamiento si el código no tenía uno aún.
  //   Si ya existía, se ignora (el seguimiento se gestiona desde la web).
  let trInserted = 0;
  const trUpdated = 0;
  let trSkipped = 0;

  if (sheets.stats) {
    let sheetRow = 2;
    for (const raw of sheets.stats) {
      const norm = rowToNormalized(raw);
      const codigoRaw = pickCell(norm, ["Código", "Codigo", "Código Empleado", "Codigo Empleado"]);
      if (!codigoRaw) {
        sheetRow++;
        continue;
      }
      try {
        const codigo = normalizeEmployeeCode(codigoRaw);
        if (!codigo) throw new Error("Código de empleado vacío");

        const fechaConvocatoria = toDateOrNull(pickCell(norm, ["fecha_convocatoria", "Fecha Convocatoria"]));
        const accion = emptyToNull(pickCell(norm, ["accion", "acción", "Acción"]));
        const cobradoDate = toDateOrNull(pickCell(norm, ["cobrado_date", "Cobrado Date", "Cobrado"]));
        const cyclesRaw = pickCell(norm, ["closed_cycles_json", "Closed Cycles", "Ciclos Cerrados"]);
        const ciclos = parseClosedCyclesJson(cyclesRaw);

        const existing = await prisma.disciplinaryTreatment.findUnique({
          where: { codigoEmpleado: codigo },
          select: { id: true },
        });

        if (existing) {
          // No tocamos tratamientos existentes: el seguimiento se hace desde la web.
          trSkipped++;
          sheetRow++;
          continue;
        }

        const treatmentData = {
          codigoEmpleado: codigo,
          codigoEmpleadoRaw: emptyToNull(codigoRaw),
          nombre: emptyToNull(pickCell(norm, ["Nombre", "nombre"])),
          zona: emptyToNull(pickCell(norm, ["Zona", "zona"])),
          fechaConvocatoria,
          accion,
          cobradoDate,
          importBatchId: batch.id,
        };

        await prisma.$transaction(async (tx) => {
          const created = await tx.disciplinaryTreatment.create({
            data: treatmentData,
            select: { id: true },
          });
          if (ciclos.length > 0) {
            await tx.disciplinaryClosedCycle.createMany({
              data: ciclos.map((c) => ({
                treatmentId: created.id,
                cerradoEl: c.cerradoEl,
                accion: c.accion,
                accionRaw: c.accionRaw,
                monto: c.monto !== null ? new Prisma.Decimal(c.monto) : null,
                count: c.count,
                omissions: c.omissions,
                lastDate: c.lastDate,
                fechaConvocatoria: c.fechaConvocatoria,
                nombre: c.nombre,
                zona: c.zona,
                raw: c.raw as Prisma.InputJsonValue,
              })),
            });
          }
        });
        trInserted++;
      } catch (e) {
        errors.push({
          sheet: "Estadísticas",
          row: sheetRow,
          message: e instanceof Error ? e.message : "Error desconocido",
        });
      }
      sheetRow++;
    }
  }

  // ── 4) Actualizamos los contadores del batch.
  await prisma.disciplinaryImportBatch.update({
    where: { id: batch.id },
    data: {
      rowsInserted: apInserted + trInserted,
      rowsUpdated: apUpdated + trUpdated,
      rowsSkipped: apSkipped + trSkipped,
      errorsJson: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  });

  return {
    batchId: batch.id,
    rowsHistorial: sheets.historial?.length ?? 0,
    rowsTratamiento: sheets.stats?.length ?? 0,
    apercibimientosInserted: apInserted,
    apercibimientosUpdated: apUpdated,
    apercibimientosSkipped: apSkipped,
    omisionesInserted: omInserted,
    omisionesDeleted: omDeleted,
    treatmentsInserted: trInserted,
    treatmentsUpdated: trUpdated,
    treatmentsSkipped: trSkipped,
    errors,
  };
}

/**
 * Recalcula la vigencia de TODOS los apercibimientos (útil tras una importación
 * y como tarea programada futura para mantener "Vigente/Vencido/Prescrito"
 * actualizados con el paso del tiempo). Idempotente.
 */
export async function recomputeAllVigencias(now: Date = new Date()): Promise<number> {
  const all = await prisma.disciplinaryApercibimiento.findMany({
    select: { id: true, fechaEmision: true, estado: true, vigencia: true },
  });
  let updated = 0;
  for (const a of all) {
    const v = calculateVigencia(a.fechaEmision, a.estado, now);
    if (v !== a.vigencia) {
      await prisma.disciplinaryApercibimiento.update({
        where: { id: a.id },
        data: { vigencia: v },
      });
      updated++;
    }
  }
  return updated;
}
