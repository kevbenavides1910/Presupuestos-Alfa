import type { Transporter } from "nodemailer";

const CC_SPLIT = /[;,\n]+/;

export function parseEmailAddressList(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(CC_SPLIT)) {
    const e = part.trim();
    if (e) out.push(e);
  }
  return out;
}

/**
 * Une CC fijo (ajustes) + administrador de zona; evita duplicar el destinatario principal y direcciones repetidas.
 */
export function mergeDisciplinaryCc(
  to: string,
  fixedCcRaw: string | null | undefined,
  zoneAdministratorCc?: string | null,
): string | undefined {
  const toL = to.trim().toLowerCase();
  const seen = new Set<string>();
  const addrs: string[] = [];
  const push = (addr: string) => {
    const t = addr.trim();
    if (!t) return;
    const tl = t.toLowerCase();
    if (tl === toL) return;
    if (seen.has(tl)) return;
    seen.add(tl);
    addrs.push(t);
  };
  for (const a of parseEmailAddressList(fixedCcRaw)) push(a);
  if (zoneAdministratorCc?.trim()) push(zoneAdministratorCc.trim());
  return addrs.length > 0 ? addrs.join(", ") : undefined;
}

export async function sendDisciplinaryOmisionEmail(opts: {
  transport: Transporter;
  from: string;
  to: string;
  /** Copia al administrador de zona (catálogo Zonas) si aplica. */
  cc?: string;
  subject: string;
  text: string;
  pdfFilename: string;
  pdfBytes: Uint8Array;
}): Promise<void> {
  await opts.transport.sendMail({
    from: opts.from,
    to: opts.to,
    ...(opts.cc ? { cc: opts.cc } : {}),
    subject: opts.subject,
    text: opts.text,
    attachments: [{ filename: opts.pdfFilename, content: Buffer.from(opts.pdfBytes) }],
  });
}
