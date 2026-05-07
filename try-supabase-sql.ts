// Try Supabase SQL endpoint
const SUPABASE_URL = 'https://msajwmlhcrwyiblbkvuy.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYWp3bWxoY3J3eWlibGJrdnV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzk4MjMyMCwiZXhwIjoyMDkzNTU4MzIwfQ.Pji9g_k95up3xWDr4-UfIEdR6llJ_t_N436hV_s7M2g';

async function tryEndpoints() {
  // Try the Supabase SQL endpoint
  const endpoints = [
    `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    `${SUPABASE_URL}/rest/v1/rpc/execute_sql`, 
    `${SUPABASE_URL}/pg/query`,
  ];
  
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`
        },
        body: JSON.stringify({ query: 'SELECT 1' })
      });
      console.log(`${url}: ${res.status} ${await res.text().then(t => t.substring(0, 100))}`);
    } catch (err: any) {
      console.log(`${url}: ERROR ${err.message}`);
    }
  }
}

tryEndpoints();
