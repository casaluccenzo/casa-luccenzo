-- Migration 020: Categorías y moneda en gastos
--
-- CONTEXTO
-- Hasta ahora `expenses` era una tabla plana (description, amount, timestamp)
-- y todos los gastos se cargaban desde el flujo de caja de Ventas, sin
-- categoría y asumidos en USD. Se agrega una sección admin para cargar
-- gastos fijos (arriendo, sueldos, servicios), que pueden pagarse en $ o Bs.
--
-- Todo aditivo:
--   category  -> 'arriendo' | 'sueldos' | 'servicios' | 'otros'.
--                NULL en filas viejas y en gastos de mostrador -> se leen
--                como 'otros' del lado del cliente.
--   currency  -> 'USD' | 'VES'. DEFAULT 'USD' para no romper inserts viejos.
--   bcv_rate  -> tasa BCV congelada al cargar el gasto (relevante solo si
--                currency = 'VES'), mismo patrón que sales.bcv_rate.
--
-- Sin cambios de RLS: las políticas de `expenses` (001/010/011) no
-- referencian columnas puntuales. Sin trigger de relleno server-side: el
-- form admin siempre manda los tres campos y el DEFAULT cubre rutas viejas.

BEGIN;

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS bcv_rate numeric;

COMMIT;
