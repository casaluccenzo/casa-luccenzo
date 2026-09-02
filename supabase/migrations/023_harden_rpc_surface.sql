-- Migration 023: cerrar RPCs SECURITY DEFINER que no deberían ser públicos
--
-- El linter marca 5 funciones SECURITY DEFINER llamables por anon vía
-- /rest/v1/rpc/. Análisis:
--   handle_new_user()      -> es el TRIGGER de auth.users (on_auth_user_created).
--                             No tiene por qué ser invocable por RPC. Revocar
--                             a todos: el trigger dispara igual (no depende de
--                             GRANT EXECUTE), mismo patrón que la migración 018.
--   admin_set_user_pin()   -> ya valida rol admin adentro (auth.uid()), pero
--                             anon no tiene nada que hacer acá. Revocar anon.
--   set_quick_pin()         -> escribe el PIN de auth.uid(); para anon auth.uid()
--                             es NULL y no hace nada. Revocar anon igual.
--   get_user_role() /
--   get_user_location()     -> las usan las policies RLS (por eso son DEFINER) y
--                             están diseñadas para responder también a anon
--                             (get_user_role devuelve 'anon'). Se dejan.
--   verify_quick_pin()      -> es el check del PIN de la pantalla de bloqueo,
--                             que puede correr con la sesión JWT ya expirada
--                             (rol anon). Tiene rate-limit + lockout propios en
--                             la tabla. Se deja para no romper el desbloqueo.
--
-- Además: fijar search_path en handle_new_user (solo referencia public.* y
-- funciones de pg_catalog, es seguro).

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION public.handle_new_user() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_pin(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_quick_pin(text) FROM anon;
