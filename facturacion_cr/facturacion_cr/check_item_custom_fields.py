#!/usr/bin/env python3
"""Ejecutar en backend: cd frappe-bench && env/bin/python apps/facturacion_cr/facturacion_cr/check_item_custom_fields.py"""
import os
import sys

BENCH_ROOT = "/home/frappe/frappe-bench"
SITES_PATH = os.path.join(BENCH_ROOT, "sites")


def _resolve_site_name() -> str:
    """Sitio por env, argumento o sites/currentsite.txt (como usa bench)."""
    if len(sys.argv) >= 2 and sys.argv[1].strip():
        return sys.argv[1].strip()
    env = os.environ.get("FRAPPE_SITE") or os.environ.get("SITE_NAME") or ""
    if env.strip():
        return env.strip()
    cur = os.path.join(SITES_PATH, "currentsite.txt")
    if os.path.isfile(cur):
        with open(cur, encoding="utf-8") as f:
            name = (f.read() or "").strip()
            if name:
                return name
    return "frontend"


os.chdir(BENCH_ROOT)
_site = _resolve_site_name()

# Antes de frappe.connect(): RotatingFileHandler puede usar sites/<site>/logs o, en algunos builds, bench/<site>/logs.
os.makedirs("/home/frappe/logs", exist_ok=True)
os.makedirs(os.path.join(SITES_PATH, _site, "logs"), exist_ok=True)
os.makedirs(os.path.join(BENCH_ROOT, _site, "logs"), exist_ok=True)

import frappe  # noqa: E402

if not os.path.isdir(os.path.join(SITES_PATH, _site)):
    print(f"Sitio '{_site}' no existe en {SITES_PATH}. Carpetas:", file=sys.stderr)
    try:
        for name in sorted(os.listdir(SITES_PATH)):
            path = os.path.join(SITES_PATH, name)
            if os.path.isdir(path) and not name.startswith("."):
                print(f"  - {name}", file=sys.stderr)
    except OSError as e:
        print(e, file=sys.stderr)
    print(f"Usa: python .../check_item_custom_fields.py <nombre_sitio>", file=sys.stderr)
    sys.exit(1)

frappe.init(site=_site, sites_path=SITES_PATH)
frappe.connect()

rows = frappe.db.sql(
    """
    SELECT fieldname, label, fieldtype, insert_after
    FROM `tabCustom Field`
    WHERE dt = 'Item'
      AND fieldname IN ('custom_codigo_cabys', 'hacienda_fe_item_section')
    ORDER BY fieldname
    """,
    as_dict=True,
)
print(f"Sitio: {_site}")
print("Custom Fields en Item (CABYS):")
for r in rows:
    print(r)
if not rows:
    print("(ninguno — migrate / create_item_cabys_field no creo los campos)")

frappe.destroy()
