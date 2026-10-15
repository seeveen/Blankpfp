import { HttpError, json, getIp, readJson, checkOrigin, getCookie } from './http.js';
import {
  COOKIE,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  sha256,
  newToken,
  newId,
  hmac,
  isSecure,
  sessionCookie,
} from './auth.js';
import { allow } from './ratelimit.js';
import { sanitizeSvg } from './svg.js';
import { FORMATS_BY_TYPE, formatsText, inspectRaster, toBuffer, MIME } from './files.js';

export const TYPES = ['accessory', 'face', 'shape', 'frame', 'background'];
const USER_RE = /^[A-Za-z0-9_]{3,20}$/;
const ID_RE = /^[a-f0-9]{24}$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|monitor|curl|wget|python-requests/i;
const MODES = ['auto', 'dark', 'light'];
const BGS = ['clean', 'aurora', 'grad', 'dots', 'plain'];
const PAGE = 24;
const NAME_COOLDOWN_MS = 7 * 86400000;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._'’-]{0,28}[\p{L}\p{N}._]$/u;
const PX_OK = ['256', '512', '640', '720', '1024', '1080', '2048', '4096'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fábrica dos handlers. Recebe uma função que devolve o banco (MongoDB ou o falso dos testes). */
export function createHandlers(getDb) {
  const wrap = (fn) => async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Erro interno. Tente novamente em instantes.' }, 500);
    }
  };

  async function currentUser(req, db) {
    const token = getCookie(req, COOKIE);
    if (!token) return null;
    const session = await db.collection('sessions').findOne({ _id: sha256(token) });
    if (!session || new Date(session.expiresAt) < new Date()) return null;
    return db.collection('users').findOne({ _id: session.userId });
  }
  async function needUser(req, db) {
    const user = await currentUser(req, db);
    if (!user) throw new HttpError(401, 'Entre na sua conta para continuar.');
    return user;
  }
  const nextNameChange = (u) => {
    const last = u && u.displayNameChangedAt ? new Date(u.displayNameChangedAt).getTime() : 0;
    return last && Date.now() < last + NAME_COOLDOWN_MS ? new Date(last + NAME_COOLDOWN_MS).toISOString() : null;
  };
  const publicUser = (u) =>
    u
      ? {
          id: u._id,
          username: u.username,
          displayName: u.displayName || u.username,
          avatarV: u.avatarV || 0,
          createdAt: u.createdAt,
          nextNameChange: nextNameChange(u),
          prefs: u.prefs || {},
        }
      : null;
  const paramsOf = async (ctx) => (ctx && ctx.params ? await ctx.params : {});
  async function idParam(ctx) {
    const { id } = await paramsOf(ctx);
    if (!ID_RE.test(String(id || ''))) throw new HttpError(404, 'Item não encontrado.');
    return id;
  }

  async function startSession(req, db, user, status = 200) {
    const token = newToken();
    const maxAge = SESSION_DAYS * 86400;
    await db.collection('sessions').insertOne({
      _id: sha256(token),
      userId: user._id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + maxAge * 1000),
    });
    return json({ user: publicUser(user) }, status, { 'set-cookie': sessionCookie(token, { secure: isSecure(req), maxAge }) });
  }

  const itemMeta = (d, me, liked) => ({
    id: d._id,
    type: d.type,
    format: d.format || 'svg',
    width: d.width || null,
    height: d.height || null,
    name: d.name,
    tint: !!d.tint,
    authorName: d.authorName,
    likes: d.likes || 0,
    createdAt: d.createdAt,
    mine: !!me && d.authorId === me._id,
    liked: !!liked,
  });

  const api = {
    /* ---------- visitantes (únicos por IP) ---------- */
    visit: wrap(async (req) => {
      const db = await getDb();
      const col = db.collection('visitors');
      if (req.method === 'POST') {
        checkOrigin(req);
        const ip = getIp(req);
        if (ip && !BOT_RE.test(req.headers.get('user-agent') || '')) {
          const now = new Date();
          await col.updateOne({ _id: hmac(ip) }, { $setOnInsert: { firstSeen: now }, $set: { lastSeen: now } }, { upsert: true });
        }
      }
      return json({ total: await col.countDocuments({}) });
    }),

    /* ---------- conta ---------- */
    register: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const body = await readJson(req, 5000);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!USER_RE.test(username)) throw new HttpError(400, 'Usuário: de 3 a 20 letras, números ou _.');
      if (password.length < 6 || password.length > 72) throw new HttpError(400, 'A senha precisa ter de 6 a 72 caracteres.');
      if (!allow('reg:' + (getIp(req) || 'x'), 5, 3600000)) throw new HttpError(429, 'Muitas contas criadas deste lugar. Tente mais tarde.');
      const users = db.collection('users');
      const lower = username.toLowerCase();
      if (await users.findOne({ usernameLower: lower })) throw new HttpError(409, 'Esse usuário já existe.');
      const user = { _id: newId(), username, usernameLower: lower, displayName: username, displayNameChangedAt: null, pass: await hashPassword(password), createdAt: new Date(), prefs: {} };
      try {
        await users.insertOne(user);
      } catch (e) {
        if (e && e.code === 11000) throw new HttpError(409, 'Esse usuário já existe.');
        throw e;
      }
      return startSession(req, db, user, 201);
    }),

    login: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const body = await readJson(req, 5000);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!allow(`login:${getIp(req) || 'x'}:${username}`, 10, 900000)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
      const user = await db.collection('users').findOne({ usernameLower: username });
      const ok = user ? await verifyPassword(password, user.pass) : (await verifyPassword(password, 'aa:bb'), false);
      if (!ok) throw new HttpError(401, 'Usuário ou senha incorretos.');
      return startSession(req, db, user);
    }),

    logout: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const token = getCookie(req, COOKIE);
      if (token) await db.collection('sessions').deleteOne({ _id: sha256(token) });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', { secure: isSecure(req), maxAge: 0 }) });
    }),

    me: wrap(async (req) => {
      const db = await getDb();
      return json({ user: publicUser(await currentUser(req, db)) });
    }),

    prefs: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const user = await needUser(req, db);
      const body = await readJson(req, 2000);
      const prefs = {};
      if (MODES.includes(body.mode)) prefs.mode = body.mode;
      if (Number.isInteger(body.ai) && body.ai >= 0 && body.ai < 12) prefs.ai = body.ai;
      if (BGS.includes(body.sbg)) prefs.sbg = body.sbg;
      if (PX_OK.includes(String(body.px))) prefs.px = String(body.px);
      if (body.fmt === 'png' || body.fmt === 'jpg') prefs.fmt = body.fmt;
      if (body.crop === 'circ' || body.crop === 'quad') prefs.crop = body.crop;
      if (typeof body.cfill === 'boolean') prefs.cfill = body.cfill;
      if (typeof body.emb === 'boolean') prefs.emb = body.emb;
      await db.collection('users').updateOne({ _id: user._id }, { $set: { prefs } });
      return json({ prefs });
    }),

    /* ---------- biblioteca (somente SVG) ---------- */
    libraryList: wrap(async (req) => {
      const db = await getDb();
      const me = await currentUser(req, db);
      const url = new URL(req.url);
      const type = url.searchParams.get('type');
      const q = (url.searchParams.get('q') || '').trim().slice(0, 40);
      const sort = url.searchParams.get('sort') === 'popular' ? 'popular' : 'recent';
      const skip = Math.min(5000, Math.max(0, parseInt(url.searchParams.get('skip') || '0', 10) || 0));
      const filter = {};
      if (TYPES.includes(type)) filter.type = type;
      if (q) {
        const re = escapeRe(q);
        filter.$or = [{ name: { $regex: re, $options: 'i' } }, { authorName: { $regex: re, $options: 'i' } }];
      }
      if (url.searchParams.get('liked')) {
        if (!me) throw new HttpError(401, 'Entre na sua conta para ver o que você curtiu.');
        const mine = await db.collection('likes').find({ userId: me._id }).sort({ createdAt: -1 }).limit(500).toArray();
        filter._id = { $in: mine.map((l) => l.itemId) };
      }
      if (url.searchParams.get('mine')) {
        if (!me) throw new HttpError(401, 'Entre na sua conta para ver seus envios.');
        filter.authorId = me._id;
      }
      const rows = await db
        .collection('library')
        .find(filter, { projection: { svg: 0, data: 0 } })
        .sort(sort === 'popular' ? { likes: -1, createdAt: -1 } : { createdAt: -1 })
        .skip(skip)
        .limit(PAGE + 1)
        .toArray();
      const page = rows.slice(0, PAGE);
      const likedSet = new Set();
      if (me && page.length) {
        const likes = await db.collection('likes').find({ userId: me._id, itemId: { $in: page.map((d) => d._id) } }).toArray();
        likes.forEach((l) => likedSet.add(l.itemId));
      }
      return json({ items: page.map((d) => itemMeta(d, me, likedSet.has(d._id))), hasMore: rows.length > PAGE });
    }),

    libraryCreate: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const body = await readJson(req, 3300000);
      const type = String(body.type || '');
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      if (!TYPES.includes(type)) throw new HttpError(400, 'Tipo inválido.');
      if (name.length < 2 || name.length > 40) throw new HttpError(400, 'O nome precisa ter de 2 a 40 caracteres.');
      const allowed = FORMATS_BY_TYPE[type];
      const claimed = body.format ? String(body.format).toLowerCase().replace('jpg', 'jpeg') : null;
      let file; // { format, mime, svg? , data?, width?, height? }
      if (typeof body.data === 'string') {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data) || body.data.length > 2800000) throw new HttpError(400, 'Imagem inválida ou grande demais (máx. 2 MB).');
        const buf = Buffer.from(body.data, 'base64');
        const info = inspectRaster(buf);
        if (!info.ok) throw new HttpError(400, info.error);
        if (claimed && claimed !== info.format) throw new HttpError(400, 'O conteúdo do arquivo não corresponde ao formato informado.');
        if (!allowed.includes(info.format)) throw new HttpError(400, formatsText(type));
        file = { format: info.format, mime: info.mime, data: buf, width: info.width, height: info.height };
      } else {
        if (claimed && claimed !== 'svg') throw new HttpError(400, 'O conteúdo do arquivo não corresponde ao formato informado.');
        if (!allowed.includes('svg')) throw new HttpError(400, formatsText(type));
        const clean = sanitizeSvg(body.svg);
        if (!clean.ok) throw new HttpError(400, clean.error);
        file = { format: 'svg', mime: MIME.svg, svg: clean.svg };
      }
      if (!allow('lib:' + me._id, 20, 3600000)) throw new HttpError(429, 'Você enviou muitos itens agora há pouco. Tente mais tarde.');
      const col = db.collection('library');
      if ((await col.countDocuments({ authorId: me._id })) >= 60) throw new HttpError(409, 'Limite de 60 itens por conta. Apague algum para enviar outro.');
      const doc = {
        _id: newId(),
        type,
        name,
        format: file.format,
        mime: file.mime,
        tint: !!body.tint && file.format === 'svg' && type !== 'frame' && type !== 'background',
        authorId: me._id,
        authorName: me.displayName || me.username,
        likes: 0,
        createdAt: new Date(),
      };
      if (file.svg) doc.svg = file.svg;
      else {
        doc.data = file.data;
        doc.width = file.width;
        doc.height = file.height;
      }
      doc.bytes = file.svg ? Buffer.byteLength(file.svg) : file.data.length;
      await col.insertOne(doc);
      return json({ item: itemMeta(doc, me, false) }, 201);
    }),

    libraryGet: wrap(async (req, ctx) => {
      const db = await getDb();
      const me = await currentUser(req, db);
      const id = await idParam(ctx);
      const d = await db.collection('library').findOne({ _id: id }, { projection: { svg: 0, data: 0 } });
      if (!d) throw new HttpError(404, 'Item não encontrado.');
      const liked = me ? await db.collection('likes').findOne({ _id: `${id}:${me._id}` }) : null;
      return json({ item: itemMeta(d, me, liked) });
    }),

    libraryFile: wrap(async (req, ctx) => {
      const db = await getDb();
      const id = await idParam(ctx);
      const d = await db.collection('library').findOne({ _id: id }, { projection: { svg: 1, data: 1, format: 1 } });
      if (!d) throw new HttpError(404, 'Item não encontrado.');
      const isSvg = typeof d.svg === 'string';
      const format = isSvg ? 'svg' : d.format;
      const headers = {
        'content-type': (MIME[format] || 'application/octet-stream') + (isSvg ? '; charset=utf-8' : ''),
        'cache-control': 'public, max-age=3600, s-maxage=86400',
        'content-security-policy': isSvg ? "default-src 'none'; style-src 'unsafe-inline'; sandbox" : "default-src 'none'; sandbox",
        'x-content-type-options': 'nosniff',
      };
      return new Response(isSvg ? d.svg : new Uint8Array(toBuffer(d.data)), { status: 200, headers });
    }),

    libraryDelete: wrap(async (req, ctx) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const id = await idParam(ctx);
      const col = db.collection('library');
      const d = await col.findOne({ _id: id }, { projection: { svg: 0, data: 0 } });
      if (!d) throw new HttpError(404, 'Item não encontrado.');
      if (d.authorId !== me._id) throw new HttpError(403, 'Só o autor pode apagar este item.');
      await col.deleteOne({ _id: id });
      await db.collection('likes').deleteMany({ itemId: id });
      return json({ ok: true });
    }),

    libraryLike: wrap(async (req, ctx) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const id = await idParam(ctx);
      const col = db.collection('library');
      const d = await col.findOne({ _id: id }, { projection: { svg: 0, data: 0 } });
      if (!d) throw new HttpError(404, 'Item não encontrado.');
      const likes = db.collection('likes');
      const key = `${id}:${me._id}`;
      let liked;
      if (await likes.findOne({ _id: key })) {
        await likes.deleteOne({ _id: key });
        await col.updateOne({ _id: id }, { $inc: { likes: -1 } });
        liked = false;
      } else {
        await likes.insertOne({ _id: key, itemId: id, userId: me._id, createdAt: new Date() });
        await col.updateOne({ _id: id }, { $inc: { likes: 1 } });
        liked = true;
      }
      const fresh = await col.findOne({ _id: id }, { projection: { svg: 0, data: 0 } });
      return json({ liked, likes: Math.max(0, fresh.likes || 0) });
    }),


    /* ---------- perfil ---------- */
    profileGet: wrap(async (req) => {
      const db = await getDb();
      const me = await needUser(req, db);
      const items = await db.collection('library').find({ authorId: me._id }, { projection: { likes: 1 } }).limit(200).toArray();
      return json({
        user: publicUser(me),
        stats: {
          items: items.length,
          likes: items.reduce((n, d) => n + (d.likes || 0), 0),
          designs: await db.collection('designs').countDocuments({ userId: me._id }),
        },
      });
    }),

    profileUpdate: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const body = await readJson(req, 2000);
      const name = String(body.displayName || '').normalize('NFC').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 30 || !NAME_RE.test(name)) {
        throw new HttpError(400, 'O nome de exibição precisa ter de 2 a 30 caracteres (letras, números, espaço, ponto, _ ou -).');
      }
      if (name === (me.displayName || me.username)) return json({ user: publicUser(me) });
      const next = nextNameChange(me);
      if (next) {
        const days = Math.ceil((new Date(next).getTime() - Date.now()) / 86400000);
        throw new HttpError(429, `Você só pode trocar o nome de exibição a cada 7 dias. Tente de novo em ${days} dia${days > 1 ? 's' : ''} (${new Date(next).toLocaleDateString('pt-BR')}).`);
      }
      await db.collection('users').updateOne({ _id: me._id }, { $set: { displayName: name, displayNameChangedAt: new Date() } });
      await db.collection('library').updateMany({ authorId: me._id }, { $set: { authorName: name } });
      return json({ user: publicUser(await db.collection('users').findOne({ _id: me._id })) });
    }),

    avatarSet: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const body = await readJson(req, 700000);
      if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) throw new HttpError(400, 'Imagem inválida.');
      const buf = Buffer.from(body.data, 'base64');
      if (buf.length > 300000) throw new HttpError(400, 'A foto passa de 300 KB.');
      const info = inspectRaster(buf);
      if (!info.ok) throw new HttpError(400, info.error);
      if (info.width > 1024 || info.height > 1024) throw new HttpError(400, 'A foto de perfil pode ter no máximo 1024×1024 pixels.');
      if (!allow('avatar:' + me._id, 12, 3600000)) throw new HttpError(429, 'Você trocou a foto muitas vezes. Tente mais tarde.');
      const avatarV = Date.now();
      await db.collection('users').updateOne({ _id: me._id }, { $set: { avatar: buf, avatarMime: info.mime, avatarV } });
      return json({ avatarV });
    }),

    avatarDelete: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      await db.collection('users').updateOne({ _id: me._id }, { $set: { avatarV: 0 }, $unset: { avatar: '', avatarMime: '' } });
      return json({ avatarV: 0 });
    }),

    avatarGet: wrap(async (req, ctx) => {
      const db = await getDb();
      const id = await idParam(ctx);
      const u = await db.collection('users').findOne({ _id: id }, { projection: { avatar: 1, avatarMime: 1, avatarV: 1 } });
      if (!u || !u.avatar || !u.avatarV) throw new HttpError(404, 'Sem foto.');
      return new Response(new Uint8Array(toBuffer(u.avatar)), {
        status: 200,
        headers: {
          'content-type': u.avatarMime || 'image/jpeg',
          'cache-control': 'public, max-age=300',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      });
    }),

    /* ---------- segurança da conta ---------- */
    passwordChange: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const body = await readJson(req, 3000);
      const current = String(body.current || '');
      const next = String(body.next || '');
      if (next.length < 6 || next.length > 72) throw new HttpError(400, 'A nova senha precisa ter de 6 a 72 caracteres.');
      if (!allow('pw:' + me._id, 8, 900000)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
      if (!(await verifyPassword(current, me.pass))) throw new HttpError(401, 'A senha atual está incorreta.');
      await db.collection('users').updateOne({ _id: me._id }, { $set: { pass: await hashPassword(next) } });
      const token = getCookie(req, COOKIE);
      await db.collection('sessions').deleteMany({ userId: me._id, _id: { $ne: sha256(token || '') } });
      return json({ ok: true });
    }),

    logoutAll: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      await db.collection('sessions').deleteMany({ userId: me._id });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', { secure: isSecure(req), maxAge: 0 }) });
    }),

    accountDelete: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const body = await readJson(req, 3000);
      if (!allow('del:' + me._id, 5, 900000)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
      if (!(await verifyPassword(String(body.password || ''), me.pass))) throw new HttpError(401, 'Senha incorreta.');
      const lib = db.collection('library');
      const mine = await lib.find({ authorId: me._id }, { projection: { svg: 0, data: 0 } }).limit(500).toArray();
      for (const it of mine) await db.collection('likes').deleteMany({ itemId: it._id });
      await lib.deleteMany({ authorId: me._id });
      const given = await db.collection('likes').find({ userId: me._id }).limit(1000).toArray();
      for (const l of given) await lib.updateOne({ _id: l.itemId }, { $inc: { likes: -1 } });
      await db.collection('likes').deleteMany({ userId: me._id });
      await db.collection('designs').deleteMany({ userId: me._id });
      await db.collection('sessions').deleteMany({ userId: me._id });
      await db.collection('users').deleteOne({ _id: me._id });
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', { secure: isSecure(req), maxAge: 0 }) });
    }),

    libraryRename: wrap(async (req, ctx) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const id = await idParam(ctx);
      const body = await readJson(req, 2000);
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 40) throw new HttpError(400, 'O nome precisa ter de 2 a 40 caracteres.');
      const col = db.collection('library');
      const d = await col.findOne({ _id: id }, { projection: { svg: 0, data: 0 } });
      if (!d) throw new HttpError(404, 'Item não encontrado.');
      if (d.authorId !== me._id) throw new HttpError(403, 'Só o autor pode renomear este item.');
      await col.updateOne({ _id: id }, { $set: { name } });
      return json({ item: itemMeta({ ...d, name }, me, false) });
    }),

    /* ---------- designs salvos ---------- */
    designsList: wrap(async (req) => {
      const db = await getDb();
      const me = await needUser(req, db);
      const rows = await db.collection('designs').find({ userId: me._id }, { projection: { snapshot: 0 } }).sort({ createdAt: -1 }).limit(50).toArray();
      return json({ items: rows.map((d) => ({ id: d._id, name: d.name, thumb: d.thumb, createdAt: d.createdAt })) });
    }),

    designsCreate: wrap(async (req) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const body = await readJson(req, 250000);
      const name = String(body.name || 'Meu design').trim().slice(0, 40) || 'Meu design';
      const snapshot = typeof body.snapshot === 'string' ? body.snapshot : JSON.stringify(body.snapshot || null);
      if (snapshot.length > 150000) throw new HttpError(413, 'Design grande demais.');
      try {
        const o = JSON.parse(snapshot);
        if (!o || typeof o !== 'object' || !Array.isArray(o.s)) throw new Error('x');
      } catch {
        throw new HttpError(400, 'Design inválido.');
      }
      const thumb = String(body.thumb || '');
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumb) || thumb.length > 40000) throw new HttpError(400, 'Miniatura inválida.');
      const col = db.collection('designs');
      if ((await col.countDocuments({ userId: me._id })) >= 30) throw new HttpError(409, 'Limite de 30 designs. Apague algum para salvar outro.');
      const doc = { _id: newId(), userId: me._id, name, snapshot, thumb, createdAt: new Date() };
      await col.insertOne(doc);
      return json({ item: { id: doc._id, name, thumb, createdAt: doc.createdAt } }, 201);
    }),

    designsGet: wrap(async (req, ctx) => {
      const db = await getDb();
      const me = await needUser(req, db);
      const id = await idParam(ctx);
      const d = await db.collection('designs').findOne({ _id: id, userId: me._id });
      if (!d) throw new HttpError(404, 'Design não encontrado.');
      return json({ id: d._id, name: d.name, snapshot: d.snapshot });
    }),

    designsDelete: wrap(async (req, ctx) => {
      checkOrigin(req);
      const db = await getDb();
      const me = await needUser(req, db);
      const id = await idParam(ctx);
      const d = await db.collection('designs').findOne({ _id: id, userId: me._id });
      if (!d) throw new HttpError(404, 'Design não encontrado.');
      await db.collection('designs').deleteOne({ _id: id });
      return json({ ok: true });
    }),
  };
  api.librarySvg = api.libraryFile; // rota antiga /svg continua valendo
  return api;
}
