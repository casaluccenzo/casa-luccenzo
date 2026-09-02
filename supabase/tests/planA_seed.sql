-- planA_seed.sql — datos de ejemplo SOLO para el proyecto dev.
-- NUNCA correr contra produccion.
-- Mix de pastelitos y empaquetados; alguno con stock < initial_stock para
-- ejercitar el count_down del backfill (migracion 032).

INSERT INTO public.products (id,name,stock,min,max,price,category,initial_stock,cost) VALUES
  ('seed-past-a','Pastelito Queso',   14, 3, 30, 1.50, 'pastelitos', 20, 0.55),
  ('seed-past-b','Pastelito Carne',    0, 3, 30, 1.75, 'pastelitos', 18, 0.70),
  ('seed-past-c','Pastelito Pizza',    9, 3, 30, 1.60, 'pastelitos', 12, 0.60),
  ('seed-beb-a', 'Malta 355ml',       28, 6, 60, 1.20, 'bebidas',    40, 0.80),
  ('seed-beb-b', 'Agua 600ml',        11, 6, 60, 0.90, 'bebidas',    11, 0.45),
  ('seed-dul-a', 'Chocolate barra',    5, 2, 24, 2.00, 'dulces',      7, 1.10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.debts (uuid, client_name, amount) VALUES
  ('seed-debt-a','Panaderia El Sol', 120.00),
  ('seed-debt-b','Kiosco Maria',      45.50),
  ('seed-debt-c','Cliente Frecuente',  8.00)
ON CONFLICT (uuid) DO NOTHING;
