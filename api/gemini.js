async function getAuthenticatedAdmin(req) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return null;

    try {
        const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey }
        });
        if (!userResp.ok) return null;
        const user = await userResp.json();
        if (!user?.id) return null;

        // Only 'admin' profiles get to use the AI assistant (venta/cocina do not).
        // RLS on profiles allows a user to read their own row, so their own token suffices.
        const profileResp = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
            headers: { 'Authorization': `Bearer ${token}`, 'apikey': anonKey }
        });
        if (!profileResp.ok) return null;
        const rows = await profileResp.json();
        if (rows?.[0]?.role !== 'admin') return null;

        return user;
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const user = await getAuthenticatedAdmin(req);
    if (!user) {
        return res.status(401).json({ error: 'Unauthorized: se requiere una sesión de administrador de Casa Lucenzo.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || req.body?.apiKey;
    if (!apiKey) {
        return res.status(400).json({ error: 'No Gemini API key configured on server or in request.' });
    }

    try {
        const { query, prompt } = req.body || {};
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt || query }]
                    }
                ]
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            return res.status(response.status).json({ error: errData });
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return res.status(200).json({ text: text || '' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
