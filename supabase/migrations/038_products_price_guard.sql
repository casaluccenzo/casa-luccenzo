-- Migration 038: los precios solo los cambia una persona desde "Editar producto".
-- Entre el 9 y el 15 de octubre de 2026 la caja recalculaba sola el precio de
-- los pastelitos como 1900 / tasa BCV (PR #38, revertido en #41). Una caja que
-- siga con esa version vieja en memoria o en cache vuelve a escribir precios
-- como 2.158807 y pisa lo que el dueño puso a mano. El formulario de edicion
-- solo admite centavos (step 0.01), asi que un precio con mas de 2 decimales
-- nunca viene de una persona: se ignora y se conserva el precio anterior. Se
-- ignora en vez de rechazar para no trabar la cola de subida de PowerSync de
-- ese dispositivo (sus ventas tienen que seguir subiendo).
BEGIN;

CREATE OR REPLACE FUNCTION public.products_keep_manual_price()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.price IS DISTINCT FROM OLD.price AND NEW.price <> round(NEW.price, 2) THEN
        NEW.price := OLD.price;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_keep_manual_price ON public.products;
CREATE TRIGGER products_keep_manual_price
    BEFORE UPDATE OF price ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.products_keep_manual_price();

COMMIT;
