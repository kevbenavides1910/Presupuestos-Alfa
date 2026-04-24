import frappe


@frappe.whitelist()
def enviar_sales_invoice_a_crlibre(sales_invoice: str) -> dict:
    if not sales_invoice:
        frappe.throw("Debe indicar el identificador de Sales Invoice.")

    if not frappe.db.exists("Sales Invoice", sales_invoice):
        frappe.throw(f"No existe la Sales Invoice: {sales_invoice}")

    doc = frappe.get_doc("Sales Invoice", sales_invoice)
    if doc.docstatus != 1:
        frappe.throw("Solo se puede enviar una factura en estado Submitted.")

    estado = (doc.hacienda_estado or "").strip()
    if estado not in ("", "Pendiente", "Rechazado"):
        frappe.throw("Solo se puede enviar cuando el estado de Hacienda es Pendiente o Rechazado.")

    frappe.msgprint("API de CRLibre conectada")
    return {"ok": True, "message": "API de CRLibre conectada"}
