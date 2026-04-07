# TCU Writing Emphasis — WAC/WID Knowledge Base

A public-facing chat interface for querying the WAC/WID scholarly knowledge base (3,926 indexed documents spanning journal articles and book chapters).

## Architecture

```
┌─────────────────────────┐       ┌──────────────────────────┐
│   GitHub Pages          │       │  Cloudflare Worker       │
│   (static frontend)     │──────▶│  (API proxy)             │
│                         │       │                          │
│  index.html             │       │  POST /api/chat          │
│  style.css              │       │  ↓                       │
│  app.js                 │       │  OpenAI Responses API    │
│                         │       │  + file_search           │
└─────────────────────────┘       │  (vector store)          │
                                  └──────────────────────────┘
```

- **Frontend**: Vanilla HTML/CSS/JS on GitHub Pages — no build step
- **Backend**: Cloudflare Worker — proxies requests to OpenAI, keeps API key secret
- **AI**: OpenAI Responses API with `file_search` against a vector store of 3,926 WAC/WID documents
- **Model**: `gpt-4o` (configurable in `api/worker.js`)

## Setup

### 1. Deploy the Frontend (GitHub Pages)

1. Push this repository to GitHub.
2. Go to **Settings → Pages** in your repository.
3. Set source to **Deploy from a branch** → `main` → `/ (root)`.
4. Your site will be live at `https://<username>.github.io/TCU-WritingEmphasis/`.

### 2. Deploy the Backend (Cloudflare Worker)

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
# Install the Wrangler CLI
npm install -g wrangler

# Log in to Cloudflare
wrangler login

# Navigate to the api directory
cd api

# Set your OpenAI API key as a secret
npx wrangler secret put OPENAI_API_KEY
# Paste your key when prompted

# Deploy the worker
npx wrangler deploy
```

After deploying, Wrangler will print the worker URL (e.g., `https://tcu-wac-api.<subdomain>.workers.dev`).

### 3. Connect Frontend to Backend

1. Open `app.js` and update the `API_URL` constant on line 7 to your worker URL:
   ```js
   const API_URL = 'https://tcu-wac-api.YOUR_SUBDOMAIN.workers.dev/api/chat';
   ```
2. Open `api/wrangler.toml` and update `ALLOWED_ORIGIN` to your GitHub Pages URL:
   ```toml
   ALLOWED_ORIGIN = "https://YOUR_USERNAME.github.io"
   ```
3. Redeploy the worker: `cd api && npx wrangler deploy`
4. Push the updated `app.js` to GitHub.

## Local Development

To test the frontend locally, just open `index.html` in a browser or use a local server:

```bash
# Python
python -m http.server 8000

# Node.js
npx serve .
```

To test the worker locally:

```bash
cd api
npx wrangler dev
```

## Configuration

| Setting | File | Description |
|---------|------|-------------|
| `API_URL` | `app.js` | Worker endpoint URL |
| `MODEL` | `api/worker.js` | OpenAI model (`gpt-4o`, `gpt-4o-mini`, etc.) |
| `VECTOR_STORE_ID` | `api/worker.js` | OpenAI vector store ID |
| `SYSTEM_PROMPT` | `api/worker.js` | AI personality and instructions |
| `ALLOWED_ORIGIN` | `api/wrangler.toml` | CORS origin for the frontend |
| `RATE_LIMIT` | `api/worker.js` | Max requests per IP per minute (default: 20) |

## Costs

- **GitHub Pages**: Free
- **Cloudflare Workers Free Tier**: 100,000 requests/day
- **OpenAI API**: Pay-per-use (~$2.50/1M input tokens, ~$10/1M output tokens for gpt-4o)

## License

MIT
