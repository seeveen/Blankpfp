// Servidor de PREVIEW: roda o editor + a API real (lib/handlers.js) com um banco em memória.
// Não precisa de MongoDB nem de Next.js:  npm run preview:fake   ->  http://localhost:3100
// Os dados somem quando o servidor é fechado.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandlers } from '../lib/handlers.js';
import { createFakeDb } from './fake-db.js';
import { STUDIO_HTML } from '../components/studioHtml.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const ROUTES = [
  [/^\/api\/visit$/, { GET: 'visit', POST: 'visit' }],
  [/^\/api\/auth\/register$/, { POST: 'register' }],
  [/^\/api\/auth\/login$/, { POST: 'login' }],
  [/^\/api\/auth\/logout$/, { POST: 'logout' }],
  [/^\/api\/auth\/me$/, { GET: 'me' }],
  [/^\/api\/prefs$/, { POST: 'prefs' }],
  [/^\/api\/library$/, { GET: 'libraryList', POST: 'libraryCreate' }],
  [/^\/api\/library\/([a-f0-9]+)$/, { GET: 'libraryGet', PATCH: 'libraryRename', DELETE: 'libraryDelete' }],
  [/^\/api\/profile$/, { GET: 'profileGet', POST: 'profileUpdate' }],
  [/^\/api\/profile\/avatar$/, { POST: 'avatarSet', DELETE: 'avatarDelete' }],
  [/^\/api\/users\/([a-f0-9]+)\/avatar$/, { GET: 'avatarGet' }],
  [/^\/api\/auth\/password$/, { POST: 'passwordChange' }],
  [/^\/api\/auth\/logout-all$/, { POST: 'logoutAll' }],
  [/^\/api\/auth\/delete$/, { POST: 'accountDelete' }],
  [/^\/api\/library\/([a-f0-9]+)\/svg$/, { GET: 'librarySvg' }],
  [/^\/api\/library\/([a-f0-9]+)\/file$/, { GET: 'libraryFile' }],
  [/^\/api\/library\/([a-f0-9]+)\/like$/, { POST: 'libraryLike' }],
  [/^\/api\/designs$/, { GET: 'designsList', POST: 'designsCreate' }],
  [/^\/api\/designs\/([a-f0-9]+)$/, { GET: 'designsGet', DELETE: 'designsDelete' }],
];

function page() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Blank PFP Studio (preview)</title>
<style>${read('app/globals.css')}</style></head><body><main class="page">
<div class="vcard"><div class="vi">👥</div><div><small>Visitantes</small><b id="visit-count">…</b></div><div class="vd">pessoas diferentes<br>(contadas por IP)</div></div>
<div class="studio">${STUDIO_HTML}</div></main>
<script>fetch('/api/visit',{method:'POST'}).then(r=>r.json()).then(d=>{document.getElementById('visit-count').textContent=d.total.toLocaleString('pt-BR')})</script>
<script src="/studio.js"></script></body></html>`;
}

export function startServer(port = 3100) {
  const db = createFakeDb();
  const h = createHandlers(async () => db);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(page());
      }
      if (url.pathname === '/studio.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        return res.end(read('public/studio.js'));
      }
      for (const [re, methods] of ROUTES) {
        const m = url.pathname.match(re);
        if (!m) continue;
        const fn = methods[req.method];
        if (!fn) break;
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
        if (!headers.get('x-forwarded-for')) headers.set('x-forwarded-for', req.headers['x-test-ip'] || req.socket.remoteAddress || '');
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
        const response = await h[fn](request, { params: Promise.resolve({ id: m[1] }) });
        const out = {};
        response.headers.forEach((v, k) => (out[k] = v));
        res.writeHead(response.status, out);
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('não encontrado');
    } catch (e) {
      console.error(e);
      res.writeHead(500);
      res.end('erro');
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, db, url: 'http://localhost:' + port })));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const port = Number(process.env.PORT || 3100);
  startServer(port).then(({ url }) => console.log('Preview rodando em ' + url + ' (banco em memória)'));
}
