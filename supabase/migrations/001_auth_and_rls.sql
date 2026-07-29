-- ====================================================================
-- MIGRACIÓN DE AUTENTICACIÓN Y SEGURIDAD ROW LEVEL SECURITY (RLS)
-- Proyecto: Casa Lucenzo POS
-- Fecha: 2026-07-28
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. TABLA PUBLIC.PROFILES (VINCULADA A AUTH.USERS)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'venta', 'cocina')),
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Índice para búsquedas rápidas por username
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- --------------------------------------------------------------------
-- 2. FUNCIÓN Y TRIGGER AUTOMÁTICO AL CREAR USUARIO EN AUTH.USERS
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, name, role, active)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'venta'),
        true
    )
    ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger sobre auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- --------------------------------------------------------------------
-- 3. FUNCIÓN AUXILIAR PARA CONSULTAR EL ROL DEL USUARIO ACTUAL
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID DEFAULT auth.uid())
RETURNS TEXT AS $$
DECLARE
    u_role TEXT;
BEGIN
    SELECT role INTO u_role FROM public.profiles WHERE id = user_id AND active = true;
    RETURN COALESCE(u_role, 'anon');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- --------------------------------------------------------------------
-- 4. HABILITAR RLS EN TODAS LAS TABLAS DEL SISTEMA
-- --------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replenishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------
-- 5. POLÍTICAS RLS PARA PUBLIC.PROFILES
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Permitir lectura de perfiles propios y por rol" ON public.profiles;
CREATE POLICY "Permitir lectura de perfiles propios y por rol" ON public.profiles
    FOR SELECT TO authenticated, anon
    USING (
        auth.uid() = id OR 
        public.get_user_role(auth.uid()) = 'admin' OR 
        active = true
    );

DROP POLICY IF EXISTS "Admin puede gestionar perfiles" ON public.profiles;
CREATE POLICY "Admin puede gestionar perfiles" ON public.profiles
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) = 'admin')
    WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

-- --------------------------------------------------------------------
-- 6. POLÍTICAS RLS PARA PRODUCTOS (public.products)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Todos los usuarios autenticados pueden ver productos" ON public.products;
CREATE POLICY "Todos los usuarios autenticados pueden ver productos" ON public.products
    FOR SELECT TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Admin y Cocina/Venta pueden actualizar stock de productos" ON public.products;
CREATE POLICY "Admin y Cocina/Venta pueden actualizar stock de productos" ON public.products
    FOR UPDATE TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta', 'cocina'))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta', 'cocina'));

DROP POLICY IF EXISTS "Solo Admin puede insertar o eliminar productos" ON public.products;
CREATE POLICY "Solo Admin puede insertar o eliminar productos" ON public.products
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) = 'admin')
    WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

-- --------------------------------------------------------------------
-- 7. POLÍTICAS RLS PARA VENTAS (public.sales)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Ver ventas por rol" ON public.sales;
CREATE POLICY "Ver ventas por rol" ON public.sales
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta', 'cocina'));

DROP POLICY IF EXISTS "Venta y Admin pueden registrar ventas" ON public.sales;
CREATE POLICY "Venta y Admin pueden registrar ventas" ON public.sales
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

DROP POLICY IF EXISTS "Solo Admin puede eliminar ventas" ON public.sales;
CREATE POLICY "Solo Admin puede eliminar ventas" ON public.sales
    FOR DELETE TO authenticated
    USING (public.get_user_role(auth.uid()) = 'admin');

-- --------------------------------------------------------------------
-- 8. POLÍTICAS RLS PARA GASTOS (public.expenses) Y DEUDAS (public.debts)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Ver gastos por rol" ON public.expenses;
CREATE POLICY "Ver gastos por rol" ON public.expenses
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

DROP POLICY IF EXISTS "Venta y Admin pueden registrar gastos" ON public.expenses;
CREATE POLICY "Venta y Admin pueden registrar gastos" ON public.expenses
    FOR INSERT TO authenticated
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

DROP POLICY IF EXISTS "Solo Admin puede borrar gastos" ON public.expenses;
CREATE POLICY "Solo Admin puede borrar gastos" ON public.expenses
    FOR DELETE TO authenticated
    USING (public.get_user_role(auth.uid()) = 'admin');

-- Deudas
DROP POLICY IF EXISTS "Ver deudas por rol" ON public.debts;
CREATE POLICY "Ver deudas por rol" ON public.debts
    FOR SELECT TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

DROP POLICY IF EXISTS "Venta y Admin pueden gestionar deudas" ON public.debts;
CREATE POLICY "Venta y Admin pueden gestionar deudas" ON public.debts
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta'))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

-- --------------------------------------------------------------------
-- 9. POLÍTICAS RLS PARA REPOSICIONES / DESPACHOS (public.replenishments)
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS "Ver reposiciones por rol" ON public.replenishments;
CREATE POLICY "Ver reposiciones por rol" ON public.replenishments
    FOR SELECT TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Cocina y Admin pueden crear y actualizar reposiciones" ON public.replenishments;
CREATE POLICY "Cocina y Admin pueden crear y actualizar reposiciones" ON public.replenishments
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'cocina', 'venta'))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'cocina', 'venta'));

-- --------------------------------------------------------------------
-- 10. POLÍTICAS RLS PARA INGREDIENTES, APP_CONFIG, SESSIONS & LOGS
-- --------------------------------------------------------------------
-- Ingredientes
DROP POLICY IF EXISTS "Lectura de ingredientes" ON public.ingredients;
CREATE POLICY "Lectura de ingredientes" ON public.ingredients
    FOR SELECT TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Gestión de ingredientes" ON public.ingredients;
CREATE POLICY "Gestión de ingredientes" ON public.ingredients
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'cocina'))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'cocina'));

-- App Config
DROP POLICY IF EXISTS "Lectura de app_config" ON public.app_config;
CREATE POLICY "Lectura de app_config" ON public.app_config
    FOR SELECT TO authenticated, anon
    USING (true);

DROP POLICY IF EXISTS "Actualización de app_config por admin/venta" ON public.app_config;
CREATE POLICY "Actualización de app_config por admin/venta" ON public.app_config
    FOR ALL TO authenticated
    USING (public.get_user_role(auth.uid()) IN ('admin', 'venta'))
    WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'venta'));

-- Active Sessions
DROP POLICY IF EXISTS "Permitir sesiones activas" ON public.active_sessions;
CREATE POLICY "Permitir sesiones activas" ON public.active_sessions
    FOR ALL TO authenticated, anon
    USING (true)
    WITH CHECK (true);

-- Activity Logs
DROP POLICY IF EXISTS "Lectura e inserción de logs" ON public.activity_logs;
CREATE POLICY "Lectura e inserción de logs" ON public.activity_logs
    FOR ALL TO authenticated, anon
    USING (true)
    WITH CHECK (true);

-- ====================================================================
-- SCRIPT COMPLETADO
-- ====================================================================
