# Setup Guide

Complete step-by-step guide to get your news feed running.

## Prerequisites

- [Node.js 18+](https://nodejs.org/)
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works!)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Install Wrangler (if not already installed)

```bash
npm install -g wrangler
```

## Step 3: Login to Cloudflare

```bash
wrangler login
```

This will open your browser to authenticate with Cloudflare.

## Step 4: Create D1 Database

```bash
wrangler d1 create news-feed-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "news-feed-db"
database_id = "YOUR_DATABASE_ID_HERE"  # <-- Paste here
```

## Step 5: Run Database Migrations

```bash
wrangler d1 execute news-feed-db --file=db/schema.sql
wrangler d1 execute news-feed-db --file=db/seed.sql
```

## Step 6: Create KV Namespace

```bash
wrangler kv:namespace create news-feed-kv
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_ID_HERE"  # <-- Paste here
```

## Step 7: Test Locally

Start the development server:

```bash
npm run dev
```

Open http://localhost:4321 in your browser.

**Note:** For local development, you'll need to run the Cloudflare Workers locally:

```bash
# In a separate terminal
wrangler dev workers/api.ts
```

## Step 8: Deploy to Cloudflare

### Deploy the Workers

```bash
wrangler deploy workers/api.ts --name news-feed-api
wrangler deploy workers/fetcher.ts --name news-feed-fetcher
```

### Deploy the Astro site to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name news-feed
```

## Step 9: Configure API Keys (Optional)

If you want to use Twitter or Sofascore sources:

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Add your API keys to `.env`

3. Add secrets to Cloudflare Workers:
```bash
wrangler secret put TWITTER_API_KEY
wrangler secret put TWITTER_BEARER_TOKEN
wrangler secret put SOFASCORE_API_KEY
```

## Step 10: Test the Fetcher

Manually trigger the article fetcher:

```bash
curl -X POST https://news-feed-fetcher.YOUR-SUBDOMAIN.workers.dev/api/fetch-now
```

Or wait for the cron job to run (every hour).

## Troubleshooting

### Database migrations fail
- Make sure you've created the database first with `wrangler d1 create`
- Check that the `database_id` in `wrangler.toml` matches the output

### API endpoints return 404
- Verify Workers are deployed: `wrangler deployments list`
- Check the routes in `wrangler.toml`
- Make sure you're using the correct subdomain

### No articles showing
- Run the fetcher manually: `POST /api/fetch-now`
- Check that RSS sources are active in the database
- Look at Worker logs: `wrangler tail news-feed-api`

### Local development not working
- Make sure both `npm run dev` (Astro) and `wrangler dev` (Workers) are running
- Check that ports aren't conflicting
- Try using `--local` flag: `wrangler dev --local`

## Next Steps

1. Visit your site and start voting on articles!
2. The algorithm will learn your preferences over time
3. Check the Settings page to see your sources and weights
4. Add custom sources by inserting into the `sources` table

## Useful Commands

```bash
# View database contents
wrangler d1 execute news-feed-db --command="SELECT * FROM articles LIMIT 10"

# View Worker logs
wrangler tail news-feed-api

# List all deployments
wrangler deployments list

# Delete old articles (run cleanup)
wrangler d1 execute news-feed-db --command="DELETE FROM articles WHERE published_at < datetime('now', '-30 days')"
```

## Support

Having issues? Check:
- [Cloudflare D1 Docs](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Astro Docs](https://docs.astro.build/)
- [GitHub Issues](https://github.com/ndsimmons/news-feed/issues)
