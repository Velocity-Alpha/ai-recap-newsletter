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
    // Parse query parameters
    const page = parseInt(event.queryStringParameters?.page || '1', 10);
    const limit = parseInt(event.queryStringParameters?.limit || '6', 10);
    
    // Validate parameters
    const validPage = Math.max(1, page);
    const validLimit = Math.max(1, Math.min(100, limit)); // Cap at 100 items per page
    const offset = (validPage - 1) * validLimit;

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM newsletter.issues;
    `);
    const totalCount = parseInt(countResult.rows?.[0]?.total || '0', 10);
    const totalPages = Math.ceil(totalCount / validLimit);

    // Get paginated results
    const result = await pool.query(`
      SELECT 
        id, 
        title,
        excerpt,
        feature_image_url,
        published_at, 
        created_at  
      FROM newsletter.issues
      WHERE published_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT $1 OFFSET $2;
    `, [validLimit, offset]);

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
        pagination: {
          currentPage: validPage,
          totalPages: totalPages,
          totalCount: totalCount,
          limit: validLimit,
          hasNextPage: validPage < totalPages,
          hasPreviousPage: validPage > 1
        },
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
