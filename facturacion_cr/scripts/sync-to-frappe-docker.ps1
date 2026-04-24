#Requires -Version 5.1
<#
.SYNOPSIS
  Copia facturacion_cr a frappe_docker, reconstruye la imagen y ejecuta migrate + clear-cache.

.USAGE
  .\sync-to-frappe-docker.ps1

  Variables abajo si tus rutas son distintas.

IMPORTANTE
  No pegues la SALIDA de este script de vuelta en PowerShell (syncing..., tracebacks, etc.):
  PowerShell intentara ejecutar cada linea como comando. Solo vuelve a ejecutar .\sync-to-frappe-docker.ps1
#>

$ErrorActionPreference = 'Stop'

Write-Host "Tip: no pegues el log de salida en la consola; solo ejecuta de nuevo este .ps1 si hace falta.`n" -ForegroundColor DarkGray

$RepoRoot       = 'C:\Users\proyectosace\Documents\Presupuestos-Alfa'
$FrappeDocker   = 'C:\Users\proyectosace\Documents\frappe_docker'
$SiteName       = 'frontend'
$ComposeProject = 'frappe'
$ComposeFile    = 'pwd.yml'
$ImageTag       = 'local/facturacion-cr:v16.15.0'
$Dockerfile     = 'Dockerfile.facturacion_cr'

$Src = Join-Path $RepoRoot 'facturacion_cr'
$Dst = Join-Path $FrappeDocker 'custom_apps\facturacion_cr'

if (-not (Test-Path $Src)) {
    Write-Error "No existe carpeta fuente: $Src"
}
if (-not (Test-Path $FrappeDocker)) {
    Write-Error "No existe frappe_docker: $FrappeDocker"
}

Write-Host "`n=== 1/6 robocopy Presupuestos-Alfa/facturacion_cr -> frappe_docker/custom_apps/facturacion_cr ===`n" -ForegroundColor Cyan

robocopy $Src $Dst /E /COPY:DAT /R:2 /W:2 `
    /XD .git __pycache__ node_modules .pytest_cache *.egg-info '.tox' `
    /NFL /NDL /NJH /NJS

# robocopy: 0-7 = OK con distintos niveles de copia; >= 8 error
if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy fallo con codigo $LASTEXITCODE"
}

Push-Location $FrappeDocker
try {
    Write-Host "`n=== 2/6 docker build $ImageTag ===`n" -ForegroundColor Cyan
    docker build -t $ImageTag -f $Dockerfile .

    Write-Host "`n=== 3/6 docker compose up -d ($ComposeFile / -p $ComposeProject) ===`n" -ForegroundColor Cyan
    docker compose -f $ComposeFile -p $ComposeProject up -d

    Write-Host "`n=== 4/6 bench --site $SiteName migrate ===`n" -ForegroundColor Cyan
    docker compose -f $ComposeFile -p $ComposeProject exec -T backend bash -lc "bench --site $SiteName migrate"

    Write-Host "`n=== 5/6 bench --site $SiteName clear-cache ===`n" -ForegroundColor Cyan
    docker compose -f $ComposeFile -p $ComposeProject exec -T backend bash -lc "bench --site $SiteName clear-cache"

    Write-Host "`n=== 6/6 bench restart ===`n" -ForegroundColor Cyan
    docker compose -f $ComposeFile -p $ComposeProject exec -T backend bash -lc "bench restart"

    Write-Host "`n=== Verificar install.py + Custom Fields en Item (DB) ===`n" -ForegroundColor Cyan
    docker compose -f $ComposeFile -p $ComposeProject exec -T backend bash -lc "grep -n 'create_item_cabys_field' /home/frappe/frappe-bench/apps/facturacion_cr/facturacion_cr/install.py | head -n 5"
    docker compose -f $ComposeFile -p $ComposeProject exec -T backend bash -lc "cd /home/frappe/frappe-bench && env/bin/python apps/facturacion_cr/facturacion_cr/check_item_custom_fields.py $SiteName"

    Write-Host "`nListo. En Item > Detalles: seccion 'Facturacion electronica CR' debajo de UdM, campo Codigo CABYS. Si no ves: Ctrl+Shift+R en el navegador.`n" -ForegroundColor Green
}
finally {
    Pop-Location
}
