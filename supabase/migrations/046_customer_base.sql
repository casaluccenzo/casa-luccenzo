-- 046_customer_base.sql
-- Base de clientes para descargar desde el panel de administrador (pestaña
-- "Clientes"). No crea tablas: arma la lista al momento con lo que ya existe.
--
--   * sales: el cliente va dentro de name, "Producto [Nombre - V-12345678] (...)".
--     Solo cuentan las cuentas que traen cédula/RIF (6+ dígitos); los apodos
--     del mostrador ("Familia", "Sr", "Cliente #4") no son clientes con datos.
--   * invoices: nombre, RIF, teléfono y dirección de las facturas (también las
--     anuladas, porque los datos del cliente siguen siendo buenos).
--   * wifi_registros y pedidos_online: aportan teléfono. Se pegan a la cédula
--     cuando el nombre coincide; si no, salen como cliente sin cédula.
--
-- Se agrupa por cédula/RIF (letra + dígitos sin ceros a la izquierda), así
-- "20172306" y "V-20172306" son la misma persona. Los teléfonos del propio
-- negocio no se toman como teléfono del cliente.
--
-- Datos personales: anon no puede llamarla y la función rechaza a quien no
-- sea admin (las tablas siguen con su RLS).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_customer_base()
RETURNS TABLE (
    nombre         text,
    apellido       text,
    cedula_rif     text,
    telefono       text,
    direccion      text,
    visitas        integer,
    facturas       integer,
    primera_visita date,
    ultima_visita  date,
    origen         text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
    v_location uuid := coalesce(get_user_location(auth.uid()), '00000000-0000-0000-0000-000000000001');
BEGIN
    IF get_user_role(auth.uid()) IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Solo el administrador puede ver la base de clientes' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    WITH
    store_phones(p) AS (VALUES ('04248386066'), ('04248397037'), ('04120839311')),
    tags AS (
        SELECT DISTINCT s.timestamp AS ts, substring(s.name from '\[(.*?)\]') AS tag
          FROM public.sales s
         WHERE s.voided_at IS NULL AND s.location_id = v_location AND s.name LIKE '%[%'
    ),
    sale_people AS (
        SELECT ts,
               trim(substring(tag from '^(.*?)\s+-\s+[VJEGPvjegp]?[\s.-]*\d')) AS nombre,
               upper(coalesce(substring(tag from '\s-\s+([VJEGPvjegp])[\s.-]*\d'), 'V')) AS letra,
               regexp_replace(substring(tag from '\s-\s+[VJEGPvjegp]?[\s.-]*(\d[\d.\s-]*)$'), '\D', '', 'g') AS digitos
          FROM tags
         WHERE tag ~ '\s-\s+[VJEGPvjegp]?[\s.-]*\d{6,}'
    ),
    inv_people AS (
        SELECT i.issued_at AS ts, trim(i.client_name) AS nombre,
               upper(coalesce(substring(i.client_rif from '^\s*([VJEGPvjegp])'), 'V')) AS letra,
               regexp_replace(i.client_rif, '\D', '', 'g') AS digitos,
               nullif(regexp_replace(coalesce(i.client_phone, ''), '\D', '', 'g'), '') AS telefono,
               nullif(trim(coalesce(i.client_address, '')), '') AS direccion,
               (i.status = 'emitida') AS emitida
          FROM public.invoices i
         WHERE i.location_id = v_location
    ),
    all_rif AS (
        SELECT letra || ltrim(digitos, '0') AS k, letra, digitos, nombre, ts, 'venta' AS src, NULL::text AS telefono, NULL::text AS direccion, false AS emitida FROM sale_people
        UNION ALL
        SELECT letra || ltrim(digitos, '0'), letra, digitos, nombre, ts, 'factura', telefono, direccion, emitida FROM inv_people
    ),
    valid AS (
        SELECT * FROM all_rif
         WHERE length(ltrim(digitos, '0')) >= 6 AND nombre !~* 'prueba'
    ),
    names AS (
        SELECT k, nombre, ts,
               lower(translate(regexp_replace(nombre, '\s+', ' ', 'g'), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS nk
          FROM valid
         WHERE nombre !~* '^\s*cliente(\s*#?\s*\d+)?\s*$' AND nombre <> ''
    ),
    name_votes AS (
        SELECT k, nk, count(*) AS n, max(ts) AS last_ts FROM names GROUP BY k, nk
    ),
    best_name AS (
        -- El nombre que más se repite para esa cédula; de sus formas, la que trae
        -- acentos o ñ ("España" antes que "Espana") y si no, la más reciente.
        SELECT DISTINCT ON (nm.k) nm.k, regexp_replace(trim(nm.nombre), '\s+', ' ', 'g') AS nombre
          FROM names nm
          JOIN (SELECT DISTINCT ON (k) k, nk FROM name_votes ORDER BY k, n DESC, last_ts DESC) w
            ON w.k = nm.k AND w.nk = nm.nk
         ORDER BY nm.k, (nm.nombre ~ '[ÁÉÍÓÚÜÑáéíóúüñ]') DESC, nm.ts DESC
    ),
    people AS (
        SELECT v.k,
               max(v.letra) AS letra,
               (array_agg(v.digitos ORDER BY length(v.digitos) DESC))[1] AS digitos,
               count(DISTINCT v.ts) FILTER (WHERE v.src = 'venta') AS visitas,
               min(v.ts) AS primera, max(v.ts) AS ultima,
               count(*) FILTER (WHERE v.src = 'factura' AND v.emitida) AS facturas,
               bool_or(v.src = 'factura') AS con_factura,
               (array_agg(v.telefono ORDER BY v.ts DESC) FILTER (WHERE v.telefono IS NOT NULL AND v.telefono NOT IN (SELECT p FROM store_phones)))[1] AS telefono,
               (array_agg(v.direccion ORDER BY v.ts DESC) FILTER (WHERE v.direccion IS NOT NULL))[1] AS direccion
          FROM valid v GROUP BY v.k
    ),
    contacts AS (
        SELECT trim(w.nombre) AS nombre, regexp_replace(coalesce(w.telefono, ''), '\D', '', 'g') AS telefono, w.created_at AS ts, 'wifi' AS src
          FROM public.wifi_registros w WHERE w.location_id = v_location
        UNION ALL
        SELECT trim(p.customer_name), regexp_replace(coalesce(p.customer_phone, ''), '\D', '', 'g'), p.created_at, 'pedido web'
          FROM public.pedidos_online p WHERE p.location_id = v_location
    ),
    contacts_ok AS (
        SELECT *, lower(translate(regexp_replace(nombre, '\s+', ' ', 'g'), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS nk
          FROM contacts
         WHERE length(telefono) >= 10 AND telefono NOT IN (SELECT p FROM store_phones) AND nombre !~* 'prueba'
    ),
    rif_rows AS (
        SELECT p.*, coalesce(b.nombre, 'Cliente') AS nombre,
               lower(translate(regexp_replace(coalesce(b.nombre, ''), '\s+', ' ', 'g'), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) AS nk
          FROM people p LEFT JOIN best_name b USING (k)
    ),
    merged AS (
        SELECT r.nombre, r.letra, r.digitos,
               coalesce(r.telefono, (SELECT c.telefono FROM contacts_ok c WHERE c.nk = r.nk AND r.nk <> '' ORDER BY c.ts DESC LIMIT 1)) AS telefono,
               r.direccion, r.visitas, r.primera, r.ultima, r.facturas,
               concat_ws(', ', CASE WHEN r.visitas > 0 THEN 'ventas' END, CASE WHEN r.con_factura THEN 'facturas' END) AS origen
          FROM rif_rows r
        UNION ALL
        (SELECT DISTINCT ON (c.telefono) c.nombre, NULL, NULL, c.telefono, NULL, 0, c.ts, c.ts, 0, c.src
          FROM contacts_ok c
         WHERE NOT EXISTS (SELECT 1 FROM rif_rows r WHERE r.nk = c.nk OR r.telefono = c.telefono)
         ORDER BY c.telefono, c.ts DESC)
    )
    SELECT
        CASE WHEN m.letra IN ('J', 'G') THEN m.nombre ELSE initcap(split_part(m.nombre, ' ', 1)) END AS nombre,
        CASE WHEN m.letra IN ('J', 'G') OR trim(m.nombre) !~ '\s' THEN ''
             ELSE initcap(regexp_replace(trim(m.nombre), '^\S+\s+', '')) END AS apellido,
        CASE WHEN m.digitos IS NULL THEN '' ELSE m.letra || '-' || m.digitos END AS cedula_rif,
        coalesce(m.telefono, '') AS telefono,
        coalesce(m.direccion, '') AS direccion,
        m.visitas::int AS visitas,
        m.facturas::int AS facturas,
        (m.primera AT TIME ZONE 'America/Caracas')::date AS primera_visita,
        (m.ultima AT TIME ZONE 'America/Caracas')::date AS ultima_visita,
        m.origen
      FROM merged m
     ORDER BY m.ultima DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_base() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_base() TO authenticated;

COMMIT;
