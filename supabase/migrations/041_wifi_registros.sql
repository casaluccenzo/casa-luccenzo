-- Migration 041: wifi de clientes con registro (casalucenzo.com/wifi).
--
-- El cliente escanea el QR de la mesa, pone su nombre (y WhatsApp si quiere),
-- acepta que guardemos sus datos, toca seguir en Instagram o TikTok y la
-- página le muestra la clave de la red de invitados del Mercusys.
--
-- Privacidad: wifi_registros guarda nombres y teléfonos, así que anon NO
-- tiene ningún permiso sobre las tablas (ni SELECT ni INSERT). La única
-- puerta pública es wifi_registrar(), SECURITY DEFINER, que valida, inserta
-- y devuelve la clave. Nadie desde la web puede listar registros ni leer la
-- clave sin registrarse. Solo admin/venta ven los registros desde /sistema y
-- solo admin cambia la clave o borra un registro (si un cliente lo pide).
--
-- No se puede comprobar que el cliente de verdad nos siguió: Instagram y
-- TikTok no lo permiten. Se guarda en qué botón tocó, nada más.
--
-- Desde el 30/10/2026 Supabase no da GRANT automático a tablas nuevas, por
-- eso van explícitos abajo.
BEGIN;

CREATE TABLE public.wifi_registros (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id   uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES public.locations(id),
    nombre        text NOT NULL CHECK (char_length(nombre) BETWEEN 2 AND 80),
    telefono      text CHECK (telefono IS NULL OR telefono ~ '^\+?[0-9]{7,15}$'),
    red_social    text NOT NULL CHECK (red_social IN ('instagram', 'tiktok')),
    acepta_datos  boolean NOT NULL CHECK (acepta_datos),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wifi_registros_created ON public.wifi_registros (location_id, created_at DESC);

ALTER TABLE public.wifi_registros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin y venta ven los registros del wifi" ON public.wifi_registros
    FOR SELECT TO authenticated
    USING (get_user_role((select auth.uid())) = ANY (ARRAY['admin'::text, 'venta'::text]));

CREATE POLICY "Admin borra registros del wifi" ON public.wifi_registros
    FOR DELETE TO authenticated
    USING (get_user_role((select auth.uid())) = 'admin');

-- Una fila por local. clave NULL = todavía no configurada: la página le dice
-- al cliente que la pida en caja.
CREATE TABLE public.wifi_config (
    location_id  uuid PRIMARY KEY REFERENCES public.locations(id),
    red          text NOT NULL DEFAULT 'Casa Lucenzo Invitados' CHECK (char_length(red) BETWEEN 1 AND 32),
    clave        text CHECK (clave IS NULL OR char_length(clave) BETWEEN 8 AND 63),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.wifi_config (location_id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (location_id) DO NOTHING;

ALTER TABLE public.wifi_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin y venta ven la clave del wifi" ON public.wifi_config
    FOR SELECT TO authenticated
    USING (get_user_role((select auth.uid())) = ANY (ARRAY['admin'::text, 'venta'::text]));

CREATE POLICY "Admin cambia la clave del wifi" ON public.wifi_config
    FOR UPDATE TO authenticated
    USING (get_user_role((select auth.uid())) = 'admin')
    WITH CHECK (get_user_role((select auth.uid())) = 'admin');

CREATE OR REPLACE FUNCTION public.wifi_registrar(
    p_nombre      text,
    p_telefono    text,
    p_red_social  text,
    p_acepta      boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_location uuid := '00000000-0000-0000-0000-000000000001';
    v_nombre   text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
    v_tel      text := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), '');
    v_cfg      public.wifi_config;
BEGIN
    IF p_acepta IS NOT TRUE THEN
        RAISE EXCEPTION 'falta_consentimiento' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_nombre) NOT BETWEEN 2 AND 80 THEN
        RAISE EXCEPTION 'nombre_invalido' USING ERRCODE = '22023';
    END IF;
    IF v_tel IS NOT NULL AND v_tel !~ '^\+?[0-9]{7,15}$' THEN
        RAISE EXCEPTION 'telefono_invalido' USING ERRCODE = '22023';
    END IF;
    IF p_red_social IS NULL OR p_red_social NOT IN ('instagram', 'tiktok') THEN
        RAISE EXCEPTION 'red_invalida' USING ERRCODE = '22023';
    END IF;
    -- Freno contra scripts que llenen la tabla: un local no recibe más de
    -- 60 registros reales en 10 minutos.
    IF (SELECT count(*) FROM public.wifi_registros
         WHERE location_id = v_location AND created_at > now() - interval '10 minutes') >= 60 THEN
        RAISE EXCEPTION 'demasiados_intentos' USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.wifi_registros (location_id, nombre, telefono, red_social, acepta_datos)
    VALUES (v_location, v_nombre, v_tel, p_red_social, true);

    SELECT * INTO v_cfg FROM public.wifi_config WHERE location_id = v_location;
    RETURN jsonb_build_object('red', v_cfg.red, 'clave', v_cfg.clave);
END;
$$;

REVOKE ALL ON public.wifi_registros FROM PUBLIC, anon;
REVOKE ALL ON public.wifi_config FROM PUBLIC, anon;
GRANT SELECT, DELETE ON public.wifi_registros TO authenticated;
GRANT SELECT, UPDATE ON public.wifi_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wifi_registros TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wifi_config TO service_role;

REVOKE ALL ON FUNCTION public.wifi_registrar(text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wifi_registrar(text, text, text, boolean) TO anon, authenticated;

COMMIT;
