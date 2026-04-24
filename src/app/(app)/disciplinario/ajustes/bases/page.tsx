import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Users, MapPin } from "lucide-react";

export default function DisciplinarioAjustesBasesPage() {
  return (
    <>
      <Topbar title="Disciplinario · Ajustes · Bases de datos" />
      <div className="p-6 space-y-6 max-w-3xl">
        <p className="text-sm text-slate-600">
          Equivalente a <strong>Ajustes → Bases de datos</strong> en la app Python: mantenimiento
          de la base de empleados y la tabla <strong>zona → administrador → correo</strong> (en web:
          pestaña <strong>Zonas</strong> en Mantenimientos).
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Base de empleados
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-3">
            <p>
              Importación CSV al maestro disciplinario (código, nombre, correo, zona, teléfono,
              cuenta…). Misma función que el mapeo flexible del escritorio hacia{" "}
              <code className="text-xs">base_empleados</code>.
            </p>
            <Button asChild className="gap-2">
              <Link href="/disciplinario/importar">
                <Upload className="h-4 w-4" /> Abrir pantalla de importación
              </Link>
            </Button>
            <p className="text-xs text-slate-500">
              El formulario de importación incluye el bloque «Maestro de empleados (CSV)».
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="h-5 w-5 text-slate-500" />
              Zona — administrador — correo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-3">
            <p>
              En escritorio se guarda en <code className="text-xs">zonas_admin.xlsx</code>. En la web,
              el mismo dato vive en el catálogo de zonas: nombre de zona, administrador disciplinario y
              correo. Los imports disciplinarios enriquecen el administrador y pueden poner en copia
              (CC) ese correo cuando aplica.
            </p>
            <p className="text-xs text-slate-500">
              El texto de <strong>Zona</strong> en maestro CSV o en el reporte de marcas debe coincidir
              con el <strong>nombre</strong> de la zona en Mantenimientos (tras normalizar mayúsculas
              y espacios).
            </p>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/admin/catalogs">
                <MapPin className="h-4 w-4" /> Abrir Mantenimientos (pestaña Zonas)
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
