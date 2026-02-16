# News Feed Aggregator

A personalized news aggregation website built with **Astro**, **Cloudflare**, and **React** that pulls articles from your favorite sources, stores them in a database, and uses a simple recommendation algorithm to display the top content.

## Features

- 📰 **Multi-source aggregation** from Tech, Business, Sports, Politics, Culture, and Podcasts
- 🎯 **Smart recommendations** based on your voting behavior
- 👍👎 **Swipe to vote** on articles (desktop: keyboard arrows or mouse drag)
- 💾 **Cloudflare D1** database for storing articles and preferences
- ⚡ **Edge-powered** with Cloudflare Workers
- 🎨 **Techmeme-inspired** clean, text-focused design
- 👤 **Single-user** with future multi-user support

## Tech Stack

- **Frontend**: Astro + React + TailwindCSS
- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Caching**: Cloudflare KV
- **Scheduling**: Cloudflare Cron Triggers
- **Deployment**: Cloudflare Pages

## Data Sources

### Tech
- Techmeme (RSS)
- X/Twitter (API - requires keys)
- Stratechery (RSS)

### Business
- Yahoo Finance (RSS)
- CNBC (RSS)

### Sports
- Sofascore (API - requires keys)

### Politics
- Mark Halperin's Wide World of News
- 2way
- X/Twitter (API - requires keys)

## Project Structure

```
news-feed/
├── src/
│   ├── pages/
│   │   ├── index.astro              # Main feed page
│   │   └── settings.astro           # Manage sources/categories
│   ├── components/
│   │   ├── FeedCard.tsx             # Swipeable article card
│   │   ├── CategoryFilter.tsx       # Filter by category
│   │   └── ArticleList.tsx          # Feed container
│   ├── layouts/
│   │   └── Layout.astro             # Base layout
│   ├── lib/
│   │   └── types.ts                 # TypeScript types
│   └── styles/
│       └── global.css               # Global styles
├── workers/
│   ├── api.ts                       # API endpoints
│   ├── fetcher.ts                   # Cron job to fetch articles
│   ├── scoring.ts                   # Recommendation algorithm
│   └── parsers/
│       ├── rss.ts                   # RSS parser
│       ├── twitter.ts               # X/Twitter API
│       └── generic.ts               # Generic scraper
├── db/
│   ├── schema.sql                   # D1 schema
│   └── seed.sql                     # Initial data
├── wrangler.toml                    # Cloudflare config
└── astro.config.mjs                 # Astro config
```

## Database Schema

See `db/schema.sql` for the complete schema. Key tables:

- `users` - User accounts (ready for multi-user)
- `categories` - Article categories
- `sources` - Configurable news sources
- `articles` - Fetched articles
- `votes` - User voting history
- `interest_weights` - Learned preferences

## Recommendation Algorithm

Simple weighted scoring:

```
score = (base_relevance × topic_match) + (upvotes × 2) - (downvotes × 3) - age_penalty
```

- **base_relevance**: Keyword matching with interests (0-1)
- **topic_match**: Category alignment with user interests (0-1)
- **upvotes/downvotes**: Explicit feedback
- **age_penalty**: Newer articles ranked higher

Each vote adjusts category and source weights by ±10%.

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account (free tier works)
- Wrangler CLI: `npm install -g wrangler`

### Installation

1. Clone the repository:
```bash
git clone https://github.com/ndsimmons/news-feed.git
cd news-feed
```

2. Install dependencies:
```bash
npm install
```

3. Set up Cloudflare:
```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create news-feed-db

# Run migrations
wrangler d1 execute news-feed-db --file=db/schema.sql
wrangler d1 execute news-feed-db --file=db/seed.sql
```

4. Configure environment:
```bash
cp .env.example .env
# Add your API keys (Twitter, etc.)
```

5. Run locally:
```bash
npm run dev
```

### Deployment

```bash
# Deploy to Cloudflare Pages
npm run build
wrangler pages publish dist
```

## API Endpoints

- `GET /api/feed?limit=20` - Get top 20 articles
- `POST /api/vote` - Vote on article `{article_id, vote}`
- `GET /api/categories` - List categories
- `GET /api/sources` - List sources
- `PUT /api/sources/:id` - Update source config
- `POST /api/sources` - Add new source
- `DELETE /api/sources/:id` - Remove source
- `GET /api/fetch-now` - Manually trigger article fetch

## Keyboard Shortcuts

- `→` (Right Arrow) - Upvote article
- `←` (Left Arrow) - Downvote article
- `↓` (Down Arrow) - Skip to next article

## Adding New Sources

Sources are easily configurable in the database. To add a new source:

1. Insert into `sources` table with appropriate `fetch_method` and `config`
2. For RSS: Provide `rss_url` in config
3. For API: Provide API details in config
4. For scraping: Provide selectors in config

Example:
```sql
INSERT INTO sources (name, url, category_id, fetch_method, config, active)
VALUES ('New Source', 'https://example.com', 1, 'rss', 
        '{"rss_url": "https://example.com/feed.xml"}', 1);
```

## Future Enhancements

- [ ] Multi-user authentication
- [ ] Mobile app (React Native)
- [ ] Email digest
- [ ] Social sharing
- [ ] Advanced ML recommendation engine
- [ ] Search functionality
- [ ] Save/bookmark articles
- [ ] Dark mode

## Design Inspiration

This project draws design inspiration from [Techmeme](https://techmeme.com) - clean, text-focused, information-dense layout.

## Contributing

This is a personal project, but suggestions and improvements are welcome!

## License

MIT

## Author

Nick Simmons ([@ndsimmons](https://github.com/ndsimmons))
