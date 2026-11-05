# Configuración de Supabase

Se reutiliza el proyecto existente, con sus usuarios y anfitriones autorizados. No crear otro proyecto ni cambiar contraseñas para separar los repositorios.

## Actualizar una instalación existente

1. Ejecutar `migrations/002_artyquest.sql` en SQL Editor y cargar el banco privado de versión 2. El archivo privado local preparado por el propietario combina las dos operaciones en una transacción.
2. Mantener **Authentication → Sign In / Providers → Anonymous Sign-Ins** habilitado.
3. Conservar las autorizaciones en `arena_private.admins`. No cambiar los permisos de las tablas privadas.
4. Comprobar que `public.arena_rooms` está en la publicación Realtime `supabase_realtime`.

Para consultar la versión: `select public.arena_version();` debe devolver `2`. La web comprueba esa versión en los estados recibidos.

La actualización es reaplicable y conserva las salas existentes, puntuaciones, cuentas, permisos y preguntas de versión 1. Los clientes antiguos pueden terminar sus partidas anteriores; las salas de ArtyQuest requieren el cliente nuevo. No ejecutar otra vez la migración inicial sobre un proyecto ya configurado.

## Proyecto nuevo

1. Ejecutar `migrations/001_arena.sql`, luego `migrations/002_artyquest.sql`.
2. Cargar en privado el banco de preguntas, con `version=2` y posiciones consecutivas empezando en cero. Las soluciones nunca van al repositorio, a `public/` o a variables de compilación.
3. Habilitar Anonymous Sign-Ins y crear una cuenta de anfitrión en Supabase Auth.
4. El propietario autoriza su UUID desde SQL Editor:

```sql
insert into arena_private.admins(user_id)
values ('UUID_DEL_USUARIO') on conflict do nothing;
```

Ejecutar las migraciones antes de este `insert`; de lo contrario la tabla no existe. El jugador nunca puede autorizarse desde el navegador.

Para muchas personas en la misma red, revisar los límites de acceso anónimo por IP en Authentication. La clave publicable se incluye en el cliente por diseño; RLS y las funciones SQL aplican la autorización. Nunca incluir una clave secreta o `service_role` en el frontend.
