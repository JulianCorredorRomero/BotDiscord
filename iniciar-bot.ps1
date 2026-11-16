# Inicia el bot. Recarga el PATH (por si yt-dlp/ffmpeg se instalaron con la terminal abierta)
# y pide el token sin guardarlo en ningún archivo.
Set-Location -Path $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

if (-not $env:DISCORD_TOKEN) {
  $env:DISCORD_TOKEN = (Read-Host 'Pega el token del bot').Trim()
}
if (-not $env:DISCORD_CLIENT_ID) { $env:DISCORD_CLIENT_ID = '1571752827297206272' }
if (-not $env:DISCORD_GUILD_ID) { $env:DISCORD_GUILD_ID = '1571769915679973468' }

if (-not (Test-Path 'dist/src/main.js')) { npm.cmd run build }
node dist/src/main.js
