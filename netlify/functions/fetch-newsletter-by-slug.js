const pkg = require('pg');
const path = require('path');
const dotenv = require('dotenv');

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
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed'
      })
    };
  }

  try {
    const { slug } = event.queryStringParameters || {};

    if (!slug) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing slug parameter',
          message: 'Please provide a slug like: ?slug=my-issue'
        })
      };
    }

    const result = await pool.query(
      `SELECT
        id,
        slug,
        title,
        excerpt,
        feature_image_url,
        content_json,
        issue_date,
        published_at,
        created_at
      FROM newsletter.issues
      WHERE slug = $1`,
      [slug]
    );

    const rows = result.rows || [];

    if (rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Record not found',
          message: `No record found with slug: ${slug}`
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
      },
      body: JSON.stringify({
        success: true,
        data: rows[0],
        timestamp: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error('Database error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Database error',
        message: err.message
      })
    };
  }
};
