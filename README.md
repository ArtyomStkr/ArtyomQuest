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

Aplicar `supabase/migrations/002_artyquest.sql`, luego `003_mobile_challenges.sql` en SQL Editor y cargar el banco privado de versión 3. El propietario dispone de archivos locales privados para actualizar funciones y cargar retos. Esos archivos no se publican en GitHub.

La actualización conserva usuarios, administradores, salas, puntuaciones y los bancos anteriores. No volver a ejecutar `001_arena.sql` sobre una instalación existente. Para un proyecto nuevo, ejecutar las migraciones en orden, cargar un banco privado y autorizar al anfitrión.

Ver [configuración](supabase/README.md). No hace falta un servidor propio.

## Partida

El anfitrión crea una sala con su cuenta habitual; los invitados usan código, nombre y avatar. **Empezar** inicia una cuenta regresiva sincronizada de cinco segundos. Los retos alternan preguntas conceptuales sencillas, código que se completa tocando fichas y peticiones guiadas. La ruta, los datos y el contexto necesarios aparecen en cada reto: no se exige recordar texto ni sintaxis exacta de las diapositivas. Tocar una opción de selección la envía inmediatamente. Los otros formatos se pueden editar antes de pulsar **Enviar respuesta**.

Cuando todos responden o vence el tiempo, aparecen la solución, la explicación y la clasificación automáticamente, sin desplegables. El anfitrión pulsa **Siguiente**: se muestra la tabla durante cinco segundos y comienza el próximo reto automáticamente. Puede usar **Siguiente** durante un reto para cerrarlo y continuar. Tras el último aparece el podio. El código se compara como texto; nunca se ejecuta código escrito por jugadores.

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
