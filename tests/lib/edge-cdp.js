/* edge-cdp.js — мини-обвязка headless Edge по CDP для сквозных тестов и визуального QA.
   Без зависимостей: глобальный WebSocket (Node 22+) и fetch. Лежит в tests/lib/, поэтому
   `node --test "tests/*.test.js"` её как тест не запускает.
     const edge = await launchEdge();          // свой временный профиль, порт отладки 0
     const page = await edge.open(url, {width, height});
     await page.eval('1+1')                    // Runtime.evaluate, awaitPromise, по значению
     await page.shot(file)                     // PNG
     await edge.close();                       // процесс + профиль */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const EDGE_PATHS = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

function edgePath() { return EDGE_PATHS.find((p) => fs.existsSync(p)) || null; }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, ms, what) {
  const until = Date.now() + (ms || 15000);
  let last;
  while (Date.now() < until) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(100);
  }
  throw new Error('не дождался: ' + (what || 'условие') + (last instanceof Error ? ' (' + last.message + ')' : ''));
}

class Page {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.wait = new Map(); this.logs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (m.id && this.wait.has(m.id)) {
        const { res, rej } = this.wait.get(m.id); this.wait.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.logs.push('EXC ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.logs.push('ERR ' + m.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' '));
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.wait.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('в странице: ' + (d.exception && d.exception.description ? d.exception.description : d.text));
    }
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async size(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function launchEdge() {
  const exe = edgePath();
  if (!exe) throw new Error('Edge не найден');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'homyak-edge-'));
  const proc = cp.spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(prof, 'DevToolsActivePort');
  let port;
  try {
    port = await waitFor(() => fs.existsSync(portFile) && parseInt(fs.readFileSync(portFile, 'utf8').split('\n')[0], 10), 20000, 'порт отладки Edge');
  } catch (e) {
    // Edge не поднялся - не оставляем висящий процесс и папку профиля
    try { proc.kill(); } catch (x) {}
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (x) {}
    throw e;
  }
  const base = 'http://127.0.0.1:' + port;
  const pages = [];
  return {
    port,
    async open(url, o) {
      o = o || {};
      const t = await (await fetch(base + '/json/new?about:blank', { method: 'PUT' })).json();
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
      const p = new Page(ws);
      pages.push(p);
      await p.send('Runtime.enable');
      await p.send('Page.enable');
      await p.size(o.width || 412, o.height || 840);
      if (o.dark !== undefined) {
        await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: o.dark ? 'dark' : 'light' }] });
      }
      await p.goto(url);
      return p;
    },
    async close() {
      pages.forEach((p) => p.close());
      const exited = new Promise((res) => { if (proc.exitCode !== null) res(); else proc.once('exit', res); });
      try { proc.kill(); } catch (e) {}
      await Promise.race([exited, sleep(5000)]);
      // на Windows папка профиля освобождается не сразу после выхода процесса
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(prof, { recursive: true, force: true }); break; } catch (e) { await sleep(300); }
      }
    }
  };
}

// статика папки (или карты путь → функция-содержимое) на свободном порту
function serveStatic(root, extra) {
  const http = require('node:http');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  const srv = http.createServer((req, res) => {
    let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { p = '/'; }
    if (p === '/') p = '/index.html';
    if (extra && extra[p]) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain', 'Cache-Control': 'no-store' });
      return res.end(extra[p]());
    }
    if (!root) { res.writeHead(404); return res.end(); }
    const f = path.join(root, p);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, () => resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) })));
}

function freePort() {
  const net = require('node:net');
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

module.exports = { edgePath, launchEdge, serveStatic, freePort, waitFor, sleep };
