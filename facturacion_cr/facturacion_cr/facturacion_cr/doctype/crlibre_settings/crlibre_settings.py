import re

import frappe
from frappe.model.document import Document


class CRLibreSettings(Document):
    def validate(self) -> None:
        if not self.emisor_cedula:
            frappe.throw("La cédula del emisor es obligatoria.")

        if not re.fullmatch(r"\d{9,12}", self.emisor_cedula):
            frappe.throw("La cédula del emisor debe tener entre 9 y 12 dígitos numéricos.")
