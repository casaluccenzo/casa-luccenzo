# Admin Dashboard: Sidebar Redesign + Employee Attribution

**Status:** Superseded by verification — see correction below
**Date:** 2026-08-16

## Correction (post-approval verification)

Everything in "Approach" and "Design §1" below assumes the admin settings
sub-nav is a horizontal icon-only row that needs to become a sidebar. Before
starting implementation, live-testing at desktop width (1280px) showed **the
vertical sidebar already exists and is already live**: `.admin-sidebar`
(`css/components.css:1811`, `width: 210px`, `flex-direction: column`) with
labeled buttons ("Resumen", "Análisis", "Productos", etc.), and its own
`768px` breakpoint (`css/components.css:2245`) that correctly collapses it to
the icon-only row. What looked like "the old horizontal nav" during
brainstorming was this same sidebar rendering in its mobile mode — the
browser pane used for verification was 722px wide, under the breakpoint.

**Net effect: the "Approach" and "Design §1" sections below do not need to be
built.** The only parts of this spec that still apply are §2 (content
inventory, minus the sidebar-existence claim), §3 (employee attribution),
and the naming fix. See the implementation plan for the corrected, much
smaller scope.

## Context

`proto-admin-resumen.html` (untracked scratch file in the repo root) is a standalone
design prototype exploring a more "professional" layout for the Admin panel: a
left sidebar instead of a horizontal icon-only tab strip, plus richer KPI cards
and a per-employee activity feed. This spec turns that prototype into a scoped,
buildable design against the real codebase.

The already-shipped KPI/Bs/delta/Recent-Activity feature (v286, tested and
confirmed working in this session) is **not** part of this spec — it's already
done and separately committable.

## Scope

There are two distinct navigations in `sistema/index.html`, both currently
labeled in ways that collide:

1. **Top-level app nav** (shared by all roles): `1. Control · 2. Vitrina ·
   3. Resumen · 4. Clientes · 5. Cocina · 6. Créditos · 7. Cambio` (button IDs
   under the main `nav-item` bar). **Out of scope** — not touched by this spec.
2. **Admin settings sub-nav** (inside "Control", opened via the ⚙️ "Configurar
   Productos" gear): today a horizontal row of 8 icon-only buttons
   (`admin-tab-btn-summary`, `-analytics`, `-products`, `-devices`, `-logs`,
   `-costs`, `-agent`, `-preferences`), each toggling a `panel*` div via
   `activateTab(btn, panel)` (`js/app.js:4332`). **This is what becomes the
   sidebar.**

**Role scope:** Admin only. Ventas and Cocina keep their current screens
unchanged — they're tablet/mostrador flows already optimized for that use,
and redesigning them is a separate, unrelated effort.

**Naming fix:** the sub-nav's first item (`admin-tab-btn-summary`, currently
unlabeled/icon-only, functionally "the KPI dashboard") is labeled **"Dashboard"**
in the new sidebar, not "Resumen" — the top-level app nav already has an
unrelated screen called "Resumen" (`view-resumen`, a live shift-reconciliation
view for Ventas/Cocina), and reusing the name for a second, different screen
would only add to the confusion. This spec does not rename `view-resumen`
itself — that's shared, out-of-scope surface.

## Approach

**Replace the nav chrome, keep the state machine.** `activateTab()` and the
eight `panel*` content divs are unchanged — that logic already works in
production and there's no reason to touch it. Only the button markup/CSS
changes: from a horizontal icon row to a vertical sidebar list with icon +
label, grouped into two sections ("OPERACIÓN" / "SISTEMA" per the prototype).
Button `id`s stay the same, so the existing `getElementById` + event listener
wiring in `app.js` keeps working untouched.

Two alternatives were considered and rejected: a full router-based rewrite
(higher regression risk on a live business-critical system, no immediate
benefit) and a parallel opt-in "beta" sidebar (contradicts the "do it properly,
all the way" goal and adds temporary dual-maintenance).

## Design

### 1. Layout & responsive

Fixed-width sidebar (~220–240px) on the left inside the admin settings panel,
with "Casa Lucenzo — Panel Admin" header and the two grouped sections. Content
area (existing `panel*` divs) fills the remaining space, unchanged.

Below the existing `768px` breakpoint (the only one `components.css` uses
today), the sidebar collapses back to **today's horizontal icon row** rather
than a new mobile pattern (drawer, hamburger, etc.) — that pattern is already
built, tested, and this redesign targets the fixed counter device where Admin
is actually used, not a new mobile admin experience.

### 2. Content inventory

Cross-checked every widget in the prototype against the real codebase:

**Already exists** (just needs to move under the new "Dashboard" sidebar item,
no new logic): KPI cards with Bs + weekly delta, Recent Activity feed, Ventas
por Categoría, Favoritos del día/semana, Reporte de Ventas Semanales,
Métodos de Pago, Alertas de Stock Crítico, Distribución de ventas por hora.

**Genuinely new:**
- **Ticket Promedio** card — `ventas totales del día ÷ cantidad de ventas del
  día`. Shows `—` when there are zero sales (not a divide-by-zero artifact),
  same convention as the existing delta chip's "sin registro" state.
- **"Reporte PDF" button** — reuses the existing `window.print()` pattern
  already used elsewhere in the app (`js/ui.js`, e.g. lines ~3682, ~4769,
  ~5330, ~5539). No new PDF library needed; there's none loaded today.
- **Last register-close time on the "Caja" card** — needs confirmation during
  implementation planning whether this timestamp is already persisted
  anywhere (e.g. from "Cerrar Jornada"); if not, out of scope for this pass.

### 3. Employee attribution in Recent Activity

Today `logActivity(action, details)` (`js/app.js:3027`) only carries
`currentRole` ('admin'/'venta'/'cocina') through to `insertActivityLog()`
(`js/supabase.js:1351`) and the `activity_logs` table. The specific person is
only visible in ad-hoc login-event text ("Ingreso de admin (admin)..."), not
as structured data on every row. `currentUser` (with `.name`/`.username`) is
already tracked module-globally in `app.js` (line 3102) — it just isn't
threaded through.

**Change:**
1. `logActivity()` passes `currentUser ? currentUser.name : null` as a new
   argument to `insertActivityLog()`.
2. `insertActivityLog(role, action, details, actorName)` adds `actor_name:
   actorName || null` to the insert payload.
3. Migration: `ALTER TABLE activity_logs ADD COLUMN actor_name text;` —
   additive, nullable. No RLS policy changes needed (Postgres RLS is row-level,
   not column-level; the existing `WITH CHECK` conditions from migrations
   010/011/014 don't reference specific columns).
4. `fetchActivityLogs()` already does `select('*')` — the new column arrives
   automatically once it exists, no query change.
5. `renderRecentActivity()` / `renderActivityLogs()` (`js/ui.js`) display
   `actor_name` when present (e.g. "María · venta"); fall back to role-only
   display when absent.

**No retroactive migration** — existing rows keep showing role-only. This is
a forward-only enrichment.

**Deploy-order risk (real, not hypothetical):** the DB migration must land
before (or atomically with) client code that starts sending `actor_name` —
sending an unknown column to a table that doesn't have it yet fails the
insert. This is the same class of gotcha as the RLS/pagination incidents in
project memory; call it out explicitly in the implementation plan's rollout
step, and verify via [[verifying-production-deploys]] before considering it
done.

### 4. Error handling

- Ticket Promedio: zero sales → `—`, not `NaN`/`Infinity`.
- Old activity_logs rows without `actor_name`: render role-only, no error.
- Offline: `currentUser` is already available from the local PIN session even
  without connectivity, so `actor_name` is still captured; the existing
  `enqueueOfflineOp` path for `activity_logs` inserts is unchanged.
- Sub-768px viewports: no new code path — falls back to the existing,
  already-hardened icon-row rendering.

### 5. Testing plan

Manual smoke test via the local dev server, logged in as Admin (same
approach used to verify the KPI/delta/activity feature earlier this session):

- All 8 sidebar sections still open their correct panel and existing
  functionality inside each is unaffected (this is the main regression risk
  given `activateTab()` is being fed by new markup).
- Ticket Promedio calculates correctly against real and zero-sales data.
- "Reporte PDF" triggers print output.
- A fresh PIN login produces a Recent Activity entry showing the employee's
  name; pre-existing rows still render without erroring.
- Viewport resize below 768px falls back to the icon row, not a broken
  sidebar.
- Full [[verifying-production-deploys]] checklist before calling the deploy
  done, given this touches `sistema/index.html` structure and a DB migration.

## Out of scope

- Top-level app nav (`Control/Vitrina/Resumen/Clientes/Cocina/Créditos/Cambio`)
  — shared with Ventas/Cocina, not touched.
- Ventas and Cocina role UIs — unchanged.
- Renaming or restructuring `view-resumen` (the shift-reconciliation screen).
- Retroactively backfilling `actor_name` on historical `activity_logs` rows.
- A dedicated mobile/tablet sidebar experience — sub-768px keeps today's icon
  row.
