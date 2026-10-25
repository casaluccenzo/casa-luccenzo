-- Rol de solo lectura para la copia de seguridad diaria (.github/workflows/backup.yml).
-- Se corre UNA vez en el SQL Editor de Supabase. Genera una clave al azar y la
-- muestra en el resultado: copiarla al secreto BACKUP_DB_PASSWORD de GitHub.
-- La clave no queda guardada en ningun archivo. Si se pierde, correr esto de
-- nuevo: cambia la clave y hay que actualizar el secreto.
--
-- backup_reader puede LEER todo (pg_read_all_data, sin RLS) y no puede escribir
-- nada: no tiene permisos de escritura y sus sesiones son read-only.
do $$
declare
  pw text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if exists (select 1 from pg_roles where rolname = 'backup_reader') then
    execute format('alter role backup_reader with login bypassrls password %L', pw);
  else
    execute format('create role backup_reader with login bypassrls password %L', pw);
  end if;
  perform set_config('backup.pw', pw, false);
end $$;

grant pg_read_all_data to backup_reader;
alter role backup_reader set default_transaction_read_only = on;
comment on role backup_reader is 'Solo lectura para la copia de seguridad diaria (GitHub Actions, backup.yml)';

select current_setting('backup.pw') as "copiar en BACKUP_DB_PASSWORD";
