-- Migration 048: la página casalucenzo.com/wifi muestra la clave sin registro.
--
-- Decisión de Gustavo (2026-11-04): el wifi de visitas queda disponible para
-- todos. Al escanear el QR sale "síguenos en nuestras redes" (sin confirmar
-- nada) y "gracias, disfruta esta red las veces que quieras" con la clave.
--
-- wifi_config sigue cerrada para anon; la única puerta pública es esta función
-- que devuelve SOLO red y clave (nada de registros ni teléfonos). Si la clave
-- se filtra, se cambia en el router y en el POS (Pedidos → Wifi de clientes).
-- wifi_registrar y la tabla wifi_registros se dejan como están (historial).
BEGIN;

CREATE OR REPLACE FUNCTION public.wifi_clave()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object('red', c.red, 'clave', c.clave)
      FROM public.wifi_config c
     WHERE c.location_id = '00000000-0000-0000-0000-000000000001';
$$;

REVOKE ALL ON FUNCTION public.wifi_clave() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wifi_clave() TO anon, authenticated, service_role;

COMMIT;
