module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
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
