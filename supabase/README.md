# Configuración de Supabase

Se reutiliza el proyecto existente, con sus usuarios y anfitriones autorizados. No crear otro proyecto ni cambiar contraseñas para separar los repositorios.

## Actualizar una instalación existente

1. Aplicar las migraciones pendientes hasta `migrations/004_presence_and_variety.sql` y cargar el banco privado de versión 4. El archivo privado `artyquest-presence-update.sql` del propietario combina esta última migración y el banco en una transacción. Si el proyecto ya tiene las versiones anteriores, ejecutar solo esa actualización.
2. Mantener **Authentication → Sign In / Providers → Anonymous Sign-Ins** habilitado.
3. Conservar las autorizaciones en `arena_private.admins`. No cambiar los permisos de las tablas privadas.
4. Comprobar que `public.arena_rooms` está en la publicación Realtime `supabase_realtime`.

Para consultar la versión: `select public.arena_version();` debe devolver `4`. La web conserva el protocolo de estado versión 2 y envía `clientVersion=4` con el banco variado versión 4.

La actualización es reaplicable y conserva las salas existentes, puntuaciones, cuentas, permisos y bancos anteriores. Crear una sala nueva carga los retos y las reglas de presencia nuevos. Un código cerrado queda inutilizable: se crea otra sala para una partida nueva. No ejecutar otra vez la migración inicial sobre un proyecto ya configurado.

## Proyecto nuevo

1. Ejecutar las cuatro migraciones en orden numérico.
2. Cargar en privado el banco de preguntas, con `version=4` y posiciones consecutivas empezando en cero. Las soluciones nunca van al repositorio, a `public/` o a variables de compilación.
3. Habilitar Anonymous Sign-Ins y crear una cuenta de anfitrión en Supabase Auth.
4. El propietario autoriza su UUID desde SQL Editor:

```sql
insert into arena_private.admins(user_id)
values ('UUID_DEL_USUARIO') on conflict do nothing;
```

Ejecutar las migraciones antes de este `insert`; de lo contrario la tabla no existe. El jugador nunca puede autorizarse desde el navegador.

Para 50 personas en la misma red, configurar Anonymous Sign-ins al menos en 100 por hora y por IP para disponer de margen para reintentos. La aplicación identifica cada participante por su UUID, no por su IP. Ver [límites de Supabase](https://supabase.com/docs/guides/auth/rate-limits). La clave publicable se incluye en el cliente por diseño; RLS y las funciones SQL aplican la autorización. Nunca incluir una clave secreta o `service_role` en el frontend.

La salida explícita del anfitrión cierra la sala para todos. Cerrar una pestaña intenta avisar con `pagehide` y `fetch(..., {keepalive:true})`; el margen de reconexión es 15 segundos. Si no se recibe ese aviso, los latidos vencen después de 75 segundos en primer plano o 150 en segundo plano. Minimizar no envía una salida. Los navegadores móviles pueden suspender la red o no avisar un cierre; no es posible garantizar detección instantánea de todos los cierres bruscos. El podio de una sala nueva permanece 30 segundos antes del cierre automático.
