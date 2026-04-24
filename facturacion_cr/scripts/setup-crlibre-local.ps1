#Requires -Version 5.1
<#
.SYNOPSIS
  Clona CRLibre API_Hacienda y levanta PHP+Apache+MariaDB con Docker (puerto HTTP 8090).

.USAGE
  .\setup-crlibre-local.ps1

  Variables abajo si prefieres otra rama o puerto.

DESPUES DE LEVANTAR
  - Probar desde Windows: http://localhost:8090/api.php?w=ejemplo&r=hola
  - ERPNext (`backend` en la misma red Docker que CRLibre): CRLibre Settings > URL API =
      http://crlibre-api/api.php
    (Alternativa si no comparten red: http://host.docker.internal:8090/api.php)
  - Antes de CRLibre debe existir la red de frappe (`docker compose -f pwd.yml -p frappe up -d`).

IMPORTANTE
  No pegues la SALIDA de este script de vuelta en PowerShell como si fueran comandos.
#>

$ErrorActionPreference = 'Stop'

if (-not $PSScriptRoot) {
    $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$CrlibreRoot     = 'C:\Users\proyectosace\Documents\crlibre-api-hacienda'
$CrlibreBranch   = 'v4.4'
$CrlibreRepoUrl  = 'https://github.com/CRLibre/API_Hacienda.git'
$HttpHostPort    = 8090
# Red definida en frappe_docker/pwd.yml con `docker compose ... -p frappe` -> frappe_frappe_network
$FrappeDockerNetwork = $(if ($env:FRAPPE_DOCKER_NETWORK) { $env:FRAPPE_DOCKER_NETWORK } else { 'frappe_frappe_network' })

Write-Host "`n=== CRLibre API_Hacienda local (Docker) ===`n" -ForegroundColor Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "git no esta en PATH. Instala Git for Windows."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "docker no esta en PATH. Instala Docker Desktop."
}

if (-not (Test-Path $CrlibreRoot)) {
    Write-Host "Clonando $CrlibreRepoUrl (rama $CrlibreBranch)...`n" -ForegroundColor Yellow
    $parent = Split-Path $CrlibreRoot -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    git clone --depth 1 --branch $CrlibreBranch $CrlibreRepoUrl $CrlibreRoot
}
else {
    Write-Host "Ya existe: $CrlibreRoot (omitir clone).`n" -ForegroundColor DarkGray
}

$settingsPhp = Join-Path $CrlibreRoot 'www\settings.php'
$settingsSample = Join-Path $PSScriptRoot 'crlibre-local-settings.php.sample'
if (-not (Test-Path $settingsSample)) {
    Write-Error "No esta el archivo plantilla: $settingsSample"
}
# Plantilla docker v4.4 con rutas /var/www/html/api/ y DB=testdb (php-apache.env).
# Si settings.php existe pero es el formato getenv/.env (ramas nuevas), el API no arranca bien.
$applySettings = $true
if (Test-Path $settingsPhp) {
    $prev = Get-Content -LiteralPath $settingsPhp -Raw -ErrorAction SilentlyContinue
    # Sobrescribir si viene una variante rota que usa getenv() sin .env en Docker.
    if ($prev -and $prev -notmatch 'getenv\s*\(' -and $prev -match '/var/www/html/api/') {
        $applySettings = $false
    }
}
if ($applySettings) {
    Write-Host "Copiando www\settings.php desde facturacion_cr (plantilla local Docker)...`n" -ForegroundColor Yellow
    Copy-Item -LiteralPath $settingsSample -Destination $settingsPhp -Force
}

# Dockerfile oficial usa Debian Buster (EOL): apt falla sin archive.debian.org.
# En Windows, git puede dejar CRLF en docker-entrypoint.sh y el contenedor no arranca.
$dockerfilePath = Join-Path $CrlibreRoot 'docker-php-apache\Dockerfile'
if (Test-Path $dockerfilePath) {
    $df = Get-Content -LiteralPath $dockerfilePath -Raw
    $changed = $false
    if ($df -notmatch 'archive.debian.org') {
        Write-Host "Parcheando docker-php-apache/Dockerfile (Buster -> archive.debian.org)...`n" -ForegroundColor Yellow
        $df = $df -replace 'RUN apt-get update && apt-get -y install libpng-dev curl libcurl4-openssl-dev openssl netcat', @'
RUN sed -i 's/deb.debian.org/archive.debian.org/g' /etc/apt/sources.list \
 && sed -i 's/security.debian.org/archive.debian.org/g' /etc/apt/sources.list \
 && printf 'Acquire::Check-Valid-Until "false";\n' > /etc/apt/apt.conf.d/99no-check-valid \
 && apt-get update && apt-get -y install libpng-dev curl libcurl4-openssl-dev openssl netcat
'@
        $changed = $true
    }
    if ($df -notmatch "sed -i 's/\\r\$//' /usr/local/bin/docker-entrypoint") {
        Write-Host "Parcheando docker-php-apache/Dockerfile (CRLF en entrypoint)...`n" -ForegroundColor Yellow
        $df = $df -replace 'COPY ./docker-php-apache/docker-entrypoint.sh /usr/local/bin/\r?\nRUN chmod \+x /usr/local/bin/docker-entrypoint.sh', @'
COPY ./docker-php-apache/docker-entrypoint.sh /usr/local/bin/
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh
'@
        $changed = $true
    }
    if ($changed) {
        Set-Content -LiteralPath $dockerfilePath -Value $df -Encoding UTF8 -NoNewline
    }
}

# Compose concatena ports de override + base => quedaria 8080 y 8090; parcheamos docker-compose.yml.
$composePath = Join-Path $CrlibreRoot 'docker-compose.yml'
if (Test-Path $composePath) {
    $yc = Get-Content -LiteralPath $composePath -Raw
    $yc2 = $yc -replace '8080:80', "${HttpHostPort}:80"
    if ($yc2 -ne $yc) {
        Set-Content -LiteralPath $composePath -Value $yc2 -Encoding UTF8 -NoNewline
        Write-Host "Actualizado docker-compose.yml: puerto HTTP host $HttpHostPort -> 80 (evita choque con ERPNext en 8080).`n" -ForegroundColor DarkGray
    }
    $yc3 = Get-Content -LiteralPath $composePath -Raw
    if ($yc3 -match './www/settings\.php:/var/www/html/settings\.php') {
        Write-Host "Actualizado docker-compose.yml: volumen ./www completo (evita mount roto de settings.php en Windows).`n" -ForegroundColor Yellow
        $yc3 = $yc3 -replace '- ./www/settings.php:/var/www/html/settings.php', '- ./www:/var/www/html'
        Set-Content -LiteralPath $composePath -Value $yc3 -Encoding UTF8 -NoNewline
    }
    $yc4 = Get-Content -LiteralPath $composePath -Raw
    if ($yc4 -match '\bcrlibrenet\b' -and $yc4 -notmatch 'frappe_shared') {
        Write-Host "Actualizado docker-compose.yml: uniendo CRLibre a la red ERPNext ($FrappeDockerNetwork)...`n" -ForegroundColor Yellow
        $yc4 = $yc4 -replace '(?ms)(    depends_on:\s*\r?\n      - "mariadb"\s*\r?\n    networks:\s*\r?\n      - crlibrenet\s*\r?\n    volumes:)', @'
    depends_on:
      - "mariadb"
    networks:
      frappe_shared:
        aliases:
          - crlibre-api
    volumes:
'@
        $yc4 = $yc4 -replace '(?ms)(    tty: true\s*\r?\n    networks:\s*\r?\n      - crlibrenet\s*\r?\n)(\r?\nnetworks:)', @'
    tty: true
    networks:
      - frappe_shared

networks:
'@
        $footer = @'
networks:
  frappe_shared:
    external: true
    name: ${FRAPPE_DOCKER_NETWORK:-frappe_frappe_network}

'@
        $yc4 = $yc4 -replace '(?ms)^networks:\s*\r?\n\s+crlibrenet:\s*\r?\n\s+driver:\s+bridge\s*\r?\n\s+driver_opts:\s*\r?\n\s+com.docker.network.enable_ipv6:\s*"false"\s*$', $footer.TrimEnd()
        Set-Content -LiteralPath $composePath -Value $yc4 -Encoding UTF8 -NoNewline
    }
}

docker network inspect $FrappeDockerNetwork 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "AVISO: La red Docker '$FrappeDockerNetwork' no existe aun. Levanta ERPNext antes (frappe_docker: docker compose -f pwd.yml -p frappe up -d).`n" -ForegroundColor Yellow
}

$env:FRAPPE_DOCKER_NETWORK = $FrappeDockerNetwork

Push-Location $CrlibreRoot
try {
    Write-Host "=== docker compose up -d --build ===`n" -ForegroundColor Cyan
    docker compose -f docker-compose.yml up -d --build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "docker compose fallo con codigo $LASTEXITCODE"
    }

    Write-Host "`nListo.`n" -ForegroundColor Green
    Write-Host "  Probar en el navegador (desde Windows):" -ForegroundColor White
    Write-Host "    http://localhost:${HttpHostPort}/api.php?w=ejemplo&r=hola`n" -ForegroundColor Gray
    Write-Host "  ERPNext > CRLibre Settings > URL API (recomendado, misma red Docker):" -ForegroundColor White
    Write-Host "    http://crlibre-api/api.php`n" -ForegroundColor Gray
    Write-Host "  Alternativa (sin red compartida):" -ForegroundColor White
    Write-Host "    http://host.docker.internal:${HttpHostPort}/api.php`n" -ForegroundColor DarkGray
}
finally {
    Pop-Location
}
