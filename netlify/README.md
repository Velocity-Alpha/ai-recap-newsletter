# Netlify Backend Functions

This folder contains the backend functions for the Netlify deployment.

## Files Included
- `functions/getData.js`: A serverless function to fetch all newsletter data from the database.
- `functions/getDataById.js`: A serverless function to fetch a specific newsletter by ID.
- `functions/getOverviewData.js`: A serverless function to fetch newsletter overview data (for listing pages).
- `netlify.toml`: Netlify configuration file.

## Setup Instructions

1. **Install Dependencies**:
   ```bash
   cd netlify
   npm install
   ```

2. **Environment Variables**:
   - Create a `.env` file in the `netlify` folder (or set in Netlify dashboard).
   - Add the required environment variable:
     ```
     DATABASE_URL=your_database_connection_string
     ```
   - For Netlify deployment, add this as an environment variable in the Netlify dashboard under Site settings > Environment variables.

3. **Run Locally**:
   - From the project root, start the Netlify development server:
     ```bash
     netlify dev
     ```
   - Access the endpoints at:
     ```
     http://localhost:8888/.netlify/functions/getData
     http://localhost:8888/.netlify/functions/getDataById?id=1
     http://localhost:8888/.netlify/functions/getOverviewData
     ```

4. **Deploy to Netlify**:
   - Connect your repository to Netlify
   - Set the build command: `npm run build`
   - Set the publish directory: `.next`
   - Add the `DATABASE_URL` environment variable in Netlify dashboard
   - Deploy!

## API Endpoints

### GET /.netlify/functions/getData
Returns all newsletter issues with full content.

### GET /.netlify/functions/getDataById?id={id}
Returns a specific newsletter issue by ID.

### GET /.netlify/functions/getOverviewData
Returns newsletter overview data (id, title, excerpt, feature_image_url, published_at) for listing pages.

