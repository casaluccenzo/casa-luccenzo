-- Migration 016: Add actor_name to activity_logs for per-employee attribution
--
-- logActivity() has only ever carried the role ('admin'/'venta'/'cocina'),
-- not who specifically performed the action. currentUser (js/app.js) already
-- tracks the logged-in person's name every session -- this just gives it a
-- column to land in. Additive and nullable: existing rows are untouched and
-- keep rendering as role-only. No RLS policy changes needed -- Postgres RLS
-- is row-level, not column-level, so the WITH CHECK conditions from
-- migrations 010/011/014 are unaffected by a new column.

BEGIN;

ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS actor_name text;

COMMIT;
