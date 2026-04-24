import re

import frappe
from frappe.utils import cint

from facturacion_cr.api_crlibre import _parse_hacienda_medios_json, _receptor_domicilio
from facturacion_cr.hacienda_codes import normalize_tribu_actividad


def validate_crlibre_settings(doc, _method=None) -> None:
    if not doc.emisor_cedula:
        frappe.throw("La cédula del emisor es obligatoria.")

    if not re.fullmatch(r"\d{9,12}", doc.emisor_cedula):
        frappe.throw("La cédula del emisor debe tener entre 9 y 12 dígitos numéricos.")

    if doc.tipo_cedula_emisor not in ("fisico", "juridico", "dimex", "nite"):
        frappe.throw("El tipo de cédula del emisor debe ser: fisico, juridico, dimex o nite.")

    if not doc.sucursal or not re.fullmatch(r"\d{3}", str(doc.sucursal)):
        frappe.throw("La sucursal debe tener exactamente 3 dígitos (por ejemplo: 001).")

    if not doc.terminal or not re.fullmatch(r"\d{5}", str(doc.terminal)):
        frappe.throw("La terminal debe tener exactamente 5 dígitos (por ejemplo: 00001).")

    if doc.api_mode == "users_loggedIn":
        if not doc.api_username or not doc.api_password:
            frappe.throw("En modo users_loggedIn debe completar API Username y API Password.")

    actividad = (getattr(doc, "actividad_economica_principal", None) or "").strip()
    if not actividad:
        frappe.throw("La actividad economica principal (TRIBU ej. 7020.0 o 6 digitos v4.4) es obligatoria.")
    norm = normalize_tribu_actividad(actividad)
    if not norm or not re.fullmatch(r"\d{6}", norm):
        frappe.throw(
            "La actividad economica principal debe ser formato TRIBU (ej. 7020.0) o 6 digitos para el XML v4.4."
        )
    doc.actividad_economica_principal = norm


def before_submit_sales_invoice_actividad(doc, _method=None) -> None:
    code = (getattr(doc, "hacienda_actividad_economica", None) or "").strip()
    if not code:
        frappe.throw(
            "Indique el codigo de actividad economica (TRIBU ej. 7020.0 o 6 digitos v4.4) en Ministerio de Hacienda CR."
        )
    norm = normalize_tribu_actividad(code)
    if not norm or not re.fullmatch(r"\d{6}", norm):
        frappe.throw(
            "Actividad economica en la factura: formato TRIBU (ej. 7020.0) o 6 digitos v4.4."
        )
    doc.hacienda_actividad_economica = norm


def before_submit_sales_invoice_hacienda_items(doc, _method=None) -> None:
    from frappe.utils import flt

    cond = (getattr(doc, "hacienda_condicion_venta", None) or "01").strip()
    if cond == "02" and not doc.due_date:
        frappe.throw("Para condicion de venta 02 (Credito) debe indicar la fecha de vencimiento (Due Date) de la factura.")

    ar = (getattr(doc, "hacienda_actividad_receptor", None) or "").strip()
    if ar:
        ar_norm = normalize_tribu_actividad(ar)
        if not ar_norm or not re.fullmatch(r"\d{6}", ar_norm):
            frappe.throw(
                "Actividad economica del receptor: formato TRIBU (ej. 7020.0) o 6 digitos v4.4."
            )
        doc.hacienda_actividad_receptor = ar_norm

    medio_prin = (getattr(doc, "hacienda_medio_pago", None) or "").strip()
    rows_mp = _parse_hacienda_medios_json(doc) or []
    if not rows_mp and medio_prin == "99":
        otro = (getattr(doc, "hacienda_medio_pago_otro", None) or "").strip()
        if len(otro) < 5:
            frappe.throw('Si el medio de pago principal es 99 (Otros), indique "Detalle medio Otros" con al menos 5 caracteres.')

    if rows_mp:
        if len(rows_mp) > 4:
            frappe.throw("Hacienda permite como maximo 4 medios de pago en el desglose (JSON).")
        total_inv = round(flt(doc.grand_total), 2)
        sum_mp = round(sum(flt(r.get("monto", 0)) for r in rows_mp), 2)
        if abs(sum_mp - total_inv) > 0.02:
            frappe.throw(
                f"La suma de montos en 'Desglose medios de pago (JSON)' ({sum_mp}) debe coincidir con el total del comprobante ({total_inv})."
            )
        for r in rows_mp:
            if str(r.get("tipo_medio") or "").strip() == "99":
                det = (r.get("detalle_otro") or "").strip()
                if len(det) < 5:
                    frappe.throw("En medios de pago (JSON): si el tipo es 99, indique detalle_otro con minimo 5 caracteres en cada elemento.")

    hacienda_settings = frappe.get_single("CRLibre Settings")
    if cint(getattr(hacienda_settings, "exigir_ubicacion_receptor", 1)):
        rec_p, rec_c, rec_d, rec_b, _ro = _receptor_domicilio(doc.customer)
        if not (str(rec_p or "").strip() and str(rec_c or "").strip() and str(rec_d or "").strip()):
            frappe.throw(
                "El cliente debe tener una direccion principal con Provincia, Canton y Distrito Hacienda "
                "(campos personalizados en Address, por ejemplo custom_provincia_hacienda). "
                "O desactive 'Exigir domicilio receptor' en CRLibre Settings si el XML no lo requiere."
            )

    for row in doc.items or []:
        if flt(row.discount_amount) <= 0:
            pass
        else:
            nat = (getattr(row, "hacienda_naturaleza_descuento", None) or "").strip()
            if not nat:
                frappe.throw(
                    f"Linea {row.idx} ({row.item_code or ''}): con descuento debe completar "
                    '"Naturaleza descuento (Hacienda)" (3 a 80 caracteres, v4.4).'
                )
            if len(nat) < 3 or len(nat) > 80:
                frappe.throw(
                    f"Linea {row.idx} ({row.item_code or ''}): Naturaleza descuento debe tener entre 3 y 80 caracteres."
                )

        num_ex = (getattr(row, "hacienda_exon_numero_documento", None) or "").strip()
        if num_ex:
            if not (getattr(row, "hacienda_exon_nombre_institucion", None) or "").strip():
                frappe.throw(f"Linea {row.idx}: exoneracion requiere institucion.")
            if not getattr(row, "hacienda_exon_fecha", None):
                frappe.throw(f"Linea {row.idx}: exoneracion requiere fecha de documento.")
            tdoc = (getattr(row, "hacienda_exon_tipo_documento", None) or "").strip()
            if not tdoc:
                frappe.throw(f"Linea {row.idx}: exoneracion requiere tipo de documento (2 digitos nota 10.1).")
            if not re.fullmatch(r"\d{2}", tdoc):
                frappe.throw(f"Linea {row.idx}: tipo documento exoneracion debe ser 2 digitos.")


def validate_customer_hacienda(doc, _method=None) -> None:
    c = (getattr(doc, "hacienda_codigo_actividad_receptor", None) or "").strip()
    if c:
        c_norm = normalize_tribu_actividad(c)
        if not c_norm or not re.fullmatch(r"\d{6}", c_norm):
            frappe.throw(
                "Actividad economica del cliente: formato TRIBU (ej. 7020.0) o 6 digitos v4.4."
            )
        doc.hacienda_codigo_actividad_receptor = c_norm
    t = (getattr(doc, "hacienda_tipo_identificacion", None) or "").strip()
    if t and t not in ("01", "02", "03", "04"):
        frappe.throw("Tipo identificacion Hacienda debe ser 01, 02, 03 o 04.")
