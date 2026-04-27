-- Ajustes disciplinarios (fila única id = default): plantillas PDF y SMTP.
-- El modelo ya estaba en schema.prisma; sin esta tabla fallan upsert y el correo de prueba.

CREATE TABLE "app_disciplinary_settings" (
    "id" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL DEFAULT 'APERCIBIMIENTO — OMISION DE MARCA',
    "documentLegalText" TEXT NOT NULL DEFAULT 'Se registra apercibimiento por omisiones de marca segun normativa interna vigente.',
    "documentFooter" TEXT NOT NULL DEFAULT 'Documento generado desde Syntra — Control de Rentabilidad.',
    "documentFormCode" TEXT NOT NULL DEFAULT 'F-RH-30',
    "documentFormRevision" TEXT NOT NULL DEFAULT '05/07/2021',
    "documentFormVersion" TEXT NOT NULL DEFAULT '2',
    "documentFormSubtitle" TEXT NOT NULL DEFAULT 'Apercibimiento por omisión de marca',
    "documentIntroTemplate" TEXT NOT NULL DEFAULT 'Por medio de la presente se le notifica el apercibimiento N° {{numero}}, registrado con fecha de emisión {{fecha_emision}}, por {{omisiones_count}} omisión(es) de marca. Los datos del funcionario y el detalle de las omisiones registradas son los siguientes:',
    "documentSignaturePath" TEXT,
    "apercibimientoConsecutiveYear" INTEGER,
    "apercibimientoConsecutiveLast" INTEGER NOT NULL DEFAULT 0,
    "emailFixedCc" TEXT,
    "emailSubjectTemplate" TEXT NOT NULL DEFAULT 'Apercibimiento {{numero}} — omision de marca',
    "emailBodyTemplate" TEXT NOT NULL DEFAULT E'Estimado/a {{nombre}}:\n\nSe registra el apercibimiento {{numero}} por {{omisiones_count}} omision(es) de marca. Adjuntamos la constancia en PDF.\n\nEste mensaje fue enviado automaticamente desde el sistema de control.',
    "mailProvider" TEXT NOT NULL DEFAULT 'CUSTOM_SMTP',
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpSecure" BOOLEAN,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFrom" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_disciplinary_settings_pkey" PRIMARY KEY ("id")
);
