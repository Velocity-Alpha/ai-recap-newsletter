const pkg = require('pg');
const dotenv = require('dotenv');

// Load environment variables - system env vars take precedence
dotenv.config({ override: false });

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required for Neon
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
    const result = await pool.query(`
      SELECT 
        id, 
        title,
        excerpt,
        feature_image_url,
        published_at, 
        created_at  
      FROM newsletter.issues
      ORDER BY published_at DESC;
    `);
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({
        success: true,
        data: result.rows,
        count: result.rows.length,
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
