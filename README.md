# ArtyQuest

Juego multijugador para móvil y PC sobre lógica, programación y API REST con Laravel. Hasta 50 personas por sala, 12 retos, 80 avatares, clasificación después de cada reto y podio final.

Web: https://artyomstkr.github.io/ArtyomQuest/

Diapositivas: https://artyomstkr.github.io/Expo-Web/#laravel

## Desarrollo

Node.js >=20.19 y npm:

```sh
npm ci
npm run dev
```

La web utiliza el proyecto Supabase existente. La URL y la clave publicable están en `src/services/supabaseClient.js`; se pueden sustituir con las variables de `.env.example`. Nunca usar claves secretas, contraseñas o respuestas en variables `VITE_*`.

## Supabase existente

Aplicar las migraciones en orden hasta `004_presence_and_variety.sql` y cargar el banco privado de versión 4. El propietario dispone de archivos locales privados para actualizar funciones y cargar retos en una transacción. Esos archivos no se publican en GitHub.

La actualización conserva usuarios, administradores, salas, puntuaciones y los bancos anteriores. No volver a ejecutar `001_arena.sql` sobre una instalación existente. Para un proyecto nuevo, ejecutar las migraciones en orden, cargar un banco privado y autorizar al anfitrión.

Ver [configuración](supabase/README.md). No hace falta un servidor propio.

## Partida

El anfitrión crea una sala con su cuenta habitual; los invitados usan código, nombre y avatar. **Empezar** inicia una cuenta regresiva sincronizada de cinco segundos. Los retos alternan POST, PATCH, DELETE, GET y PUT, además de conceptos, JSON y lógica. La ruta y el contexto están dados; crear una actividad permite un título propio, sin una palabra secreta. Las opciones booleanas muestran `true` y `false`. Tocar una opción de selección la envía inmediatamente. Los otros formatos se pueden editar antes de pulsar **Enviar respuesta**.

Cuando todos los participantes conectados responden o vence el tiempo, aparecen la solución, la explicación y la clasificación automáticamente. Un modal comunica el acierto o error después del cierre; nunca adelanta la corrección a los demás. El anfitrión pulsa **Siguiente**: se muestra la tabla durante cinco segundos y comienza el próximo reto automáticamente. Puede usar **Siguiente** durante un reto para cerrarlo y continuar. Tras el último aparece el podio durante 30 segundos y la sala se cierra; también puede finalizarla antes. Un código cerrado no se reutiliza. El código se compara como texto; nunca se ejecuta código escrito por jugadores.

La pregunta ocupa la tarjeta principal. El anfitrión tiene una distribución de escritorio con participantes y controles laterales; el invitado conserva la vista móvil. Después del cierre, la corrección se resalta en verde para ambos roles. El texto libre de las respuestas admite mayúsculas y minúsculas; los booleanos conservan su tipo JSON y las claves de la API su nombre exacto. Recargar recupera identidad, sala, respuestas, puntos y plazo. Las identidades se aíslan por pestaña.

La presencia usa identidades autenticadas y un identificador nuevo por carga de página, nunca la IP del participante. Al cerrar una pestaña, `pagehide` intenta enviar un aviso autenticado con `keepalive`; hay 15 segundos de margen para refrescar y el aviso de una página antigua no puede desconectar a la nueva. Minimizar solo actualiza el estado de presencia. Si el navegador no avisa, se usa el último latido: 75 segundos en primer plano o 150 en segundo plano. Un sistema que suspenda la red también puede interrumpir presencia. El anfitrión que sale explícitamente cierra la sala inmediatamente; todos los clientes reciben el cierre y eliminan su entrada guardada.

Los latidos privados se espacian 20 segundos con un desfase inicial y no generan un evento Realtime por jugador cada vez. Los cambios de presencia sí actualizan la sala. En una red compartida, revisar **Authentication → Rate Limits → Anonymous Sign-ins** para admitir al menos 100 accesos por hora si se esperan 50 personas y reintentos. Supabase limita ese acceso por IP; la app conserva la identidad durante un refresh para no generar usuarios anónimos nuevos.

Los sonidos se habilitan tras interactuar con la página: cuenta regresiva, últimos segundos y fanfarria del ganador. El botón del altavoz permite silenciarlos. El ganador aparece destacado con una lluvia de confeti; se respeta la preferencia de movimiento reducido. El acceso desde las diapositivas se conserva, y el juego no contiene un enlace de vuelta.

Al pie de los resultados está **Ver ranking global**: es un Easter egg visual con ArtyomStkr, su imagen y `99999+` puntos, seguido por la clasificación de esa partida. Ese registro no se guarda en Supabase ni participa en el cálculo del ganador.

El reloj de la base de datos determina plazos y puntos. Los contadores del teléfono no escriben cada segundo. Supabase Realtime notifica cambios; el cliente recupera el estado al vencer un plazo, al volver a la pestaña y cada 30 segundos como recuperación. Sin clientes conectados, la transición se procesa al recuperar la sala conservando el plazo original.

## Seguridad

El banco, las respuestas y la lista de administradores viven en `arena_private`, sin acceso para los clientes. Solo se entrega el reto actual; la solución y explicación se entregan después del cierre. RLS limita las lecturas a miembros de la sala; no existen escrituras directas de puntuaciones desde el navegador. Las funciones SQL comprueban identidad, rol, plazo, formato, duplicados e índice del reto. El banco real y su SQL de instalación deben permanecer fuera de este repositorio, sus artefactos y releases.

## Comprobar y publicar

```sh
npm test
npm run build
```

Las pruebas usan PostgreSQL embebido y un banco sintético. Cubren los formatos actuales y anteriores, 50 jugadores, 12 retos, reloj, transiciones, permisos, 80 avatares y actualización sin pérdida de datos. No modifican Supabase ni sustituyen una prueba con dispositivos conectados a Internet.

En GitHub, **Settings → Pages → Source: GitHub Actions**. Subir a `main` ejecuta las pruebas, compila y publica exclusivamente `dist/`. Los archivos estáticos usan rutas relativas para funcionar en `/ArtyomQuest/`. Las diapositivas permanecen en su propio repositorio y solo enlazan a este juego.
