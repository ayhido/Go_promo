#!/usr/bin/env node
// Хук Claude Code: читает JSON события из stdin и отправляет его плашке.
// Никогда не блокирует Claude: любые ошибки игнорируются, выход всегда 0.
const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.CLAUDE_ISLAND_PORT) || 47321;
setTimeout(() => process.exit(0), 1500).unref();

function slimInput(input) {
  if (!input || typeof input !== 'object') return undefined;
  const out = {};
  for (const key of ['file_path', 'path', 'pattern', 'command', 'description', 'url', 'query', 'notebook_path']) {
    if (typeof input[key] === 'string') out[key] = input[key].slice(0, 300);
  }
  return out;
}

function lastAssistantText(transcriptPath) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return undefined;
    const size = fs.statSync(transcriptPath).size;
    const fd = fs.openSync(transcriptPath, 'r');
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      if (obj.type !== 'assistant') continue;
      const content = obj.message && obj.message.content;
      const text = Array.isArray(content)
        ? content.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ')
        : typeof content === 'string' ? content : '';
      if (text.trim()) return text.trim();
    }
  } catch { /* не страшно */ }
  return undefined;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let d = {};
  try { d = JSON.parse(raw); } catch { process.exit(0); }

  const evt = {
    event: d.hook_event_name,
    session: d.session_id,
    cwd: d.cwd,
    tool: d.tool_name,
    input: slimInput(d.tool_input),
    message: d.message,
    prompt: typeof d.prompt === 'string' ? d.prompt.slice(0, 300) : undefined,
    ts: Date.now(),
  };
  if (d.hook_event_name === 'Stop') {
    const text = d.last_assistant_message || lastAssistantText(d.transcript_path);
    if (text) evt.last = String(text).replace(/\s+/g, ' ').slice(0, 400);
  }

  const body = JSON.stringify(evt);
  const req = http.request(
    {
      host: '127.0.0.1', port: PORT, path: '/event', method: 'POST', timeout: 800,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    (res) => { res.resume(); res.on('end', () => process.exit(0)); },
  );
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(body);
});
