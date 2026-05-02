/**
 * Minimal embedded chat UI served at `GET /`.
 *
 * Plain HTML + CSS + fetch — no build step, no framework. Streams from
 * `POST /chat` via SSE so tool calls, tool results, and assistant text
 * all arrive live. Persists `threadId` + `preset` in localStorage.
 * Edit this in-place, or delete it and point your own frontend at
 * `POST /chat` (it accepts `text/event-stream`).
 */
export const CHAT_UI = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>copass-agent</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      max-width: 760px; margin: 0 auto; padding: 1.5rem 1rem;
      background: #fafafa; color: #111;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0b0d10; color: #e7e9ea; }
      .msg.assistant { background: #1a1d21; border-color: #2a2d31; }
      .msg.user { background: #264873; color: #e7f1ff; }
      .msg.error { background: #3a1515; color: #ffb3b3; }
      #log { background: #14171a; border-color: #23272b; }
      input[type=text] { background: #14171a; color: inherit; border-color: #2a2d31; }
      #meta { color: #777; }
      #meta button { background: #1a1d21; color: #ccc; border-color: #2a2d31; }
    }
    header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; }
    header h1 { font-size: 1rem; margin: 0; font-weight: 600; }
    header .hint { font-size: 0.75rem; color: #888; }
    #log {
      border: 1px solid #e1e4e8; border-radius: 10px; padding: 1rem;
      height: 60vh; overflow-y: auto; background: white;
    }
    #log:empty::before {
      content: "Ask anything about your Copass knowledge graph.";
      color: #999; font-style: italic;
    }
    .msg { margin: 0 0 0.6rem; padding: 0.55rem 0.8rem; border-radius: 8px;
           max-width: 85%; white-space: pre-wrap; word-wrap: break-word; line-height: 1.45; }
    .msg.user { background: #e0efff; margin-left: auto; border-bottom-right-radius: 2px; }
    .msg.assistant { background: #fff; border: 1px solid #eaeaea; border-bottom-left-radius: 2px; }
    .msg.error { background: #ffe8e8; color: #a00; font-style: italic; border: 1px solid #fcc; }
    .tool {
      margin: 0.35rem 0; padding: 0.45rem 0.7rem;
      border: 1px solid #d8dde3; border-radius: 6px;
      background: #f5f7fa; max-width: 85%;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.8rem;
    }
    .tool summary {
      cursor: pointer; list-style: none; user-select: none;
      display: flex; justify-content: space-between; gap: 0.5rem;
    }
    .tool summary::-webkit-details-marker { display: none; }
    .tool .name { font-weight: 600; color: #0550ae; }
    .tool .status { color: #6a737d; font-weight: 400; }
    .tool .status.done { color: #22863a; }
    .tool .status.err { color: #a00; }
    .tool .args, .tool .result {
      margin-top: 0.4rem; padding-top: 0.4rem;
      border-top: 1px dashed #d8dde3;
      white-space: pre-wrap; word-break: break-word;
    }
    .tool .args-label, .tool .result-label {
      font-size: 0.7rem; color: #6a737d; text-transform: uppercase;
      letter-spacing: 0.04em; margin-bottom: 0.2rem;
    }
    @media (prefers-color-scheme: dark) {
      .tool { background: #14171a; border-color: #2a2d31; color: #d1d5da; }
      .tool .name { color: #79b8ff; }
      .tool .status { color: #8b949e; }
      .tool .status.done { color: #85e89d; }
      .tool .args, .tool .result { border-top-color: #2a2d31; }
      .tool .args-label, .tool .result-label { color: #8b949e; }
    }
    form { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
    input[type=text] {
      flex: 1; padding: 0.7rem 0.9rem;
      border: 1px solid #cdd1d6; border-radius: 8px; font: inherit;
      background: white; color: inherit;
    }
    button {
      padding: 0.7rem 1.1rem; border: 0; border-radius: 8px;
      background: #0969da; color: white; font: inherit; cursor: pointer;
      font-weight: 500;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #meta {
      display: flex; justify-content: space-between; align-items: center;
      margin-top: 0.6rem; font-size: 0.73rem; color: #666;
    }
    #meta button {
      padding: 0.2rem 0.55rem; font-size: 0.73rem; font-weight: normal;
      background: #eee; color: #333; border: 1px solid #ddd;
    }
    #preset-row {
      display: flex; align-items: center; gap: 0.5rem;
      margin-bottom: 0.5rem; font-size: 0.8rem; color: #555;
    }
    #preset-row label { white-space: nowrap; }
    #preset {
      flex: 1; padding: 0.4rem 0.55rem;
      border: 1px solid #cdd1d6; border-radius: 6px; font: inherit;
      background: white; color: inherit;
    }
    @media (prefers-color-scheme: dark) {
      #preset-row { color: #aaa; }
      #preset { background: #14171a; color: inherit; border-color: #2a2d31; }
    }
  </style>
</head>
<body>
  <header>
    <h1>copass-agent</h1>
    <span class="hint">POST /chat · SSE · thread-aware via Context Window</span>
  </header>
  <div id="preset-row">
    <label for="preset">preset</label>
    <select id="preset">
      <option value="">agent (default)</option>
      <option value="discover+interpret">discover + interpret</option>
      <option value="search">search (copass/1.0)</option>
      <option value="search:thinking">search (copass/1.0:thinking)</option>
      <option value="search-2.0">search (copass/2.0)</option>
      <option value="search-2.0:thinking">search (copass/2.0:thinking)</option>
    </select>
  </div>
  <div id="log"></div>
  <form id="f">
    <input type="text" id="i" placeholder="Ask about your knowledge graph…" autofocus autocomplete="off" required />
    <button type="submit" id="b">Send</button>
  </form>
  <div id="meta">
    <span>thread: <span id="tid">new</span></span>
    <button type="button" id="reset">New thread</button>
  </div>
  <script>
    const log = document.getElementById('log');
    const form = document.getElementById('f');
    const input = document.getElementById('i');
    const btn = document.getElementById('b');
    const tidSpan = document.getElementById('tid');
    const resetBtn = document.getElementById('reset');
    const presetSel = document.getElementById('preset');
    const KEY = 'copass:threadId';
    const PRESET_KEY = 'copass:preset';

    presetSel.value = localStorage.getItem(PRESET_KEY) || '';
    presetSel.addEventListener('change', () => {
      if (presetSel.value) localStorage.setItem(PRESET_KEY, presetSel.value);
      else localStorage.removeItem(PRESET_KEY);
    });

    function add(role, content) {
      const div = document.createElement('div');
      div.className = 'msg ' + role;
      div.textContent = content;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }
    function getTid() { return localStorage.getItem(KEY); }
    function setTid(tid) {
      if (tid) localStorage.setItem(KEY, tid);
      else localStorage.removeItem(KEY);
      tidSpan.textContent = tid ? tid.slice(0, 16) + '…' : 'new';
    }
    setTid(getTid());

    resetBtn.addEventListener('click', () => {
      setTid(null);
      log.innerHTML = '';
      input.focus();
    });

    function renderToolCall(id, name, input) {
      const details = document.createElement('details');
      details.className = 'tool';
      details.dataset.id = id || '';
      details.innerHTML =
        '<summary>' +
          '<span><span class="name">' + (name || '?') + '</span> ' +
          '<span class="status">running…</span></span>' +
          '<span style="color:#888;font-size:0.7rem">click to expand</span>' +
        '</summary>' +
        '<div class="args-label">args</div>' +
        '<div class="args"></div>';
      details.querySelector('.args').textContent = JSON.stringify(input, null, 2);
      log.appendChild(details);
      log.scrollTop = log.scrollHeight;
      return details;
    }

    function completeToolCall(id, name, output) {
      let node = id ? log.querySelector('.tool[data-id="' + id + '"]') : null;
      if (!node) {
        const all = log.querySelectorAll('.tool');
        node = all[all.length - 1];
      }
      if (!node) return;
      const status = node.querySelector('.status');
      if (status) { status.textContent = 'done'; status.className = 'status done'; }
      const nameEl = node.querySelector('.name');
      if (nameEl && name && !nameEl.textContent) nameEl.textContent = name;
      const resultLabel = document.createElement('div');
      resultLabel.className = 'result-label';
      resultLabel.textContent = 'result';
      const resultDiv = document.createElement('div');
      resultDiv.className = 'result';
      const str = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
      resultDiv.textContent = str.length > 4000 ? str.slice(0, 4000) + '\\n… (' + (str.length - 4000) + ' more chars)' : str;
      node.appendChild(resultLabel);
      node.appendChild(resultDiv);
    }

    async function streamChat(message) {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          message,
          threadId: getTid() || undefined,
          preset: presetSel.value || undefined,
        }),
      });
      if (!res.ok || !res.body) {
        let err = 'request failed';
        try { const j = await res.json(); err = j.error || err; } catch {}
        throw new Error(err);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answerBubble = null;
      let answerText = '';
      let gotError = null;

      function ensureAnswerBubble() {
        if (!answerBubble) answerBubble = add('assistant', '');
        return answerBubble;
      }

      function handleFrame(event, dataStr) {
        let data;
        try { data = dataStr ? JSON.parse(dataStr) : {}; } catch { data = {}; }
        if (event === 'meta') {
          if (data.threadId) setTid(data.threadId);
        } else if (event === 'tool-call') {
          renderToolCall(data.id, data.name, data.input);
        } else if (event === 'tool-result') {
          completeToolCall(data.id, data.name, data.output);
        } else if (event === 'text') {
          answerText += data.delta || '';
          ensureAnswerBubble().textContent = answerText;
          log.scrollTop = log.scrollHeight;
        } else if (event === 'error') {
          gotError = data.error || 'stream error';
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\\n\\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (!frame.trim()) continue;
          let ev = 'message', data = '';
          for (const line of frame.split('\\n')) {
            if (line.startsWith('event: ')) ev = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += (data ? '\\n' : '') + line.slice(6);
          }
          handleFrame(ev, data);
        }
      }

      if (gotError) throw new Error(gotError);
      if (!answerText) ensureAnswerBubble().textContent = '(no content)';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = input.value.trim();
      if (!message) return;
      add('user', message);
      input.value = '';
      btn.disabled = true;

      try {
        await streamChat(message);
      } catch (err) {
        add('error', 'Error: ' + (err && err.message || err));
      } finally {
        btn.disabled = false;
        input.focus();
      }
    });
  </script>
</body>
</html>
`;
