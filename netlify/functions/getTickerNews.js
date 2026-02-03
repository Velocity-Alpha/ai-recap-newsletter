const pkg = require('pg');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from netlify/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Pool } = pkg;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not defined');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

exports.handler = async function(event) {
  // Set CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };

  // Handle OPTIONS preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Query for stats in the last 7 days
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE category ILIKE '%research%' OR category ILIKE '%paper%')::int as papers,
        COUNT(*) FILTER (WHERE category ILIKE '%tool%')::int as tools,
        COUNT(*) FILTER (WHERE category NOT ILIKE '%research%' AND category NOT ILIKE '%paper%' AND category NOT ILIKE '%tool%' OR category IS NULL)::int as stories
      FROM newsletter.stories
      WHERE day >= CURRENT_DATE - INTERVAL '7 days';
    `);
    const stats = statsResult.rows[0];

    // Query for short-ish headlines in the last 7 days, ensuring distinctness and randomizing time for ticker variety
    const result = await pool.query(`
      SELECT headline, day, category, randomized_created_at as "createdAt"
      FROM (
        SELECT DISTINCT ON (TRIM(REGEXP_REPLACE(headline, '\\(\\d+\\s*minute\\s*read\\)', '', 'gi')))
          TRIM(REGEXP_REPLACE(headline, '\\(\\d+\\s*minute\\s*read\\)', '', 'gi')) as headline, 
          day,
          category,
          "createdAt" + (random() * 24 - 12) * interval '1 hour' as randomized_created_at
        FROM newsletter.stories
        WHERE day >= CURRENT_DATE - INTERVAL '7 days'
          AND LENGTH(headline) <= 80
          AND headline NOT ILIKE '%tldr%'
          AND headline NOT ILIKE '%rundown%'
          AND headline NOT ILIKE '%morning%'
        ORDER BY TRIM(REGEXP_REPLACE(headline, '\\(\\d+\\s*minute\\s*read\\)', '', 'gi')), day DESC, "createdAt" DESC
      ) sub
      ORDER BY randomized_created_at DESC
      LIMIT 20;
    `);
    
    const rows = result.rows || [];
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({
        success: true,
        data: rows,
        stats: stats,
        count: rows.length,
        timestamp: new Date().toISOString()
      }),
    };
  } catch (err) {
    console.error('DB Query Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false,
        error: 'Database query failed', 
        details: err.message,
        timestamp: new Date().toISOString()
      }),
    };
  }
};
