-- Apariencia global: logo y colores (singleton id = default)
CREATE TABLE "app_branding" (
    "id" TEXT NOT NULL,
    "logoPath" TEXT,
    "primaryHex" TEXT NOT NULL DEFAULT '#2563eb',
    "sidebarHex" TEXT NOT NULL DEFAULT '#0f172a',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_branding_pkey" PRIMARY KEY ("id")
);

INSERT INTO "app_branding" ("id", "logoPath", "primaryHex", "sidebarHex", "updatedAt")
VALUES ('default', NULL, '#2563eb', '#0f172a', CURRENT_TIMESTAMP);
