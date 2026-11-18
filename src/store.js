// IndexedDB file store for assets the player imported from their own IPA (works in pages and workers).
const DB = 'gangstar-assets';
const STORE = 'files';
export const META = '__meta__';

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    let result;
    fn(s, (v) => { result = v; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted'));
  }));
}

/** value stored under path (ArrayBuffer / Uint8Array / object) or undefined */
export function get(path) {
  return tx('readonly', (s, done) => { const r = s.get(path); r.onsuccess = () => done(r.result); });
}

export function has(path) {
  return tx('readonly', (s, done) => { const r = s.count(path); r.onsuccess = () => done(r.result > 0); });
}

export function put(path, data) {
  return tx('readwrite', (s) => { s.put(data, path); });
}

/** write many [path, data] pairs in one transaction */
export function putMany(entries) {
  return tx('readwrite', (s) => { for (const [p, d] of entries) s.put(d, p); });
}

export function clear() {
  return tx('readwrite', (s) => { s.clear(); });
}

export function count() {
  return tx('readonly', (s, done) => { const r = s.count(); r.onsuccess = () => done(r.result); });
}

/** ask the browser not to evict the imported game (best effort) */
export async function persist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}

export async function estimate() {
  try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}
