import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://msajwmlhcrwyiblbkvuy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYWp3bWxoY3J3eWlibGJrdnV5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzk4MjMyMCwiZXhwIjoyMDkzNTU4MzIwfQ.Pji9g_k95up3xWDr4-UfIEdR6llJ_t_N436hV_s7M2g'
);

async function check() {
  const tables = ['candles', 'predictions', 'outcomes', 'model_performance', 'learning_params'];
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`${table}: ERROR - ${error.message}`);
    } else {
      console.log(`${table}: OK (${data?.length || 0} rows)`);
    }
  }
}
check();
