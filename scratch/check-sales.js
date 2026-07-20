const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = "https://xttpaqokeyywjaajvjyu.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQ2NDcsImV4cCI6MjA5OTgyMDY0N30.GUREG-_krI5l3cowwuGZv1774q3AaWEjbmwrWLqhXDE";

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    try {
        const start = new Date("2026-07-15T00:00:00Z").toISOString();
        const end = new Date("2026-07-20T23:59:59Z").toISOString();

        console.log(`Querying sales from ${start} to ${end}...`);
        const { data: sales, error: salesError } = await supabase
            .from('sales')
            .select('timestamp')
            .gte('timestamp', start)
            .lte('timestamp', end);

        if (salesError) throw salesError;

        const salesCounts = {};
        sales.forEach(s => {
            const dateStr = s.timestamp.substring(0, 10);
            salesCounts[dateStr] = (salesCounts[dateStr] || 0) + 1;
        });

        console.log("\nSALES COUNTS BY DATE:");
        console.log(salesCounts);

        const { data: expenses, error: expError } = await supabase
            .from('expenses')
            .select('timestamp')
            .gte('timestamp', start)
            .lte('timestamp', end);

        if (expError) throw expError;

        const expCounts = {};
        expenses.forEach(e => {
            const dateStr = e.timestamp.substring(0, 10);
            expCounts[dateStr] = (expCounts[dateStr] || 0) + 1;
        });

        console.log("\nEXPENSES COUNTS BY DATE:");
        console.log(expCounts);

    } catch (e) {
        console.error(e);
    }
}
run();
