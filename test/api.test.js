import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../lib/handlers.js';
import { sanitizeSvg } from '../lib/svg.js';
import { resetRateLimit } from '../lib/ratelimit.js';
import { createFakeDb } from './fake-db.js';

let db, h;
beforeEach(() => {
  db = createFakeDb();
  h = createHandlers(async () => db);
  resetRateLimit();
});

const BASE = 'https://pfp.test';
function req(method, path, { body, cookie, ip = '1.1.1.1', ua = 'Mozilla/5.0', origin = BASE, json = true } = {}) {
  const headers = { host: 'pfp.test', 'x-forwarded-for': ip, 'user-agent': ua, 'x-forwarded-proto': 'https' };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (json) headers['content-type'] = 'application/json';
  }
  return new Request(BASE + path, { method, headers, body: payload });
}
const data = async (res) => ({ status: res.status, ...(await res.json()) });
const cookieOf = (res) => (res.headers.get('set-cookie') || '').split(';')[0];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#f00"/></svg>';

async function signup(name = 'maria', pw = 'segredo1', ip = '9.9.9.9') {
  const res = await h.register(req('POST', '/api/auth/register', { body: { username: name, password: pw }, ip }));
  return { res, cookie: cookieOf(res) };
}

/* ---------- SVG ---------- */
test('SVG: aceita um SVG simples e adiciona xmlns', () => {
  const r = sanitizeSvg('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>');
  assert.equal(r.ok, true);
  assert.match(r.svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
});
test('SVG: rejeita script, eventos, links externos, foreignObject e arquivos que não são SVG', () => {
  const ruins = [
    '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1 1" onload="alert(1)"></svg>',
    '<svg viewBox="0 0 1 1"><a href="https://x.com"><rect/></a></svg>',
    '<svg viewBox="0 0 1 1"><image href="http://x.com/a.png"/></svg>',
    '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
    '<svg viewBox="0 0 1 1"><rect style="fill:url(https://x.com/a)"/></svg>',
    '<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"/></svg>',
    '<!DOCTYPE svg><svg viewBox="0 0 1 1"></svg>',
    '<svg><rect/></svg>',
    '<html><svg viewBox="0 0 1 1"></svg></html>',
    'texto qualquer',
    42,
  ];
  for (const s of ruins) assert.equal(sanitizeSvg(s).ok, false, String(s).slice(0, 50));
});
test('SVG: aceita referência interna (#id) e imagem embutida em base64', () => {
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>').ok, true);
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1"><image href="data:image/png;base64,AAAA"/></svg>').ok, true);
});
test('SVG: rejeita arquivo acima de 100 KB', () => {
  assert.equal(sanitizeSvg('<svg viewBox="0 0 1 1">' + ' '.repeat(100001) + '</svg>').ok, false);
});

/* ---------- visitantes por IP ---------- */
test('Visitantes: o mesmo IP conta uma vez; IPs diferentes somam', async () => {
  const a = await data(await h.visit(req('POST', '/api/visit', { ip: '10.0.0.1' })));
  const b = await data(await h.visit(req('POST', '/api/visit', { ip: '10.0.0.1' })));
  const c = await data(await h.visit(req('POST', '/api/visit', { ip: '10.0.0.2' })));
  assert.equal(a.total, 1);
  assert.equal(b.total, 1);
  assert.equal(c.total, 2);
});
test('Visitantes: o IP não é guardado, só o hash; GET apenas lê', async () => {
  await h.visit(req('POST', '/api/visit', { ip: '203.0.113.7' }));
  const saved = JSON.stringify(db._cols.visitors.docs);
  assert.ok(!saved.includes('203.0.113.7'));
  const g = await data(await h.visit(req('GET', '/api/visit', { ip: '203.0.113.99', origin: null })));
  assert.equal(g.total, 1);
});
test('Visitantes: robôs e requisições sem IP não entram na conta', async () => {
  await h.visit(req('POST', '/api/visit', { ip: '10.0.0.3', ua: 'Googlebot/2.1' }));
  await h.visit(req('POST', '/api/visit', { ip: '' }));
  const r = await data(await h.visit(req('GET', '/api/visit', { origin: null })));
  assert.equal(r.total, 0);
});
test('Visitantes: usa o primeiro IP de x-forwarded-for', async () => {
  await h.visit(req('POST', '/api/visit', { ip: '10.0.0.5, 70.1.1.1' }));
  const same = await data(await h.visit(req('POST', '/api/visit', { ip: '10.0.0.5' })));
  assert.equal(same.total, 1);
});

/* ---------- conta ---------- */
test('Conta: criar, ver quem sou, sair e entrar de novo', async () => {
  const { res, cookie } = await signup();
  const created = await data(res);
  assert.equal(created.status, 201);
  assert.equal(created.user.username, 'maria');
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /Secure/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);
  assert.ok(!JSON.stringify(created).includes('pass'));
  assert.equal((await data(await h.me(req('GET', '/api/auth/me', { cookie, origin: null })))).user.username, 'maria');
  const out = await h.logout(req('POST', '/api/auth/logout', { cookie, body: {} }));
  assert.equal(out.status, 200);
  assert.equal((await data(await h.me(req('GET', '/api/auth/me', { cookie, origin: null })))).user, null);
  const again = await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'MARIA', password: 'segredo1' } })));
  assert.equal(again.status, 200);
  assert.equal(again.user.username, 'maria');
});
test('Conta: senha fica com hash, nunca em texto puro', async () => {
  await signup('joao', 'minhasenha');
  const u = db._cols.users.docs[0];
  assert.ok(u.pass.includes(':') && !u.pass.includes('minhasenha'));
});
test('Conta: validações, usuário repetido e senha errada', async () => {
  assert.equal((await data(await h.register(req('POST', '/api/auth/register', { body: { username: 'a', password: '123456' } })))).status, 400);
  assert.equal((await data(await h.register(req('POST', '/api/auth/register', { body: { username: 'ok_user', password: '123' } })))).status, 400);
  assert.equal((await data(await h.register(req('POST', '/api/auth/register', { body: { username: 'com espaço', password: '123456' } })))).status, 400);
  await signup('ana', 'senha123');
  assert.equal((await signup('Ana', 'outra123')).res.status, 409);
  assert.equal((await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'ana', password: 'errada' } })))).status, 401);
  assert.equal((await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'ninguem', password: 'errada' } })))).status, 401);
});
test('Conta: limita tentativas de login e criação de contas', async () => {
  await signup('lia', 'senha123');
  let last;
  for (let i = 0; i < 11; i++) last = await h.login(req('POST', '/api/auth/login', { body: { username: 'lia', password: 'x' + i } }));
  assert.equal(last.status, 429);
  resetRateLimit();
  let blocked = 0;
  for (let i = 0; i < 7; i++) if ((await signup('user_' + i, 'senha123', '8.8.8.8')).res.status === 429) blocked++;
  assert.ok(blocked >= 1);
});
test('Segurança: recusa origem de outro site e exige JSON', async () => {
  const r1 = await data(await h.register(req('POST', '/api/auth/register', { body: { username: 'zed', password: '123456' }, origin: 'https://evil.example' })));
  assert.equal(r1.status, 403);
  const r2 = await data(await h.register(req('POST', '/api/auth/register', { body: 'username=a', json: false })));
  assert.equal(r2.status, 415);
});
test('Preferências: salva só valores válidos', async () => {
  const { cookie } = await signup('pri', 'senha123');
  const ok = await data(await h.prefs(req('POST', '/api/prefs', { cookie, body: { mode: 'dark', ai: 2, sbg: 'grad', hack: 1 } })));
  assert.deepEqual(ok.prefs, { mode: 'dark', ai: 2, sbg: 'grad' });
  const me = await data(await h.me(req('GET', '/api/auth/me', { cookie, origin: null })));
  assert.deepEqual(me.user.prefs, { mode: 'dark', ai: 2, sbg: 'grad' });
  assert.equal((await data(await h.prefs(req('POST', '/api/prefs', { body: { mode: 'dark' } })))).status, 401);
});

/* ---------- biblioteca ---------- */
async function publish(cookie, extra = {}) {
  return data(await h.libraryCreate(req('POST', '/api/library', { cookie, body: { type: 'accessory', name: 'Coroa legal', svg: SVG, ...extra } })));
}
test('Biblioteca: precisa estar logado para compartilhar', async () => {
  assert.equal((await publish(undefined)).status, 401);
});
test('Biblioteca: compartilhar, listar, filtrar por tipo, buscar e ordenar', async () => {
  const a = await signup('ana', 'senha123', '1.1.1.1');
  const b = await signup('beto', 'senha123', '2.2.2.2');
  const wait = () => new Promise((r) => setTimeout(r, 5));
  const i1 = await publish(a.cookie, { name: 'Chapéu de bruxa', type: 'accessory' });
  await wait();
  await publish(b.cookie, { name: 'Rosto fofo', type: 'face', tint: true });
  await wait();
  const i3 = await publish(b.cookie, { name: 'Moldura de flores', type: 'frame', tint: true });
  assert.equal(i1.status, 201);
  assert.equal(i3.item.tint, false, 'moldura não é pintável');
  assert.ok(!JSON.stringify(i1).includes('<svg'), 'a listagem não devolve o SVG inteiro');
  const all = await data(await h.libraryList(req('GET', '/api/library', { origin: null })));
  assert.equal(all.items.length, 3);
  assert.equal(all.items[0].name, 'Moldura de flores', 'mais recente primeiro');
  const faces = await data(await h.libraryList(req('GET', '/api/library?type=face', { origin: null })));
  assert.deepEqual(faces.items.map((x) => x.name), ['Rosto fofo']);
  const byAuthor = await data(await h.libraryList(req('GET', '/api/library?q=ANA', { origin: null })));
  assert.deepEqual(byAuthor.items.map((x) => x.name), ['Chapéu de bruxa']);
  const mine = await data(await h.libraryList(req('GET', '/api/library?mine=1', { cookie: b.cookie, origin: null })));
  assert.equal(mine.items.length, 2);
  assert.ok(mine.items.every((x) => x.mine));
  assert.equal((await data(await h.libraryList(req('GET', '/api/library?mine=1', { origin: null })))).status, 401);
  await h.libraryLike(req('POST', `/api/library/${i1.item.id}/like`, { cookie: b.cookie, body: {} }), { params: { id: i1.item.id } });
  const pop = await data(await h.libraryList(req('GET', '/api/library?sort=popular', { origin: null })));
  assert.equal(pop.items[0].name, 'Chapéu de bruxa');
});
test('Biblioteca: curtir alterna e conta certo; só logado curte', async () => {
  const a = await signup('ana', 'senha123');
  const it = await publish(a.cookie);
  const ctx = { params: { id: it.item.id } };
  const like = (cookie) => h.libraryLike(req('POST', `/api/library/${it.item.id}/like`, { cookie, body: {} }), ctx);
  assert.equal((await data(await like(undefined))).status, 401);
  const l1 = await data(await like(a.cookie));
  assert.deepEqual([l1.liked, l1.likes], [true, 1]);
  const l2 = await data(await like(a.cookie));
  assert.deepEqual([l2.liked, l2.likes], [false, 0]);
  await like(a.cookie);
  const listed = await data(await h.libraryList(req('GET', '/api/library', { cookie: a.cookie, origin: null })));
  assert.equal(listed.items[0].liked, true);
});
test('Biblioteca: serve o SVG com cabeçalhos seguros e só o autor apaga', async () => {
  const a = await signup('ana', 'senha123', '1.1.1.1');
  const b = await signup('beto', 'senha123', '2.2.2.2');
  const it = await publish(a.cookie);
  const ctx = { params: Promise.resolve({ id: it.item.id }) }; // Next 15 entrega params como Promise
  const svg = await h.librarySvg(req('GET', `/api/library/${it.item.id}/svg`, { origin: null }), ctx);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(svg.headers.get('content-security-policy'), /sandbox/);
  assert.equal(svg.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await svg.text(), /<svg/);
  const bad = await h.libraryDelete(req('DELETE', `/api/library/${it.item.id}`, { cookie: b.cookie }), ctx);
  assert.equal(bad.status, 403);
  assert.equal((await h.libraryDelete(req('DELETE', `/api/library/${it.item.id}`, { cookie: a.cookie }), ctx)).status, 200);
  assert.equal((await h.librarySvg(req('GET', '/x', { origin: null }), ctx)).status, 404);
  assert.equal((await h.libraryGet(req('GET', '/x', { origin: null }), { params: { id: 'zzz' } })).status, 404);
});
test('Biblioteca: recusa SVG com script, tipo inválido e nome curto', async () => {
  const a = await signup('ana', 'senha123');
  assert.equal((await publish(a.cookie, { svg: '<svg viewBox="0 0 1 1"><script>1</script></svg>' })).status, 400);
  assert.equal((await publish(a.cookie, { type: 'musica' })).status, 400);
  assert.equal((await publish(a.cookie, { name: 'a' })).status, 400);
  assert.equal((await publish(a.cookie, { svg: 'data:image/png;base64,AAAA' })).status, 400);
});

/* ---------- designs salvos ---------- */
const THUMB = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
test('Designs: salvar, listar, abrir e apagar (só do dono)', async () => {
  const a = await signup('ana', 'senha123', '1.1.1.1');
  const b = await signup('beto', 'senha123', '2.2.2.2');
  const snap = JSON.stringify({ s: ['gato', 'nenhum'], a: {}, v: {} });
  const made = await data(await h.designsCreate(req('POST', '/api/designs', { cookie: a.cookie, body: { name: 'Meu gato', snapshot: snap, thumb: THUMB } })));
  assert.equal(made.status, 201);
  const list = await data(await h.designsList(req('GET', '/api/designs', { cookie: a.cookie, origin: null })));
  assert.equal(list.items.length, 1);
  assert.ok(!('snapshot' in list.items[0]));
  const ctx = { params: { id: made.item.id } };
  const open = await data(await h.designsGet(req('GET', '/x', { cookie: a.cookie, origin: null }), ctx));
  assert.equal(open.snapshot, snap);
  assert.equal((await h.designsGet(req('GET', '/x', { cookie: b.cookie, origin: null }), ctx)).status, 404);
  assert.equal((await h.designsDelete(req('DELETE', '/x', { cookie: b.cookie }), ctx)).status, 404);
  assert.equal((await h.designsDelete(req('DELETE', '/x', { cookie: a.cookie }), ctx)).status, 200);
  assert.equal((await data(await h.designsList(req('GET', '/api/designs', { cookie: a.cookie, origin: null })))).items.length, 0);
  assert.equal((await data(await h.designsList(req('GET', '/api/designs', { origin: null })))).status, 401);
});
test('Designs: valida snapshot e miniatura', async () => {
  const a = await signup('ana', 'senha123');
  const post = (body) => h.designsCreate(req('POST', '/api/designs', { cookie: a.cookie, body }));
  assert.equal((await post({ name: 'x', snapshot: 'não é json', thumb: THUMB })).status, 400);
  assert.equal((await post({ name: 'x', snapshot: '{"a":1}', thumb: THUMB })).status, 400);
  assert.equal((await post({ name: 'x', snapshot: '{"s":[]}', thumb: 'http://x.com/a.png' })).status, 400);
  assert.equal((await post({ name: 'x', snapshot: '{"s":[]}', thumb: THUMB })).status, 201);
});

/* ---------- imagens (PNG/JPG/WebP) por categoria ---------- */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALklEQVR4nGP8z5Dyn4ECwESJZqoYwILMYWSYw0iMJmRvD7wXRg0YFgYwDv3MBAAaSgflY0gyKQAAAABJRU5ErkJggg==';
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzqiiiv6zP5kP/2Q==';
const WEBP = 'UklGRh4AAABXRUJQVlA4TBEAAAAvD8ADAAdQvFKUu/+BiOh/AAA=';
const WEBP_LOSSY = 'UklGRjwAAABXRUJQVlA4IDAAAAAQAgCdASoQABAAAUAmJaACdLoB+AH4AAPIAP7tzt/+yr4TI/9Uz/6nCXIMfQoAAAA=';
const GIF = 'R0lGODdhBAAEAIAAAAAAAAAAACwAAAAABAAEAAAICQABCBxIsCCAgAA7';

const publishRaw = async (cookie, body) => data(await h.libraryCreate(req('POST', '/api/library', { cookie, body })));
test('Imagens: Fundo aceita PNG, JPG, WebP (lossless e lossy) e SVG', async () => {
  const a = await signup('ana', 'senha123');
  for (const [fmt, data64] of [['png', PNG], ['jpeg', JPG], ['webp', WEBP], ['webp', WEBP_LOSSY]]) {
    const r = await publishRaw(a.cookie, { type: 'background', name: 'Fundo ' + fmt, format: fmt, data: data64 });
    assert.equal(r.status, 201, fmt + ' ' + (r.error || ''));
    assert.equal(r.item.format, fmt);
    assert.deepEqual([r.item.width, r.item.height], [16, 16]);
  }
  assert.equal((await publish(a.cookie, { type: 'background', name: 'Fundo svg' })).status, 201);
});
test('Imagens: Moldura aceita PNG e SVG, mas não JPG nem WebP', async () => {
  const a = await signup('ana', 'senha123');
  assert.equal((await publishRaw(a.cookie, { type: 'frame', name: 'Moldura png', data: PNG })).status, 201);
  assert.equal((await publish(a.cookie, { type: 'frame', name: 'Moldura svg' })).status, 201);
  const jpg = await publishRaw(a.cookie, { type: 'frame', name: 'Moldura jpg', data: JPG });
  assert.equal(jpg.status, 400);
  assert.match(jpg.error, /Molduras aceitam somente SVG e PNG/);
  assert.equal((await publishRaw(a.cookie, { type: 'frame', name: 'Moldura webp', data: WEBP })).status, 400);
});
test('Imagens: Adereço, Rosto e Forma continuam só SVG', async () => {
  const a = await signup('ana', 'senha123');
  for (const type of ['accessory', 'face', 'shape']) {
    const r = await publishRaw(a.cookie, { type, name: 'Item ' + type, data: PNG });
    assert.equal(r.status, 400, type);
    assert.match(r.error, /aceitam somente SVG/);
  }
  assert.equal((await publish(a.cookie, { type: 'shape', name: 'Forma svg' })).status, 201);
});
test('Imagens: valida o conteúdo real (GIF, texto, formato trocado, tamanho e dimensões)', async () => {
  const a = await signup('ana', 'senha123');
  const post = (extra) => publishRaw(a.cookie, { type: 'background', name: 'Teste', ...extra });
  assert.equal((await post({ data: GIF })).status, 400, 'GIF não é aceito');
  assert.equal((await post({ data: Buffer.from('isto é só texto, não imagem de verdade').toString('base64') })).status, 400);
  const mismatch = await post({ format: 'png', data: JPG });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.error, /não corresponde/);
  assert.equal((await post({ format: 'jpg', data: JPG })).status, 201, 'jpg é sinônimo de jpeg');
  assert.equal((await post({ data: '***não-é-base64***' })).status, 400);
  const big = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(2 * 1024 * 1024 + 10)]).toString('base64');
  assert.equal((await post({ data: big })).status, 400, 'acima de 2 MB');
  const png = Buffer.from(PNG, 'base64');
  png.writeUInt32BE(5000, 16); // largura 5000 no IHDR
  assert.equal((await post({ data: png.toString('base64') })).status, 400, 'dimensão acima de 4096');
  assert.equal((await post({ format: 'svg', data: PNG })).status, 400, 'formato svg com bytes de png');
  assert.equal((await publish(a.cookie, { type: 'background', name: 'Svg falso', svg: PNG })).status, 400, 'png em base64 enviado como svg');
});
test('Imagens: os bytes voltam idênticos, com o MIME certo e cabeçalhos seguros', async () => {
  const a = await signup('ana', 'senha123');
  const made = await publishRaw(a.cookie, { type: 'frame', name: 'Moldura png', data: PNG });
  const ctx = { params: Promise.resolve({ id: made.item.id }) };
  for (const route of ['libraryFile', 'librarySvg']) {
    const res = await h[route](req('GET', '/x', { origin: null }), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG, 'base64')), 'bytes idênticos');
  }
  const jpg = await publishRaw(a.cookie, { type: 'background', name: 'Fundo jpg', data: JPG });
  const jr = await h.libraryFile(req('GET', '/x', { origin: null }), { params: { id: jpg.item.id } });
  assert.equal(jr.headers.get('content-type'), 'image/jpeg');
  const svg = await publish(a.cookie, { type: 'shape', name: 'Forma svg' });
  const sr = await h.libraryFile(req('GET', '/x', { origin: null }), { params: { id: svg.item.id } });
  assert.match(sr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(sr.headers.get('content-security-policy'), /sandbox/);
});
test('Imagens: a listagem não devolve bytes e informa formato e tamanho', async () => {
  const a = await signup('ana', 'senha123');
  await publishRaw(a.cookie, { type: 'background', name: 'Fundo png', data: PNG });
  const listed = await data(await h.libraryList(req('GET', '/api/library?type=background', { origin: null })));
  assert.equal(listed.items[0].format, 'png');
  assert.equal(listed.items[0].width, 16);
  assert.ok(!JSON.stringify(listed).includes(PNG.slice(0, 40)));
});

/* ---------- perfil, foto, segurança ---------- */
const meOf = async (cookie) => (await data(await h.me(req('GET', '/api/auth/me', { cookie, origin: null })))).user;
test('Perfil: nome de exibição começa igual ao usuário e é diferente do login', async () => {
  const { cookie } = await signup('ana_login', 'senha123');
  const u = await meOf(cookie);
  assert.equal(u.displayName, 'ana_login');
  const r = await data(await h.profileUpdate(req('POST', '/api/profile', { cookie, body: { displayName: 'Ana Gatinha' } })));
  assert.equal(r.status, 200);
  assert.equal(r.user.displayName, 'Ana Gatinha');
  assert.equal(r.user.username, 'ana_login');
  const login = await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'ana_login', password: 'senha123' } })));
  assert.equal(login.status, 200, 'o login continua sendo pelo usuário');
  const byDisplay = await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'Ana Gatinha', password: 'senha123' } })));
  assert.equal(byDisplay.status, 401, 'não dá para entrar pelo nome de exibição');
});
test('Perfil: só troca o nome de exibição a cada 7 dias', async () => {
  const { cookie } = await signup('bia', 'senha123');
  const post = (displayName) => h.profileUpdate(req('POST', '/api/profile', { cookie, body: { displayName } }));
  assert.equal((await post('Bia Primeira')).status, 200);
  const blocked = await data(await post('Bia Segunda'));
  assert.equal(blocked.status, 429);
  assert.match(blocked.error, /a cada 7 dias/);
  assert.ok((await meOf(cookie)).nextNameChange, 'informa quando poderá trocar de novo');
  assert.equal((await meOf(cookie)).displayName, 'Bia Primeira');
  db._cols.users.docs[0].displayNameChangedAt = new Date(Date.now() - 8 * 86400000);
  assert.equal((await post('Bia Segunda')).status, 200, 'depois de 7 dias libera');
  assert.equal((await meOf(cookie)).nextNameChange !== null, true);
  assert.equal((await post('Bia Segunda')).status, 200, 'repetir o mesmo nome não conta como troca');
});
test('Perfil: valida o nome de exibição e atualiza o autor dos itens compartilhados', async () => {
  const { cookie } = await signup('caio', 'senha123');
  const post = (displayName) => h.profileUpdate(req('POST', '/api/profile', { cookie, body: { displayName } }));
  for (const bad of ['a', '<script>', 'x'.repeat(31), '  ', 'nome\u0007bell', '']) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  await publish(cookie, { name: 'Meu item' });
  assert.equal((await post('Caio Criador')).status, 200);
  const list = await data(await h.libraryList(req('GET', '/api/library', { origin: null })));
  assert.equal(list.items[0].authorName, 'Caio Criador');
  const byName = await data(await h.libraryList(req('GET', '/api/library?q=criador', { origin: null })));
  assert.equal(byName.items.length, 1, 'a busca por autor acha pelo nome de exibição');
});
test('Perfil: foto de perfil (valida o conteúdo real, tamanho e dimensões)', async () => {
  const a = await signup('dani', 'senha123');
  const put = async (body, cookie = a.cookie) => data(await h.avatarSet(req('POST', '/api/profile/avatar', { cookie, body })));
  assert.equal((await put({ data: PNG })).status, 200);
  const u = await meOf(a.cookie);
  assert.ok(u.avatarV > 0);
  const got = await h.avatarGet(req('GET', '/x', { origin: null }), { params: { id: u.id } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(PNG, 'base64')));
  assert.equal((await put({ data: GIF })).status, 400);
  assert.equal((await put({ data: Buffer.from('texto qualquer que não é imagem').toString('base64') })).status, 400);
  const wide = Buffer.from(PNG, 'base64');
  wide.writeUInt32BE(2000, 16);
  assert.equal((await put({ data: wide.toString('base64') })).status, 400, 'acima de 1024 px');
  assert.equal((await put({ data: Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(310000)]).toString('base64') })).status, 400, 'acima de 300 KB');
  assert.equal((await put({ data: PNG }, undefined)).status, 200);
  const del = await h.avatarDelete(req('DELETE', '/api/profile/avatar', { cookie: a.cookie }));
  assert.equal(del.status, 200);
  assert.equal((await h.avatarGet(req('GET', '/x', { origin: null }), { params: { id: u.id } })).status, 404);
  assert.equal((await data(await h.avatarSet(req('POST', '/api/profile/avatar', { body: { data: PNG } })))).status, 401);
});
test('Perfil: estatísticas e itens curtidos', async () => {
  const a = await signup('eva', 'senha123', '1.1.1.1');
  const b = await signup('fabio', 'senha123', '2.2.2.2');
  const it = await publish(a.cookie, { name: 'Item da Eva' });
  await h.libraryLike(req('POST', `/api/library/${it.item.id}/like`, { cookie: b.cookie, body: {} }), { params: { id: it.item.id } });
  const prof = await data(await h.profileGet(req('GET', '/api/profile', { cookie: a.cookie, origin: null })));
  assert.deepEqual([prof.stats.items, prof.stats.likes], [1, 1]);
  const liked = await data(await h.libraryList(req('GET', '/api/library?liked=1', { cookie: b.cookie, origin: null })));
  assert.deepEqual(liked.items.map((x) => x.name), ['Item da Eva']);
  assert.equal((await data(await h.libraryList(req('GET', '/api/library?liked=1', { origin: null })))).status, 401);
  assert.equal((await data(await h.libraryList(req('GET', '/api/library?liked=1', { cookie: a.cookie, origin: null })))).items.length, 0);
});
test('Itens compartilhados: renomear (só o autor)', async () => {
  const a = await signup('gabi', 'senha123', '1.1.1.1');
  const b = await signup('hugo', 'senha123', '2.2.2.2');
  const it = await publish(a.cookie, { name: 'Nome velho' });
  const ctx = { params: { id: it.item.id } };
  const ren = (cookie, name) => h.libraryRename(req('PATCH', `/api/library/${it.item.id}`, { cookie, body: { name } }), ctx);
  assert.equal((await ren(b.cookie, 'Roubado')).status, 403);
  assert.equal((await ren(undefined, 'Anônimo')).status, 401);
  assert.equal((await ren(a.cookie, 'x')).status, 400);
  const ok = await data(await ren(a.cookie, 'Nome novo'));
  assert.equal(ok.item.name, 'Nome novo');
  assert.equal((await data(await h.libraryGet(req('GET', '/x', { origin: null }), ctx))).item.name, 'Nome novo');
});
test('Segurança: trocar a senha encerra as outras sessões', async () => {
  const a = await signup('iara', 'senha123');
  const other = cookieOf(await h.login(req('POST', '/api/auth/login', { body: { username: 'iara', password: 'senha123' } })));
  const change = (current, next) => h.passwordChange(req('POST', '/api/auth/password', { cookie: a.cookie, body: { current, next } }));
  assert.equal((await change('errada', 'novasenha1')).status, 401);
  assert.equal((await change('senha123', '123')).status, 400);
  assert.equal((await change('senha123', 'novasenha1')).status, 200);
  assert.ok(await meOf(a.cookie), 'a sessão atual continua valendo');
  assert.equal(await meOf(other), null, 'a outra sessão foi encerrada');
  assert.equal((await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'iara', password: 'senha123' } })))).status, 401);
  assert.equal((await data(await h.login(req('POST', '/api/auth/login', { body: { username: 'iara', password: 'novasenha1' } })))).status, 200);
});
test('Segurança: sair de todos os dispositivos', async () => {
  const a = await signup('jota', 'senha123');
  const other = cookieOf(await h.login(req('POST', '/api/auth/login', { body: { username: 'jota', password: 'senha123' } })));
  const res = await h.logoutAll(req('POST', '/api/auth/logout-all', { cookie: a.cookie, body: {} }));
  assert.equal(res.status, 200);
  assert.equal(await meOf(a.cookie), null);
  assert.equal(await meOf(other), null);
});
test('Segurança: excluir a conta remove dados e curtidas dadas', async () => {
  const a = await signup('kira', 'senha123', '1.1.1.1');
  const b = await signup('lia2', 'senha123', '2.2.2.2');
  const itemB = await publish(b.cookie, { name: 'Do Lia' });
  await publish(a.cookie, { name: 'Da Kira' });
  await h.libraryLike(req('POST', `/api/library/${itemB.item.id}/like`, { cookie: a.cookie, body: {} }), { params: { id: itemB.item.id } });
  await h.designsCreate(req('POST', '/api/designs', { cookie: a.cookie, body: { name: 'd', snapshot: '{"s":[]}', thumb: THUMB } }));
  const del = (password) => h.accountDelete(req('POST', '/api/auth/delete', { cookie: a.cookie, body: { password } }));
  assert.equal((await del('errada')).status, 401);
  assert.equal((await del('senha123')).status, 200);
  assert.equal(await meOf(a.cookie), null);
  assert.equal(db._cols.users.docs.some((u) => u.username === 'kira'), false);
  assert.equal(db._cols.designs.docs.length, 0);
  const list = await data(await h.libraryList(req('GET', '/api/library', { origin: null })));
  assert.deepEqual(list.items.map((x) => [x.name, x.likes]), [['Do Lia', 0]], 'só o item de outra pessoa restou, sem a curtida da conta apagada');
  assert.equal((await signup('kira', 'outra1234', '5.5.5.5')).res.status, 201, 'o nome de usuário volta a ficar livre');
});
test('Preferências: guarda também as opções de exportação', async () => {
  const { cookie } = await signup('mia', 'senha123');
  const ok = await data(await h.prefs(req('POST', '/api/prefs', { cookie, body: { mode: 'dark', px: 1024, fmt: 'jpg', crop: 'quad', cfill: true, emb: false } })));
  assert.deepEqual(ok.prefs, { mode: 'dark', px: '1024', fmt: 'jpg', crop: 'quad', cfill: true, emb: false });
  const bad = await data(await h.prefs(req('POST', '/api/prefs', { cookie, body: { px: 99999, fmt: 'gif', crop: 'x' } })));
  assert.deepEqual(bad.prefs, {});
});
