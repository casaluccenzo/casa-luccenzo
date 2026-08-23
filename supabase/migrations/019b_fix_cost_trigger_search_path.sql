-- Migration 019b: harden fill_missing_sale_cost() search_path
--
-- El linter de Supabase marcó la función del trigger de 019 (WARN:
-- function_search_path_mutable) por no fijar search_path -- puede ser
-- secuestrada por un search_path malicioso en la sesión que dispara el
-- trigger. Fix estándar: fijarlo a public.

ALTER FUNCTION public.fill_missing_sale_cost() SET search_path = public;
