-- Migration 009: Fix products with an empty category
-- Found while auditing the landing page menu list against the real catalog --
-- these 6 products had category = '' instead of a real category, which meant
-- they'd silently disappear from any category-filtered view (e.g. the
-- paused online-order popup's category pills).

UPDATE public.products SET category = 'empanadas'
WHERE name IN ('Empanada de Queso', 'Empanada de Mechada', 'Empanada de Molida', 'Empanada de Pollo')
  AND (category IS NULL OR category = '');

UPDATE public.products SET category = 'dulces'
WHERE name IN ('Cocosette Maxi', 'Susy Maxi')
  AND (category IS NULL OR category = '');
