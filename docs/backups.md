# Copias de seguridad

Supabase en plan gratis no guarda copias descargables, así que
`.github/workflows/backup.yml` hace una cada día a las **4:00 am Caracas**
(08:00 UTC), después de la recarga de pastelitos de las 2:17 am.

## Qué guarda

Un archivo `casa-lucenzo-backup-AAAA-MM-DD.7z` cifrado con `BACKUP_PASSPHRASE`:

| Archivo | Contenido |
|---|---|
| `public.sql` | Todas las tablas del POS con sus datos (productos, ventas, stock, facturas, gastos, deudas, pedidos, wifi…), funciones, triggers, RLS y GRANTs |
| `auth-data.sql` | Usuarios para iniciar sesión (sin `schema_migrations`) |
| `cron-data.sql` | Trabajos de `pg_cron` (sincronización BCV) |
| `conteos.txt` | Filas por tabla, para comprobar una restauración |

Las copias se guardan 30 días en GitHub Actions (pestaña **Actions → Copia
de seguridad → la corrida → Artifacts**). El repo es público, por eso el
archivo va cifrado: sin la clave no se puede abrir, ni siquiera los nombres
de los archivos de adentro.

## Puesta en marcha (una sola vez)

1. En Supabase, **SQL Editor**, correr `supabase/backup_reader.sql`. Crea el
   rol de solo lectura `backup_reader` y muestra su clave.
2. En GitHub, **Settings → Secrets and variables → Actions → New repository
   secret**:
   - `BACKUP_DB_PASSWORD`: la clave que mostró el paso 1.
   - `BACKUP_PASSPHRASE`: una clave larga que se elija y **se guarde fuera
     de GitHub**. Sin ella las copias no se pueden abrir.
3. **Actions → Copia de seguridad → Run workflow** para probarla.

## Abrir una copia

Bajar el artifact (es un .zip que trae el .7z) y abrir el .7z con 7-Zip
(Windows) o `7z x archivo.7z` usando `BACKUP_PASSPHRASE`.

## Restaurar

En un proyecto Supabase **nuevo** (nunca encima de producción sin revisar):

```sh
# Connection string del proyecto nuevo (Session pooler), con su clave de postgres
export DB="postgresql://postgres.<ref>:<clave>@<pooler>:5432/postgres"

psql "$DB" -c 'drop schema public cascade; create schema public;'
psql "$DB" -v ON_ERROR_STOP=1 -f public.sql
psql "$DB" -f auth-data.sql      # usuarios (las claves siguen igual)
psql "$DB" -f cron-data.sql      # opcional: trabajos pg_cron
```

Comparar las filas con `conteos.txt`:

```sh
psql "$DB" -tA -F ' ' -c "select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by 1"
```

Después, apuntar `SUPABASE_URL` / claves en Vercel (y en la app de
escritorio y Android) al proyecto nuevo.

Para recuperar solo una tabla o unas filas, restaurar en un proyecto aparte y
copiar desde ahí lo que haga falta.
