import { MongoClient } from 'mongodb';

const cache = globalThis.__pfpMongo || (globalThis.__pfpMongo = { promise: null, indexed: false });

export async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('A variável MONGODB_URI não está configurada.');
  if (!cache.promise) {
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 8000 });
    cache.promise = client.connect().then((c) => c.db(process.env.MONGODB_DB || 'blankpfp'));
    cache.promise.catch(() => {
      cache.promise = null;
    });
  }
  const db = await cache.promise;
  if (!cache.indexed) {
    cache.indexed = true;
    try {
      await ensureIndexes(db);
    } catch (e) {
      cache.indexed = false;
      console.error('Falha ao criar índices:', e);
    }
  }
  return db;
}

export async function ensureIndexes(db) {
  await Promise.all([
    db.collection('users').createIndex({ usernameLower: 1 }, { unique: true }),
    db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('library').createIndex({ type: 1, createdAt: -1 }),
    db.collection('library').createIndex({ likes: -1, createdAt: -1 }),
    db.collection('library').createIndex({ authorId: 1 }),
    db.collection('likes').createIndex({ itemId: 1 }),
    db.collection('designs').createIndex({ userId: 1, createdAt: -1 }),
  ]);
}
