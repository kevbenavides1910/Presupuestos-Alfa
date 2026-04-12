# Sistema de Control de Rentabilidad de Contratos

## Requisitos Previos

- Node.js 20+
- PostgreSQL 14+ (o Docker)
- npm o yarn

---

## Instalación Rápida

### 1. Instalar dependencias
```bash
cd security-contracts
npm install
```

### 2. Configurar base de datos

**Opción A — Docker (recomendado):**
```bash
docker-compose up postgres -d
```

**Opción B — PostgreSQL local:**
Crear base de datos `security_contracts` y actualizar `.env.local`.

### 3. Configurar variables de entorno
El archivo `.env.local` ya está creado con valores de desarrollo:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/security_contracts"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-secret-change-in-production-min32chars!!"
```

### 4. Inicializar la base de datos
```bash
npm run db:generate   # Generar cliente Prisma
npm run db:push       # Crear tablas en PostgreSQL
npm run db:seed       # Cargar datos iniciales (~30 contratos de muestra)
```

### 5. Iniciar el servidor de desarrollo
```bash
npm run dev
```

Abrir http://localhost:3000

---

## Credenciales de Acceso (desarrollo)

| Usuario | Email | Contraseña | Permisos |
|---------|-------|------------|---------|
| Admin | admin@seguridadgrupocr.com | admin123 | Total |
| Supervisor | supervisor@seguridadgrupocr.com | supervisor123 | Leer/Escribir contratos, gastos |
| Contabilidad | contabilidad@seguridadgrupocr.com | contab123 | Gastos, reportes |

---

## Estructura del Proyecto

```
src/
├── app/
│   ├── (auth)/login/         # Página de login
│   ├── (app)/
│   │   ├── dashboard/        # Dashboard ejecutivo
│   │   ├── contracts/        # CRUD de contratos
│   │   ├── expenses/
│   │   │   ├── deferred/     # Gastos diferidos
│   │   │   └── admin/        # Gastos administrativos
│   │   └── reports/          # Reportes + exportar Excel
│   └── api/                  # API Routes (Next.js)
├── components/               # Componentes React
├── lib/
│   ├── business/             # Lógica de negocio
│   ├── validations/          # Schemas Zod
│   └── utils/                # Utilidades
└── prisma/
    ├── schema.prisma
    └── seed.ts
```

---

## Funcionalidades Implementadas

### Dashboard
- KPIs: contratos activos, facturación total, contratos en riesgo, % ejecución
- Estado por empresa (verde/amarillo/rojo)
- Top contratos con mayor ejecución de presupuesto
- Alertas de contratos próximos a vencer (60 días)

### Contratos
- Listado con filtros (empresa, estado, tipo de cliente, búsqueda)
- Creación y edición completa con validaciones
- Vista detalle con:
  - Barra de ejecución presupuestaria (semáforo)
  - Registro de uniformes por mes
  - Registro de hallazgos de auditoría (PENDIENTE/COMPLETADO)
  - Gestión de prórrogas
- Eliminación lógica (soft delete)
- Log de auditoría en cada cambio

### Gastos
- **Uniformes**: registro mensual por artículo (camisa, pantalón, zapatos, gorra, chaleco, etc.)
- **Hallazgos de auditoría**: radio, esposas, paraguas, blackjack, linterna — sólo los PENDIENTES afectan el presupuesto
- **Gastos diferidos**: registro y distribución proporcional entre contratos (por % de equivalencia)
- **Gastos administrativos**: transportes, celulares, líneas telefónicas, combustible — distribuibles por empresa

### Reportes
- Tabla completa de rentabilidad por contrato
- Semáforos Verde/Amarillo/Rojo con conteos
- Exportar a Excel (.xlsx)
- Filtros por empresa y período mensual

---

## Reglas de Negocio

1. **Semáforo de presupuesto de insumos:**
   - 🟢 Verde: < 70% ejecutado
   - 🟡 Amarillo: 70% – 90% ejecutado
   - 🔴 Rojo: > 90% ejecutado

2. **% de Equivalencia:**
   - `equivalencePct = posiciones_del_contrato / total_posiciones_empresa`
   - Se recalcula automáticamente al crear/editar/eliminar contratos

3. **Gastos diferidos:**
   - Un gasto global se distribuye entre todos los contratos activos de la empresa
   - Cada contrato absorbe: `monto_global × equivalencePct`
   - Una vez distribuido, queda bloqueado (no redistribuible sin admin)

4. **Hallazgos de auditoría:**
   - Solo los hallazgos con estado PENDIENTE afectan el presupuesto
   - Al marcar COMPLETADO (equipo repuesto), el gasto ya no se contabiliza

---

## Despliegue con Docker

```bash
# Todo en uno
docker-compose up -d

# Inicializar DB y seed (primera vez)
docker-compose exec app npx prisma db push
docker-compose exec app npm run db:seed
```

---

## Próximos Pasos Sugeridos

1. **Importación masiva desde Excel** — cargar los ~90 contratos reales desde el archivo
2. **Módulo de usuarios** — gestión de usuarios y roles desde la UI
3. **Flujo de aprobaciones** — supervisor solicita gasto → administrador aprueba
4. **Notificaciones por email** — alertas cuando un contrato llega a 80%/90%
5. **Dashboard por empresa** — vista filtrada por empresa para supervisores
6. **Historial de cambios en UI** — visualizar el log de auditoría por contrato
