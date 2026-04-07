/* ── TCU Writing Emphasis – Frontend App ── */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  const API_URL = 'https://tcu-wac-api.tcu-wem.workers.dev/api/chat';
  // CloudFlare Worker deployed and configured

  // ── DOM refs ───────────────────────────────────────────────
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('user-input');
  const sendBtn    = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');

  // ── State ──────────────────────────────────────────────────
  let previousResponseId = null;
  let isLoading = false;

  // ── Initialize ─────────────────────────────────────────────
  function init() {
    sendBtn.addEventListener('click', handleSend);
    newChatBtn.addEventListener('click', resetChat);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    inputEl.addEventListener('input', () => {
      autoResize();
      sendBtn.disabled = inputEl.value.trim().length === 0;
    });

    // Wire up suggested-question buttons
    document.querySelectorAll('.suggestion').forEach((btn) => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.dataset.q || btn.textContent;
        sendBtn.disabled = false;
        handleSend();
      });
    });

    inputEl.focus();
  }

  // ── Textarea auto-resize ───────────────────────────────────
  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 150) + 'px';
  }

  // ── Send message ───────────────────────────────────────────
  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    // Remove welcome panel on first message
    const welcome = document.querySelector('.welcome');
    if (welcome) welcome.remove();

    appendUserMessage(text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    setLoading(true);

    try {
      const data = await callApi(text);
      appendAssistantMessage(data.text, data.citations);
      previousResponseId = data.responseId || null;
    } catch (err) {
      appendError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      inputEl.focus();
    }
  }

  // ── API call ───────────────────────────────────────────────
  async function callApi(message) {
    const body = { message };
    if (previousResponseId) body.previousResponseId = previousResponseId;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.error || `Request failed (${res.status})`);
    }

    return res.json();
  }

  // ── Render helpers ─────────────────────────────────────────
  function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML = `<div class="message-content">${escapeHtml(text)}</div>`;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function appendAssistantMessage(text, citations) {
    const div = document.createElement('div');
    div.className = 'message assistant';

    // Parse text: replace citation markers like 【4:0†source】 with numbered badges
    let htmlText = renderMarkdown(text);
    htmlText = replaceCitationMarkers(htmlText, citations);

    let inner = `<div class="message-content">${htmlText}`;

    if (citations && citations.length > 0) {
      inner += renderCitations(citations);
    }

    inner += '</div>';
    div.innerHTML = inner;

    // Wire up citation toggle
    const hdr = div.querySelector('.citations-header');
    if (hdr) {
      hdr.addEventListener('click', () => {
        hdr.classList.toggle('open');
        hdr.nextElementSibling.classList.toggle('open');
      });
    }

    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function appendError(message) {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `<div class="error-msg">${escapeHtml(message)}</div>`;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  // ── Citation marker replacement ────────────────────────────
  function replaceCitationMarkers(html, citations) {
    if (!citations || citations.length === 0) return html;

    // Match OpenAI-style markers: 【…†…】
    return html.replace(/【[^】]*†[^】]*】/g, (match) => {
      // Find which citation this refers to (by index in the match)
      const idx = findCitationIndex(match, citations);
      if (idx < 0) return '';
      return `<span class="citation-marker" title="${escapeAttr(citations[idx].filename)}">${idx + 1}</span>`;
    });
  }

  function findCitationIndex(marker, citations) {
    // Try to extract the index from the marker pattern 【index:subindex†source】
    const m = marker.match(/【(\d+)/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (idx >= 0 && idx < citations.length) return idx;
    }
    return 0; // default to first citation
  }

  // ── Render citations panel ─────────────────────────────────
  function renderCitations(citations) {
    let html = '<div class="citations">';
    html += `<div class="citations-header"><span class="arrow">▶</span> Sources (${citations.length})</div>`;
    html += '<div class="citations-list">';

    citations.forEach((c, i) => {
      const displayName = formatFilename(c.filename);
      html += `<div class="citation-card">
        <span class="citation-num">${i + 1}</span>
        <span class="citation-file">${escapeHtml(displayName)}</span>
        ${c.quote ? `<div class="citation-quote">${escapeHtml(truncate(c.quote, 300))}</div>` : ''}
      </div>`;
    });

    html += '</div></div>';
    return html;
  }

  // ── Loading indicator ──────────────────────────────────────
  function setLoading(on) {
    isLoading = on;
    sendBtn.disabled = on;

    const existing = document.getElementById('loading');
    if (existing) existing.remove();

    if (on) {
      const div = document.createElement('div');
      div.id = 'loading';
      div.className = 'message assistant';
      div.innerHTML = `<div class="message-content">
        <div class="loading-dots"><span></span><span></span><span></span></div>
      </div>`;
      messagesEl.appendChild(div);
      scrollToBottom();
    }
  }

  // ── Reset chat ─────────────────────────────────────────────
  function resetChat() {
    previousResponseId = null;
    messagesEl.innerHTML = '';
    addWelcome();
    inputEl.value = '';
    inputEl.style.height = 'auto';
    inputEl.focus();
  }

  function addWelcome() {
    const div = document.createElement('div');
    div.className = 'welcome';
    div.innerHTML = `
      <h2>Welcome to the WAC/WID Knowledge Base</h2>
      <p>Ask questions about Writing Across the Curriculum and Writing in the Disciplines scholarship — spanning decades of research from journals, book chapters, and more.</p>
      <div class="suggested-questions">
        <p class="suggestions-label">Try asking about:</p>
        <button class="suggestion">Key principles of Writing Across the Curriculum</button>
        <button class="suggestion">How are WI courses designed across disciplines?</button>
        <button class="suggestion">What does research say about peer review in writing?</button>
        <button class="suggestion">Strategies for faculty development in WAC programs</button>
      </div>`;
    messagesEl.appendChild(div);

    // Wire up suggestion buttons
    div.querySelectorAll('.suggestion').forEach((btn) => {
      btn.addEventListener('click', () => {
        inputEl.value = btn.dataset.q || btn.textContent;
        sendBtn.disabled = false;
        handleSend();
      });
    });
  }

  // ── Utilities ──────────────────────────────────────────────
  function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
      return marked.parse(text, { breaks: true });
    }
    // Fallback: simple newlines → <br>
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function formatFilename(name) {
    if (!name) return 'Unknown source';
    // Strip file extension and convert underscores/hyphens to spaces
    return name
      .replace(/\.(txt|pdf|md)$/i, '')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max) + '…';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ── Boot ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
