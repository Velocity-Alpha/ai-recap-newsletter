# AI Intelligence Newsletter - Standalone Website

A beautiful, light-mode newsletter website with paint-style colors that complement Gemini image generation. This is a standalone Next.js application for displaying AI intelligence newsletters.

## Features

- 🎨 **Light Mode Design**: Beautiful paint-style color palette with soft pastels and warm tones
- 📰 **Newsletter Listing**: Browse recent newsletters with pagination
- 📖 **Detailed Newsletter View**: Read full newsletter content with organized sections
- 📧 **Newsletter Subscription**: Integrated subscription form
- 🚀 **Netlify Integration**: Serverless functions for data fetching
- 📱 **Responsive Design**: Works beautifully on all devices

## Tech Stack

- **Next.js 16** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS 4** - Styling with custom paint-style theme
- **Netlify Functions** - Serverless backend
- **PostgreSQL** - Database (via Neon or similar)

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- PostgreSQL database (Neon, Supabase, etc.)

### Installation

1. **Clone and navigate to the project**:
   ```bash
   cd va_newsletter
   ```

2. **Install dependencies**:
   ```bash
   npm install
   cd netlify && npm install && cd ..
   ```

3. **Set up environment variables**:
   - Copy the example environment files and update with your values:
     ```bash
     cp .env.local.example .env.local
     cp netlify/.env.example netlify/.env
     ```
   - Update `.env.local` in the root directory:
     ```env
     NEXT_PUBLIC_NEWSLETTER_URL=http://localhost:8888/.netlify/functions
     ```
   - Update `netlify/.env` with your database connection string:
     ```env
     DATABASE_URL=your_database_connection_string
     ```

4. **Run the development server**:
```bash
npm run dev
   ```

5. **Run Netlify functions locally** (in a separate terminal):
   ```bash
   cd netlify
   npm install
   cd ..
   netlify dev
```

   The app will be available at [http://localhost:3000](http://localhost:3000)

## Project Structure

```
va_newsletter/
├── app/                    # Next.js app directory
│   ├── page.tsx           # Home page (newsletter listing)
│   ├── newsletter/
│   │   └── [id]/
│   │       └── page.tsx   # Individual newsletter page
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Global styles with paint theme
├── src/
│   ├── components/        # React components
│   │   ├── Header.tsx
│   │   ├── NewsletterCard.tsx
│   │   ├── RecentNewsletters.tsx
│   │   ├── SubscribeNewsletter.tsx
│   │   └── Pagination.tsx
│   ├── types/            # TypeScript types
│   │   └── newsletter.types.ts
│   └── utils/            # Utility functions
│       └── dateFormatter.ts
├── netlify/
│   ├── functions/        # Netlify serverless functions
│   │   ├── fetch-newsletter-by-id.js
│   │   ├── fetch-newsletters-list.js
│   │   └── fetch-ticker-news.js
│   └── package.json
└── netlify.toml          # Netlify configuration
```

## Color Palette

The website uses a paint-style color scheme with:
- **Primary**: Rich purple (#7C3AED)
- **Accent**: Soft pink (#EC4899)
- **Backgrounds**: Warm whites and soft pastels
- **Gradients**: Lavender, peach, mint, sky blue, coral, amber, rose

## Deployment

### Deploy to Netlify

1. **Connect your repository** to Netlify
2. **Set build settings**:
   - Build command: `npm run build`
   - Publish directory: `.next`
3. **Add environment variables** in Netlify dashboard:
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `NEXT_PUBLIC_NEWSLETTER_URL`: Your Netlify function URL (auto-set if using Netlify)
4. **Deploy!**

The Netlify functions will automatically be deployed with your site.

## API Endpoints

The Netlify functions provide the following endpoints:

- `/.netlify/functions/fetch-newsletter-by-id?id={id}` - Get newsletter by ID
- `/.netlify/functions/fetch-newsletters-list` - Get newsletter overview for listings
- `/.netlify/functions/fetch-ticker-news` - Get ticker news

## Database Schema

The application expects a PostgreSQL database with a `newsletter.issues` table containing:
- `id` (integer)
- `title` (text)
- `excerpt` (text)
- `content_json` (jsonb)
- `feature_image_url` (text)
- `published_at` (timestamp)
- `created_at` (timestamp)

## License

Private project
