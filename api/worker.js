/**
 * TCU Writing Emphasis – API Proxy (Cloudflare Worker)
 *
 * Proxies chat requests to the OpenAI Responses API with file_search
 * against the WAC/WID vector store, and returns structured JSON
 * with text + citations.
 *
 * Environment secrets (set via `wrangler secret put`):
 *   OPENAI_API_KEY – your OpenAI API key
 *
 * Environment variables (set in wrangler.toml):
 *   ALLOWED_ORIGIN – your GitHub Pages URL (e.g. https://yourusername.github.io)
 */

const VECTOR_STORE_ID = 'vs_69c9b064bf2081919edb5702601a0d94';
const MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `You are the TCU Writing Emphasis Knowledge Base assistant, an expert on Writing Across the Curriculum (WAC) and Writing in the Disciplines (WID) pedagogy.

When answering questions:
- Draw on the knowledge base to provide evidence-based, scholarly responses.
- Cite specific sources (author, year, title) whenever you reference scholarship.
- Present the range of perspectives found in the literature.
- If a question falls outside the knowledge base, say so clearly.
- Be concise but thorough. Prefer concrete examples from the sources.
- Format responses in Markdown for readability.`;

// Simple in-memory rate limiter (per-isolate, resets on redeploy)
const rateBuckets = new Map();
const RATE_LIMIT = 20;       // requests
const RATE_WINDOW = 60_000;  // per 60 seconds

export default {
  async fetch(request, env) {
    // ── CORS preflight ─────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(env, new Response(null, { status: 204 }));
    }

    // ── Route: POST /api/chat ──────────────────────────────
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/chat') {
      return corsResponse(env, await handleChat(request, env));
    }

    // ── Health check ───────────────────────────────────────
    if (request.method === 'GET' && new URL(request.url).pathname === '/') {
      return corsResponse(env, new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }

    return corsResponse(env, new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));
  },
};

// ── Main handler ───────────────────────────────────────────
async function handleChat(request, env) {
  // Rate limiting by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded. Please wait a moment.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { message, previousResponseId } = body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return jsonResponse({ error: 'Message is required' }, 400);
  }

  if (message.length > 2000) {
    return jsonResponse({ error: 'Message too long (max 2000 characters)' }, 400);
  }

  // ── Call OpenAI Responses API ────────────────────────────
  const oaiBody = {
    model: MODEL,
    instructions: SYSTEM_PROMPT,
    input: message.trim(),
    tools: [{
      type: 'file_search',
      vector_store_ids: [VECTOR_STORE_ID],
    }],
  };
  if (previousResponseId) {
    oaiBody.previous_response_id = previousResponseId;
  }

  let oaiRes;
  try {
    oaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(oaiBody),
    });
  } catch (err) {
    return jsonResponse({ error: 'Failed to reach OpenAI API' }, 502);
  }

  if (!oaiRes.ok) {
    const errText = await oaiRes.text().catch(() => 'Unknown error');
    console.error('OpenAI error:', oaiRes.status, errText);
    return jsonResponse({ error: 'The AI service returned an error. Please try again.' }, 502);
  }

  const oaiData = await oaiRes.json();

  // ── Parse response ───────────────────────────────────────
  const result = parseResponse(oaiData);
  return jsonResponse(result, 200);
}

// ── Parse the Responses API output ─────────────────────────
function parseResponse(data) {
  let text = '';
  const citations = [];
  const seenFiles = new Set();

  for (const item of data.output || []) {
    if (item.type === 'message' && item.content) {
      for (const block of item.content) {
        if (block.type === 'output_text') {
          text += block.text;

          // Collect file citations from annotations
          for (const ann of block.annotations || []) {
            if (ann.type === 'file_citation' && ann.file_citation) {
              const fc = ann.file_citation;
              const key = fc.file_id || fc.filename;
              if (!seenFiles.has(key)) {
                seenFiles.add(key);
                citations.push({
                  filename: fc.filename || 'Unknown',
                  quote: fc.quote || '',
                  fileId: fc.file_id || null,
                });
              }
            }
          }
        }
      }
    }
  }

  return {
    text: text || 'I was not able to find relevant information. Please try rephrasing your question.',
    citations,
    responseId: data.id || null,
  };
}

// ── Rate limiter ───────────────────────────────────────────
function isRateLimited(ip) {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_WINDOW) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT;
}

// ── Helpers ────────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsResponse(env, response) {
  const origin = env.ALLOWED_ORIGIN || '*';
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
