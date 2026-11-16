# Inicia el bot de musica. Uso: doble clic en Iniciar-Bot.bat
#  - Recarga el PATH (por si yt-dlp/ffmpeg se instalaron con la terminal abierta).
#  - Instala lo que falte (yt-dlp, ffmpeg, dependencias de Node) y compila si hace falta.
#  - Pide el token solo la primera vez y lo guarda cifrado para tu usuario de Windows,
#    fuera del proyecto (%APPDATA%\BotDiscord\token.dat). Nunca se sube a GitHub.
param([switch]$NuevoToken)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Paso($texto) { Write-Host "`n>> $texto" -ForegroundColor Cyan }

# --- Herramientas externas -------------------------------------------------
foreach ($t in @(@{ cmd = 'yt-dlp'; id = 'yt-dlp.yt-dlp' }, @{ cmd = 'ffmpeg'; id = 'Gyan.FFmpeg' })) {
  if (-not (Get-Command $t.cmd -ErrorAction SilentlyContinue)) {
    Paso "Falta $($t.cmd). Instalando con winget..."
    winget install --id $t.id -e --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Get-Command $t.cmd -ErrorAction SilentlyContinue)) {
      throw "No se pudo instalar $($t.cmd). Instalalo a mano: winget install $($t.id)"
    }
  }
}

# --- Dependencias y compilacion -------------------------------------------
if (-not (Test-Path 'node_modules')) {
  Paso 'Instalando dependencias (solo la primera vez)...'
  npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw 'npm install fallo.' }
}

$main = 'dist/src/main.js'
$necesitaCompilar = -not (Test-Path $main)
if (-not $necesitaCompilar) {
  $compilado = (Get-Item $main).LastWriteTime
  $necesitaCompilar = [bool](Get-ChildItem -Path 'src' -Recurse -Filter '*.ts' | Where-Object { $_.LastWriteTime -gt $compilado } | Select-Object -First 1)
}
if ($necesitaCompilar) {
  Paso 'Compilando...'
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'La compilacion fallo.' }
}

# --- Token ------------------------------------------------------------------
$tokenFile = Join-Path $env:APPDATA 'BotDiscord\token.dat'
if ($NuevoToken -and (Test-Path $tokenFile)) { Remove-Item $tokenFile }

function Leer-Token {
  if (Test-Path $tokenFile) {
    $sec = Get-Content $tokenFile | ConvertTo-SecureString
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  $plano = (Read-Host 'Pega el token del bot (Portal de desarrolladores > Bot > Reset Token)').Trim().Trim('"')
  New-Item -ItemType Directory -Force -Path (Split-Path $tokenFile) | Out-Null
  $plano | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $tokenFile
  return $plano
}

if (-not $env:DISCORD_TOKEN) {
  for ($i = 0; $i -lt 3; $i++) {
    $token = Leer-Token
    try {
      $me = Invoke-RestMethod -Uri 'https://discord.com/api/v10/users/@me' -Headers @{ Authorization = "Bot $token" }
      Write-Host "Token correcto. Bot: $($me.username)" -ForegroundColor Green
      $env:DISCORD_TOKEN = $token
      break
    } catch {
      $codigo = $null
      if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
      if ($codigo -eq 401) {
        Write-Host 'Discord rechazo ese token. Copia el token de la pestana Bot (no el Application ID ni la Public Key).' -ForegroundColor Yellow
        Remove-Item $tokenFile -ErrorAction SilentlyContinue
      } else {
        Write-Host 'No se pudo comprobar el token (sin internet?). Se intentara arrancar igual.' -ForegroundColor Yellow
        $env:DISCORD_TOKEN = $token
        break
      }
    }
  }
  if (-not $env:DISCORD_TOKEN) { throw 'No se obtuvo un token valido.' }
}

if (-not $env:DISCORD_CLIENT_ID) { $env:DISCORD_CLIENT_ID = '1571752827297206272' }
if (-not $env:DISCORD_GUILD_ID) { $env:DISCORD_GUILD_ID = '1571769915679973468' }

# --- Arranque ---------------------------------------------------------------
Paso 'Arrancando el bot. Cierra esta ventana o pulsa Ctrl+C para detenerlo.'
node $main
