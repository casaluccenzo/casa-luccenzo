-- Migration 011: Drop `anon` from three leftover SELECT policies
--
-- Migration 010 removed the six blanket "Acceso publico seguro" policies, which
-- was the serious hole (write access to everything). Probing production with
-- the anon key afterwards showed three tables still readable without a session,
-- through separate, older policies that 010 deliberately did not touch:
--
--   ingredients    -- pantry quantities
--   replenishments -- what Cocina is dispatching and when
--   profiles       -- usernames and roles, i.e. a ready-made list of accounts
--                     to try credentials against
--
-- No financial data and no write access, so this is a smaller leak than 010's,
-- but none of it is needed publicly. Verified before closing:
--   * The public site (index.html) queries only `products` and `pedidos_online`.
--   * The WhatsApp/Telegram bots and the sales-monitor cron use the service role.
--   * api/gemini.js reads `profiles` with the END USER's bearer token (the anon
--     key is only the `apikey` header), so it keeps working as `authenticated`.
--
-- The USING expressions are left byte-for-byte identical; the only change is
-- dropping `anon` from the role list, so in-app behaviour cannot shift.

BEGIN;

DROP POLICY IF EXISTS "Lectura de ingredientes" ON public.ingredients;
CREATE POLICY "Lectura de ingredientes"
    ON public.ingredients FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Ver reposiciones por rol" ON public.replenishments;
CREATE POLICY "Ver reposiciones por rol"
    ON public.replenishments FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Permitir lectura de perfiles propios y por rol" ON public.profiles;
CREATE POLICY "Permitir lectura de perfiles propios y por rol"
    ON public.profiles FOR SELECT TO authenticated
    USING ((auth.uid() = id) OR (get_user_role(auth.uid()) = 'admin') OR (active = true));

COMMIT;
