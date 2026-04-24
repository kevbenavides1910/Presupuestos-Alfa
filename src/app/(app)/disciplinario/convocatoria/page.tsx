import Link from "next/link";
import { Topbar } from "@/components/layout/Topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Users } from "lucide-react";

export default function DisciplinarioConvocatoriaPage() {
  return (
    <>
      <Topbar title="Disciplinario · Solicitud de convocatoria" />
      <div className="p-6 space-y-6 max-w-3xl">
        <p className="text-sm text-slate-600">
          En la app de escritorio (Python), esta pestaña carga el Excel de{" "}
          <strong>resumen por empleado</strong>, permite ajustar lugar y hora, y genera el PDF en
          formato <strong>F-RH-42</strong> con envío por correo. En la web el tratamiento y la fecha
          de convocatoria se gestionan en <strong>Tratamiento</strong> y en la ficha del empleado.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Paso 1 — Resumen y fechas de convocatoria
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-3">
            <p>
              Defina o edite la <strong>fecha de convocatoria</strong> desde el resumen por empleado
              o la ficha de cada código. Exporte el resumen a Excel si necesita compartirlo con RRHH
              (equivalente al archivo que abre el escritorio).
            </p>
            <Button asChild variant="outline" className="gap-2">
              <Link href="/disciplinario/empleados">Ir a Tratamiento (resumen)</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-600" />
              Paso 2 — PDF F-RH-42 y correo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-2">
            <p>
              La generación automática del PDF <strong>F-RH-42</strong> y la plantilla de correo
              específica de convocatoria aún no están portadas a la web; puede seguir usando la app
              de escritorio para ese documento mientras tanto, con los mismos datos exportados.
            </p>
            <p className="text-xs text-slate-500">
              Si necesita este flujo 100&nbsp;% en la web, indíquelo y se puede enlazar la misma
              lógica de <code className="text-xs">convocatoria_pdf.py</code> y plantillas.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
