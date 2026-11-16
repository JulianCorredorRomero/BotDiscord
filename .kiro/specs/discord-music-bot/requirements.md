# Requirements Document

## Introduction

Bot de Discord para reproducir música en canales de voz. Se controla con comandos de barra (slash commands), admite enlaces y búsquedas de YouTube, gestiona una cola de reproducción y listas de reproducción persistentes, y permite ajustar el volumen en tiempo real. Incluye funciones de comodidad y accesibilidad (botones interactivos, autocompletado, mensajes claros, desconexión automática) y procesamiento de audio (normalización de volumen, fundidos, limitador) para que la reproducción suene bien.

## Glossary

- **Bot**: La aplicación de Discord que recibe comandos y reproduce audio en canales de voz.
- **Servidor**: Un servidor (guild) de Discord donde el Bot está instalado.
- **Canal_de_Voz**: Un canal de voz de Discord en el que el Bot reproduce audio.
- **Usuario**: Persona que interactúa con el Bot mediante comandos o botones.
- **Comando**: Un slash command del Bot (por ejemplo, `/play`).
- **Pista**: Un elemento de audio reproducible obtenido de YouTube, con título, duración, URL y miniatura.
- **Cola**: Lista ordenada de Pistas pendientes de reproducción en un Servidor.
- **Lista_de_Reproducción**: Conjunto ordenado y con nombre de Pistas guardado de forma persistente.
- **Almacén**: Base de datos persistente donde el Bot guarda Listas_de_Reproducción y configuración.
- **Reproductor**: Componente que gestiona la conexión de voz, la Cola y la reproducción de un Servidor.
- **Procesador_de_Audio**: Componente que aplica normalización, fundidos, limitador y volumen al audio.
- **Resolvedor**: Componente que convierte enlaces o textos de búsqueda en Pistas.
- **Mensaje_de_Reproducción**: Mensaje del Bot que muestra la Pista actual con botones interactivos.
- **Rol_DJ**: Rol de Discord configurado por servidor que autoriza comandos de control.
- **Volumen**: Entero de 0 a 100 que representa el nivel de reproducción del Servidor.
- **Serializador_de_Listas**: Componente que convierte Listas_de_Reproducción a formato JSON y viceversa.
- **Modo_Repetición**: Estado de repetición de la Cola: desactivado, pista actual o cola completa.

## Requirements

### Requirement 1: Reproducir música con /play

**User Story:** Como usuario, quiero reproducir música con `/play` usando un enlace o texto, para empezar a escuchar de forma sencilla.

#### Acceptance Criteria

1. WHEN un Usuario ejecuta `/play` con un enlace válido de vídeo de YouTube, THE Resolvedor SHALL crear una Pista a partir de ese enlace en un máximo de 5 segundos.
2. WHEN un Usuario ejecuta `/play` con un texto que no es un enlace y tiene entre 1 y 100 caracteres, THE Resolvedor SHALL buscar en YouTube y crear una Pista con el primer resultado en un máximo de 5 segundos.
3. WHEN un Usuario ejecuta `/play` con un enlace de lista de reproducción de YouTube, THE Resolvedor SHALL crear una Pista por cada vídeo disponible, hasta un máximo de 100 Pistas, omitiendo los vídeos no disponibles, y responder con el número de Pistas añadidas.
4. WHEN la Cola está vacía y se agrega una Pista, THE Reproductor SHALL iniciar la reproducción de esa Pista en un máximo de 5 segundos.
5. WHEN la Cola contiene una Pista en reproducción y se agrega otra Pista, THE Reproductor SHALL añadir la nueva Pista al final de la Cola y responder con su posición numérica en la Cola, empezando en 1 para la primera Pista en espera.
6. WHEN un Usuario que está en un Canal_de_Voz ejecuta `/play` y el Bot no está en un Canal_de_Voz del Servidor, THE Reproductor SHALL conectarse al Canal_de_Voz del Usuario en un máximo de 10 segundos.
7. IF un Usuario ejecuta `/play` sin estar en un Canal_de_Voz, THEN THE Bot SHALL responder con un mensaje que indique que debe unirse primero a un Canal_de_Voz y SHALL NOT modificar la Cola.
8. IF un Usuario ejecuta un Comando de reproducción desde un Canal_de_Voz distinto al del Bot mientras el Bot reproduce, THEN THE Bot SHALL responder con un mensaje que indique el Canal_de_Voz en uso y SHALL NOT modificar la Cola ni la reproducción actual.
9. IF el Bot carece de permisos para conectarse o hablar en el Canal_de_Voz del Usuario, THEN THE Bot SHALL responder con un mensaje que indique el permiso faltante y SHALL NOT modificar la Cola.
10. IF el Resolvedor no obtiene ninguna Pista porque el enlace no es válido, el vídeo no está disponible, la búsqueda no devuelve resultados o YouTube no responde en 10 segundos, THEN THE Bot SHALL responder con un mensaje que indique el motivo del fallo y SHALL NOT modificar la Cola.

### Requirement 2: Control de reproducción y cola

**User Story:** Como usuario, quiero controlar la reproducción con comandos simples, para manejar la música sin complicaciones.

#### Acceptance Criteria

1. WHEN un Usuario ejecuta `/pause` durante una reproducción activa, THE Reproductor SHALL pausar la reproducción en un máximo de 1 segundo y conservar la posición actual con una precisión de ±1 segundo.
2. WHEN un Usuario ejecuta `/resume` con la reproducción pausada, THE Reproductor SHALL reanudar la reproducción en un máximo de 1 segundo desde la posición conservada, con una precisión de ±1 segundo.
3. WHEN un Usuario ejecuta `/skip` y la Cola contiene al menos 1 Pista pendiente, THE Reproductor SHALL detener la Pista actual y comenzar a reproducir la siguiente Pista de la Cola en un máximo de 3 segundos.
4. WHEN un Usuario ejecuta `/skip` y la Cola no contiene Pistas pendientes, THE Reproductor SHALL detener la Pista actual y dejar la reproducción en estado inactivo.
5. WHEN un Usuario ejecuta `/stop`, THE Reproductor SHALL detener la reproducción, vaciar la Cola y desconectarse del Canal_de_Voz en un máximo de 5 segundos.
6. WHEN un Usuario ejecuta `/nowplaying` con una reproducción activa, THE Bot SHALL mostrar el título, la duración total, la posición actual (con formato mm:ss) y la miniatura de la Pista actual.
7. WHEN un Usuario ejecuta `/loop` con un modo válido, THE Reproductor SHALL aplicar el Modo_Repetición indicado y THE Bot SHALL responder con un mensaje que confirme el modo aplicado.
8. IF un Usuario ejecuta `/loop` con un modo que no pertenece a los Modos_Repetición definidos, THEN THE Bot SHALL responder con un mensaje que indique los modos válidos y THE Reproductor SHALL conservar el Modo_Repetición vigente.
9. WHEN un Usuario ejecuta `/shuffle` y la Cola contiene al menos 2 Pistas pendientes, THE Reproductor SHALL reordenar aleatoriamente las Pistas pendientes de la Cola sin alterar la Pista actual ni el conjunto de Pistas pendientes.
10. WHEN un Usuario ejecuta `/remove` con una posición entera entre 1 y el número de Pistas de la Cola (ambos incluidos), THE Reproductor SHALL eliminar la Pista de esa posición de la Cola y desplazar las Pistas siguientes una posición hacia adelante.
11. IF un Usuario ejecuta `/remove` con una posición menor que 1, mayor que el número de Pistas de la Cola o que no sea un entero, THEN THE Bot SHALL responder con un mensaje que indique el rango válido y THE Reproductor SHALL conservar la Cola sin cambios.
12. IF un Usuario ejecuta `/pause`, `/resume`, `/skip` o `/nowplaying` sin reproducción activa, THEN THE Bot SHALL responder con un mensaje que indique que no hay nada reproduciéndose y THE Reproductor SHALL conservar su estado sin cambios.
13. WHEN un Usuario ejecuta `/queue` con al menos 1 Pista en la Cola, THE Bot SHALL mostrar las Pistas de la Cola en páginas de 10 Pistas como máximo, con el número de posición, título y duración de cada una, e indicar el número de página actual y el total de páginas.
14. IF un Usuario ejecuta `/queue` con la Cola vacía, THEN THE Bot SHALL responder con un mensaje que indique que la Cola está vacía.

### Requirement 3: Control dinámico de volumen

**User Story:** Como usuario, quiero ajustar el volumen mientras suena la música, para adaptarlo a la conversación en la llamada.

#### Acceptance Criteria

1. WHEN un Usuario ejecuta `/volume` con un valor entero entre 0 y 100 (ambos incluidos), THE Procesador_de_Audio SHALL aplicar el nuevo Volumen a la reproducción en curso en un máximo de 500 ms y THE Bot SHALL responder con un mensaje que confirme el nuevo Volumen.
2. WHEN un Usuario ejecuta `/volume` sin valor, THE Bot SHALL responder con un mensaje que muestre el Volumen actual del Servidor como entero entre 0 y 100, en un máximo de 2 segundos.
3. IF un Usuario ejecuta `/volume` con un valor que no es un entero entre 0 y 100 (incluidos valores negativos, mayores que 100 o decimales), THEN THE Bot SHALL mantener el Volumen actual, no modificar el valor guardado en el Almacén y responder con un mensaje que indique el rango válido de 0 a 100.
4. WHEN el Volumen cambia, THE Procesador_de_Audio SHALL interpolar linealmente el nivel de audio desde el Volumen anterior hasta el nuevo durante 300 ms para evitar saltos audibles.
5. WHEN el Volumen de un Servidor cambia, THE Almacén SHALL guardar el nuevo valor para ese Servidor en un máximo de 1 segundo.
6. IF el Almacén no puede guardar el nuevo Volumen, THEN THE Bot SHALL mantener aplicado el nuevo Volumen en la reproducción en curso y responder con un mensaje que indique que el valor no se guardó.
7. WHEN el Reproductor se conecta a un Canal_de_Voz, THE Procesador_de_Audio SHALL aplicar el último Volumen guardado del Servidor.
8. WHERE un Servidor no tiene Volumen guardado, THE Procesador_de_Audio SHALL usar un Volumen de 50.
9. WHEN un Usuario pulsa el botón de subir o bajar volumen del Mensaje_de_Reproducción, THE Procesador_de_Audio SHALL aumentar o reducir el Volumen en 10 puntos, limitando el resultado al rango de 0 a 100 (por ejemplo, subir desde 95 resulta en 100 y bajar desde 5 resulta en 0).

### Requirement 4: Listas de reproducción persistentes

**User Story:** Como usuario, quiero guardar y cargar listas de reproducción, para reutilizar mis canciones favoritas.

#### Acceptance Criteria

1. WHEN un Usuario ejecuta `/playlist save` con un nombre de 1 a 50 caracteres, THE Bot SHALL guardar en el Almacén la Pista actual seguida de las Pistas de la Cola, en ese orden, como una Lista_de_Reproducción con ese nombre asociada a ese Usuario y a ese Servidor, y responder con una confirmación que incluya el nombre y el número de Pistas guardadas.
2. WHEN un Usuario ejecuta `/playlist load` con el nombre de una Lista_de_Reproducción existente, THE Bot SHALL añadir sus Pistas al final de la Cola en su orden original, sin modificar las Pistas que ya estaban en la Cola, y responder con una confirmación que incluya el número de Pistas añadidas.
3. WHEN un Usuario ejecuta `/playlist list`, THE Bot SHALL mostrar el nombre y el número de Pistas de cada Lista_de_Reproducción de ese Usuario en el Servidor, ordenadas alfabéticamente por nombre.
4. IF un Usuario ejecuta `/playlist list` y no tiene Listas_de_Reproducción en el Servidor, THEN THE Bot SHALL responder con un mensaje que indique que no hay Listas_de_Reproducción disponibles.
5. WHEN un Usuario ejecuta `/playlist delete` con el nombre de una Lista_de_Reproducción propia, THE Bot SHALL eliminarla del Almacén y responder con una confirmación que incluya el nombre eliminado.
6. IF un Usuario ejecuta `/playlist save` con un nombre que ya existe para ese Usuario en el Servidor, THEN THE Bot SHALL solicitar confirmación y SHALL sobrescribir la Lista_de_Reproducción solo si el Usuario confirma en un plazo de 30 segundos; si el Usuario rechaza la confirmación o el plazo expira, THE Bot SHALL conservar la Lista_de_Reproducción original sin cambios e indicar que la operación fue cancelada.
7. IF un Usuario ejecuta `/playlist load` o `/playlist delete` con un nombre inexistente, THEN THE Bot SHALL responder con un mensaje que indique que la Lista_de_Reproducción no existe, sin modificar la Cola ni el Almacén.
8. IF un Usuario ejecuta `/playlist save` con la Cola vacía y sin Pista actual, THEN THE Bot SHALL responder con un mensaje que indique que no hay Pistas para guardar, sin modificar el Almacén.
9. IF un Usuario intenta eliminar una Lista_de_Reproducción creada por otro Usuario, THEN THE Bot SHALL rechazar la operación con un mensaje que indique que solo el creador puede eliminarla, sin modificar el Almacén.
10. IF un Usuario ejecuta `/playlist save` y la Pista actual más las Pistas de la Cola superan 200 Pistas, THEN THE Bot SHALL rechazar la operación con un mensaje que indique el límite de 200 Pistas por Lista_de_Reproducción, sin modificar el Almacén.
11. IF un Usuario ejecuta `/playlist save` con un nombre nuevo y ya tiene 25 Listas_de_Reproducción en el Servidor, THEN THE Bot SHALL rechazar la operación con un mensaje que indique el límite de 25 Listas_de_Reproducción por Usuario y Servidor, sin modificar el Almacén.
12. WHEN el Bot se reinicia, THE Almacén SHALL conservar todas las Listas_de_Reproducción guardadas, con su nombre, creador, Servidor y Pistas en el mismo orden.
13. THE Serializador_de_Listas SHALL convertir cada Lista_de_Reproducción a JSON para su almacenamiento y reconstruirla desde JSON.
14. FOR ALL Listas_de_Reproducción válidas, serializar, deserializar y volver a serializar SHALL producir un resultado equivalente al original (propiedad de ida y vuelta).
15. IF el Serializador_de_Listas recibe un JSON inválido, THEN THE Serializador_de_Listas SHALL devolver un error que indique el motivo del rechazo, sin modificar el Almacén.

### Requirement 5: Calidad y uniformidad del audio

**User Story:** Como usuario, quiero que el audio tenga volumen uniforme y sin distorsión, para que la música suene bien en la llamada.

#### Acceptance Criteria

1. WHEN una Pista comienza a procesarse, THE Procesador_de_Audio SHALL normalizar la sonoridad integrada de la Pista a -16 LUFS con una tolerancia de ±1 LU.
2. THE Procesador_de_Audio SHALL aplicar un limitador con techo de -1 dBTP, de modo que ninguna muestra de la salida supere -1 dBTP.
3. WHEN una Pista comienza, THE Procesador_de_Audio SHALL aplicar un fundido de entrada de 500 ms, con una tolerancia de ±50 ms, desde silencio hasta el nivel de salida configurado.
4. WHEN una Pista termina o un Usuario ejecuta `/skip`, THE Procesador_de_Audio SHALL aplicar un fundido de salida de 500 ms, con una tolerancia de ±50 ms, hasta silencio antes de iniciar la siguiente Pista.
5. WHEN un Usuario ejecuta `/pause` o `/resume`, THE Procesador_de_Audio SHALL aplicar un fundido de 200 ms, con una tolerancia de ±20 ms, antes de detener o reanudar la salida de audio.
6. THE Procesador_de_Audio SHALL codificar el audio en Opus con una tasa de bits igual al menor valor entre 96 kbps y la tasa de bits máxima del Canal_de_Voz.
7. WHILE el Volumen está entre 0 y 100 inclusive, THE Procesador_de_Audio SHALL mantener el nivel de salida pico por debajo de -1 dBTP.
8. IF el procesamiento de audio de una Pista falla, THEN THE Reproductor SHALL omitir la Pista, publicar en el canal de texto, en un máximo de 5 segundos, un mensaje de error que indique el título de la Pista y que fue omitida, conservar sin cambios el resto de la Cola y continuar con la siguiente Pista.
9. IF el procesamiento de audio de una Pista falla y la Cola no contiene más Pistas, THEN THE Reproductor SHALL detener la reproducción, publicar en el canal de texto un mensaje de error que indique que la Cola quedó vacía y mantener la conexión al Canal_de_Voz.

### Requirement 6: Botones, mensajes y accesibilidad

**User Story:** Como usuario, quiero botones y mensajes claros, para controlar la música de forma cómoda y accesible.

#### Acceptance Criteria

1. WHEN una Pista comienza a reproducirse, THE Bot SHALL publicar un Mensaje_de_Reproducción con título, duración, solicitante, miniatura y botones de pausa/reanudar, omitir, detener, repetición, volumen más y volumen menos.
2. WHEN cambia la Pista actual o el estado de reproducción, THE Bot SHALL actualizar el Mensaje_de_Reproducción en un máximo de 2 segundos.
3. WHEN un Usuario pulsa un botón del Mensaje_de_Reproducción, THE Bot SHALL ejecutar la acción equivalente aplicando las mismas verificaciones de permisos que el Comando.
4. WHEN un Usuario escribe en el parámetro de búsqueda de `/play`, THE Bot SHALL devolver hasta 5 sugerencias de autocompletado, cada una con título (truncado a un máximo de 100 caracteres) y duración, en un máximo de 3 segundos.
5. THE Bot SHALL redactar cada mensaje de respuesta en el idioma configurado del Servidor, con español como idioma predeterminado.
6. THE Bot SHALL incluir una descripción de texto en cada botón y en cada elemento visual del Mensaje_de_Reproducción para compatibilidad con lectores de pantalla.
7. WHEN un Usuario ejecuta un Comando, THE Bot SHALL responder en un máximo de 3 segundos, o enviar una respuesta diferida dentro de ese mismo plazo si la operación tarda más.
8. WHERE un Usuario ejecuta un Comando de consulta, THE Bot SHALL enviar la respuesta como mensaje visible solo para ese Usuario.
9. WHEN la Cola termina, THE Bot SHALL actualizar el Mensaje_de_Reproducción en un máximo de 2 segundos para indicar que la reproducción finalizó y desactivar todos sus botones.
10. IF un Usuario pulsa un botón del Mensaje_de_Reproducción y la acción es rechazada por falta de permisos o porque la Pista ya no está activa, THEN THE Bot SHALL enviar al Usuario un mensaje visible solo para él que indique el motivo del rechazo en un máximo de 3 segundos, sin modificar el estado de reproducción.
11. IF la actualización del Mensaje_de_Reproducción falla o el mensaje fue eliminado, THEN THE Bot SHALL publicar un nuevo Mensaje_de_Reproducción en el canal de texto en un máximo de 5 segundos, conservando el estado actual de la reproducción.
12. IF la búsqueda de autocompletado no produce resultados o no se completa en 3 segundos, THEN THE Bot SHALL devolver una lista de sugerencias vacía sin interrumpir el uso de `/play`.

### Requirement 7: Manejo de errores de YouTube

**User Story:** Como usuario, quiero que el bot gestione bien los errores de YouTube, para entender por qué una pista no suena.

#### Acceptance Criteria

1. IF el Resolvedor recibe un enlace que no corresponde a un vídeo o lista de YouTube accesible, THEN THE Bot SHALL responder en el canal de texto del Comando, en un plazo máximo de 5 segundos, con un mensaje que indique que el enlace no es válido, y SHALL dejar la Cola sin cambios.
2. IF una Pista no está disponible (eliminada, privada o bloqueada por región), THEN THE Bot SHALL, en un plazo máximo de 5 segundos, notificar en el canal de texto el título de la Pista y el motivo específico (eliminada, privada o bloqueada por región), omitir la Pista y continuar con la siguiente Pista de la Cola.
3. IF una Pista tiene restricción de edad y no puede reproducirse, THEN THE Bot SHALL, en un plazo máximo de 5 segundos, notificar en el canal de texto el título de la Pista y que la causa es la restricción de edad, omitir la Pista y continuar con la siguiente Pista de la Cola.
4. IF una búsqueda no devuelve resultados, THEN THE Bot SHALL responder en el canal de texto del Comando, en un plazo máximo de 5 segundos, con un mensaje que indique que no se encontraron resultados, y SHALL dejar la Cola sin cambios.
5. IF la descarga del flujo de audio falla, THEN THE Reproductor SHALL reintentar hasta 3 veces con un intervalo de 2 segundos entre intentos, y IF el tercer reintento también falla, THEN THE Bot SHALL notificar en el canal de texto el título de la Pista y el fallo de descarga, omitir la Pista y continuar con la siguiente Pista de la Cola.
6. IF la Cola contiene 500 Pistas y un usuario intenta agregar una Pista, THEN THE Bot SHALL rechazar la Pista, informar en el canal de texto que el límite es de 500 Pistas y conservar sin cambios las Pistas ya presentes en la Cola.
7. WHEN el Resolvedor agrega una lista de YouTube que contiene Pistas no disponibles, THE Bot SHALL informar en el canal de texto el número de Pistas agregadas y el número de Pistas omitidas.
8. IF ocurre un error no previsto al procesar un Comando, THEN THE Bot SHALL registrar el error junto con el nombre del Comando, el identificador del usuario y el identificador del servidor, y responder en un plazo máximo de 5 segundos con un mensaje genérico que no incluya trazas, rutas ni detalles internos, manteniendo el Bot operativo para procesar Comandos posteriores.
9. IF una lista de YouTube agregada haría superar las 500 Pistas de la Cola, THEN THE Bot SHALL agregar solo las Pistas que quepan hasta alcanzar 500, en el orden de la lista, e informar el número de Pistas agregadas y el número de Pistas rechazadas por el límite.

### Requirement 8: Permisos, rol DJ y límite de uso

**User Story:** Como administrador, quiero controlar quién puede manejar la música y limitar abusos, para mantener el orden en el servidor.

#### Acceptance Criteria

1. WHERE un Servidor tiene un Rol_DJ configurado, THE Bot SHALL permitir los Comandos `/skip`, `/stop`, `/volume`, `/shuffle`, `/remove` y `/loop` solo a Usuarios que tengan el Rol_DJ o el permiso de administrador de Discord en ese Servidor.
2. WHERE un Servidor no tiene Rol_DJ configurado, THE Bot SHALL permitir todos los Comandos a cualquier Usuario que esté en el mismo Canal_de_Voz que el Bot.
3. WHEN un Usuario con permiso de administrador ejecuta `/dj set` con un rol, THE Almacén SHALL guardar ese rol como Rol_DJ del Servidor, reemplazar cualquier Rol_DJ anterior, y THE Bot SHALL confirmar el cambio al administrador en un máximo de 3 segundos.
4. WHEN un Usuario con permiso de administrador ejecuta `/dj clear` en un Servidor con Rol_DJ configurado, THE Almacén SHALL eliminar el Rol_DJ del Servidor y THE Bot SHALL confirmar la eliminación en un máximo de 3 segundos.
5. IF un Usuario sin permiso de administrador ejecuta `/dj set` o `/dj clear`, THEN THE Bot SHALL rechazar el Comando, indicar que requiere permiso de administrador y dejar sin cambios el Rol_DJ almacenado.
6. IF un Usuario sin autorización ejecuta un Comando restringido, THEN THE Bot SHALL rechazar el Comando, indicar que requiere el Rol_DJ y no modificar el estado de la reproducción ni de la Cola.
7. IF un Usuario ejecuta más de 5 Comandos en una ventana deslizante de 10 segundos, THEN THE Bot SHALL rechazar los Comandos adicionales de ese Usuario, indicar el tiempo de espera restante en segundos (redondeado hacia arriba) y no modificar el estado de la reproducción ni de la Cola.
8. THE Bot SHALL solicitar únicamente los permisos de Discord Connect, Speak, Send Messages y Embed Links.

### Requirement 9: Desconexión automática y reconexión

**User Story:** Como usuario, quiero que el bot se desconecte solo y se recupere de fallos, para no dejar el bot ocupando el canal ni perder la cola.

#### Acceptance Criteria

1. WHILE el Bot es el único participante en el Canal_de_Voz, THE Reproductor SHALL pausar la reproducción al detectar que no quedan otros participantes (excluyendo otros bots) y desconectarse del Canal_de_Voz tras 300 segundos continuos en ese estado.
2. WHEN un Usuario se une al Canal_de_Voz antes de que transcurran los 300 segundos del plazo de desconexión, THE Reproductor SHALL cancelar la desconexión y reanudar la reproducción desde la posición en la que se pausó, en un máximo de 2 segundos.
3. WHILE la Cola está vacía y no hay reproducción en curso, THE Reproductor SHALL desconectarse del Canal_de_Voz tras 300 segundos continuos de inactividad. WHEN se añade una Pista a la Cola antes de cumplirse ese plazo, THE Reproductor SHALL cancelar el temporizador de inactividad.
4. IF la conexión de voz se interrumpe durante la reproducción, THEN THE Reproductor SHALL realizar hasta 3 intentos de reconexión dentro de una ventana máxima de 15 segundos desde la interrupción, y SHALL reanudar la Pista desde la posición alcanzada en el momento de la interrupción, con una tolerancia máxima de 2 segundos, al reconectar con éxito.
5. IF la reconexión falla tras 3 intentos o se agotan los 15 segundos, THEN THE Reproductor SHALL destruir la sesión de voz, enviar un mensaje al canal de texto indicando que la reconexión falló y conservar la Cola sin cambios durante 600 segundos.
6. IF transcurren 600 segundos tras la destrucción de la sesión de voz sin que un Usuario reanude la reproducción, THEN THE Reproductor SHALL eliminar la Cola conservada.
7. IF un moderador mueve el Bot a otro Canal_de_Voz, THEN THE Reproductor SHALL continuar la reproducción en el nuevo Canal_de_Voz, conservando la Cola y la posición de la Pista actual, con una interrupción máxima de 5 segundos.
8. IF un moderador desconecta el Bot del Canal_de_Voz, THEN THE Reproductor SHALL detener la reproducción, vaciar la Cola y liberar la sesión de voz sin intentar reconectarse.
9. WHEN el Bot arranca, THE Bot SHALL registrar sus slash commands y quedar disponible para recibir comandos en un máximo de 60 segundos.
10. IF el registro de slash commands falla o no se completa en 60 segundos al arrancar, THEN THE Bot SHALL registrar el fallo indicando la causa y reintentar el registro hasta 3 veces con un intervalo de 10 segundos entre intentos.

### Requirement 10: Configuración segura y observabilidad

**User Story:** Como operador del bot, quiero configurar el bot de forma segura y observable, para desplegarlo y mantenerlo con confianza.

#### Acceptance Criteria

1. WHEN el Bot arranca, THE Bot SHALL leer el token de Discord y las credenciales de servicios exclusivamente desde variables de entorno.
2. IF al arrancar falta una variable de entorno obligatoria o su valor es una cadena vacía, THEN THE Bot SHALL terminar su ejecución en un máximo de 5 segundos con código de salida distinto de cero, SHALL no conectarse a Discord y SHALL escribir en la salida de error un mensaje que indique el nombre de cada variable ausente o vacía.
3. THE Bot SHALL excluir de todos los registros y mensajes de error el valor del token de Discord y de las credenciales de servicios, incluso cuando un error contenga dichos valores.
4. WHEN ocurre una conexión o desconexión con Discord, un error de reproducción o un error de Comandos, THE Bot SHALL escribir una entrada de registro con marca de tiempo en formato ISO 8601 UTC, tipo de evento, descripción del error cuando aplique e identificador de Servidor, en un máximo de 1 segundo desde el evento.
5. IF un evento registrable no está asociado a un Servidor, THEN THE Bot SHALL escribir la entrada de registro con el campo de identificador de Servidor marcado como "ninguno".
6. WHILE el Bot reproduce audio en hasta 10 Servidores simultáneamente, THE Bot SHALL mantener la cola, la posición de reproducción y el estado de pausa de cada Servidor independientes, de modo que un Comando, un error o una detención en un Servidor no modifique el estado de los demás.
