const supabaseUrl = "https://xttpaqokeyywjaajvjyu.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dHBhcW9rZXl5d2phYWp2anl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDQ2NDcsImV4cCI6MjA5OTgyMDY0N30.GUREG-_krI5l3cowwuGZv1774q3AaWEjbmwrWLqhXDE";

async function run() {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        console.log("Fetching sales for today from Supabase...");
        const res = await fetch(`${supabaseUrl}/rest/v1/sales?timestamp=gte.${todayStart.toISOString()}`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });

        const sales = await res.json();
        console.log(`Found ${sales.length} sales today in Supabase DB:`);
        sales.forEach(s => {
            console.log(`- UUID: ${s.uuid} | Name: ${s.name} | Price: $${s.price} | Time: ${s.timestamp}`);
        });

        // Delete test sales that don't have "(Pagado"
        const activeUnpaidSales = sales.filter(s => !/\(Pagado/i.test(s.name) && !/\((Punto|Pago|Efectivo|Biopago)/i.test(s.name));
        console.log(`\nActive unpaid sales to delete: ${activeUnpaidSales.length}`);

        if (activeUnpaidSales.length > 0) {
            const uuids = activeUnpaidSales.map(s => s.uuid);
            console.log("Deleting UUIDs from Supabase DB:", uuids);

            const deleteRes = await fetch(`${supabaseUrl}/rest/v1/sales?uuid=in.(${uuids.join(',')})`, {
                method: 'DELETE',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            });

            console.log("Delete response status:", deleteRes.status);
            if (deleteRes.ok) {
                console.log("✅ SUCCESSFULLY DELETED ACTIVE UNPAID SALES FROM SUPABASE DB!");
            }
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
