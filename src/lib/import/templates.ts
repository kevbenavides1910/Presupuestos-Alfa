import * as XLSX from "xlsx";

const CONTRACT_HEADERS = [
  "licitacion_no",
  "empresa",
  "cliente",
  "tipo_cliente",
  "oficiales",
  "puestos",
  "fecha_inicio",
  "fecha_fin",
  "facturacion_mensual",
  "labor_pct",
  "supplies_pct",
  "admin_pct",
  "profit_pct",
  "estado",
  "notas",
];

const EXPENSE_HEADERS = [
  "licitacion_no",
  "tipo",
  "partida",
  "descripcion",
  "monto",
  "mes",
  "empresa",
  "diferido",
  "origen",
  "referencia",
  "notas",
];

export function contractImportTemplateBuffer(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([CONTRACT_HEADERS]);
  ws["!cols"] = CONTRACT_HEADERS.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  const help = XLSX.utils.aoa_to_sheet([
    ["Columnas: licitacion_no (único), empresa (CONSORCIO o «Consorcio»), cliente, tipo_cliente (PUBLIC/PRIVATE),"],
    ["oficiales y puestos: opcionales (por defecto 1). Fechas y facturacion_mensual obligatorias."],
    ["labor_pct…profit_pct: opcionales; si faltan se usa 65% / 15% / 12% / 8% y se normaliza si solo informa parte."],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Contratos");
  XLSX.utils.book_append_sheet(wb, help, "Instrucciones");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function expenseImportTemplateBuffer(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([EXPENSE_HEADERS]);
  ws["!cols"] = EXPENSE_HEADERS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  const help = XLSX.utils.aoa_to_sheet([
    ["licitacion_no: obligatorio salvo si diferido=sí. tipo: códigos APERTURA, UNIFORMS… o nombre (Uniformes)."],
    ["partida: LABOR, SUPPLIES, ADMIN, PROFIT o alias en español. mes: YYYY-MM. origen: nombre exacto del catálogo."],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Gastos");
  XLSX.utils.book_append_sheet(wb, help, "Instrucciones");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
