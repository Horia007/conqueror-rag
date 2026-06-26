# Conqueror RAG

A minimal RAG (Retrieval-Augmented Generation) chat app. It answers questions
about [The Conqueror](https://help.theconqueror.events) using only the content
of their help center, retrieved from a vector database and grounded with Claude.

## How it works

```
help center URLs (urls.txt)
        │
        ▼  scripts/ingest.ts        ← one-off ingestion
  Upstash Vector  (text chunks + embeddings)
        │
        ▼  POST /api/chat           ← retrieval + streaming
   Claude (Anthropic)
        │
        ▼
   Chat UI (streamed Markdown answers with sources)
```

- **Frontend:** Next.js (App Router) + Tailwind CSS. The chat UI lives in
  [`components/chat.tsx`](components/chat.tsx); assistant replies are rendered as
  Markdown by [`components/markdown-message.tsx`](components/markdown-message.tsx).
- **API:** [`app/api/chat/route.ts`](app/api/chat/route.ts) takes the latest user
  message, queries Upstash Vector for relevant help-center chunks, injects them
  into the system prompt, and streams the answer with the Vercel AI SDK.
- **Ingestion:** [`scripts/ingest.ts`](scripts/ingest.ts) fetches each URL in
  `urls.txt`, extracts the article text, chunks it, and upserts it into Upstash
  Vector (which generates embeddings via its built-in model).

## Tech stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Vercel AI SDK (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`) — model `claude-sonnet-4-6`
- Upstash Vector (`@upstash/vector`) for retrieval
- Tailwind CSS v4
- `cheerio` for HTML parsing during ingestion

## Prerequisites

- Node.js 20+
- An [Anthropic](https://console.anthropic.com) API key
- An [Upstash Vector](https://console.upstash.com) index **created with an
  embedding model** (the ingestion sends raw text, not vectors)

## Environment variables

Copy the example file and fill in your keys:

```bash
cp .env.local.example .env.local
```

| Variable | Used by | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `/api/chat` | Anthropic API key (server-only) |
| `UPSTASH_VECTOR_REST_URL` | `/api/chat`, ingest | Upstash Vector REST URL |
| `UPSTASH_VECTOR_REST_TOKEN` | `/api/chat`, ingest | Upstash Vector REST token |

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Ingesting content

Populate the vector index from the URLs in `urls.txt`:

```bash
npm run ingest
```

Re-running is safe: each chunk has a stable id (`<article-slug>--<n>`), so an
upsert updates existing rows instead of duplicating them.

## Build & lint

```bash
npm run build   # production build
npm run lint    # eslint
```

> There are no automated tests in this project.

## Deploy

Deploys to [Vercel](https://vercel.com) as a standard Next.js app. Add the three
environment variables above in **Project Settings → Environment Variables**, then
redeploy (env vars are not applied to existing deployments automatically). The
Anthropic and Upstash clients run server-side only.
