# Netlify Functions Folder

This directory only contains serverless function source code and Netlify-specific config.

## Local Development

Run local development from the repository root:

```bash
npm run dev
```

Do not run `netlify dev` from this directory directly. The root command starts:
- Next.js target app (default `http://localhost:3000`)
- Netlify proxy + functions (`http://localhost:8888`)

Optional custom target app port:

```bash
PORT=3001 npm run dev
```

## Environment

- `netlify/.env` should define `DATABASE_URL`
- `NEXT_PUBLIC_NEWSLETTER_URL` is optional and only needed for custom API origin overrides
