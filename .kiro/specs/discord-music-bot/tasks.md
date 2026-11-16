# Implementation Plan: discord-music-bot

## Overview

Implementación en TypeScript (Node.js) con `discord.js` v14, `@discordjs/voice`, `yt-dlp`, `ffmpeg` y SQLite (`better-sqlite3`). Primero se construye la lógica pura (Cola, volumen, permisos, serializador, temporizadores, configuración) con sus pruebas basadas en propiedades (`fast-check` + `vitest`). Después se añaden los módulos con E/S (Almacén, Resolvedor, AudioPipeline, GuildPlayer) y, por último, la capa de Discord (router, comandos, botones, arranque) que conecta todo.

## Tasks

- [x] 1. Configurar el proyecto y los tipos compartidos
  - [x] 1.1 Crear la estructura del proyecto y los tipos base
    - Crear `package.json`, `tsconfig.json`, configuración de `vitest` y dependencias (`discord.js`, `@discordjs/voice`, `better-sqlite3`, `fast-check`)
    - Definir `Result<T, E>`, `Clock` (con implementación real y falsa), `Track`, `Playlist`, `GuildSettings`, `LoopMode`, `CommandName`
    - Crear la estructura de carpetas `src/` (core, store, audio, player, discord) y `tests/`
    - _Requirements: 10.1, 10.6_

- [x] 2. Implementar la Cola
  - [x] 2.1 Implementar la clase `Queue`
    - `add` con límite de 500 y adición parcial, `remove`, `shuffle(rng)`, `advance(loop)`, `skip`, `clear`
    - Devolver conteos de agregadas/rechazadas y la posición de la primera pista agregada
    - _Requirements: 1.5, 2.3, 2.4, 2.9, 2.10, 2.11, 7.6, 7.9_

  - [x] 2.2 Escribir prueba de propiedad para añadir pistas
    - **Property 2: Añadir pistas respeta orden y límite de 500**
    - **Validates: Requirements 1.5, 7.6, 7.9**

  - [x] 2.3 Escribir prueba de propiedad para skip
    - **Property 5: Skip avanza a la siguiente pista**
    - **Validates: Requirements 2.3, 2.4**

  - [x] 2.4 Escribir prueba de propiedad para shuffle
    - **Property 8: Shuffle es una permutación de las pendientes**
    - **Validates: Requirements 2.9**

  - [x] 2.5 Escribir prueba de propiedad para remove
    - **Property 9: Remove**
    - **Validates: Requirements 2.10, 2.11**

- [x] 3. Implementar utilidades puras de volumen, formato y paginación
  - [x] 3.1 Implementar utilidades puras
    - `clampVolume`, `stepVolume`, `parseVolumeArg`, `volumeRamp`
    - `formatDuration`, `paginateQueue`, `truncateSuggestion` y limitación de sugerencias a 5
    - Selección de tasa de bits Opus `min(96, máximo del canal)`
    - Validación de `/loop` (modos válidos) y `/nowplaying` (texto con título, duración, posición, miniatura)
    - _Requirements: 2.6, 2.7, 2.8, 2.13, 3.3, 3.4, 3.9, 5.6, 6.4_

  - [x] 3.2 Escribir prueba de propiedad para la rampa de volumen
    - **Property 12: Rampa lineal de volumen**
    - **Validates: Requirements 3.4**

  - [x] 3.3 Escribir prueba de propiedad para los botones de volumen
    - **Property 13: Botones de volumen**
    - **Validates: Requirements 3.9**

  - [x] 3.4 Escribir prueba de propiedad para formato de duración, /nowplaying y modo de repetición
    - **Property 6: Formato de duración y de /nowplaying**
    - **Property 7: Modo de repetición**
    - **Validates: Requirements 2.6, 2.7, 2.8**

  - [x] 3.5 Escribir prueba de propiedad para la paginación
    - **Property 10: Paginación de /queue**
    - **Validates: Requirements 2.13**

  - [x] 3.6 Escribir prueba de propiedad para la tasa de bits
    - **Property 22: Selección de tasa de bits**
    - **Validates: Requirements 5.6**

  - [x] 3.7 Escribir prueba de propiedad para las sugerencias de autocompletado
    - **Property 26: Sugerencias de autocompletado**
    - **Validates: Requirements 6.4**

- [x] 4. Implementar el Resolvedor
  - [x] 4.1 Implementar `classifyInput` y `Resolver` con yt-dlp
    - Clasificar entradas en `video_url`, `playlist_url`, `search`, `invalid_url`
    - Resolver vídeo, búsqueda (primer resultado) y listas (máximo 100, omitiendo no disponibles) con tiempo límite de 10 s
    - Errores tipados: `invalid_link`, `unavailable:{deleted|private|region}`, `age_restricted`, `no_results`, `timeout`
    - Búsqueda para autocompletado con tiempo límite de 3 s que devuelve lista vacía si falla
    - _Requirements: 1.1, 1.2, 1.3, 1.10, 6.4, 6.12, 7.1, 7.2, 7.3, 7.4, 7.7_

  - [x] 4.2 Escribir prueba de propiedad para la clasificación de entradas
    - **Property 1: Clasificación de entradas de /play**
    - **Validates: Requirements 1.2, 7.1**

  - [x] 4.3 Escribir prueba de propiedad para la importación de listas de YouTube
    - **Property 3: Importación de listas de YouTube**
    - **Validates: Requirements 1.3, 7.7**

  - [x] 4.4 Escribir prueba de propiedad para fallos de resolución
    - **Property 4: Los fallos de resolución no modifican la Cola**
    - **Validates: Requirements 1.10, 7.1, 7.4**

- [x] 5. Implementar el serializador y las reglas de listas
  - [x] 5.1 Implementar `PlaylistSerializer` y `validatePlaylistSave`
    - Serialización JSON con versión y claves en orden fijo; deserialización con validación de esquema que devuelve `Result` sin lanzar excepciones
    - Reglas: nombre 1 a 50, vacío, máximo 200 pistas, 25 listas por usuario, confirmación de sobrescritura
    - _Requirements: 4.6, 4.8, 4.10, 4.11, 4.13, 4.14, 4.15_

  - [x] 5.2 Escribir prueba de propiedad para la ida y vuelta del serializador
    - **Property 20: Ida y vuelta del serializador**
    - **Validates: Requirements 4.13, 4.14**

  - [x] 5.3 Escribir prueba de propiedad para JSON inválido
    - **Property 21: JSON inválido**
    - **Validates: Requirements 4.15**

  - [x] 5.4 Escribir prueba de propiedad para la validación de guardado
    - **Property 17: Validación de guardado**
    - **Validates: Requirements 4.6, 4.8, 4.10, 4.11**

- [x] 6. Implementar el Almacén y los servicios de listas, volumen y Rol_DJ
  - [x] 6.1 Implementar `Store` sobre SQLite
    - Crear esquema `guild_settings` y `playlists`; operaciones de volumen (por defecto 50), Rol_DJ, idioma y listas
    - Devolver error tipado si falla el guardado
    - _Requirements: 3.5, 3.6, 3.8, 4.12, 8.3, 8.4_

  - [x] 6.2 Escribir prueba de propiedad para la persistencia tras reinicio
    - **Property 19: Persistencia de listas tras reinicio**
    - **Validates: Requirements 4.12**

  - [x] 6.3 Implementar servicios de `/playlist`, `/volume` y `/dj`
    - `save` (con confirmación de 30 s), `load` (al final de la Cola), `list` (orden alfabético, por usuario y servidor), `delete` (solo el creador)
    - `/volume` con valor, sin valor y con fallo de guardado (aplica y avisa); `/dj set|clear` solo para administradores
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 8.3, 8.4, 8.5_

  - [x] 6.4 Escribir prueba de propiedad para guardar listas
    - **Property 14: Guardar una lista conserva pistas y orden**
    - **Validates: Requirements 4.1**

  - [x] 6.5 Escribir prueba de propiedad para cargar listas
    - **Property 15: Cargar una lista añade al final**
    - **Validates: Requirements 4.2**

  - [x] 6.6 Escribir prueba de propiedad para listar listas
    - **Property 16: Listado de listas**
    - **Validates: Requirements 4.3**

  - [x] 6.7 Escribir prueba de propiedad para acceso por nombre y creador
    - **Property 18: Acceso a listas por nombre y creador**
    - **Validates: Requirements 4.5, 4.7, 4.9**

  - [x] 6.8 Escribir prueba de propiedad para el volumen
    - **Property 11: Aplicación y consulta de Volumen**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**

  - [x] 6.9 Escribir prueba de propiedad para el Rol_DJ
    - **Property 29: Configuración del Rol_DJ**
    - **Validates: Requirements 8.3, 8.4, 8.5**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implementar permisos y límite de uso
  - [x] 8.1 Implementar `canExecute`, `RESTRICTED` y `RateLimiter`
    - Reglas de Rol_DJ y canal de voz; ventana deslizante de 5 comandos en 10 s con espera redondeada hacia arriba
    - _Requirements: 6.3, 8.1, 8.2, 8.6, 8.7_

  - [x] 8.2 Escribir prueba de propiedad para la decisión de permisos
    - **Property 28: Decisión de permisos**
    - **Validates: Requirements 6.3, 8.1, 8.2, 8.6**

  - [x] 8.3 Escribir prueba de propiedad para el límite de uso
    - **Property 30: Límite de uso por ventana deslizante**
    - **Validates: Requirements 8.7**

- [x] 9. Implementar configuración, registro e i18n
  - [x] 9.1 Implementar `loadConfig`, `redactSecrets`, `formatLogEntry`, `Logger` e `I18n`
    - `loadConfig` lista las variables ausentes o vacías; salida con código distinto de cero y mensaje en stderr
    - Registro ISO 8601 UTC con tipo, descripción y guildId o "ninguno"; redacción de secretos en todo texto saliente
    - Catálogo de mensajes con español por defecto y respaldo
    - _Requirements: 6.5, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 9.2 Escribir prueba de propiedad para la carga de configuración
    - **Property 33: Carga de configuración**
    - **Validates: Requirements 10.2**

  - [x] 9.3 Escribir prueba de propiedad para la redacción de secretos
    - **Property 34: Redacción de secretos**
    - **Validates: Requirements 10.3**

  - [x] 9.4 Escribir prueba de propiedad para el formato de registro
    - **Property 35: Formato de entradas de registro**
    - **Validates: Requirements 10.4, 10.5**

  - [x] 9.5 Escribir prueba de propiedad para el catálogo de idioma
    - **Property 27: Catálogo de idioma**
    - **Validates: Requirements 6.5**

- [x] 10. Implementar desconexión automática y reconexión
  - [x] 10.1 Implementar `IdleTimerStateMachine`
    - 300 s con el Bot solo en el canal, 300 s con Cola vacía, retención de Cola 600 s tras destruir la sesión; cancelaciones al unirse un usuario o añadir una pista
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6_

  - [x] 10.2 Escribir prueba de propiedad para la máquina de desconexión
    - **Property 31: Máquina de desconexión y retención de Cola**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6**

  - [x] 10.3 Implementar la política de reconexión de voz
    - Hasta 3 intentos dentro de 15 s; reanudar en la posición de la interrupción; destruir sesión y avisar si fallan
    - Distinguir movimiento del Bot (continuar en el nuevo canal) de desconexión manual (vaciar Cola, sin reconectar)
    - _Requirements: 9.4, 9.5, 9.7, 9.8_

  - [x] 10.4 Escribir prueba de propiedad para la reconexión
    - **Property 32: Reconexión de voz**
    - **Validates: Requirements 9.4, 9.5**

- [x] 11. Implementar el pipeline de audio
  - [x] 11.1 Implementar `AudioPipeline` con ffmpeg
    - Cadena `loudnorm` (-16 LUFS) → fundido de entrada 500 ms → volumen con rampa 300 ms → `alimiter` (-1 dBTP) → fundido de salida 500 ms → Opus
    - Transformador PCM para cambios de volumen en vivo y fundidos de pausa/reanudación de 200 ms
    - Descarga con 3 reintentos separados 2 s; error tipado si falla ffmpeg
    - _Requirements: 3.1, 3.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 7.5_

  - [x] 11.2 Escribir prueba de propiedad para los reintentos de descarga
    - **Property 24: Reintentos de descarga**
    - **Validates: Requirements 7.5**

  - [x] 11.3 Escribir pruebas de audio con muestras
    - Medir sonoridad (-16 LUFS ±1 LU), techo de -1 dBTP con Volumen 0, 50 y 100, y duración de los fundidos
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7_

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implementar el Reproductor por Servidor
  - [x] 13.1 Implementar `GuildPlayer`
    - Estado, `Queue`, conexión de voz, `AudioPipeline`, `IdleTimerStateMachine`, pausa/reanudación, skip, stop, loop, aplicación del último Volumen guardado (50 por defecto)
    - Omitir pistas fallidas (procesamiento, no disponible, restricción de edad, descarga) con aviso de título y motivo; mantener la conexión si la Cola queda vacía
    - Conexión al canal del usuario, verificación de permisos de voz y de canal distinto
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.12, 3.7, 5.8, 5.9, 7.2, 7.3, 7.5, 9.1, 9.2, 9.3_

  - [x] 13.2 Escribir prueba de propiedad para pistas fallidas
    - **Property 23: Una pista fallida se omite y la Cola continúa**
    - **Validates: Requirements 5.8, 5.9, 7.2, 7.3, 7.5**

  - [x] 13.3 Implementar `PlayerManager`
    - `Map<guildId, GuildPlayer>` con creación, destrucción y aislamiento por Servidor
    - _Requirements: 10.6_

  - [x] 13.4 Escribir prueba de propiedad para el aislamiento entre Servidores
    - **Property 37: Aislamiento entre Servidores**
    - **Validates: Requirements 10.6**

- [x] 14. Implementar el Mensaje_de_Reproducción
  - [x] 14.1 Implementar `NowPlayingMessage`
    - Modelo con título, duración, solicitante, miniatura y seis botones con etiqueta de texto
    - Actualización al cambiar pista o estado, estado final con botones desactivados, y recreación del mensaje si falla o se elimina
    - _Requirements: 6.1, 6.2, 6.6, 6.9, 6.11_

  - [x] 14.2 Escribir prueba de propiedad para el Mensaje_de_Reproducción
    - **Property 25: Mensaje_de_Reproducción**
    - **Validates: Requirements 6.1, 6.6, 6.9**

- [x] 15. Implementar la capa de Discord y conectar todo
  - [x] 15.1 Implementar `Guard` e `InteractionRouter`
    - Encadenar `RateLimiter`, `canExecute` y verificaciones de canal de voz; `deferReply` cuando la operación pueda tardar
    - Capturar errores no previstos: registrar comando, usuario y Servidor, y responder con mensaje genérico
    - Respuestas efímeras para comandos de consulta
    - _Requirements: 6.7, 6.8, 7.8, 8.1, 8.2, 8.6, 8.7_

  - [x] 15.2 Escribir prueba de propiedad para errores no previstos
    - **Property 36: Respuesta a errores no previstos**
    - **Validates: Requirements 7.8**

  - [x] 15.3 Implementar los manejadores de comandos
    - `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/nowplaying`, `/queue`, `/loop`, `/shuffle`, `/remove`, `/volume`, `/playlist`, `/dj`
    - Conectarlos con `Resolver`, `GuildPlayer`, servicios de `Store` y `I18n`
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.10, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.9, 2.10, 2.12, 2.13, 2.14, 3.1, 3.2, 4.1, 4.2, 4.3, 4.5, 8.3, 8.4_

  - [x] 15.4 Implementar manejadores de botones y autocompletado
    - Cada botón ejecuta la acción equivalente con el mismo `Guard`; rechazos con mensaje efímero
    - Autocompletado de `/play` con hasta 5 sugerencias
    - _Requirements: 3.9, 6.3, 6.4, 6.10, 6.12_

  - [x] 15.5 Implementar `Bootstrap`
    - Cargar configuración, iniciar sesión con intents `Guilds` y `GuildVoiceStates`, registrar slash commands con hasta 3 reintentos cada 10 s
    - Solicitar solo permisos Connect, Speak, Send Messages y Embed Links; cablear router, `PlayerManager`, `Store`, `Logger`
    - _Requirements: 8.8, 9.9, 9.10, 10.1, 10.2_

  - [x] 15.6 Escribir pruebas unitarias y de integración de la capa de Discord
    - `/play` sin canal de voz, comandos sin reproducción activa, `/playlist list` vacío, volumen por defecto, fallo al guardar volumen
    - Movimiento y desconexión del Bot por un moderador, registro de slash commands, permisos solicitados
    - _Requirements: 1.7, 2.12, 3.6, 3.8, 4.4, 8.8, 9.7, 9.8, 9.9_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Todas las sub-tareas, incluidas las pruebas (propiedades, muestras de audio, unitarias e integración), son obligatorias.
- Cada prueba de propiedad usa `fast-check` con `numRuns: 100` y lleva el comentario **Feature: discord-music-bot, Property N: ...**.
- Cada prueba de propiedad va en su propio archivo de pruebas para permitir ejecución en paralelo.
- Cada tarea referencia requisitos concretos para trazabilidad.
- Los criterios de temporización con servicios externos se cubren con pruebas de integración o de ejemplo, no con PBT.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "8.1", "9.1", "10.1", "10.3"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "4.2", "4.3", "4.4", "5.2", "5.3", "5.4", "6.1", "8.2", "8.3", "9.2", "9.3", "9.4", "9.5", "10.2", "10.4", "11.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "11.2", "11.3", "13.1"] },
    { "id": 4, "tasks": ["6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "13.2", "13.3", "14.1"] },
    { "id": 5, "tasks": ["13.4", "14.2", "15.1"] },
    { "id": 6, "tasks": ["15.2", "15.3", "15.4"] },
    { "id": 7, "tasks": ["15.5", "15.6"] }
  ]
}
```
