-- Migración 053: stock de pastelitos manual (27/11/2026, pedido de Gustavo).
--
-- Hasta ahora los pastelitos se contaban "por día": recompute_product_stock()
-- (migración 033) sumaba solo los movimientos posteriores al último cierre
-- (last_close_at()), así que cada Cierre de Jornada los dejaba en 0 y el cron
-- de las 2 a.m. (api/daily-restock.js) les sumaba 20 por sabor.
--
-- Gustavo ahora carga el stock él mismo, y lo que queda de un día pasa al
-- siguiente (también si quedó en negativo). Desde aquí los pastelitos se
-- cuentan igual que las bebidas:
--   stock         = suma de TODOS sus movimientos
--   initial_stock = lo que había al último cierre + lo cargado desde entonces
-- (el cierre sigue marcando dónde empieza "hoy" para el cuadre de ventas).
--
-- Antes de cambiar la fórmula, a cada sabor se le agrega un movimiento
-- 'open_carry' con fecha = último cierre, para que la suma de toda su historia
-- dé exactamente lo que tiene hoy. Así ningún sabor cambia de número al correr
-- esto: el stock de hoy queda igual y solo deja de borrarse en el cierre.
-- Es idempotente: si se corre dos veces, el segundo ajuste da 0 y no inserta.

BEGIN;

-- 1. Ajuste de arranque: historia completa = stock de hoy.
INSERT INTO public.stock_movements (id, product_id, delta, type, device_id, created_at, note)
SELECT 'open-carry-053-' || p.id,
       p.id,
       hoy.delta - toda.delta,
       'open_carry',
       'migracion-053',
       public.last_close_at(),
       'Arranque stock manual: deja la historia igual al stock de hoy'
  FROM public.products p
  CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(m.delta), 0) AS delta FROM public.stock_movements m
       WHERE m.product_id = p.id AND m.created_at > public.last_close_at()
  ) hoy
  CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(m.delta), 0) AS delta FROM public.stock_movements m
       WHERE m.product_id = p.id
  ) toda
 WHERE p.category = 'pastelitos'
   AND public.last_close_at() > '-infinity'::timestamptz
   AND hoy.delta <> toda.delta
ON CONFLICT (id) DO NOTHING;

-- 2. Misma fórmula para todas las categorías (sin la rama de pastelitos).
CREATE OR REPLACE FUNCTION public.recompute_product_stock(p_product_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_t0         timestamptz := public.last_close_at();
    v_stock      integer;
    v_initial    integer;
    v_max_cfg    integer;
BEGIN
    SELECT max INTO v_max_cfg
      FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(delta),0) INTO v_stock
      FROM public.stock_movements
     WHERE product_id = p_product_id;
    SELECT
      COALESCE((SELECT SUM(delta) FROM public.stock_movements
                 WHERE product_id = p_product_id AND created_at <= v_t0), 0)
      + COALESCE((SELECT SUM(delta) FROM public.stock_movements
                   WHERE product_id = p_product_id AND created_at > v_t0 AND type = 'load'), 0)
      INTO v_initial;

    UPDATE public.products
       SET stock_computed         = v_stock,
           initial_stock_computed = v_initial,
           max_computed           = GREATEST(v_initial, COALESCE(v_max_cfg, 0)),
           stock                  = v_stock,
           initial_stock          = v_initial,
           max                    = GREATEST(v_initial, COALESCE(v_max_cfg, 0))
     WHERE id = p_product_id;
END;
$$;

-- 3. Recalcular los pastelitos con la fórmula nueva (deben quedar igual).
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM public.products WHERE category = 'pastelitos' LOOP
        PERFORM public.recompute_product_stock(r.id);
    END LOOP;
END $$;

COMMIT;

-- Para revisar después de correrlo (debe mostrar el mismo stock que el POS):
-- SELECT id, name, stock, initial_stock FROM public.products WHERE category = 'pastelitos' ORDER BY name;
