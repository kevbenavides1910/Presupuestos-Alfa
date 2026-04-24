# Comprueba en MariaDB (via Frappe) que existen los Custom Fields del Item. No hace build.
# Uso: .\verify-item-cabys-in-db.ps1  (desde carpeta que tenga pwd.yml, o ajusta $FrappeDocker)

$ErrorActionPreference = 'Stop'
$FrappeDocker   = 'C:\Users\proyectosace\Documents\frappe_docker'
$ComposeFile    = 'pwd.yml'
$ComposeProject = 'frappe'
$SiteName       = 'frontend'

Push-Location $FrappeDocker
try {
    docker compose -f $ComposeFile -p $ComposeProject exec -T backend bash -lc "cd /home/frappe/frappe-bench && env/bin/python apps/facturacion_cr/facturacion_cr/check_item_custom_fields.py $SiteName"
}
finally {
    Pop-Location
}
