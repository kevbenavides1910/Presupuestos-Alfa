import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DISCIPLINARY_MAIL_PROVIDERS = ["CUSTOM_SMTP", "OUTLOOK", "GMAIL"] as const;
export type DisciplinaryMailProvider = (typeof DISCIPLINARY_MAIL_PROVIDERS)[number];

/** Texto por defecto del párrafo tras «Estimado(a) Señor(a):» (PDF). */
export const DEFAULT_DOCUMENT_INTRO_TEMPLATE =
  "Por medio de la presente se le notifica el apercibimiento N° {{numero}}, registrado con fecha de emisión {{fecha_emision}}, por {{omisiones_count}} omisión(es) de marca. Los datos del funcionario y el detalle de las omisiones registradas son los siguientes:";

export const DEFAULT_DISCIPLINARY_SETTINGS = {
  documentTitle: "APERCIBIMIENTO - OMISION DE MARCA",
  documentLegalText: "Se registra apercibimiento por omisiones de marca segun normativa interna vigente.",
  documentFooter: "Documento generado desde Syntra - Control de Rentabilidad.",
  documentFormCode: "F-RH-30",
  documentFormRevision: "05/07/2021",
  documentFormVersion: "2",
  documentFormSubtitle: "Apercibimiento por omisión de marca",
  documentIntroTemplate: DEFAULT_DOCUMENT_INTRO_TEMPLATE,
  emailSubjectTemplate: "Apercibimiento {{numero}} - omision de marca",
  emailBodyTemplate:
    "Estimado/a {{nombre}}:\n\nSe registra el apercibimiento {{numero}} por {{omisiones_count}} omision(es) de marca. Adjuntamos la constancia en PDF.\n\nEste mensaje fue enviado automaticamente desde el sistema de control.",
  mailProvider: "CUSTOM_SMTP" as DisciplinaryMailProvider,
} as const;

export async function ensureDisciplinarySettingsRow() {
  return prisma.appDisciplinarySettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ...DEFAULT_DISCIPLINARY_SETTINGS,
    },
    update: {},
  });
}

export function normalizeMailProvider(v: string | null | undefined): DisciplinaryMailProvider {
  const key = (v ?? "").trim().toUpperCase();
  if (key === "OUTLOOK" || key === "GMAIL" || key === "CUSTOM_SMTP") return key;
  return "CUSTOM_SMTP";
}

export type MailTemplateValues = Record<string, string | number | null | undefined>;

export function renderMailTemplate(template: string, values: MailTemplateValues): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => {
    const raw = values[key];
    if (raw === undefined || raw === null) return "";
    return String(raw);
  });
}

/**
 * Número único OM-AAAA-NNNNNN (consecutivo por año civil). Asignación atómica (transacción serializable).
 */
export async function allocateNextApercibimientoNumero(fechaEmision: Date): Promise<string> {
  const year = fechaEmision.getFullYear();
  await ensureDisciplinarySettingsRow();
  return prisma.$transaction(
    async (tx) => {
      const row = await tx.appDisciplinarySettings.findUniqueOrThrow({ where: { id: "default" } });
      const prevYear = row.apercibimientoConsecutiveYear;
      const prevLast = row.apercibimientoConsecutiveLast ?? 0;
      const next = prevYear === year ? prevLast + 1 : 1;
      await tx.appDisciplinarySettings.update({
        where: { id: "default" },
        data: {
          apercibimientoConsecutiveYear: year,
          apercibimientoConsecutiveLast: next,
        },
      });
      return `OM-${year}-${String(next).padStart(6, "0")}`;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
