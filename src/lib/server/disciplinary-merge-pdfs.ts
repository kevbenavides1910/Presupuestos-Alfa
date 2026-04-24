import { PDFDocument } from "pdf-lib";

/** Une varios PDF de una página o más en un solo documento (orden preservado). */
export async function mergePdfBuffers(pdfs: Uint8Array[]): Promise<Uint8Array> {
  if (pdfs.length === 0) {
    throw new Error("No hay documentos PDF para unir");
  }
  const merged = await PDFDocument.create();
  for (const buf of pdfs) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return merged.save({ useObjectStreams: false });
}
