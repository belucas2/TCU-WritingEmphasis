/* ── TCU Writing Emphasis – Frontend App ── */

(function () {
  'use strict';

  // ── Configuration ──────────────────────────────────────────
  const API_URL = 'https://tcu-wac-api.tcu-wem.workers.dev/api/chat';
  const API_REVIEW_URL = 'https://tcu-wac-api.tcu-wem.workers.dev/api/review';
  // CloudFlare Worker deployed and configured

  // ── DOM refs ───────────────────────────────────────────────
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('user-input');
  const sendBtn    = document.getElementById('send-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  
  // Mode switcher
  const modeChatBtn = document.getElementById('mode-chat');
  const modeReviewBtn = document.getElementById('mode-review');
  
  // Review mode elements
  const fileInput = document.getElementById('file-input');
  const fileUploadArea = document.getElementById('file-upload-area');
  const fileSelected = document.getElementById('file-selected');
  const fileName = document.getElementById('file-name');
  const fileSize = document.getElementById('file-size');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const reviewBtn = document.getElementById('review-btn');
  
  // Input wrappers
  const chatInputWrapper = document.getElementById('chat-input-wrapper');
  const reviewInputWrapper = document.getElementById('review-input-wrapper');
  const disclaimerChat = document.getElementById('disclaimer-chat');
  const disclaimerReview = document.getElementById('disclaimer-review');
  
  // Welcome messages
  const welcomeChat = document.querySelector('.welcome-chat');
  const welcomeReview = document.querySelector('.welcome-review');

  // ── State ──────────────────────────────────────────────────
  let previousResponseId = null;
  let isLoading = false;
  let currentMode = 'chat';
  let selectedFile = null;

  // ── Initialize ─────────────────────────────────────────────
  function init() {
    // Chat mode listeners
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
    
    // Mode switcher
    modeChatBtn.addEventListener('click', () => switchMode('chat'));
    modeReviewBtn.addEventListener('click', () => switchMode('review'));
    
    // File upload listeners
    fileUploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelection);
    removeFileBtn.addEventListener('click', clearSelectedFile);
    reviewBtn.addEventListener('click', handleReview);
    
    // Drag and drop
    fileUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileUploadArea.classList.add('drag-over');
    });
    fileUploadArea.addEventListener('dragleave', () => {
      fileUploadArea.classList.remove('drag-over');
    });
    fileUploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      fileUploadArea.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    });

    inputEl.focus();
  }
  
  // ── Mode Switching ─────────────────────────────────────────
  function switchMode(mode) {
    currentMode = mode;
    
    // Update mode buttons
    modeChatBtn.classList.toggle('active', mode === 'chat');
    modeReviewBtn.classList.toggle('active', mode === 'review');
    
    // Show/hide input areas
    chatInputWrapper.style.display = mode === 'chat' ? 'flex' : 'none';
    reviewInputWrapper.style.display = mode === 'review' ? 'flex' : 'none';
    disclaimerChat.style.display = mode === 'chat' ? 'block' : 'none';
    disclaimerReview.style.display = mode === 'review' ? 'block' : 'none';
    
    // Show/hide welcome messages
    welcomeChat.style.display = mode === 'chat' ? 'block' : 'none';
    welcomeReview.style.display = mode === 'review' ? 'block' : 'none';
    
    // Clear existing messages (except welcome)
    const messages = messagesEl.querySelectorAll('.message:not(.welcome-chat):not(.welcome-review)');
    messages.forEach(msg => msg.remove());
    
    // Reset state
    previousResponseId = null;
    selectedFile = null;
    clearSelectedFile();
    
    if (mode === 'chat') {
      inputEl.focus();
    }
  }
  
  // ── File Handling ──────────────────────────────────────────
  function handleFileSelection(e) {
    const file = e.target.files[0];
    if (file) {
      handleFile(file);
    }
  }
  
  function handleFile(file) {
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const allowedExts = ['.pdf', '.docx', '.txt'];
    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedTypes.includes(file.type) && !allowedExts.includes(fileExt)) {
      alert('Please upload a PDF, Word document (.docx), or text file (.txt)');
      return;
    }
    
    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size must be less than 10MB');
      return;
    }
    
    selectedFile = file;
    
    // Update UI
    fileUploadArea.style.display = 'none';
    fileSelected.style.display = 'flex';
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    reviewBtn.disabled = false;
  }
  
  function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = '';
    fileUploadArea.style.display = 'block';
    fileSelected.style.display = 'none';
    reviewBtn.disabled = true;
  }
  
  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
    const welcome = document.querySelector('.welcome-chat');
    if (welcome) welcome.style.display = 'none';

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
  
  // ── Handle Syllabus Review ─────────────────────────────────
  async function handleReview() {
    if (!selectedFile || isLoading) return;
    
    // Hide welcome message
    welcomeReview.style.display = 'none';
    
    // Show upload confirmation
    appendUserMessage(`Uploaded: ${selectedFile.name}`);
    setLoading(true);
    
    try {
      const data = await callReviewApi(selectedFile);
      appendAssistantMessage(data.text, data.citations || []);
    } catch (err) {
      appendError(err.message || 'Failed to analyze syllabus. Please try again.');
    } finally {
      setLoading(false);
      clearSelectedFile();
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
  
  // ── Review API call ────────────────────────────────────────
  async function callReviewApi(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch(API_REVIEW_URL, {
      method: 'POST',
      body: formData,
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
    selectedFile = null;
    
    // Clear all messages except welcome messages
    const messages = messagesEl.querySelectorAll('.message:not(.welcome-chat):not(.welcome-review)');
    messages.forEach(msg => msg.remove());
    
    // Show appropriate welcome message
    welcomeChat.style.display = currentMode === 'chat' ? 'block' : 'none';
    welcomeReview.style.display = currentMode === 'review' ? 'block' : 'none';
    
    // Reset inputs
    inputEl.value = '';
    inputEl.style.height = 'auto';
    clearSelectedFile();
    
    if (currentMode === 'chat') {
      inputEl.focus();
    }
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
