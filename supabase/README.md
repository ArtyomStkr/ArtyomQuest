# Configuración de Supabase

Se reutiliza el proyecto existente, con sus usuarios y anfitriones autorizados. No crear otro proyecto ni cambiar contraseñas para separar los repositorios.

## Actualizar una instalación existente

1. Ejecutar `migrations/002_artyquest.sql` y `migrations/003_mobile_challenges.sql` en SQL Editor, en ese orden, y cargar el banco privado de versión 3. Los archivos privados locales del propietario combinan actualización y carga en transacciones. Si ya se aplicó la versión 2, ejecutar únicamente la actualización móvil.
2. Mantener **Authentication → Sign In / Providers → Anonymous Sign-Ins** habilitado.
3. Conservar las autorizaciones en `arena_private.admins`. No cambiar los permisos de las tablas privadas.
4. Comprobar que `public.arena_rooms` está en la publicación Realtime `supabase_realtime`.

Para consultar la versión: `select public.arena_version();` debe devolver `3`. La web utiliza el protocolo de sala versión 2 y solicita el banco móvil versión 3.

La actualización es reaplicable y conserva las salas existentes, puntuaciones, cuentas, permisos y bancos anteriores. Las partidas en curso conservan su banco. Crear una sala nueva o terminar y reiniciar una partida desde el cliente actualizado carga los retos nuevos. No ejecutar otra vez la migración inicial sobre un proyecto ya configurado.

## Proyecto nuevo

1. Ejecutar las tres migraciones en orden numérico.
2. Cargar en privado el banco de preguntas, con `version=3` y posiciones consecutivas empezando en cero. Las soluciones nunca van al repositorio, a `public/` o a variables de compilación.
3. Habilitar Anonymous Sign-Ins y crear una cuenta de anfitrión en Supabase Auth.
4. El propietario autoriza su UUID desde SQL Editor:

```sql
insert into arena_private.admins(user_id)
values ('UUID_DEL_USUARIO') on conflict do nothing;
```

Ejecutar las migraciones antes de este `insert`; de lo contrario la tabla no existe. El jugador nunca puede autorizarse desde el navegador.

Para muchas personas en la misma red, revisar los límites de acceso anónimo por IP en Authentication. La clave publicable se incluye en el cliente por diseño; RLS y las funciones SQL aplican la autorización. Nunca incluir una clave secreta o `service_role` en el frontend.
