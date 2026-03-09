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

    const result = await pool.query(`
      WITH filtered AS (
        SELECT
          id,
          title,
          excerpt,
          feature_image_url,
          issue_date,
          published_at,
          created_at
        FROM newsletter.issues
        WHERE content_json IS NOT NULL
          AND published_at IS NOT NULL
      ),
      total AS (
        SELECT COUNT(*)::int AS total_count
        FROM filtered
      )
      SELECT
        paged.id,
        paged.title,
        paged.excerpt,
        paged.feature_image_url,
        paged.issue_date,
        paged.published_at,
        paged.created_at,
        total.total_count
      FROM total
      LEFT JOIN LATERAL (
        SELECT *
        FROM filtered
        ORDER BY COALESCE(issue_date, published_at::date) DESC, published_at DESC
        LIMIT $1 OFFSET $2
      ) paged ON true;
    `, [validLimit, offset]);

    const rows = result.rows || [];
    const totalCount = parseInt(rows?.[0]?.total_count || '0', 10);
    const totalPages = Math.ceil(totalCount / validLimit);
    const issues = rows
      .filter((row) => row.id !== null)
      .map((row) => {
        const issue = { ...row };
        delete issue.total_count;
        return issue;
      });
    
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
      },
      body: JSON.stringify({
        success: true,
        data: issues,
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
