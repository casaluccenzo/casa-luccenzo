# Migraciones

Se aplican en orden por nombre de archivo. En producción las corre Gustavo en
el SQL Editor de Supabase.

## Tablas nuevas en `public`: siempre con GRANT

Desde el 30-10-2026 Supabase ya no da permisos automáticos de la Data API a las
tablas nuevas de `public` (tampoco en preview branches ni en `supabase db
reset`). Sin GRANT, supabase-js recibe `permission denied` aunque RLS lo
permita.

Toda migración que crea una tabla lleva, en la misma migración:

```sql
CREATE TABLE public.mi_tabla ( ... );

ALTER TABLE public.mi_tabla ENABLE ROW LEVEL SECURITY;
-- políticas RLS ...

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mi_tabla
    TO anon, authenticated, service_role;
```

RLS es lo que decide qué filas ve o cambia cada quien; el GRANT solo deja que
la API llegue a la tabla. Si una tabla no debe ser accesible para nadie desde
el navegador (solo funciones `SECURITY DEFINER` o service_role), dale el GRANT
solo a `service_role`. Para una vista: `GRANT SELECT ... TO ...` y
`security_invoker = true`.

Las tablas creadas antes de la 040 tienen sus GRANT en
`040_explicit_api_grants.sql`.
