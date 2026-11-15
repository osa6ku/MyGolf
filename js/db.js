// IndexedDB の薄いラッパー（生 API）。保存は「書いたら読み戻して照合」が原則。
import { DB_NAME, DB_VERSION } from './config.js';

let _db = null;

export function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('master')) db.createObjectStore('master', { keyPath: 'course_id' });
      if (!db.objectStoreNames.contains('round')) db.createObjectStore('round', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'round_id' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out._value !== undefined ? out._value : out);
    t.onerror = () => reject(t.error);
  }));
}

export function get(store, key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

export function put(store, value) {
  return tx(store, 'readwrite', s => { s.put(value); return true; });
}

export function del(store, key) {
  return tx(store, 'readwrite', s => { s.delete(key); return true; });
}

export function getAll(store) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

export function clear(store) {
  return tx(store, 'readwrite', s => { s.clear(); return true; });
}

// 書いて読み戻し、JSON が一致しなければ例外（保存失敗を握りつぶさない）
export async function putVerified(store, value, keyOf) {
  await put(store, value);
  const back = await get(store, keyOf(value));
  if (JSON.stringify(back) !== JSON.stringify(value)) {
    throw new Error('保存の照合に失敗しました');
  }
  return back;
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await put('meta', { key, value });
}
