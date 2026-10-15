// Limite simples em memória (por instância). Serve para frear abusos básicos.
const store = globalThis.__pfpRateLimit || (globalThis.__pfpRateLimit = new Map());

export function allow(key, limit, windowMs) {
  const now = Date.now();
  const hits = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store.set(key, hits);
    return false;
  }
  hits.push(now);
  store.set(key, hits);
  if (store.size > 5000) {
    for (const [k, v] of store) if (!v.length || now - v[v.length - 1] > windowMs) store.delete(k);
  }
  return true;
}

export function resetRateLimit() {
  store.clear();
}
