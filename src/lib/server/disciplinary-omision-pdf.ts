import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { embedBrandingLogo, embedDisciplinarySignatureImage } from "@/lib/server/disciplinary-pdf-logo";
import { DEFAULT_DOCUMENT_INTRO_TEMPLATE, renderMailTemplate } from "@/lib/server/disciplinary-settings";

export type OmisionPdfInput = {
  numero: string;
  codigoEmpleado: string;
  nombreEmpleado: string;
  fechaEmision: Date;
  /** Desde maestro RRHH (columna Cédula en CSV). */
  cedula?: string | null;
  zona?: string | null;
  sucursal?: string | null;
  /** Ya no se imprimen en el PDF (se conservan opcionales por compatibilidad con llamadas antiguas). */
  contrato?: string | null;
  cliente?: string | null;
  administrador?: string | null;
  omisiones: { fecha: Date; hora: string | null; puntoOmitido?: string | null }[];
  documentTitle?: string | null;
  documentLegalText?: string | null;
  /** Párrafo tras el saludo; placeholders {{numero}}, {{fecha_emision}}, {{omisiones_count}}, {{nombre}}, {{codigo}}, {{cedula}}. */
  documentIntroTemplate?: string | null;
  documentFooter?: string | null;
  formCode?: string | null;
  formRevision?: string | null;
  formVersion?: string | null;
  formSubtitle?: string | null;
  /** Logo de Mantenimientos → Marca (PNG/JPEG). */
  brandingLogoFile?: { bytes: Uint8Array; path: string } | null;
  /** Firma/sello fijo desde Ajustes → Documento (PNG/JPEG en PDF; WebP subir como PNG). */
  signatureImageFile?: { bytes: Uint8Array; path: string } | null;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 42;
const BLUE = rgb(0.1, 0.35, 0.62);
const TEXT = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.38, 0.38, 0.42);
const BORDER = rgb(0.55, 0.55, 0.58);

function fmtDate(d: Date): string {
  return format(d, "dd/MM/yyyy", { locale: es });
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (let i = 0; i < w.length; i += maxChars) lines.push(w.slice(i, i + maxChars));
      continue;
    }
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

function drawParagraph(
  page: PDFPage,
  text: string,
  x: number,
  yStart: number,
  maxW: number,
  size: number,
  font: PDFFont,
  color = TEXT,
  lineHeight: number,
): number {
  const approxChars = Math.max(20, Math.floor(maxW / (size * 0.48)));
  let y = yStart;
  for (const line of wrapLines(text.replace(/\r\n/g, "\n").replace(/\n/g, " "), approxChars)) {
    page.drawText(line, { x, y, size, font, color, maxWidth: maxW });
    y -= lineHeight;
  }
  return y;
}

function centerX(text: string, size: number, font: PDFFont, midX: number): number {
  const w = font.widthOfTextAtSize(text, size);
  return midX - w / 2;
}

/** PDF formal: cabecera tipo formulario corporativo y cuerpo en formato de carta. */
export async function buildOmisionPdfBytes(input: OmisionPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let cursorY = PAGE_H - MARGIN;

  const logoImage: PDFImage | null = await embedBrandingLogo(pdf, input.brandingLogoFile ?? null);
  const signatureImage: PDFImage | null = await embedDisciplinarySignatureImage(
    pdf,
    input.signatureImageFile ?? null,
  );

  const headerH = 92;
  const tableLeft = MARGIN;
  const tableW = PAGE_W - 2 * MARGIN;
  const col1W = 118;
  const col2W = 268;
  const headerBottom = cursorY - headerH;

  page.drawRectangle({
    x: tableLeft,
    y: headerBottom,
    width: tableW,
    height: headerH,
    borderWidth: 0.75,
    borderColor: BORDER,
    color: undefined,
  });

  const xDiv1 = tableLeft + col1W;
  const xDiv2 = xDiv1 + col2W;
  page.drawLine({
    start: { x: xDiv1, y: headerBottom },
    end: { x: xDiv1, y: cursorY },
    thickness: 0.75,
    color: BORDER,
  });
  page.drawLine({
    start: { x: xDiv2, y: headerBottom },
    end: { x: xDiv2, y: cursorY },
    thickness: 0.75,
    color: BORDER,
  });

  if (logoImage) {
    const maxW = col1W - 16;
    const maxH = headerH - 16;
    const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height);
    const w = logoImage.width * scale;
    const h = logoImage.height * scale;
    page.drawImage(logoImage, {
      x: tableLeft + (col1W - w) / 2,
      y: headerBottom + (headerH - h) / 2,
      width: w,
      height: h,
    });
  }

  const mid2 = xDiv1 + col2W / 2;
  const formWord = "FORMULARIO";
  page.drawText(formWord, {
    x: centerX(formWord, 9, font, mid2),
    y: headerBottom + headerH - 22,
    size: 9,
    font,
    color: MUTED,
  });

  const subtitle =
    input.formSubtitle?.trim() || input.documentTitle?.trim() || "Apercibimiento por omisión de marca";
  const subSize = 11;
  const subLines = wrapLines(subtitle, 28);
  let subY = headerBottom + headerH - 40;
  for (const ln of subLines) {
    page.drawText(ln, {
      x: centerX(ln, subSize, bold, mid2),
      y: subY,
      size: subSize,
      font: bold,
      color: BLUE,
    });
    subY -= subSize + 3;
  }

  const code = input.formCode?.trim() || "F-RH-30";
  const rev = input.formRevision?.trim() || "—";
  const ver = input.formVersion?.trim() || "—";
  const metaX = xDiv2 + 8;
  let metaY = headerBottom + headerH - 20;
  const metaSize = 8.5;
  const drawMeta = (label: string, value: string) => {
    page.drawText(label, { x: metaX, y: metaY, size: metaSize, font: bold, color: TEXT });
    const lw = bold.widthOfTextAtSize(label, metaSize);
    page.drawText(value, { x: metaX + lw + 4, y: metaY, size: metaSize, font, color: TEXT });
    metaY -= 13;
  };
  drawMeta("Código:", code);
  drawMeta("Modificación:", rev);
  drawMeta("Versión:", ver);
  drawMeta("Página:", "1");

  cursorY = headerBottom - 28;

  const bodyLeft = MARGIN;
  const bodyW = PAGE_W - 2 * MARGIN;
  const lineH = 13;

  page.drawText(`Fecha de emisión: ${fmtDate(input.fechaEmision)}`, {
    x: bodyLeft,
    y: cursorY,
    size: 11,
    font,
    color: TEXT,
  });
  cursorY -= lineH * 2;

  page.drawText("Señor(a)", { x: bodyLeft, y: cursorY, size: 11, font, color: TEXT });
  cursorY -= lineH;
  page.drawText(input.nombreEmpleado.toUpperCase(), { x: bodyLeft, y: cursorY, size: 12, font: bold, color: TEXT });
  cursorY -= lineH * 2;

  page.drawText("Estimado(a) Señor(a):", { x: bodyLeft, y: cursorY, size: 11, font, color: TEXT });
  cursorY -= lineH * 1.6;

  const introTpl = input.documentIntroTemplate?.trim() || DEFAULT_DOCUMENT_INTRO_TEMPLATE;
  const intro = renderMailTemplate(introTpl, {
    numero: input.numero,
    fecha_emision: fmtDate(input.fechaEmision),
    omisiones_count: input.omisiones.length,
    nombre: input.nombreEmpleado,
    codigo: input.codigoEmpleado,
    cedula: input.cedula?.trim() ?? "",
  });
  const introParas = intro
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\n/g, " "))
    .filter(Boolean);
  for (const para of introParas.length > 0 ? introParas : [intro.trim() || " "]) {
    cursorY = drawParagraph(page, para, bodyLeft, cursorY, bodyW, 10.5, font, TEXT, 13);
    cursorY -= 6;
  }
  cursorY -= 2;

  page.drawText(`Código de empleado: ${input.codigoEmpleado}`, { x: bodyLeft, y: cursorY, size: 10, font, color: TEXT });
  cursorY -= lineH;
  if (input.cedula?.trim()) {
    page.drawText(`Cédula: ${input.cedula.trim()}`, { x: bodyLeft, y: cursorY, size: 10, font, color: TEXT });
    cursorY -= lineH;
  }
  if (input.zona?.trim()) {
    page.drawText(`Zona: ${input.zona.trim()}`, { x: bodyLeft, y: cursorY, size: 10, font, color: TEXT });
    cursorY -= lineH;
  }
  if (input.sucursal?.trim()) {
    page.drawText(`Sucursal: ${input.sucursal.trim()}`, { x: bodyLeft, y: cursorY, size: 10, font, color: TEXT });
    cursorY -= lineH;
  }
  cursorY -= 6;

  page.drawText("Omisiones de marca registradas:", { x: bodyLeft, y: cursorY, size: 10, font: bold, color: TEXT });
  cursorY -= lineH;
  for (const o of input.omisiones) {
    const horaTxt = o.hora?.trim();
    const horaPart = horaTxt ? ` — Hora de la omisión: ${horaTxt}` : "";
    const punto = o.puntoOmitido?.trim();
    const puntoPart = punto ? ` — Punto omitido: ${punto}` : "";
    const bullet = `• Fecha: ${fmtDate(o.fecha)}${horaPart}${puntoPart}`;
    if (cursorY < 120) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      cursorY = PAGE_H - MARGIN;
    }
    const lines = wrapLines(bullet, 78);
    for (const ln of lines) {
      if (cursorY < 120) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        cursorY = PAGE_H - MARGIN;
      }
      page.drawText(ln, { x: bodyLeft + 8, y: cursorY, size: 10, font, color: TEXT });
      cursorY -= lineH * 0.95;
    }
  }
  cursorY -= 10;

  const legal =
    input.documentLegalText?.trim() ||
    "Se registra apercibimiento por omisiones de marca según normativa interna vigente.";
  const legalParas = legal
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\n/g, " "))
    .filter(Boolean);
  for (const para of legalParas) {
    if (cursorY < 140) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      cursorY = PAGE_H - MARGIN;
    }
    cursorY = drawParagraph(page, para, bodyLeft, cursorY, bodyW, 10, font, TEXT, 12);
    cursorY -= 10;
  }
  cursorY -= 12;

  const closingMidX = PAGE_W / 2;
  if (cursorY < 175) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    cursorY = PAGE_H - MARGIN;
  }

  const valediction = "Atentamente,";
  page.drawText(valediction, {
    x: centerX(valediction, 11, font, closingMidX),
    y: cursorY,
    size: 11,
    font,
    color: TEXT,
  });
  cursorY -= 22;

  const sigSlotW = 320;
  const sigSlotH = 96;
  if (signatureImage) {
    const scale = Math.min(sigSlotW / signatureImage.width, sigSlotH / signatureImage.height);
    const sw = signatureImage.width * scale;
    const sh = signatureImage.height * scale;
    page.drawImage(signatureImage, {
      x: closingMidX - sw / 2,
      y: cursorY - sh,
      width: sw,
      height: sh,
    });
    cursorY -= sh + 12;
  } else {
    cursorY -= 8;
    page.drawLine({
      start: { x: closingMidX - sigSlotW / 2, y: cursorY },
      end: { x: closingMidX + sigSlotW / 2, y: cursorY },
      thickness: 0.5,
      color: MUTED,
    });
    cursorY -= 12;
  }
  const firmaLabel = "Firma y sello";
  page.drawText(firmaLabel, {
    x: centerX(firmaLabel, 8, font, closingMidX),
    y: cursorY,
    size: 8,
    font,
    color: MUTED,
  });
  cursorY -= 28;

  const foot =
    input.documentFooter?.trim() ||
    "Documento generado desde Syntra — Control de Rentabilidad. Conserve este archivo para archivo disciplinario.";
  if (cursorY < 72) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    cursorY = PAGE_H - MARGIN;
  }
  drawParagraph(page, foot, bodyLeft, cursorY, bodyW, 8, font, MUTED, 10);

  return pdf.save();
}
