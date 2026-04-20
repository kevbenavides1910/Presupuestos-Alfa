-- Agrega la hora de cada omisión (texto "HH:mm" o "HH:mm:ss"; sin timezone).
-- Permite distinguir varias omisiones del mismo día (entrada vs salida, etc.).

ALTER TABLE "disciplinary_omisiones"
    ADD COLUMN "hora" TEXT;
