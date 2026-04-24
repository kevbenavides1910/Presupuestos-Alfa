from contextlib import contextmanager
from urllib.parse import urlparse

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


@contextmanager
def _skip_version_on_custom_field_save():
    """Evita Version.get_diff al guardar Custom Field (Py3.14 + format_value espera str)."""
    from frappe.model.document import Document

    orig = Document.save

    def save_wrapped(self, *args, **kwargs):
        if getattr(self, "doctype", None) == "Custom Field":
            kwargs["ignore_version"] = True
        return orig(self, *args, **kwargs)

    Document.save = save_wrapped
    try:
        yield
    finally:
        Document.save = orig


def _create_custom_fields_safe(custom_fields: dict, *, update: bool = True) -> None:
    with _skip_version_on_custom_field_save():
        create_custom_fields(custom_fields, update=update)


def ensure_crlibre_settings_singleton_integrity() -> None:
    """Single debe llamarse exactamente 'CRLibre Settings' y no permitir rename (evita URLs con hash / 404)."""
    if not frappe.db.exists("DocType", "CRLibre Settings"):
        return
    frappe.db.sql(
        """
        UPDATE `tabDocType`
        SET `issingle`=1, `allow_rename`=0
        WHERE `name`=%s
        """,
        ("CRLibre Settings",),
    )
    frappe.clear_cache(doctype="CRLibre Settings")
    meta = frappe.get_meta("CRLibre Settings")
    if not getattr(meta, "issingle", False):
        return

    canonical = "CRLibre Settings"
    names = [n for n in (frappe.get_all("CRLibre Settings", pluck="name", limit=50) or []) if n]

    # Si ya existe el nombre canonico y hay otro (p. ej. hash), renombrar falla: hay que borrar el duplicado.
    if canonical in names:
        for name in names:
            if name != canonical:
                try:
                    frappe.delete_doc("CRLibre Settings", name, force=True)
                    frappe.db.commit()
                except Exception:
                    frappe.log_error(
                        message=frappe.get_traceback(),
                        title="facturacion_cr: eliminar CRLibre Settings duplicado",
                    )
    elif names:
        other = list(names)
        for name in other[1:]:
            try:
                frappe.delete_doc("CRLibre Settings", name, force=True)
                frappe.db.commit()
            except Exception:
                frappe.log_error(
                    message=frappe.get_traceback(),
                    title="facturacion_cr: eliminar CRLibre Settings extra",
                )
        keep = other[0]
        if keep != canonical:
            try:
                frappe.rename_doc("CRLibre Settings", keep, canonical, force=True)
                frappe.db.commit()
            except Exception:
                frappe.log_error(
                    message=frappe.get_traceback(),
                    title="facturacion_cr: renombrar CRLibre Settings singleton",
                )

    if not frappe.db.exists("CRLibre Settings", canonical):
        doc = frappe.new_doc("CRLibre Settings")
        doc.flags.ignore_validate = True
        doc.insert(ignore_permissions=True)
        frappe.db.commit()


def upgrade_deprecated_crlibre_api_url() -> None:
    """api.crlibre.org ya no existe en DNS; la demo/documentacion usa api-demo.crlibre.org."""
    if not frappe.db.exists("DocType", "CRLibre Settings"):
        return
    try:
        url = (frappe.db.get_single_value("CRLibre Settings", "api_url") or "").strip()
    except Exception:
        return
    if not url:
        return
    host = (urlparse(url).hostname or "").lower()
    if host == "api.crlibre.org":
        frappe.db.set_single_value(
            "CRLibre Settings",
            "api_url",
            "https://api-demo.crlibre.org/api.php",
        )
        frappe.db.commit()
        frappe.clear_cache(doctype="CRLibre Settings")


def relax_crlibre_api_credentials_mandatory() -> None:
    """userName/contrasena del API CRLibre solo aplican a users_loggedIn (doc CRLibre)."""
    if not frappe.db.exists("DocType", "CRLibre Settings"):
        return
    for fn in ("api_username", "api_password"):
        frappe.db.sql(
            "UPDATE `tabDocField` SET `reqd`=0 WHERE `parent`=%s AND `fieldname`=%s",
            ("CRLibre Settings", fn),
        )
    frappe.db.sql(
        """
        UPDATE `tabCustom Field`
        SET `reqd`=0
        WHERE `dt`=%s AND `fieldname` IN ('api_username', 'api_password')
        """,
        ("CRLibre Settings",),
    )
    frappe.db.commit()
    frappe.clear_cache(doctype="CRLibre Settings")


def remove_obsolete_hacienda_medios_pago_child() -> None:
    """Quita el Custom Field tipo Table que apuntaba a un DocType hijo (rompia rebuild-global-search)."""
    cf_name = frappe.db.get_value(
        "Custom Field",
        {"dt": "Sales Invoice", "fieldname": "hacienda_medios_pago"},
        "name",
    )
    if cf_name:
        frappe.delete_doc("Custom Field", cf_name, force=1, ignore_missing=True)
    if frappe.db.exists("DocType", "Hacienda Medios Pago Item"):
        frappe.delete_doc("DocType", "Hacienda Medios Pago Item", force=1, ignore_missing=True)
    frappe.db.commit()


def after_install() -> None:
    ensure_crlibre_settings_doctype()
    ensure_crlibre_settings_singleton_integrity()
    relax_crlibre_api_credentials_mandatory()
    remove_obsolete_hacienda_medios_pago_child()
    create_customer_hacienda_fields()
    create_item_tax_template_hacienda_fields()
    create_item_cabys_field()
    create_sales_invoice_custom_fields()
    create_sales_invoice_item_custom_fields()
    ensure_sales_invoice_client_script()


def after_migrate() -> None:
    ensure_crlibre_settings_doctype()
    ensure_crlibre_settings_singleton_integrity()
    upgrade_deprecated_crlibre_api_url()
    relax_crlibre_api_credentials_mandatory()
    remove_obsolete_hacienda_medios_pago_child()
    create_customer_hacienda_fields()
    create_item_tax_template_hacienda_fields()
    create_item_cabys_field()
    create_sales_invoice_custom_fields()
    create_sales_invoice_item_custom_fields()
    ensure_sales_invoice_client_script()


def ensure_crlibre_settings_doctype() -> None:
    desired_fields = [
        {"fieldname": "api_credentials_section", "label": "Credenciales API", "fieldtype": "Section Break"},
        {
            "fieldname": "api_url",
            "label": "API URL",
            "fieldtype": "Data",
            "reqd": 1,
            "default": "https://api-demo.crlibre.org/api.php",
        },
        {
            "fieldname": "api_mode",
            "label": "Modo API",
            "fieldtype": "Select",
            "options": "users_openAccess\nusers_loggedIn",
            "default": "users_openAccess",
            "reqd": 1,
        },
        {
            "fieldname": "api_username",
            "label": "API Username",
            "fieldtype": "Data",
            "description": "Solo si Modo API = users_loggedIn (userName registrado en el API CRLibre, ver users_register / users_log_me_in).",
        },
        {
            "fieldname": "api_password",
            "label": "API Password",
            "fieldtype": "Password",
            "description": "Solo si Modo API = users_loggedIn (misma contrasena que al registrar el usuario en el API).",
        },
        {"fieldname": "session_key", "label": "Session Key", "fieldtype": "Data", "read_only": 1},
        {"fieldname": "emisor_section", "label": "Datos del Emisor (Hacienda)", "fieldtype": "Section Break"},
        {
            "fieldname": "tipo_cedula_emisor",
            "label": "Tipo Cedula Emisor",
            "fieldtype": "Select",
            "options": "fisico\njuridico\ndimex\nnite",
            "default": "juridico",
            "reqd": 1,
        },
        {
            "fieldname": "emisor_cedula",
            "label": "Cedula Emisor",
            "fieldtype": "Data",
            "reqd": 1,
            "description": "Debe tener entre 9 y 12 digitos.",
        },
        {
            "fieldname": "actividad_economica_principal",
            "label": "Actividad Economica Principal",
            "fieldtype": "Data",
            "length": 16,
            "reqd": 1,
            "description": "Como en TRIBU (ej. 7020.0) o 6 digitos del XML v4.4; al guardar se normaliza a 6 digitos.",
        },
        {"fieldname": "sucursal", "label": "Sucursal", "fieldtype": "Data", "default": "001", "reqd": 1},
        {"fieldname": "terminal", "label": "Terminal", "fieldtype": "Data", "default": "00001", "reqd": 1},
        {
            "fieldname": "ambiente",
            "label": "Ambiente",
            "fieldtype": "Select",
            "options": "Staging\nProduccion",
            "default": "Staging",
            "reqd": 1,
        },
        {"fieldname": "firma_section", "label": "Firma Criptografica", "fieldtype": "Section Break"},
        {"fieldname": "llave_criptografica", "label": "Llave Criptografica (.p12)", "fieldtype": "Attach"},
        {"fieldname": "pin_llave", "label": "PIN Llave", "fieldtype": "Password"},
        {
            "fieldname": "proveedor_sistemas",
            "label": "Proveedor Sistemas (Hacienda)",
            "fieldtype": "Data",
            "description": "Codigo/numeracion de proveedor de sistemas requerido por gen_xml_fe.",
        },
        {
            "fieldname": "codigo_actividad_emisor",
            "label": "Codigo Actividad Economica Emisor",
            "fieldtype": "Data",
            "description": "Opcional / legacy; preferir actividad principal TRIBU (6 digitos v4.4 tras normalizar).",
        },
        {"fieldname": "xml_tribu_section", "label": "XML v4.4 / validacion", "fieldtype": "Section Break"},
        {
            "fieldname": "enviar_actividad_formato_tribu_xml",
            "label": "Actividad en XML formato TRIBU (ej. 4752.1)",
            "fieldtype": "Check",
            "default": 1,
            "description": "Si esta activo, gen_xml envia codigoActividad con punto como en TRIBU. Si no, 6 digitos.",
        },
        {
            "fieldname": "exigir_ubicacion_receptor",
            "label": "Exigir domicilio Hacienda del cliente",
            "fieldtype": "Check",
            "default": 1,
            "description": "Al desmarcar, se omite la validacion de provincia/canton/distrito del receptor al confirmar factura.",
        },
        {
            "fieldname": "xml_detalle_codigo_comercial_tipo_tx",
            "label": "Linea detalle: CodigoComercial y TipoTransaccion",
            "fieldtype": "Check",
            "default": 0,
            "description": "Desmarcado: igual a muchas facturas TRIBU (solo CABYS y montos). Marcado: incluye codigo interno y tipo 01 (como otros POS).",
        },
    ]

    if not frappe.db.exists("DocType", "CRLibre Settings"):
        doctype = frappe.get_doc(
            {
                "doctype": "DocType",
                "name": "CRLibre Settings",
                "module": "Facturacion Cr",
                "custom": 1,
                "issingle": 1,
                "allow_rename": 0,
                "istable": 0,
                "engine": "InnoDB",
                "track_changes": 1,
                "fields": desired_fields,
                "permissions": [
                    {
                        "role": "System Manager",
                        "read": 1,
                        "write": 1,
                        "create": 1,
                        "delete": 1,
                        "print": 1,
                        "email": 1,
                        "share": 1,
                        "export": 1,
                    }
                ],
            }
        )
        doctype.insert(ignore_permissions=True)
        frappe.db.commit()
        return

    crlibre_custom_fields = {
        "CRLibre Settings": [
            {
                "fieldname": "api_mode",
                "label": "Modo API",
                "fieldtype": "Select",
                "options": "users_openAccess\nusers_loggedIn",
                "default": "users_openAccess",
                "reqd": 1,
                "insert_after": "api_url",
            },
            {
                "fieldname": "session_key",
                "label": "Session Key",
                "fieldtype": "Data",
                "read_only": 1,
                "insert_after": "api_password",
            },
            {
                "fieldname": "tipo_cedula_emisor",
                "label": "Tipo Cedula Emisor",
                "fieldtype": "Select",
                "options": "fisico\njuridico\ndimex\nnite",
                "default": "juridico",
                "reqd": 1,
                "insert_after": "api_password",
            },
            {
                "fieldname": "actividad_economica_principal",
                "label": "Actividad Economica Principal",
                "fieldtype": "Data",
                "length": 16,
                "reqd": 1,
                "description": "Como en TRIBU (ej. 7020.0) o 6 digitos del XML v4.4; al guardar se normaliza a 6 digitos.",
                "insert_after": "emisor_cedula",
            },
            {
                "fieldname": "sucursal",
                "label": "Sucursal",
                "fieldtype": "Data",
                "default": "001",
                "reqd": 1,
                "insert_after": "actividad_economica_principal",
            },
            {
                "fieldname": "terminal",
                "label": "Terminal",
                "fieldtype": "Data",
                "default": "00001",
                "reqd": 1,
                "insert_after": "sucursal",
            },
            {
                "fieldname": "llave_criptografica",
                "label": "Llave Criptografica (.p12)",
                "fieldtype": "Attach",
                "insert_after": "ambiente",
            },
            {
                "fieldname": "pin_llave",
                "label": "PIN Llave",
                "fieldtype": "Password",
                "insert_after": "llave_criptografica",
            },
            {
                "fieldname": "certificado_p12_codigo_crlibre",
                "label": "Codigo descarga .p12 en CRLibre",
                "fieldtype": "Data",
                "description": "downloadCode del certificado en CRLibre Files, o dejelo vacio: al procesar la factura se sube el .p12 adjunto arriba y se rellena solo.",
                "insert_after": "pin_llave",
            },
            {
                "fieldname": "mh_credenciales_section",
                "label": "Ministerio de Hacienda (token recepcion)",
                "fieldtype": "Section Break",
                "insert_after": "certificado_p12_codigo_crlibre",
            },
            {
                "fieldname": "mh_usuario",
                "label": "Usuario API Hacienda",
                "fieldtype": "Data",
                "description": "Usuario del portal / API comprobantes electronicos (grant_type=password).",
                "insert_after": "mh_credenciales_section",
            },
            {
                "fieldname": "mh_contrasena",
                "label": "Contrasena API Hacienda",
                "fieldtype": "Password",
                "insert_after": "mh_usuario",
            },
            {
                "fieldname": "mh_client_secret",
                "label": "Client Secret (opcional)",
                "fieldtype": "Password",
                "description": "Si el ambiente lo exige para el token OIDC.",
                "insert_after": "mh_contrasena",
            },
            {
                "fieldname": "proveedor_sistemas",
                "label": "Proveedor Sistemas (Hacienda)",
                "fieldtype": "Data",
                "description": "Codigo/numeracion de proveedor de sistemas requerido por gen_xml_fe.",
                "insert_after": "mh_client_secret",
            },
            {
                "fieldname": "codigo_actividad_emisor",
                "label": "Codigo Actividad Economica Emisor",
                "fieldtype": "Data",
                "description": "Opcional / legacy; preferir actividad principal TRIBU (6 digitos v4.4 tras normalizar).",
                "insert_after": "proveedor_sistemas",
            },
            {
                "fieldname": "xml_tribu_section",
                "label": "XML v4.4 / validacion",
                "fieldtype": "Section Break",
                "insert_after": "codigo_actividad_emisor",
            },
            {
                "fieldname": "enviar_actividad_formato_tribu_xml",
                "label": "Actividad en XML formato TRIBU (ej. 4752.1)",
                "fieldtype": "Check",
                "default": 1,
                "description": "Si esta activo, gen_xml envia codigoActividad con punto como en TRIBU. Si no, 6 digitos.",
                "insert_after": "xml_tribu_section",
            },
            {
                "fieldname": "exigir_ubicacion_receptor",
                "label": "Exigir domicilio Hacienda del cliente",
                "fieldtype": "Check",
                "default": 1,
                "description": "Al desmarcar, se omite la validacion de provincia/canton/distrito del receptor al confirmar factura.",
                "insert_after": "enviar_actividad_formato_tribu_xml",
            },
            {
                "fieldname": "xml_detalle_codigo_comercial_tipo_tx",
                "label": "Linea detalle: CodigoComercial y TipoTransaccion",
                "fieldtype": "Check",
                "default": 0,
                "description": "Desmarcado: estilo TRIBU minimal. Marcado: codigo interno + tipo transaccion 01.",
                "insert_after": "exigir_ubicacion_receptor",
            },
        ]
    }
    _create_custom_fields_safe(crlibre_custom_fields, update=True)
    frappe.db.commit()


def create_customer_hacienda_fields() -> None:
    if not frappe.db.exists("DocType", "Customer"):
        return
    fields = {
        "Customer": [
            {
                "fieldname": "hacienda_codigo_actividad_receptor",
                "label": "Codigo actividad economica receptor (TRIBU / v4.4)",
                "fieldtype": "Data",
                "length": 16,
                "description": "Como en TRIBU (ej. 7020.0) o 6 digitos del XML v4.4. Opcional; puede sobrescribirse en la factura.",
                "insert_after": "customer_type",
            },
            {
                "fieldname": "hacienda_tipo_identificacion",
                "label": "Tipo identificacion (Hacienda v4.4)",
                "fieldtype": "Select",
                "options": "\n01\n02\n03\n04",
                "description": "01 Cedula fisica, 02 Juridica, 03 DIMEX, 04 NITE. Vacio: se infiere del tipo de cliente.",
                "insert_after": "hacienda_codigo_actividad_receptor",
            },
        ]
    }
    _create_custom_fields_safe(fields, update=True)


def create_item_tax_template_hacienda_fields() -> None:
    if not frappe.db.exists("DocType", "Item Tax Template"):
        return
    fields = {
        "Item Tax Template": [
            {
                "fieldname": "hacienda_codigo_impuesto",
                "label": "Codigo impuesto Hacienda",
                "fieldtype": "Data",
                "length": 2,
                "default": "01",
                "description": "Nota 8 Anexo 4.4 (01 = IVA).",
                "insert_after": "title",
            },
            {
                "fieldname": "hacienda_codigo_tarifa",
                "label": "Codigo tarifa IVA Hacienda",
                "fieldtype": "Data",
                "length": 2,
                "description": "Nota 8.1 (08=13%, 10=Exenta, etc.). Vacio: se infiere de la tasa de la plantilla.",
                "insert_after": "hacienda_codigo_impuesto",
            },
        ]
    }
    _create_custom_fields_safe(fields, update=True)


def create_item_cabys_field() -> None:
    if not frappe.db.exists("DocType", "Item"):
        return
    # Section despues de stock_uom: en v16 el insert_after "item_group" a veces no muestra el campo en Detalles.
    fields = {
        "Item": [
            {
                "fieldname": "hacienda_fe_item_section",
                "label": "Facturacion electronica CR",
                "fieldtype": "Section Break",
                "insert_after": "stock_uom",
            },
            {
                "fieldname": "custom_codigo_cabys",
                "label": "Codigo CABYS (Hacienda v4.4)",
                "fieldtype": "Data",
                "length": 13,
                "description": "13 digitos segun catalogo oficial CABYS. Requerido al generar XML con CRLibre.",
                "insert_after": "hacienda_fe_item_section",
            },
        ]
    }
    _create_custom_fields_safe(fields, update=True)
    frappe.clear_cache(doctype="Item")


def create_sales_invoice_custom_fields() -> None:
    if not frappe.db.exists("DocType", "Sales Invoice"):
        return
    custom_fields = {
        "Sales Invoice": [
            {
                "fieldname": "hacienda_section",
                "label": "Ministerio de Hacienda CR",
                "fieldtype": "Section Break",
                "insert_after": "naming_series",
            },
            {
                "fieldname": "hacienda_actividad_economica",
                "label": "Actividad economica (TRIBU / v4.4)",
                "fieldtype": "Data",
                "length": 16,
                "description": "Como en TRIBU (ej. 7020.0) o 6 digitos XML v4.4. Se puede traer desde CRLibre Settings en factura nueva.",
                "insert_after": "hacienda_section",
            },
            {
                "fieldname": "hacienda_actividad_receptor",
                "label": "Actividad economica receptor (TRIBU / v4.4)",
                "fieldtype": "Data",
                "length": 16,
                "description": "Como en TRIBU o 6 digitos v4.4 del receptor. Vacio: se toma del cliente si esta definido.",
                "insert_after": "hacienda_actividad_economica",
            },
            {
                "fieldname": "hacienda_condicion_venta",
                "label": "Condicion de Venta (Hacienda)",
                "fieldtype": "Select",
                "options": "01\n02\n03\n04\n99",
                "default": "01",
                "description": "01 Contado, 02 Credito, 03 Consignacion, 04 Apartado, 99 Otros (v4.4).",
                "insert_after": "hacienda_actividad_receptor",
            },
            {
                "fieldname": "hacienda_otros_xml_section",
                "label": "Otros (XML v4.4)",
                "fieldtype": "Section Break",
                "insert_after": "hacienda_condicion_venta",
            },
            {
                "fieldname": "hacienda_otro_orden_compra",
                "label": "Orden de compra (OtroTexto)",
                "fieldtype": "Data",
                "description": "Opcional. Se envia como OtroTexto codigo OrdenCompra en el XML.",
                "insert_after": "hacienda_otros_xml_section",
            },
            {
                "fieldname": "hacienda_otro_lugar_entrega",
                "label": "Lugar de entrega (OtroTexto)",
                "fieldtype": "Small Text",
                "description": "Opcional. OtroTexto codigo LugarEntrega.",
                "insert_after": "hacienda_otro_orden_compra",
            },
            {
                "fieldname": "hacienda_medio_pago",
                "label": "Medio de Pago Principal (Hacienda)",
                "fieldtype": "Select",
                "options": "01\n02\n03\n04\n05\n06\n07\n99",
                "default": "04",
                "description": "Nota 6 v4.4: 01 Efectivo, 02 Tarjeta, 03 Cheque, 04 Transferencia, 05 Recaudado terceros, 06 SINPE Movil, 07 Plataforma digital, 99 Otros.",
                "insert_after": "hacienda_otro_lugar_entrega",
            },
            {
                "fieldname": "hacienda_medio_pago_otro",
                "label": "Detalle medio Otros (Hacienda)",
                "fieldtype": "Small Text",
                "description": "Obligatorio si el medio principal es 99 (minimo 5 caracteres).",
                "insert_after": "hacienda_medio_pago",
            },
            {
                "fieldname": "hacienda_medios_pago_json",
                "label": "Desglose medios de pago (JSON)",
                "fieldtype": "JSON",
                "description": 'Opcional. Lista max. 4: [{"tipo_medio":"04","monto": 100.0, "detalle_otro":""}, ...]. '
                "La suma de monto debe igualar el total. Si hay datos, sustituye al medio principal en el XML. "
                'tipo_medio: 01-07 o 99; si 99, detalle_otro min. 5 caracteres.',
                "insert_after": "hacienda_medio_pago_otro",
            },
            {
                "fieldname": "hacienda_clave",
                "label": "Clave Hacienda",
                "fieldtype": "Data",
                "length": 50,
                "read_only": 1,
                "allow_on_submit": 1,
                "insert_after": "hacienda_medios_pago_json",
            },
            {
                "fieldname": "hacienda_consecutivo",
                "label": "Consecutivo Hacienda",
                "fieldtype": "Data",
                "length": 20,
                "read_only": 1,
                "allow_on_submit": 1,
                "insert_after": "hacienda_clave",
            },
            {
                "fieldname": "hacienda_estado",
                "label": "Estado Hacienda",
                "fieldtype": "Select",
                "options": "Pendiente\nProcesando\nEnviado\nAceptado\nRechazado\nError de Comunicacion",
                "default": "Pendiente",
                "allow_on_submit": 1,
                "insert_after": "hacienda_consecutivo",
            },
            {
                "fieldname": "hacienda_xml_enviado",
                "label": "XML / respuesta CRLibre (gen)",
                "fieldtype": "Code",
                "options": "JSON",
                "read_only": 1,
                "allow_on_submit": 1,
                "insert_after": "hacienda_estado",
            },
            {
                "fieldname": "hacienda_xml_firmado",
                "label": "XML firmado (Base64)",
                "fieldtype": "Long Text",
                "read_only": 1,
                "allow_on_submit": 1,
                "description": "Salida del modulo firmarXML de CRLibre (Base64).",
                "insert_after": "hacienda_xml_enviado",
            },
            {
                "fieldname": "hacienda_xml_respuesta",
                "label": "XML Respuesta Hacienda",
                "fieldtype": "Code",
                "options": "XML",
                "read_only": 1,
                "allow_on_submit": 1,
                "insert_after": "hacienda_xml_firmado",
            },
            {
                "fieldname": "hacienda_error_log",
                "label": "Log Error Hacienda",
                "fieldtype": "Small Text",
                "read_only": 1,
                "allow_on_submit": 1,
                "insert_after": "hacienda_xml_respuesta",
            },
        ]
    }

    _create_custom_fields_safe(custom_fields, update=True)


def create_sales_invoice_item_custom_fields() -> None:
    if not frappe.db.exists("DocType", "Sales Invoice Item"):
        return
    item_fields = {
        "Sales Invoice Item": [
            {
                "fieldname": "hacienda_naturaleza_descuento",
                "label": "Naturaleza descuento (Hacienda)",
                "fieldtype": "Data",
                "description": "Obligatorio si la linea tiene descuento: texto 3-80 caracteres (v4.4).",
                "insert_after": "discount_amount",
            },
            {
                "fieldname": "hacienda_exon_section",
                "label": "Exoneracion IVA (Hacienda)",
                "fieldtype": "Section Break",
                "insert_after": "hacienda_naturaleza_descuento",
            },
            {
                "fieldname": "hacienda_exon_tipo_documento",
                "label": "Tipo documento exoneracion",
                "fieldtype": "Data",
                "length": 2,
                "description": "Codigo nota 10.1 v4.4 (si aplica exoneracion en la linea).",
                "insert_after": "hacienda_exon_section",
            },
            {
                "fieldname": "hacienda_exon_numero_documento",
                "label": "Numero documento exoneracion",
                "fieldtype": "Data",
                "insert_after": "hacienda_exon_tipo_documento",
            },
            {
                "fieldname": "hacienda_exon_nombre_institucion",
                "label": "Institucion exoneracion",
                "fieldtype": "Data",
                "insert_after": "hacienda_exon_numero_documento",
            },
            {
                "fieldname": "hacienda_exon_fecha",
                "label": "Fecha documento exoneracion",
                "fieldtype": "Date",
                "insert_after": "hacienda_exon_nombre_institucion",
            },
            {
                "fieldname": "hacienda_exon_tarifa_exonerada",
                "label": "Tarifa exonerada (%)",
                "fieldtype": "Percent",
                "description": "Porcentaje IVA exonerado sobre el subtotal de la linea.",
                "insert_after": "hacienda_exon_fecha",
            },
            {
                "fieldname": "hacienda_exon_monto",
                "label": "Monto exoneracion",
                "fieldtype": "Currency",
                "description": "Opcional. Si vacio se estima como subtotal x tarifa exonerada.",
                "insert_after": "hacienda_exon_tarifa_exonerada",
            },
        ]
    }
    _create_custom_fields_safe(item_fields, update=True)


def ensure_sales_invoice_client_script() -> None:
    if not frappe.db.exists("DocType", "Sales Invoice"):
        return
    legacy_script_name = "Sales Invoice - Enviar a CRLibre"
    script_name = "Sales Invoice - Procesar en CRLibre"
    script_body = """
frappe.ui.form.on("Sales Invoice", {
    refresh(frm) {
        if (
            frm.is_new() &&
            (!frm.doc.hacienda_actividad_economica || String(frm.doc.hacienda_actividad_economica).trim() === "")
        ) {
            frappe.db
                .get_single_value("CRLibre Settings", "actividad_economica_principal")
                .then((v) => {
                    if (v) {
                        frm.set_value("hacienda_actividad_economica", String(v).trim());
                    }
                });
        }
        if (frm.is_new() && frm.doc.customer) {
            frappe.db.get_value(
                "Customer",
                frm.doc.customer,
                "hacienda_codigo_actividad_receptor"
            ).then((v) => {
                if (v && (!frm.doc.hacienda_actividad_receptor || String(frm.doc.hacienda_actividad_receptor).trim() === "")) {
                    frm.set_value("hacienda_actividad_receptor", String(v).trim());
                }
            });
        }
        const est = (frm.doc.hacienda_estado || "").trim();
        const puedeCr =
            frm.doc.docstatus === 1 &&
            (est === "" || est === "Pendiente" || est === "Rechazado");
        if (puedeCr) {
            frm.add_custom_button("Procesar en CRLibre", () => {
                frappe.call({
                    method: "facturacion_cr.api_crlibre.procesar_factura_hacienda",
                    args: { invoice_name: frm.doc.name },
                    freeze: true,
                    callback: () => frm.reload_doc(),
                });
            });
        }
        if (frm.doc.docstatus === 1 && (frm.doc.hacienda_clave || "").trim()) {
            frm.add_custom_button(
                "Refrescar Estado Hacienda",
                () => {
                    frappe.call({
                        method: "facturacion_cr.api_crlibre.consultar_estado_hacienda",
                        args: { invoice_name: frm.doc.name },
                        freeze: true,
                        callback: () => frm.reload_doc(),
                    });
                },
                __("Estado FE")
            );
        }
    },
    customer(frm) {
        if (!frm.is_new() || !frm.doc.customer) {
            return;
        }
        frappe.db
            .get_value("Customer", frm.doc.customer, "hacienda_codigo_actividad_receptor")
            .then((v) => {
                if (v) {
                    frm.set_value("hacienda_actividad_receptor", String(v).trim());
                }
            });
    },
});
""".strip()

    if frappe.db.exists("Client Script", legacy_script_name):
        legacy_script = frappe.get_doc("Client Script", legacy_script_name)
        legacy_script.enabled = 0
        legacy_script.save(ignore_permissions=True)

    if frappe.db.exists("Client Script", script_name):
        client_script = frappe.get_doc("Client Script", script_name)
        client_script.dt = "Sales Invoice"
        client_script.enabled = 1
        client_script.script = script_body
        client_script.save(ignore_permissions=True)
    else:
        client_script = frappe.get_doc(
            {
                "doctype": "Client Script",
                "name": script_name,
                "dt": "Sales Invoice",
                "enabled": 1,
                "script": script_body,
            }
        )
        client_script.insert(ignore_permissions=True)

    frappe.db.commit()
