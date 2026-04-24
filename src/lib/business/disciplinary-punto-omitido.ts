import { pickCell } from "@/lib/import/xlsx-read";

/** Alias de columnas habituales en export de marcas / inspecciones para el lugar o dispositivo no marcado. */
const PUNTO_OMITIDO_ALIASES = [
  "Punto",
  "PUNTO",
  "Punto omitido",
  "Punto Omitido",
  "PUNTO OMITIDO",
  "Punto de marca",
  "Punto de Marca",
  "Punto marca",
  "Marca programada",
  "Marca Programada",
  "Dispositivo",
  "Ubicacion marca",
  "Ubicación marca",
  "Nombre marca",
  "Nombre Marca",
  "Descripcion marca",
  "Descripción marca",
  "Descripcion Marca",
  "Lugar marca",
  "Lugar Marca",
  "Puesto de marca",
  "Puesto de Marca",
  "Ubicación física",
  "Ubicacion fisica",
  "Equipo",
  "Detalle marca",
  "Detalle Marca",
];

export function pickPuntoOmitidoFromRow(norm: Record<string, unknown>): string | null {
  const v = pickCell(norm, PUNTO_OMITIDO_ALIASES);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
