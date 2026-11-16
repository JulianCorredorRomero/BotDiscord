# Bot de música para Discord

Bot de música en TypeScript (`discord.js` v14, `@discordjs/voice`, `yt-dlp`, `ffmpeg`, SQLite).

## Puesta en marcha

### 1. Requisitos

- Node.js 20 o superior.
- `ffmpeg` y `yt-dlp` instalados y disponibles en el `PATH`.
  - Windows: `winget install Gyan.FFmpeg` y `winget install yt-dlp.yt-dlp`.
  - macOS: `brew install ffmpeg yt-dlp`.
  - Debian/Ubuntu: `sudo apt install ffmpeg` y `pipx install yt-dlp` (o el binario de la página de yt-dlp).
  - Si no están en el `PATH`, indica su ruta con `FFMPEG_PATH` y `YTDLP_PATH`.

### 2. Registrar el bot en Discord

1. Crea una aplicación en el [Portal de desarrolladores](https://discord.com/developers/applications).
2. En **Bot**, crea el bot y copia el token. No hace falta activar ningún intent privilegiado
   (el bot solo usa `Guilds` y `GuildVoiceStates`).
3. Copia el **Application ID** (es el `DISCORD_CLIENT_ID`).
4. Invita al bot con la URL de invitación. Se imprime en el registro al arrancar, o puedes generarla con
   `buildInviteUrl(clientId)` de `src/bootstrap.ts`. Solicita únicamente los permisos
   Connect, Speak, Send Messages y Embed Links, con los scopes `bot` y `applications.commands`.

### 3. Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DISCORD_TOKEN` | Sí | Token del bot. Nunca se escribe en los registros. |
| `DISCORD_CLIENT_ID` | Sí | Application ID. |
| `DISCORD_GUILD_ID` | No | Si se define, los comandos se registran solo en ese servidor (aparecen al instante, útil en desarrollo). Sin ella se registran de forma global. |
| `DATABASE_PATH` | No | Ruta del archivo SQLite. Por defecto `data/bot.sqlite`. |
| `FFMPEG_PATH` | No | Ruta de `ffmpeg`. Por defecto `ffmpeg`. |
| `YTDLP_PATH` | No | Ruta de `yt-dlp`. Por defecto `yt-dlp`. |

Si falta alguna variable obligatoria, o está vacía, el proceso termina con código distinto de cero y
muestra en `stderr` los nombres ausentes, sin conectarse a Discord.

### 4. Ejecutar

```bash
npm install
npm run build
npm start
```

PowerShell:

```powershell
$env:DISCORD_TOKEN = "..."
$env:DISCORD_CLIENT_ID = "..."
npm start
```

Al arrancar, el bot inicia sesión y registra los slash commands. Si el registro falla, lo anota en el
registro con la causa y reintenta hasta 3 veces con 10 s de intervalo. `Ctrl+C` (SIGINT) o SIGTERM
detienen los reproductores, cierran el almacén y desconectan el cliente.

### Pruebas

```bash
npm test
npm run typecheck
```
