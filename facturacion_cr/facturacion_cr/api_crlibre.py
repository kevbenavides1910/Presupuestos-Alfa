from __future__ import annotations

import json
import os
import random
import re
from datetime import time
from typing import Any
from urllib.parse import urlparse

import frappe
import requests
from frappe.utils import cint, flt, get_datetime, getdate

from facturacion_cr.hacienda_codes import normalize_tribu_actividad, tribu_display_from_six_digits

# Codigos de tipo de identificacion segun XSD Hacienda / uso comun en genXML
_TIPO_IDENTIF_MAP = {"fisico": "01", "juridico": "02", "dimex": "03", "nite": "04"}


def _actividad_valor_para_xml(codigo_seis: str, settings) -> str:
    """6 digitos internos -> XML TRIBU (4752.1) o 6 digitos segun CRLibre Settings."""
    s = (codigo_seis or "").strip()
    if not s:
        return ""
    if not cint(getattr(settings, "enviar_actividad_formato_tribu_xml", 1)):
        return s
    if re.fullmatch(r"\d{6}", s):
        return tribu_display_from_six_digits(s)
    return s


def _normalize_api_base(api_url: str) -> str:
    if not api_url:
        frappe.throw("CRLibre Settings: API URL vacia.")
    url = api_url.strip()
    if url.endswith("/"):
        url = url[:-1]
    path = urlparse(url).path or ""
    if path.endswith("/api"):
        url = url + ".php"
    elif path.endswith("/api.php"):
        pass
    elif not path.endswith("api.php"):
        if path.endswith("api") or url.endswith("api"):
            url = url + ".php"
        elif "api.php" not in url:
            url = url + "/api.php"
    return url


def _auth_params(settings) -> dict[str, str]:
    if getattr(settings, "api_mode", None) != "users_loggedIn":
        return {}
    refresh_crlibre_session_if_needed(settings)
    settings = frappe.get_single("CRLibre Settings")
    iam = (settings.api_username or "").strip()
    session_key = (settings.session_key or "").strip()
    if not iam or not session_key:
        frappe.throw("No se pudo obtener sessionKey CRLibre (users_loggedIn).")
    return {"iam": iam, "sessionKey": session_key}


def refresh_crlibre_session_if_needed(settings) -> None:
    if getattr(settings, "api_mode", None) != "users_loggedIn":
        return
    if (settings.session_key or "").strip():
        return
    base = _normalize_api_base(settings.api_url)
    pwd = settings.get_password("api_password")
    if not settings.api_username or not pwd:
        frappe.throw("En modo users_loggedIn se requiere API Username y API Password.")
    data = {
        "w": "users",
        "r": "users_log_me_in",
        "userName": settings.api_username,
        "pwd": pwd,
    }
    resp = requests.post(base, data=data, timeout=60)
    payload = _parse_json_loose(resp)
    session_key = _extract_session_key(payload)
    if not session_key:
        frappe.throw(f"No se pudo iniciar sesion en CRLibre: {resp.text[:500]}")
    frappe.db.set_single_value("CRLibre Settings", "session_key", session_key)


def _extract_session_key(payload: Any) -> str | None:
    if not payload:
        return None
    if isinstance(payload, dict):
        if payload.get("sessionKey"):
            return str(payload["sessionKey"])
        resp = payload.get("resp")
        if isinstance(resp, list) and resp:
            first = resp[0]
            if isinstance(first, dict):
                data = first.get("data") or first
                if isinstance(data, dict) and data.get("sessionKey"):
                    return str(data["sessionKey"])
    return None


def _parse_json_loose(resp: requests.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return {"raw": resp.text}


def _extract_clave_result(payload: Any) -> dict[str, str]:
    if isinstance(payload, str):
        frappe.throw(f"Respuesta CRLibre (clave): {payload}")
    if not isinstance(payload, dict):
        frappe.throw(f"Respuesta CRLibre (clave) no valida: {payload!r}")

    if "clave" in payload and "consecutivo" in payload:
        return {"clave": str(payload["clave"]), "consecutivo": str(payload["consecutivo"])}

    resp = payload.get("resp")
    # api-demo.crlibre.org suele devolver resp como objeto {"clave","consecutivo","length"} no como lista.
    if isinstance(resp, dict) and "clave" in resp and "consecutivo" in resp:
        return {"clave": str(resp["clave"]), "consecutivo": str(resp["consecutivo"])}
    if isinstance(resp, list) and resp:
        first = resp[0]
        if isinstance(first, dict):
            data = first.get("data") or first
            if isinstance(data, dict) and "clave" in data and "consecutivo" in data:
                return {"clave": str(data["clave"]), "consecutivo": str(data["consecutivo"])}

    if payload.get("raw") and isinstance(payload["raw"], str):
        frappe.throw(f"Respuesta CRLibre (clave): {payload['raw'][:500]}")
    frappe.throw(f"No se pudo interpretar clave/consecutivo CRLibre: {payload}")


def _consecutivo_10_from_invoice(doc) -> str:
    digits = "".join(re.findall(r"\d+", doc.name or ""))
    if not digits:
        frappe.throw("No se pudo derivar un consecutivo numerico de 10 digitos desde el nombre de la factura.")
    if len(digits) > 10:
        digits = digits[-10:]
    return digits.zfill(10)


def _codigo_seguridad_8() -> str:
    return "".join(str(random.randint(0, 9)) for _ in range(8))


def _tipo_identif_from_emisor_settings(settings) -> str:
    t = (settings.tipo_cedula_emisor or "").strip().lower()
    code = _TIPO_IDENTIF_MAP.get(t)
    if not code:
        frappe.throw("tipo_cedula_emisor invalido en CRLibre Settings.")
    return code


def _persist_invoice_fields(name: str, **fields) -> None:
    for key, value in fields.items():
        frappe.db.set_value("Sales Invoice", name, key, value, update_modified=False)
    frappe.db.commit()


def get_clave_consecutivo(doc) -> dict[str, str]:
    settings = frappe.get_single("CRLibre Settings")
    base = _normalize_api_base(settings.api_url)
    params: dict[str, str] = {
        "w": "clave",
        "r": "clave",
        "tipoDocumento": "FE",
        "tipoCedula": settings.tipo_cedula_emisor,
        "cedula": settings.emisor_cedula,
        "codigoPais": "506",
        "consecutivo": _consecutivo_10_from_invoice(doc),
        "situacion": "normal",
        "codigoSeguridad": _codigo_seguridad_8(),
        "sucursal": str(settings.sucursal),
        "terminal": str(settings.terminal),
    }
    params.update(_auth_params(settings))

    resp = requests.get(base, params=params, timeout=60)
    payload = _parse_json_loose(resp)
    if resp.status_code >= 400:
        frappe.throw(f"CRLibre clave HTTP {resp.status_code}: {resp.text[:500]}")
    result = _extract_clave_result(payload)

    doc.hacienda_clave = result["clave"]
    doc.hacienda_consecutivo = result["consecutivo"]
    _persist_invoice_fields(
        doc.name,
        hacienda_clave=result["clave"],
        hacienda_consecutivo=result["consecutivo"],
    )
    return result


def _primary_address(party_doctype: str, party_name: str):
    parents = frappe.get_all(
        "Dynamic Link",
        filters={"link_doctype": party_doctype, "link_name": party_name, "parenttype": "Address"},
        pluck="parent",
        limit=1,
    )
    if not parents:
        return None
    return frappe.get_doc("Address", parents[0])


def _addr_field(addr, *names: str) -> str | None:
    if not addr:
        return None
    for n in names:
        v = addr.get(n)
        if v:
            s = str(v).strip()
            if s:
                return s
    return None


def _emisor_domicilio(settings, company_name: str):
    addr = _primary_address("Company", company_name)
    provincia = _addr_field(addr, "custom_provincia_hacienda", "custom_provincia", "state") or "1"
    canton = _addr_field(addr, "custom_canton_hacienda", "custom_canton", "city") or "01"
    distrito = _addr_field(addr, "custom_distrito_hacienda", "custom_distrito", "county") or "01"
    barrio = _addr_field(addr, "custom_barrio_hacienda", "custom_barrio") or "01"
    otras = ""
    if addr:
        parts = [addr.address_line1, addr.address_line2, addr.city, addr.state]
        otras = " ".join(p for p in parts if p).strip() or (addr.address_line1 or "")
    otras = (otras or "Sin otras senas")[:250]
    return provincia, canton, distrito, barrio, otras


def _receptor_domicilio(customer_name: str):
    addr = _primary_address("Customer", customer_name)
    provincia = _addr_field(addr, "custom_provincia_hacienda", "custom_provincia", "state") or ""
    canton = _addr_field(addr, "custom_canton_hacienda", "custom_canton", "city") or ""
    distrito = _addr_field(addr, "custom_distrito_hacienda", "custom_distrito", "county") or ""
    barrio = _addr_field(addr, "custom_barrio_hacienda", "custom_barrio") or ""
    otras = ""
    if addr:
        parts = [addr.address_line1, addr.address_line2]
        otras = " ".join(p for p in parts if p).strip()
    return provincia, canton, distrito, barrio, otras


def _receptor_tipo_identif(customer) -> str:
    t = (getattr(customer, "hacienda_tipo_identificacion", None) or "").strip()
    if t in ("01", "02", "03", "04"):
        return t
    if customer.customer_type == "Company":
        return "02"
    return "01"


def _receptor_num_identif(customer) -> str:
    digits = re.sub(r"\D", "", customer.tax_id or "")
    if not digits:
        frappe.throw(f"Cliente {customer.name}: falta Identificacion / Tax ID para factura electronica.")
    return digits


def _codigo_actividad_receptor(doc, customer) -> str:
    for candidate in (
        (getattr(doc, "hacienda_actividad_receptor", None) or "").strip(),
        (getattr(customer, "hacienda_codigo_actividad_receptor", None) or "").strip(),
    ):
        if candidate:
            norm = normalize_tribu_actividad(candidate)
            if not norm or not re.fullmatch(r"\d{6}", norm):
                frappe.throw(
                    "Actividad economica del receptor: formato TRIBU (ej. 7020.0) o 6 digitos v4.4."
                )
            return norm
    return ""


def _infer_hacienda_tarifa_from_rate(rate_pct: float) -> tuple[str, float]:
    r = flt(rate_pct)
    if abs(r) < 0.0001:
        return "10", 0.0
    for val, code in (
        (13, "08"),
        (8, "07"),
        (4, "04"),
        (2, "03"),
        (1, "02"),
        (0.5, "09"),
    ):
        if abs(r - val) < 0.05:
            return code, float(val)
    return "08", r


def _item_tax_template_rate_and_codes(template: str | None) -> tuple[str, str, float]:
    if not template:
        return "01", "10", 0.0
    meta = (
        frappe.db.get_value(
            "Item Tax Template",
            template,
            ["hacienda_codigo_impuesto", "hacienda_codigo_tarifa"],
            as_dict=True,
        )
        or {}
    )
    rate_sum = flt(
        frappe.db.sql(
            "select coalesce(sum(tax_rate), 0) from `tabItem Tax Template Detail` where parent=%s",
            (template,),
        )[0][0]
    )
    cod_imp = (meta.get("hacienda_codigo_impuesto") or "01").strip() or "01"
    cod_tar = (meta.get("hacienda_codigo_tarifa") or "").strip()
    if not cod_tar:
        cod_tar, adj = _infer_hacienda_tarifa_from_rate(rate_sum)
        rate_sum = adj
    return cod_imp, cod_tar, rate_sum


def _parse_hacienda_medios_json(doc) -> list[dict[str, Any]] | None:
    raw = getattr(doc, "hacienda_medios_pago_json", None)
    if raw in (None, "", [], {}):
        return None
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return None
        try:
            raw = json.loads(s)
        except json.JSONDecodeError:
            frappe.throw("Desglose medios de pago (JSON): JSON invalido.")
    if not isinstance(raw, list) or len(raw) == 0:
        return None
    norm: list[dict[str, Any]] = []
    for r in raw[:4]:
        if not isinstance(r, dict):
            frappe.throw("Desglose medios de pago (JSON): cada elemento debe ser un objeto.")
        tipo = str(r.get("tipo_medio") or r.get("tipoMedioPago") or "01").strip() or "01"
        m = round(flt(r.get("monto") or r.get("totalMedioPago") or 0), 2)
        det = str(r.get("detalle_otro") or r.get("medioPagoOtros") or "").strip()
        norm.append({"tipo_medio": tipo, "monto": m, "detalle_otro": det})
    return norm


def _medios_pago_payload_list(doc, total_comprobante: float) -> list[dict[str, Any]]:
    total_rounded = round(flt(total_comprobante), 2)
    parsed = _parse_hacienda_medios_json(doc)
    if parsed:
        out: list[dict[str, Any]] = []
        for row in parsed:
            tipo = row["tipo_medio"]
            m = row["monto"]
            entry: dict[str, Any] = {"tipoMedioPago": tipo, "totalMedioPago": m}
            if tipo == "99":
                det = row["detalle_otro"]
                if det:
                    entry["medioPagoOtros"] = det[:100]
            out.append(entry)
        return out
    medio = (getattr(doc, "hacienda_medio_pago", None) or "04").strip() or "04"
    entry = {"tipoMedioPago": medio, "totalMedioPago": total_rounded}
    if medio == "99":
        otro = (getattr(doc, "hacienda_medio_pago_otro", None) or "").strip()
        if otro:
            entry["medioPagoOtros"] = otro[:100]
    return [entry]


def _plazo_credito_hacienda(doc) -> str:
    cond = (getattr(doc, "hacienda_condicion_venta", None) or "01").strip()
    if cond != "02":
        return "0"
    if doc.due_date and doc.posting_date:
        days = (getdate(doc.due_date) - getdate(doc.posting_date)).days
        return str(max(int(days), 0))
    return "0"


def _item_codigo_cabys(item_code: str) -> str:
    cabys = frappe.db.get_value("Item", item_code, "custom_codigo_cabys")
    if not cabys:
        cabys = frappe.db.get_value("Item", item_code, "codigo_cabys")
    if not cabys:
        frappe.throw(
            f"Item {item_code}: falta codigo CABYS. Agregue el campo personalizado "
            "`custom_codigo_cabys` en Item (recomendado) o `codigo_cabys`."
        )
    digits = re.sub(r"\D", "", str(cabys))
    if len(digits) < 13:
        digits = digits.zfill(13)
    return digits[:13]


def _map_uom(uom: str | None) -> str:
    u = (uom or "Unid").strip()
    if len(u) > 10:
        return "Unid"
    return u


def _line_tax_alloc(doc, line_net: float) -> float:
    if flt(doc.net_total) <= 0:
        return 0.0
    return flt(doc.total_taxes_and_charges) * (flt(line_net) / flt(doc.net_total))


def _build_detalles(doc) -> str:
    settings_ln = frappe.get_single("CRLibre Settings")
    incluir_cc_tx = cint(getattr(settings_ln, "xml_detalle_codigo_comercial_tipo_tx", 0))
    detalles: dict[str, dict[str, Any]] = {}
    idx = 1
    for row in doc.items:
        item_code = row.item_code

        qty = flt(row.qty)
        rate = flt(row.rate)
        line_net = flt(row.net_amount or row.amount)
        line_amount = flt(row.amount)
        tax_alloc = _line_tax_alloc(doc, line_net)

        cod_imp, cod_tar, tarifa_decl = _item_tax_template_rate_and_codes(row.item_tax_template)
        impuesto_list: list[dict[str, Any]] = []
        if tax_alloc > 0.00001:
            if not row.item_tax_template or cod_tar == "10":
                cod_imp, cod_tar, tarifa_decl = "01", "08", 13.0
            if cod_imp == "01":
                impuesto_list.append(
                    {
                        "codigo": cod_imp,
                        "codigoTarifa": cod_tar,
                        "tarifa": round(flt(tarifa_decl), 2),
                        "monto": round(tax_alloc, 5),
                    }
                )

        impuesto_neto = round(tax_alloc, 5)
        monto_total = round(line_net + impuesto_neto, 5)
        subtotal = round(line_net, 5)
        base_imponible = subtotal

        line: dict[str, Any] = {
            "codigoCABYS": _item_codigo_cabys(item_code),
            "cantidad": qty,
            "unidadMedida": _map_uom(row.uom),
            "detalle": (row.description or row.item_name or item_code)[:200],
            "precioUnitario": round(rate, 5),
            "montoTotal": round(line_amount, 5),
            "subTotal": subtotal,
            "baseImponible": base_imponible,
            "impuesto": impuesto_list,
            "impuestoAsumidoEmisorFabrica": 0.0,
            "impuestoNeto": impuesto_neto,
            "montoTotalLinea": monto_total,
        }
        if incluir_cc_tx:
            line["codigoComercial"] = {"tipo": "01", "codigo": (item_code or "")[:20]}
            line["tipoTransaccion"] = "01"
        disc = flt(row.discount_amount)
        if disc > 0.00001:
            nat = (getattr(row, "hacienda_naturaleza_descuento", None) or "").strip()
            otro = (nat or "Descuento comercial")[:100]
            if len(otro) < 5:
                otro = (otro + "-----")[:5]
            line["descuento"] = [
                {
                    "montoDescuento": round(disc, 5),
                    "codigoDescuento": "99",
                    "codigoDescuentoOTRO": otro,
                    "naturalezaDescuento": nat[:80] if nat else otro[:80],
                }
            ]
        num_ex = (getattr(row, "hacienda_exon_numero_documento", None) or "").strip()
        if num_ex:
            instit = (getattr(row, "hacienda_exon_nombre_institucion", None) or "").strip()
            tipo_doc = (getattr(row, "hacienda_exon_tipo_documento", None) or "").strip() or "02"
            fecha = getattr(row, "hacienda_exon_fecha", None)
            fecha_s = fecha.strftime("%Y-%m-%d") if fecha else ""
            ex_tar = flt(getattr(row, "hacienda_exon_tarifa_exonerada", 0))
            ex_monto = flt(getattr(row, "hacienda_exon_monto", 0))
            if ex_monto <= 0 and ex_tar > 0:
                ex_monto = round(subtotal * ex_tar / 100.0, 5)
            line["exoneracion"] = {
                "tipoDocumento": tipo_doc[:2],
                "numeroDocumento": num_ex[:40],
                "nombreInstitucion": instit[:160],
                "fechaEmision": fecha_s,
                "porcentajeExoneracion": round(ex_tar, 2),
                "montoExoneracion": round(ex_monto, 5),
            }
        detalles[str(idx)] = line
        idx += 1

    return json.dumps(detalles, ensure_ascii=False)


def _totals_by_rubro(doc) -> dict[str, float]:
    """Rubros sin lineas con exoneracion documentada (van a totales exonerados)."""
    serv_g = serv_e = merc_g = merc_e = 0.0
    for row in doc.items:
        if (getattr(row, "hacienda_exon_numero_documento", None) or "").strip():
            continue
        line_net = flt(row.net_amount or row.amount)
        tax_alloc = _line_tax_alloc(doc, line_net)
        is_stock = bool(frappe.db.get_value("Item", row.item_code, "is_stock_item"))
        if tax_alloc > 0.00001:
            if is_stock:
                merc_g += line_net
            else:
                serv_g += line_net
        else:
            if is_stock:
                merc_e += line_net
            else:
                serv_e += line_net
    return {
        "total_serv_gravados": serv_g,
        "total_serv_exentos": serv_e,
        "total_merc_gravada": merc_g,
        "total_merc_exenta": merc_e,
    }


def _resumen_y_desglose_v44(doc) -> dict[str, Any]:
    exon_serv = exon_merc = 0.0
    grav_serv = grav_merc = 0.0
    exent_serv = exent_merc = 0.0
    desglose: dict[tuple[str, str], float] = {}

    for row in doc.items or []:
        line_net = flt(row.net_amount or row.amount)
        tax_alloc = _line_tax_alloc(doc, line_net)
        is_stock = bool(frappe.db.get_value("Item", row.item_code, "is_stock_item"))
        has_exon = bool((getattr(row, "hacienda_exon_numero_documento", None) or "").strip())

        if has_exon:
            if is_stock:
                exon_merc += line_net
            else:
                exon_serv += line_net
            continue

        if tax_alloc > 0.00001:
            cod_imp, cod_tar, _r = _item_tax_template_rate_and_codes(row.item_tax_template)
            if not row.item_tax_template or cod_tar == "10":
                cod_imp, cod_tar = "01", "08"
            key = (cod_imp, cod_tar)
            desglose[key] = desglose.get(key, 0.0) + tax_alloc
            if is_stock:
                grav_merc += line_net
            else:
                grav_serv += line_net
        else:
            if is_stock:
                exent_merc += line_net
            else:
                exent_serv += line_net

    # CRLibre genXML.php lee Codigo / CodigoTarifaIVA / TotalMontoImpuesto (PascalCase).
    desglose_list = [
        {"Codigo": k[0], "CodigoTarifaIVA": k[1], "TotalMontoImpuesto": round(v, 5)}
        for k, v in sorted(desglose.items())
    ]
    return {
        "total_serv_exonerado": exon_serv,
        "total_merc_exonerada": exon_merc,
        "total_serv_no_sujeto": 0.0,
        "total_merc_no_sujeta": 0.0,
        "total_gravado": grav_serv + grav_merc,
        "total_exento": exent_serv + exent_merc,
        "total_exonerado": exon_serv + exon_merc,
        "total_no_sujeto": 0.0,
        "total_desglose_impuesto_list": desglose_list,
    }


def _build_otros_json(doc) -> str:
    """Formato esperado por genXML.php: objeto con `otroTexto` (no array suelto)."""
    items: list[dict[str, str]] = []
    oc = (getattr(doc, "hacienda_otro_orden_compra", None) or "").strip()
    if oc:
        items.append({"codigo": "OrdenCompra", "texto": oc[:80]})
    le = (getattr(doc, "hacienda_otro_lugar_entrega", None) or "").strip()
    if le:
        items.append({"codigo": "LugarEntrega", "texto": le[:160]})
    if not items:
        return ""
    return json.dumps({"otroTexto": items}, ensure_ascii=False)


def _validate_detalles_para_crlibre_fe(detalles_json: str) -> None:
    """genXMLFe() en PHP exige codigoCABYS, subTotal, impuestoAsumidoEmisorFabrica, impuestoNeto por línea."""
    try:
        bloque = json.loads(detalles_json)
    except json.JSONDecodeError as e:
        frappe.throw(f"detalles JSON invalido: {e}")
    if not isinstance(bloque, dict):
        frappe.throw("detalles debe ser un objeto JSON con claves \"1\",\"2\",…")
    for num, raw in sorted(bloque.items(), key=lambda kv: str(kv[0])):
        line = raw if isinstance(raw, dict) else {}
        req = ("codigoCABYS", "subTotal", "impuestoAsumidoEmisorFabrica", "impuestoNeto")
        for fn in req:
            if fn not in line:
                frappe.throw(f"Línea detalle #{num}: falta `{fn}` (requerido por CRLibre gen_xml_fe). Revise CABYS y montos.")
            val = line.get(fn)
            if val == "" or val is None:
                frappe.throw(f"Línea detalle #{num}: `{fn}` vacío.")


def _codigo_actividad_para_crlibre(doc, settings) -> str:
    """Prioridad: factura -> actividad principal en settings -> campo legacy."""
    for candidate in (
        (getattr(doc, "hacienda_actividad_economica", None) or "").strip(),
        (getattr(settings, "actividad_economica_principal", None) or "").strip(),
        (getattr(settings, "codigo_actividad_emisor", None) or "").strip(),
    ):
        if candidate:
            norm = normalize_tribu_actividad(candidate)
            if not norm or not re.fullmatch(r"\d{6}", norm):
                frappe.throw(
                    "Actividad economica: formato TRIBU (ej. 7020.0) o 6 digitos v4.4."
                )
            return norm
    frappe.throw(
        "Falta codigo de actividad economica: complete hacienda_actividad_economica en la factura "
        "o actividad_economica_principal en CRLibre Settings."
    )


def map_invoice_data(doc) -> dict[str, Any]:
    settings = frappe.get_single("CRLibre Settings")
    proveedor = (settings.proveedor_sistemas or "").strip()
    actividad_6 = _codigo_actividad_para_crlibre(doc, settings)
    if not proveedor:
        frappe.throw("Complete Proveedor Sistemas en CRLibre Settings.")

    if not doc.hacienda_clave or not doc.hacienda_consecutivo:
        frappe.throw("Faltan hacienda_clave / hacienda_consecutivo. Ejecute primero get_clave_consecutivo.")

    company = frappe.get_doc("Company", doc.company)
    customer = frappe.get_doc("Customer", doc.customer)

    posting_time = getattr(doc, "posting_time", None) or time(12, 0, 0)
    dt = get_datetime(f"{doc.posting_date} {posting_time}")
    fecha_emision = dt.strftime("%Y-%m-%dT%H:%M:%S-06:00")

    emisor_provincia, emisor_canton, emisor_distrito, emisor_barrio, emisor_otras = _emisor_domicilio(
        settings, doc.company
    )
    rec_p, rec_c, rec_d, rec_b, rec_otras = _receptor_domicilio(doc.customer)

    rubro = _totals_by_rubro(doc)
    resumen_v44 = _resumen_y_desglose_v44(doc)
    otros_txt = _build_otros_json(doc)
    total_ventas = flt(doc.total)
    total_descuentos = flt(doc.discount_amount)
    total_ventas_neta = flt(doc.net_total)
    total_impuestos = flt(doc.total_taxes_and_charges)
    total_comprobante = flt(doc.grand_total)

    condicion_venta = (getattr(doc, "hacienda_condicion_venta", None) or "01").strip() or "01"
    medios_list = _medios_pago_payload_list(doc, total_comprobante)
    medios_pago = json.dumps(medios_list, ensure_ascii=False)
    medio_pago = (medios_list[0].get("tipoMedioPago") or "04") if medios_list else "04"

    moneda = (doc.currency or "CRC").strip()
    tipo_cambio_val = (
        "1"
        if moneda.upper() == "CRC"
        else str(flt(doc.conversion_rate, 5) or 1.0)
    )

    actividad_receptor_6 = _codigo_actividad_receptor(doc, customer)

    # Company en ERPNext usa el campo `email`; Customer suele usar `email_id`.
    # CRLibre valida formato de email; `...@localhost` suele rechazarse en el regex del API.
    emisor_email = (
        (getattr(company, "email", None) or getattr(company, "email_id", None) or "").strip()
        or "noreply@example.com"
    )
    receptor_email = (
        (getattr(customer, "email_id", None) or getattr(customer, "email", None) or "").strip()
    )

    payload: dict[str, Any] = {
        "w": "genXML",
        "r": "gen_xml_fe",
        "clave": doc.hacienda_clave,
        "proveedor_sistemas": proveedor,
        # genXML.php fuerza código de actividad a 6 dígitos; enviar TRIBU "7020.0" puede fallar validación XSD.
        "codigo_actividad_emisor": actividad_6,
        "codigoActividad": actividad_6,
        "consecutivo": doc.hacienda_consecutivo,
        "fecha_emision": fecha_emision,
        "emisor_nombre": company.name,
        "emisor_tipo_identif": _tipo_identif_from_emisor_settings(settings),
        "emisor_num_identif": re.sub(r"\D", "", settings.emisor_cedula or ""),
        "emisor_nombre_comercial": company.name,
        "emisor_provincia": str(emisor_provincia),
        "emisor_canton": str(emisor_canton),
        "emisor_distrito": str(emisor_distrito),
        "emisor_barrio": str(emisor_barrio),
        "emisor_otras_senas": emisor_otras,
        "emisor_email": emisor_email,
        "receptor_nombre": customer.customer_name,
        "receptor_tipo_identif": _receptor_tipo_identif(customer),
        "receptor_num_identif": _receptor_num_identif(customer),
        "receptor_email": receptor_email,
        "receptor_provincia": rec_p,
        "receptor_canton": rec_c,
        "receptor_distrito": rec_d,
        "receptor_barrio": rec_b,
        "receptor_otras_senas": rec_otras,
        "condicion_venta": condicion_venta,
        "plazo_credito": _plazo_credito_hacienda(doc),
        "medios_pago": medios_pago,
        "medio_pago": medio_pago,
        # Nombre exacto según CRLibre API_Hacienda api/contrib/genXML/module.php (gen_xml_fe).
        "cod_moneda": moneda,
        "total_serv_gravados": str(round(rubro["total_serv_gravados"], 5)),
        "total_serv_exentos": str(round(rubro["total_serv_exentos"], 5)),
        "total_merc_gravada": str(round(rubro["total_merc_gravada"], 5)),
        "total_merc_exenta": str(round(rubro["total_merc_exenta"], 5)),
        "total_serv_exonerados": str(round(resumen_v44["total_serv_exonerado"], 5)),
        "total_merc_exonerada": str(round(resumen_v44["total_merc_exonerada"], 5)),
        "total_serv_no_sujeto": str(round(resumen_v44["total_serv_no_sujeto"], 5)),
        "total_merc_no_sujeta": str(round(resumen_v44["total_merc_no_sujeta"], 5)),
        "total_gravados": str(round(resumen_v44["total_gravado"], 5)),
        "total_exento": str(round(resumen_v44["total_exento"], 5)),
        "total_exonerado": str(round(resumen_v44["total_exonerado"], 5)),
        "total_no_sujeto": str(round(resumen_v44["total_no_sujeto"], 5)),
        "total_ventas": str(round(total_ventas, 5)),
        "total_descuentos": str(round(total_descuentos, 5)),
        "total_ventas_neta": str(round(total_ventas_neta, 5)),
        "total_impuestos": str(round(total_impuestos, 5)),
        "total_comprobante": str(round(total_comprobante, 5)),
        "tipo_cambio": tipo_cambio_val,
    }

    det_json = _build_detalles(doc)
    _validate_detalles_para_crlibre_fe(det_json)
    payload["detalles"] = det_json

    if resumen_v44["total_desglose_impuesto_list"]:
        payload["totalDesgloseImpuesto"] = json.dumps(
            resumen_v44["total_desglose_impuesto_list"], ensure_ascii=False
        )
    if otros_txt:
        payload["otros"] = otros_txt

    if actividad_receptor_6:
        ar = actividad_receptor_6.strip()
        if ar:
            payload["codigo_actividad_receptor"] = ar
            payload["codigoActividadReceptor"] = ar

    payload.update(_auth_params(frappe.get_single("CRLibre Settings")))
    return payload


def _form_post(base: str, data: dict[str, Any]) -> requests.Response:
    flat: dict[str, str] = {k: (v if isinstance(v, str) else str(v)) for k, v in data.items()}
    return requests.post(base, data=flat, timeout=120)


def _crlibre_genxml_error_detail(data: dict[str, Any]) -> str:
    """Texto humano si el JSON trae mensaje de error además de resp negativo."""
    for key in ("msg", "message", "mensaje", "error", "detalle", "detail", "descripcion"):
        val = data.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    rnested = data.get("resp")
    if isinstance(rnested, dict):
        for key in ("msg", "message", "mensaje", "error", "detalle"):
            val = rnested.get(key)
            if val is not None and str(val).strip():
                return str(val).strip()
        return json.dumps(rnested, ensure_ascii=False)[:3500]
    for _k, v in data.items():
        if _k != "resp" and isinstance(v, str) and len(v.strip()) > 3:
            return v.strip()[:2500]
    raw = json.dumps(data, ensure_ascii=False)[:3500]
    if raw.strip() in ('{"resp": -1}', '{"resp":-1}'):
        return (
            raw
            + " — El API público no envió mensaje (resp=-1 suele ser fallo XSD/validación interna en servidor CRLibre)."
        )
    return raw


def _raise_if_crlibre_genxml_failed(
    data: Any,
    raw_http_text: str = "",
    *,
    payload_diag: dict[str, Any] | None = None,
) -> None:
    """CRLibre/CalaAPI suele devolver {\"resp\": -1} ante fallo; no es XML."""
    if isinstance(data, list) and data:
        data = data[0] if isinstance(data[0], dict) else None
    if not isinstance(data, dict):
        return
    r = data.get("resp")
    if isinstance(r, int) and r < 0:
        detail = _crlibre_genxml_error_detail(data)
        raw_snip = (raw_http_text or "").strip()
        frappe.log_error(
            title="CRLibre gen_xml_fe respuesta HTTP completa",
            message=(raw_snip[:50000] if raw_snip else "(vacía)"),
        )
        if payload_diag:
            lens = {k: len(str(v)) for k, v in sorted(payload_diag.items())}
            frappe.log_error(
                title="CRLibre gen_xml_fe payload enviado (longitud por campo)",
                message=json.dumps(lens, indent=2, ensure_ascii=False)[:45000],
            )
            preview: dict[str, Any] = {}
            for k in (
                "clave",
                "consecutivo",
                "codigo_actividad_emisor",
                "codigo_actividad_receptor",
                "proveedor_sistemas",
                "emisor_num_identif",
                "emisor_email",
                "receptor_num_identif",
                "medios_pago",
                "totalDesgloseImpuesto",
            ):
                if k in payload_diag:
                    preview[k] = str(payload_diag[k])[:1200]
            det = payload_diag.get("detalles")
            if det is not None:
                preview["detalles_json_inicio"] = str(det)[:12000]
            frappe.log_error(
                title="CRLibre gen_xml_fe envío parcial (para soporte / XSD)",
                message=json.dumps(preview, indent=2, ensure_ascii=False)[:50000],
            )
        extra = ""
        if raw_snip:
            extra = f" | CUERPO_HTTP ({len(raw_snip)} bytes): {raw_snip[:2200]}"
            if len(raw_snip) > 2200:
                extra += "… Abra Error Log → «CRLibre gen_xml_fe respuesta HTTP completa»."
        frappe.throw(f"CRLibre gen_xml_fe error (resp={r}): {detail}{extra}")
    if r == 0 and data.get("success") is False:
        frappe.throw(f"CRLibre gen_xml_fe: {_crlibre_genxml_error_detail(data)}")


def _mark_error(invoice_name: str, message: str) -> None:
    short = (message or "")[:140]
    frappe.db.set_value(
        "Sales Invoice",
        invoice_name,
        {"hacienda_estado": "Error de Comunicacion", "hacienda_error_log": short},
        update_modified=False,
    )
    frappe.db.commit()


def _safe_crlibre_password(fieldname: str) -> str:
    """Lee Password de Single sin lanzar si el valor nunca se guardo (Frappe: Contrasena no encontrada)."""
    try:
        return (frappe.get_single("CRLibre Settings").get_password(fieldname) or "").strip()
    except Exception:
        return ""


def _mh_client_id(settings) -> str:
    amb = (getattr(settings, "ambiente", None) or "").strip().lower()
    if amb == "produccion":
        return "api-prod"
    return "api-stag"


def _frappe_p12_attachment_path(settings) -> str | None:
    url = getattr(settings, "llave_criptografica", None)
    if not url or not str(url).strip():
        return None
    url_s = str(url).strip()
    names = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "CRLibre Settings",
            "attached_to_name": "CRLibre Settings",
            "attached_to_field": "llave_criptografica",
        },
        pluck="name",
        limit=1,
    )
    if not names:
        names = frappe.get_all("File", filters={"file_url": url_s}, pluck="name", limit=1)
    if not names:
        return None
    try:
        path = frappe.get_doc("File", names[0]).get_full_path()
    except Exception:
        return None
    return path if path and os.path.isfile(path) else None


def _extract_download_code_upload(payload: Any) -> str | None:
    if isinstance(payload, dict):
        if payload.get("downloadCode"):
            return str(payload["downloadCode"]).strip()
        r = payload.get("resp")
        if isinstance(r, dict) and r.get("downloadCode"):
            return str(r["downloadCode"]).strip()
        if isinstance(r, list) and r and isinstance(r[0], dict) and r[0].get("downloadCode"):
            return str(r[0]["downloadCode"]).strip()
    return None


def _upload_p12_to_crlibre(settings, base: str, abs_path: str) -> str:
    data = dict(_auth_params(settings))
    data["w"] = "files"
    data["r"] = "upload"
    fname = os.path.basename(abs_path)
    with open(abs_path, "rb") as fh:
        resp = requests.post(
            base,
            data=data,
            files={"fileToUpload": (fname, fh, "application/x-pkcs12")},
            timeout=120,
        )
    text = resp.text or ""
    pl = _parse_json_loose(resp)
    if resp.status_code >= 400:
        frappe.throw(f"CRLibre upload certificado HTTP {resp.status_code}: {text[:1200]}")
    code = _extract_download_code_upload(pl)
    if code:
        return code
    frappe.throw(
        "No se obtuvo downloadCode al subir el .p12 a CRLibre. Respuesta: "
        f"{text[:1500]}"
    )


def _ensure_crlibre_p12_download_code(settings, base: str) -> None:
    """Si falta el codigo CRLibre pero hay .p12 adjunto en ERPNext, sube el archivo al API y guarda el codigo."""
    if (getattr(settings, "certificado_p12_codigo_crlibre", None) or "").strip():
        return
    path = _frappe_p12_attachment_path(settings)
    if not path:
        frappe.throw(
            "Indique «Codigo descarga .p12 en CRLibre» (tras subir el cert en CRLibre Files) "
            "o adjunte «Llave Criptografica (.p12)» en este formulario y guarde, "
            "para que el sistema pueda registrar el certificado en el API CRLibre."
        )
    code = _upload_p12_to_crlibre(settings, base, path)
    frappe.db.set_single_value("CRLibre Settings", "certificado_p12_codigo_crlibre", code)
    frappe.db.commit()
    frappe.clear_cache(doctype="CRLibre Settings")


def _require_pipeline_credentials(settings, base: str) -> None:
    _ensure_crlibre_p12_download_code(settings, base)
    if not _safe_crlibre_password("pin_llave"):
        frappe.throw(
            "Configure y guarde «PIN Llave» en CRLibre Settings (pulse Guardar despues de escribir)."
        )
    if not (getattr(settings, "mh_usuario", None) or "").strip():
        frappe.throw("Configure «Usuario API Hacienda» en CRLibre Settings.")
    if not _safe_crlibre_password("mh_contrasena"):
        frappe.throw(
            "Configure y guarde «Contrasena API Hacienda» en CRLibre Settings "
            "(credenciales del IdP/API de comprobantes; pulse Guardar)."
        )


def _fecha_emision_iso(doc) -> str:
    posting_time = getattr(doc, "posting_time", None) or time(12, 0, 0)
    dt = get_datetime(f"{doc.posting_date} {posting_time}")
    return dt.strftime("%Y-%m-%dT%H:%M:%S-06:00")


def _extract_xml_b64_from_genxml(data: dict[str, Any]) -> str:
    r = data.get("resp")
    if isinstance(r, dict):
        x = r.get("xml")
        if x is not None and str(x).strip():
            return str(x).strip()
    if isinstance(r, list) and r:
        first = r[0]
        if isinstance(first, dict) and first.get("xml"):
            return str(first["xml"]).strip()
    frappe.throw(
        "No se encontro resp.xml en la respuesta gen_xml_fe. Verifique Error Log / respuesta CRLibre."
    )


def _fetch_mh_token(settings, base: str) -> str:
    sec = _safe_crlibre_password("mh_client_secret")
    mh_pwd = _safe_crlibre_password("mh_contrasena")
    data: dict[str, str] = {
        "w": "token",
        "r": "gettoken",
        "grant_type": "password",
        "client_id": _mh_client_id(settings),
        "username": (settings.mh_usuario or "").strip(),
        "password": mh_pwd,
        "client_secret": sec,
    }
    data.update(_auth_params(settings))
    resp = _form_post(base, data)
    payload = _parse_json_loose(resp)
    if isinstance(payload, dict):
        tok = payload.get("access_token")
        if tok:
            return str(tok)
        if isinstance(payload.get("resp"), dict):
            tok = payload["resp"].get("access_token")
            if tok:
                return str(tok)
    frappe.throw(f"No se obtuvo access_token Hacienda: {(resp.text or '')[:1200]}")


def _firmar_xml_crlibre(settings, base: str, xml_b64: str) -> str:
    p12 = (settings.certificado_p12_codigo_crlibre or "").strip()
    pin = _safe_crlibre_password("pin_llave")
    data: dict[str, str] = {
        "w": "firmarXML",
        "r": "firmar",
        "p12Url": p12,
        "pinP12": pin,
        "inXml": xml_b64,
    }
    data.update(_auth_params(settings))
    resp = _form_post(base, data)
    text = resp.text or ""
    if resp.status_code >= 400:
        frappe.throw(f"CRLibre firmarXML HTTP {resp.status_code}: {text[:800]}")
    pl = _parse_json_loose(resp)
    if not isinstance(pl, dict):
        frappe.throw(f"CRLibre firmarXML respuesta invalida: {text[:800]}")
    r = pl.get("resp")
    if isinstance(r, int) and r < 0:
        frappe.throw(f"CRLibre firmarXML error: {json.dumps(pl, ensure_ascii=False)[:2000]}")
    if isinstance(r, dict) and r.get("xmlFirmado"):
        return str(r["xmlFirmado"]).strip()
    if isinstance(pl, dict) and pl.get("xmlFirmado"):
        return str(pl["xmlFirmado"]).strip()
    frappe.throw(f"CRLibre firmarXML sin xmlFirmado: {text[:1500]}")


def _send_ok(send_payload: Any) -> bool:
    if isinstance(send_payload, dict):
        st = send_payload.get("Status")
        if st is None:
            st = send_payload.get("status")
        try:
            code = int(st)
            return 200 <= code < 300
        except (TypeError, ValueError):
            return False
    return False


def _send_xml_via_crlibre(settings, base: str, doc, signed_b64: str, token: str) -> Any:
    customer = frappe.get_doc("Customer", doc.customer)
    data: dict[str, str] = {
        "w": "send",
        "r": "json",
        "token": token,
        "clave": (doc.hacienda_clave or "").strip(),
        "fecha": _fecha_emision_iso(doc),
        "emi_tipoIdentificacion": _tipo_identif_from_emisor_settings(settings),
        "emi_numeroIdentificacion": re.sub(r"\D", "", settings.emisor_cedula or ""),
        "recp_tipoIdentificacion": _receptor_tipo_identif(customer),
        "recp_numeroIdentificacion": _receptor_num_identif(customer),
        "comprobanteXml": signed_b64,
        "client_id": _mh_client_id(settings),
        "callbackUrl": "",
    }
    data.update(_auth_params(settings))
    resp = _form_post(base, data)
    return _parse_json_loose(resp)


def _consultar_via_crlibre(settings, base: str, clave: str, token: str) -> Any:
    data: dict[str, str] = {
        "w": "consultar",
        "r": "consultarCom",
        "clave": clave.strip(),
        "token": token,
        "client_id": _mh_client_id(settings),
    }
    data.update(_auth_params(settings))
    resp = _form_post(base, data)
    return _parse_json_loose(resp)


def _walk_dict_estado(obj: Any, depth: int = 0) -> str | None:
    if depth > 8:
        return None
    if isinstance(obj, dict):
        for k in (
            "ind-estado",
            "indEstado",
            "IndEstado",
            "estado",
            "Estado",
            "ind_estado",
            "IND_ESTADO",
            "EstadoMensaje",
            "descripcionEstado",
        ):
            if k in obj and obj[k] is not None:
                return str(obj[k]).strip()
        for v in obj.values():
            found = _walk_dict_estado(v, depth + 1)
            if found:
                return found
    elif isinstance(obj, list):
        for it in obj:
            found = _walk_dict_estado(it, depth + 1)
            if found:
                return found
    return None


def _extract_ind_estado_from_xml_fragment(s: str) -> str | None:
    """Extrae texto de IndEstado / ind-estado en fragmentos XML (MH suele incrustarlos en JSON)."""
    if not s or "<" not in s:
        return None
    m = re.search(r"(?is)<(?:[^>\s:]+:)?IndEstado[^>]*>\s*([^<]+?)\s*</", s)
    if m:
        return m.group(1).strip()
    m = re.search(r"(?is)<(?:[^>\s:]+:)?ind-estado[^>]*>\s*([^<]+?)\s*</", s)
    if m:
        return m.group(1).strip()
    return None


def _deep_collect_xml_ind_estado(obj: Any, depth: int = 0) -> list[str]:
    out: list[str] = []
    if depth > 12:
        return out
    if isinstance(obj, dict):
        for v in obj.values():
            out.extend(_deep_collect_xml_ind_estado(v, depth + 1))
    elif isinstance(obj, list):
        for it in obj:
            out.extend(_deep_collect_xml_ind_estado(it, depth + 1))
    elif isinstance(obj, str) and len(obj) > 40:
        x = _extract_ind_estado_from_xml_fragment(obj)
        if x:
            out.append(x)
    return out


def _classify_estado_literal(lit: str) -> str:
    """Devuelve Aceptado | Rechazado | Procesando | Desconocido."""
    es = lit.strip().lower()
    if not es:
        return "Desconocido"
    if "rechaz" in es:
        return "Rechazado"
    if "acept" in es and "no acept" not in es:
        return "Aceptado"
    if es in ("1", "01"):
        return "Aceptado"
    if es in ("2", "02"):
        return "Rechazado"
    if es in ("3", "03"):
        return "Procesando"
    if any(
        p in es
        for p in (
            "proces",
            "tramit",
            "pendient",
            "en proceso",
            "espera",
            "recibido",
        )
    ):
        return "Procesando"
    return "Desconocido"


def _interpret_consulta_hacienda(payload: Any) -> tuple[str, str, str]:
    """Clasifica la respuesta GET recepcion/{clave}. Retorna (categoria, blob, literal_o_vacio)."""
    raw_txt = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
    low = raw_txt.lower()

    if isinstance(payload, dict):
        st = payload.get("Status") if payload.get("Status") is not None else payload.get("status")
        try:
            if st is not None and int(st) >= 400:
                return "Desconocido", raw_txt[:65000], ""
        except (TypeError, ValueError):
            pass

    literals: list[str] = []
    if isinstance(payload, str):
        x = _extract_ind_estado_from_xml_fragment(payload)
        if x:
            literals.append(x)
    else:
        head = _walk_dict_estado(payload)
        if head:
            literals.append(head)
        literals.extend(_deep_collect_xml_ind_estado(payload))

    seen: set[str] = set()
    ordered: list[str] = []
    for x in literals:
        z = x.strip()
        if z and z not in seen:
            seen.add(z)
            ordered.append(z)

    for lit in ordered:
        cat = _classify_estado_literal(lit)
        if cat != "Desconocido":
            return cat, raw_txt[:65000], lit

    if "no aceptado" in low or "no aceptada" in low:
        return "Rechazado", raw_txt[:65000], ""
    if "rechazado" in low:
        return "Rechazado", raw_txt[:65000], ""
    if "aceptado" in low:
        return "Aceptado", raw_txt[:65000], ""
    if any(p in low for p in ("procesando", "en tramite", "en trámite", "pendiente")):
        return "Procesando", raw_txt[:65000], ""

    return "Procesando", raw_txt[:65000], ""


def _consultar_estado_core(invoice_name: str, *, silent: bool = False) -> dict[str, Any]:
    doc = frappe.get_doc("Sales Invoice", invoice_name)
    clave = (doc.hacienda_clave or "").strip()
    if not clave:
        frappe.throw("La factura no tiene clave Hacienda.")

    settings = frappe.get_single("CRLibre Settings")
    base = _normalize_api_base(settings.api_url)

    token = _fetch_mh_token(settings, base)
    raw = _consultar_via_crlibre(settings, base, clave, token)

    estado_det, blob, literal = _interpret_consulta_hacienda(raw)
    fields: dict[str, Any] = {
        "hacienda_xml_respuesta": blob[:65000] if blob else "",
    }
    if estado_det == "Aceptado":
        fields["hacienda_estado"] = "Aceptado"
        fields["hacienda_error_log"] = ""
        msg = "Hacienda: comprobante Aceptado."
    elif estado_det == "Rechazado":
        fields["hacienda_estado"] = "Rechazado"
        fields["hacienda_error_log"] = (blob or "")[:140]
        msg = "Hacienda: comprobante Rechazado. Revise XML Respuesta / Log."
    elif estado_det == "Procesando":
        fields["hacienda_estado"] = "Procesando"
        fields["hacienda_error_log"] = ""
        lit = (literal or "").strip()
        msg = (
            "Hacienda aún no ha emitido acuse final (aceptación o rechazo) para esta clave. "
            + (f"Indicador en respuesta: {lit[:200]}. " if lit else "")
            + "Espere unos minutos y vuelva a usar «Refrescar Estado»."
        )
    else:
        frappe.log_error(
            title="CRLibre consulta Hacienda: respuesta no interpretada",
            message=(blob or "")[:6500],
        )
        fields["hacienda_error_log"] = (blob or "")[:140]
        msg = (
            "No se pudo interpretar la respuesta de consulta de Hacienda. "
            "Revise «XML Respuesta Hacienda» en esta factura y el Error Log del sistema "
            "(entrada «CRLibre consulta Hacienda…»). Si acaba de enviar el comprobante, reintente en breve."
        )

    _persist_invoice_fields(invoice_name, **fields)

    if not silent:
        frappe.msgprint(msg)
    return {
        "ok": True,
        "estado": estado_det,
        "message": msg,
        "invoice": invoice_name,
        "literal": (literal or "") or None,
    }


def _job_enviar_consultar_hacienda(invoice_name: str) -> None:
    try:
        doc = frappe.get_doc("Sales Invoice", invoice_name)
        settings = frappe.get_single("CRLibre Settings")
        base = _normalize_api_base(settings.api_url)
        signed = (frappe.db.get_value("Sales Invoice", invoice_name, "hacienda_xml_firmado") or "").strip()
        if not signed:
            _mark_error(invoice_name, "No hay XML firmado para enviar.")
            return

        token = _fetch_mh_token(settings, base)
        send_payload = _send_xml_via_crlibre(settings, base, doc, signed, token)

        if not _send_ok(send_payload):
            detail = json.dumps(send_payload, ensure_ascii=False)[:3000]
            frappe.log_error(
                title="CRLibre send respuesta",
                message=detail,
            )
            _mark_error(invoice_name, f"Envio Hacienda no exitoso: {detail[:200]}")
            return

        _persist_invoice_fields(
            invoice_name,
            hacienda_estado="Enviado",
            hacienda_error_log="",
        )

        try:
            _consultar_estado_core(invoice_name, silent=True)
        except Exception:
            frappe.log_error(
                title="CRLibre consulta post-envio",
                message=frappe.get_traceback(),
            )
    except Exception as e:
        frappe.log_error(
            title="CRLibre job enviar/consultar",
            message=frappe.get_traceback(),
        )
        _mark_error(invoice_name, str(e))


@frappe.whitelist()
def consultar_estado_hacienda(invoice_name: str) -> dict[str, Any]:
    if not invoice_name:
        frappe.throw("Debe indicar el identificador de Sales Invoice.")
    if not frappe.db.exists("Sales Invoice", invoice_name):
        frappe.throw(f"No existe la Sales Invoice: {invoice_name}")

    try:
        return _consultar_estado_core(invoice_name, silent=False)
    except Exception as e:
        frappe.log_error(title="consultar_estado_hacienda", message=frappe.get_traceback())
        frappe.throw(str(e))


@frappe.whitelist()
def procesar_factura_hacienda(invoice_name: str) -> dict[str, Any]:
    if not invoice_name:
        frappe.throw("Debe indicar el identificador de Sales Invoice.")

    if not frappe.db.exists("Sales Invoice", invoice_name):
        frappe.throw(f"No existe la Sales Invoice: {invoice_name}")

    settings = frappe.get_single("CRLibre Settings")
    if not settings.sucursal or not settings.terminal:
        frappe.throw("Debe configurar Sucursal y Terminal en CRLibre Settings.")

    base = _normalize_api_base(settings.api_url)
    _require_pipeline_credentials(settings, base)
    settings = frappe.get_single("CRLibre Settings")

    doc = frappe.get_doc("Sales Invoice", invoice_name)
    if doc.docstatus != 1:
        frappe.throw("Solo se puede procesar una factura en estado Submitted.")

    estado = (doc.hacienda_estado or "").strip()
    if estado not in ("", "Pendiente", "Rechazado"):
        frappe.throw("Solo se puede procesar cuando el estado de Hacienda es Pendiente o Rechazado.")

    try:
        get_clave_consecutivo(doc)
        doc.reload()
        payload = map_invoice_data(doc)
        resp = _form_post(base, payload)
        text = resp.text or ""
        if resp.status_code >= 400:
            frappe.throw(f"CRLibre gen_xml_fe HTTP {resp.status_code}: {text[:800]}")

        data = _parse_json_loose(resp)
        if isinstance(data, dict) and (text.strip().startswith("{") or text.strip().startswith("[")):
            _raise_if_crlibre_genxml_failed(data, text, payload_diag=payload)

        if not isinstance(data, dict):
            frappe.throw(f"Respuesta gen_xml_fe no JSON objetivo: {text[:800]}")

        xml_b64 = _extract_xml_b64_from_genxml(data)
        storage_json = json.dumps(data, ensure_ascii=False)

        signed_b64 = _firmar_xml_crlibre(settings, base, xml_b64)

        _persist_invoice_fields(
            doc.name,
            hacienda_xml_enviado=storage_json[:65000],
            hacienda_xml_firmado=signed_b64,
            hacienda_estado="Procesando",
            hacienda_error_log="",
            hacienda_xml_respuesta="",
        )

        frappe.enqueue(
            "facturacion_cr.api_crlibre._job_enviar_consultar_hacienda",
            queue="long",
            timeout=600,
            job_name=f"hacienda_fe_{doc.name}",
            invoice_name=doc.name,
        )
    except Exception as e:
        msg = str(e)
        frappe.log_error(title="CRLibre procesar_factura_hacienda", message=frappe.get_traceback())
        _mark_error(invoice_name, msg)
        frappe.throw(msg)

    frappe.msgprint(
        "XML generado y firmado. Envio a Hacienda y consulta de estado en segundo plano. "
        "Use «Refrescar Estado Hacienda» si no ve cambios en unos minutos."
    )
    return {"ok": True, "message": "Pipeline CRLibre encolado", "invoice": invoice_name}
