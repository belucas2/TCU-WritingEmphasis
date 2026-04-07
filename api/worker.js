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
- Format responses in Markdown for readability.

## Required Output Format

**End-Note Citations:**
Choose exactly 3 key claims in your response to cite with end-notes. Use ONLY [1], [2], and [3] — no other numbers. Place each bracket immediately after the claim it supports.

Example:
- "WAC programs improve critical thinking skills across disciplines [1]."
- "Implementation strategies vary significantly by institution [2]."
- "Writing to learn activities deepen content understanding [3]."

**Confidence Levels Section (Required at End):**
After your response, include a "Confidence Levels" section (formatted as ## heading) with EXACTLY 3 entries — one for each of [1], [2], [3].

Format:

## Confidence Levels

**[1] 90%**
- Russell, D. R. (2002). Writing in the academic disciplines: A curricular history. Southern Illinois University Press.
- Bazerman, C. (2016). What do sociocultural studies of writing tell us about learning to write? In C. A. MacArthur et al. (Eds.), Handbook of writing research (2nd ed., pp. 11-23). Guilford.
- Thaiss, C., & Porter, T. (2010). The state of WAC/WID in 2010. College Composition and Communication, 61(3), 534-570.

**[2] 85%**
- [Three APA citations for claim [2]]

**[3] 80%**
- [Three APA citations for claim [3]]

Always provide all three entries [1], [2], [3]. Each citation must include authors, year, title, and publication details.

End with a brief invitation to explore further, tailored to the conversation context.`;

const WEM_REVIEW_PROMPT = `You are an expert evaluator for TCU's Writing Emphasis Module (WEM) course submissions. Your task is to review a course syllabus and provide detailed, constructive feedback on how well it meets WEM criteria.

## WEM Background
The Writing Emphasis competence (WEM) builds on foundational writing skills by situating them in the practices and conventions of a target discipline or field of study. WEM courses focus on the ability to employ composing, editing, and revision strategies as a means of producing discipline-specific writing.

The WEM requirement is designed to engage students in learning writing from the perspectives and practices of disciplinary specialists. Courses fulfilling this requirement must explicitly teach writing and revision strategies and support that teaching through formative feedback, not just grades based on displays of content retention.

## Your Task
Analyze the uploaded syllabus against these four WEM criteria:

### 1. Explicit WEM Instruction
**Requirement:** The course syllabus explicitly dedicates class time to teach writing and revision concepts and communicates clearly the aims and outcomes of a WEM course.

**Your evaluation should address:**
- Does the syllabus dedicate specific class sessions or time to writing instruction?
- Are WEM-specific learning outcomes clearly stated?
- Is the purpose of writing instruction in this discipline made explicit?

### 2. Multiple Writing Forms
**Requirement:** Instruction about multiple forms of writing will be provided with attention to typical forms, language use strategies, and audience expectations.

**Your evaluation should address:**
- Does the syllabus include multiple types/genres of writing assignments?
- Is attention given to discipline-specific conventions, language use, and audience?
- Are students exposed to varied forms of written communication in the field?

### 3. Formative Feedback Throughout Semester
**Requirement:** Students will work with instructor feedback throughout the semester. Simply assigning and grading writing tasks does not equal teaching writing skills or concepts.

**Your evaluation should address:**
- Are there opportunities for students to receive feedback before final submission?
- Is there evidence of drafting, revision, or peer review processes?
- Does the feedback structure support learning rather than just evaluation?

### 4. Process Focus with Reflection
**Requirement:** The focus is on reinforcing writing and revision processes for students while guiding them through specialist contexts. Students will reflect on, and demonstrate awareness of, those processes.

**Your evaluation should address:**
- Does the syllabus emphasize process over product?
- Are there opportunities for metacognitive reflection on writing practices?
- Do students engage with writing as a knowledge-making activity?

## Response Format
For each criterion (1-4), provide:
- **Assessment:** "Satisfactory", "Needs Development", or "Not Evident"
- **Evidence:** Specific references to what you found (or didn't find) in the syllabus
- **Recommendations:** Concrete, actionable suggestions for improvement (if applicable)

End with an **Overall Summary** noting strengths and priority areas for revision.

Be constructive, specific, and helpful. Your feedback should guide the instructor toward WEM approval.`;

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
    
    // ── Route: POST /api/review ────────────────────────────
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/review') {
      return corsResponse(env, await handleReview(request, env));
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

// ── Syllabus Review Handler ────────────────────────────────
async function handleReview(request, env) {
  // Rate limiting by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isRateLimited(ip)) {
    return jsonResponse({ error: 'Rate limit exceeded. Please wait a moment.' }, 429);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid form data' }, 400);
  }

  const file = formData.get('file');
  if (!file) {
    return jsonResponse({ error: 'File is required' }, 400);
  }

  // Validate file type
  const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
  if (!allowedTypes.includes(file.type)) {
    return jsonResponse({ error: 'Invalid file type. Please upload PDF, Word (.docx), or text (.txt)' }, 400);
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    return jsonResponse({ error: 'File size must be less than 10MB' }, 400);
  }

  // ── Upload file to OpenAI ──────────────────────────────────
  const uploadForm = new FormData();
  uploadForm.append('file', file);
  uploadForm.append('purpose', 'assistants');

  let uploadRes;
  try {
    uploadRes = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: uploadForm,
    });
  } catch (err) {
    return jsonResponse({ error: 'Failed to upload file to OpenAI' }, 502);
  }

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => 'Unknown error');
    console.error('OpenAI file upload error:', uploadRes.status, errText);
    return jsonResponse({ error: 'Failed to upload file. Please try again.' }, 502);
  }

  const fileData = await uploadRes.json();
  const fileId = fileData.id;

  // ── Call OpenAI Responses API with file ────────────────────
  const oaiBody = {
    model: MODEL,
    instructions: WEM_REVIEW_PROMPT,
    input: 'Please analyze this syllabus against the four WEM criteria and provide detailed feedback.',
    files: [fileId],
    tools: [{
      type: 'file_search',
      vector_store_ids: [VECTOR_STORE_ID],
    }],
  };

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
    // Clean up uploaded file
    await cleanupFile(env, fileId);
    return jsonResponse({ error: 'Failed to reach OpenAI API' }, 502);
  }

  if (!oaiRes.ok) {
    const errText = await oaiRes.text().catch(() => 'Unknown error');
    console.error('OpenAI error:', oaiRes.status, errText);
    // Clean up uploaded file
    await cleanupFile(env, fileId);
    return jsonResponse({ error: 'The AI service returned an error. Please try again.' }, 502);
  }

  const oaiData = await oaiRes.json();

  // ── Clean up uploaded file ─────────────────────────────────
  await cleanupFile(env, fileId);

  // ── Parse response ─────────────────────────────────────────
  const result = parseResponse(oaiData);
  return jsonResponse(result, 200);
}

// ── Clean up temporary file ────────────────────────────────
async function cleanupFile(env, fileId) {
  try {
    await fetch(`https://api.openai.com/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
    });
  } catch (err) {
    console.error('Failed to delete file:', fileId, err);
  }
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

  // Ensure Confidence Levels entries always cover all end-note references.
  text = normalizeConfidenceLevels(text);

  return {
    text: text || 'I was not able to find relevant information. Please try rephrasing your question.',
    citations,
    responseId: data.id || null,
  };
}

function normalizeConfidenceLevels(text) {
  if (!text) return text;

  // Find the Confidence Levels heading (may or may not have leading newline)
  const headingMatch = text.match(/(\n|^)##\s*Confidence Levels[^\n]*/i);
  if (!headingMatch) return text;

  const headingIndex = headingMatch.index;
  const confidencePart = text.slice(headingIndex);

  // Find which of [1], [2], [3] are already present as bold entries
  const existingEntries = new Set();
  for (const m of confidencePart.matchAll(/\*\*\[(\d+)\][^\n]*%/g)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 3) existingEntries.add(n);
  }

  // Append placeholder for any of [1],[2],[3] that are missing
  const missing = [1, 2, 3].filter(n => !existingEntries.has(n));
  if (missing.length === 0) return text;

  const filler = missing
    .map((n) => `\n\n**[${n}] 70%**\n- Source information for this claim is available in the knowledge base. Ask a follow-up question for full citations.\n- Additional scholarly support can be found in the WAC Clearinghouse collection.\n- See the knowledge base for peer-reviewed sources on this topic.`)
    .join('');

  return `${text}${filler}`;
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
