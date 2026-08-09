/**
 * Daily heartbeat so Supabase's Free tier doesn't auto-pause the project for
 * inactivity (Supabase pauses a project after ~7 days with zero real database
 * requests). Vercel invokes this once a day via the "crons" entry in
 * vercel.json -- Hobby plan allows at most one run per day, which is still
 * far more often than the 7-day threshold needs.
 *
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when it
 * triggers a scheduled cron. Add a CRON_SECRET env var in Vercel (any random
 * string, 16+ chars) so this endpoint can't be triggered by anyone who finds
 * the URL -- without it configured, every request is rejected.
 */
module.exports = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers['authorization'] || '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
        return res.status(500).json({ error: 'Supabase not configured' });
    }

    try {
        // Any real read against the DB counts as activity. app_config is a
        // single, publicly-readable row (RLS: SELECT to anon), so a plain
        // anon-key read is enough -- no service-role key needed.
        const resp = await fetch(`${supabaseUrl}/rest/v1/app_config?id=eq.1&select=id`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        if (!resp.ok) {
            return res.status(502).json({ ok: false, error: `Supabase respondió ${resp.status}` });
        }
        return res.status(200).json({ ok: true, pinged_at: new Date().toISOString() });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
};
