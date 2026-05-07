// Try connecting to Supabase PostgreSQL directly
import pg from 'pg';

// Try common Supabase connection strings
const connectionStrings = [
  'postgresql://postgres.msajwmlhcrwyiblbkvuy:msajwmlhcrwyiblbkvuy@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres:postgres@db.msajwmlhcrwyiblbkvuy.supabase.co:5432/postgres',
];

async function tryConnect() {
  for (const connStr of connectionStrings) {
    console.log('Trying:', connStr.replace(/:([^@]+)@/, ':****@'));
    const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    try {
      await client.connect();
      console.log('Connected!');
      await client.end();
      return connStr;
    } catch (err: any) {
      console.log('Failed:', err.message);
    }
  }
  return null;
}

tryConnect();
