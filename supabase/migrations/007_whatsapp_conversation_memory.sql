-- Migration 007: Conversation memory for the WhatsApp bot
-- Stores recent turns per phone number so the bot can hold a real back-and-forth
-- conversation instead of treating every incoming message in isolation.
-- Only ever read/written via the serverless webhook using SUPABASE_SERVICE_ROLE_KEY,
-- so RLS is enabled with NO policies -- anon/authenticated clients (i.e. the
-- frontend app) get zero access, only service_role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_phone_created
    ON public.whatsapp_conversations(phone, created_at);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
