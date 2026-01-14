// netlify/functions/getDataById.js
const pkg = require('pg');
const dotenv = require('dotenv');

// Load environment variables - system env vars take precedence
dotenv.config({ override: false });

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false }
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

  // Only allow GET requests
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
    // Extract ID from query parameters
    const { id } = event.queryStringParameters || {};
    
    // Validate ID
    if (!id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Missing ID parameter',
          message: 'Please provide an ID like: ?id=1'
        })
      };
    }

    const issueId = parseInt(id);
    if (isNaN(issueId) || issueId <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Invalid ID',
          message: 'ID must be a positive number'
        })
      };
    }

    // Query database
    const result = await pool.query(
      `SELECT 
        id, 
        title,
        excerpt,
        content_json, 
        published_at, 
        created_at  
      FROM newsletter.issues
      WHERE id = $1`,
      [issueId]
    );

    // Check if issue exists
    if (result.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Record not found',
          message: `No Record found with ID: ${issueId}`
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify({
        success: true,
        data: result.rows[0], // Single object
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
