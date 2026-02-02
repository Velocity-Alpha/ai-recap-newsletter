const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testConnection() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ Error: DATABASE_URL not found in .env file');
    process.exit(1);
  }
  
  console.log('Testing connection to:', process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@')); // Hide password
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const start = Date.now();
    const res = await pool.query('SELECT current_user, current_database(), version();');
    const end = Date.now();
    
    console.log('✅ Connection successful!');
    console.log('User:', res.rows[0].current_user);
    console.log('Database:', res.rows[0].current_database);
    console.log('Latency:', end - start, 'ms');

    console.log('\n--- Testing Read Access ---');
    const tables = ['newsletter.issues', 'newsletter.stories', 'newsletter.scraper_bookmarks'];
    
    for (const table of tables) {
      try {
        const tableRes = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        console.log(`✅ Read from ${table}: ${tableRes.rows[0].count} rows`);
      } catch (err) {
        console.error(`❌ Failed to read from ${table}:`, err.message);
      }
    }
  } catch (err) {
    console.error('❌ Connection failed:');
    console.error(err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
