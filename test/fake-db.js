// Banco em memória que imita só o que o projeto usa do driver do MongoDB.
// Serve para rodar os testes (e o preview local) sem precisar de um cluster.
const clone = (x) => (x === undefined ? x : structuredClone(x));

function get(doc, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc);
}

function matchValue(val, cond) {
  if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      if (op === '$in') return arg.includes(val);
      if (op === '$regex') {
        const re = new RegExp(arg, cond.$options || '');
        return typeof val === 'string' && re.test(val);
      }
      if (op === '$options') return true;
      if (op === '$ne') return val !== arg;
      throw new Error('operador não suportado no banco falso: ' + op);
    });
  }
  return val === cond;
}

function match(doc, filter = {}) {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return cond.some((f) => match(doc, f));
    return matchValue(get(doc, k), cond);
  });
}

function project(doc, projection) {
  if (!projection) return clone(doc);
  const keys = Object.keys(projection);
  const out = clone(doc);
  if (keys.every((k) => projection[k] === 0)) {
    keys.forEach((k) => delete out[k]);
    return out;
  }
  const res = { _id: doc._id };
  keys.forEach((k) => {
    if (projection[k]) res[k] = clone(doc[k]);
  });
  return res;
}

class Cursor {
  constructor(docs, projection) {
    this.docs = docs;
    this.projection = projection;
  }
  sort(spec) {
    const entries = Object.entries(spec);
    this.docs.sort((a, b) => {
      for (const [k, dir] of entries) {
        const x = a[k], y = b[k];
        if (x < y) return -dir;
        if (x > y) return dir;
      }
      return 0;
    });
    return this;
  }
  skip(n) { this.docs = this.docs.slice(n); return this; }
  limit(n) { this.docs = this.docs.slice(0, n); return this; }
  async toArray() { return this.docs.map((d) => project(d, this.projection)); }
}

class Collection {
  constructor(name) { this.name = name; this.docs = []; }
  async findOne(filter, opts = {}) {
    const d = this.docs.find((x) => match(x, filter));
    return d ? project(d, opts.projection) : null;
  }
  find(filter, opts = {}) {
    return new Cursor(this.docs.filter((x) => match(x, filter)).map((d) => d), opts.projection);
  }
  async insertOne(doc) {
    const dup = this.docs.some((d) => d._id === doc._id) || (this.name === 'users' && this.docs.some((d) => d.usernameLower === doc.usernameLower));
    if (dup) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    this.docs.push(clone(doc));
    return { insertedId: doc._id };
  }
  async updateOne(filter, update, opts = {}) {
    let d = this.docs.find((x) => match(x, filter));
    let inserted = false;
    if (!d) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
      d = {};
      Object.entries(filter).forEach(([k, v]) => { if (!k.startsWith('$') && (typeof v !== 'object' || v === null)) d[k] = v; });
      this.docs.push(d);
      inserted = true;
      Object.assign(d, clone(update.$setOnInsert || {}));
    }
    Object.assign(d, clone(update.$set || {}));
    Object.entries(update.$inc || {}).forEach(([k, v]) => { d[k] = (d[k] || 0) + v; });
    Object.keys(update.$unset || {}).forEach((k) => { delete d[k]; });
    return { matchedCount: inserted ? 0 : 1, upsertedCount: inserted ? 1 : 0 };
  }
  async updateMany(filter, update) {
    let n = 0;
    for (const d of this.docs.filter((x) => match(x, filter))) {
      Object.assign(d, clone(update.$set || {}));
      Object.entries(update.$inc || {}).forEach(([k, v]) => { d[k] = (d[k] || 0) + v; });
      n++;
    }
    return { matchedCount: n };
  }
  async deleteOne(filter) {
    const i = this.docs.findIndex((x) => match(x, filter));
    if (i >= 0) this.docs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  }
  async deleteMany(filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((x) => !match(x, filter));
    return { deletedCount: before - this.docs.length };
  }
  async countDocuments(filter) { return this.docs.filter((x) => match(x, filter)).length; }
  async createIndex() { return 'ok'; }
}

export function createFakeDb() {
  const cols = {};
  return { collection: (name) => cols[name] || (cols[name] = new Collection(name)), _cols: cols };
}
