"""Codigos de actividad economica segun catalogo TRIBU (factura electronica v4.4)."""

from __future__ import annotations

import re


def normalize_tribu_actividad(raw: str) -> str:
    """
    Convierte el codigo como lo muestra TRIBU (ej. 7020.0) al de 6 digitos usado en el XML v4.4 (702000).

    En v4.4 el comprobante lleva actividad en 6 digitos; TRIBU suele mostrar clase.subcodigo.

    Acepta:
    - Ya 6 digitos: se devuelve igual.
    - Formato clase.subcodigo: parte entera en 4 digitos + subcodigo en 2 (7020.0 -> 702000).
    - Solo la clase (1-4 digitos): se asume subcodigo 00 (7020 -> 702000).
    """
    s = (raw or "").strip()
    if not s:
        return ""
    if re.fullmatch(r"\d{6}", s):
        return s
    m = re.fullmatch(r"(\d+)\.(\d+)", s)
    if m:
        left = int(m.group(1))
        right_part = m.group(2)
        if len(right_part) <= 2:
            right = int(right_part)
        else:
            right = int(right_part[:2])
        return f"{left:04d}{right:02d}"
    if re.fullmatch(r"\d{1,4}", s):
        return f"{int(s):04d}00"
    return ""


def tribu_display_from_six_digits(six: str) -> str:
    """Convierte 6 digitos internos (ej. 702000, 475201) al formato TRIBU en XML (7020.0, 4752.1)."""
    s = (six or "").strip()
    if not re.fullmatch(r"\d{6}", s):
        return s
    a = int(s[:4])
    b = int(s[4:6])
    return f"{a}.{b}"
