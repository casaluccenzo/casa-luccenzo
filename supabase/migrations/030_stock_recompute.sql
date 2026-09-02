-- Migration 030: recálculo de stock sombra desde stock_movements (spec §5.1a).
--
-- recompute_product_stock(p_product_id) recalcula stock_computed /
-- initial_stock_computed / max_computed de ESE producto:
--   pastelitos:  stock  = Σ delta desde el último cierre
--                initial = Σ delta type='load' desde el último cierre
--   empaquetados: stock  = Σ delta (todo el historial)
--                 initial = (Σ delta <= t0) + (Σ delta type='load' > t0)
--   max_computed = GREATEST(initial, max configurado)
-- category NULL se trata como 'pastelitos' (igual que el cliente).
--
-- Triggers: AFTER INSERT en stock_movements (por fila) y AFTER INSERT en
-- day_closes (por statement, recalcula todo — cambió la frontera).

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_product_stock(p_product_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cat     text;
    v_t0      timestamptz := public.last_close_at();
    v_stock   integer;
    v_initial integer;
    v_max_cfg integer;
BEGIN
    SELECT category, max INTO v_cat, v_max_cfg
      FROM public.products WHERE id = p_product_id;
    IF NOT FOUND THEN RETURN; END IF;

    IF COALESCE(v_cat, 'pastelitos') = 'pastelitos' THEN
        SELECT COALESCE(SUM(delta),0) INTO v_stock
          FROM public.stock_movements
         WHERE product_id = p_product_id AND created_at > v_t0;
        SELECT COALESCE(SUM(delta),0) INTO v_initial
          FROM public.stock_movements
         WHERE product_id = p_product_id AND created_at > v_t0 AND type = 'load';
    ELSE
        SELECT COALESCE(SUM(delta),0) INTO v_stock
          FROM public.stock_movements
         WHERE product_id = p_product_id;
        SELECT
          COALESCE((SELECT SUM(delta) FROM public.stock_movements
                     WHERE product_id = p_product_id AND created_at <= v_t0), 0)
          + COALESCE((SELECT SUM(delta) FROM public.stock_movements
                       WHERE product_id = p_product_id AND created_at > v_t0 AND type = 'load'), 0)
          INTO v_initial;
    END IF;

    UPDATE public.products
       SET stock_computed         = v_stock,
           initial_stock_computed = v_initial,
           max_computed           = GREATEST(v_initial, COALESCE(v_max_cfg, 0))
     WHERE id = p_product_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_product_stock(text)
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_stock_movements_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM public.recompute_product_stock(NEW.product_id);
    RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_stock_movements_recompute() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stock_movements_recompute ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_recompute
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.tg_stock_movements_recompute();

CREATE OR REPLACE FUNCTION public.tg_day_close_recompute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM public.products LOOP
        PERFORM public.recompute_product_stock(r.id);
    END LOOP;
    RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_day_close_recompute() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_day_close_recompute ON public.day_closes;
CREATE TRIGGER trg_day_close_recompute
AFTER INSERT ON public.day_closes
FOR EACH STATEMENT EXECUTE FUNCTION public.tg_day_close_recompute();

COMMIT;
