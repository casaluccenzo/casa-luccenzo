const supabaseUrl = "https://xttpaqokeyywjaajvjyu.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQ2NDcsImV4cCI6MjA5OTgyMDY0N30.GUREG-_krI5l3cowwuGZv1774q3AaWEjbmwrWLqhXDE";

async function run() {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        console.log("Fetching ALL sales for today from Supabase...");
        const res = await fetch(`${supabaseUrl}/rest/v1/sales?timestamp=gte.${todayStart.toISOString()}&order=timestamp.desc`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });

        const sales = await res.json();
        console.log(`Found ${sales.length} total sales recorded today in Supabase DB:`);
        sales.forEach(s => {
            const timeLocal = new Date(s.timestamp).toLocaleTimeString();
            console.log(`- Time: ${timeLocal} (${s.timestamp}) | Name: ${s.name} | Price: $${s.price} | UUID: ${s.uuid}`);
        });

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
