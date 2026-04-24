app_name = "facturacion_cr"
app_title = "Facturacion CR"
app_publisher = "Equipo Facturacion CR"
app_description = "Facturacion Electronica Costa Rica para ERPNext v16"
app_email = "dev@facturacion-cr.local"
app_license = "MIT"

after_install = "facturacion_cr.install.after_install"
after_migrate = "facturacion_cr.install.after_migrate"

# Incluye el Single en la busqueda global (Awesome Bar / Ctrl+K).
# Sin esto, el formulario abre por URL y sidebar pero no suele aparecer al buscar "crlibre".
global_search_doctypes = {
    "Default": [
        {"doctype": "CRLibre Settings"},
    ],
}

doc_events = {
    "CRLibre Settings": {
        "validate": "facturacion_cr.validators.validate_crlibre_settings",
    },
    "Customer": {
        "validate": "facturacion_cr.validators.validate_customer_hacienda",
    },
    "Sales Invoice": {
        "before_submit": [
            "facturacion_cr.validators.before_submit_sales_invoice_actividad",
            "facturacion_cr.validators.before_submit_sales_invoice_hacienda_items",
        ],
    },
}
