// Converts the player's IPA into the IndexedDB asset store off the main thread.
import { openZip } from './import/zip.js';
import { convertAll } from './import/convert.js';
import * as store from './store.js';

const enc = new TextEncoder();

/** copy into a standalone ArrayBuffer so IndexedDB never clones a whole parent buffer */
function toBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.slice().buffer;
  }
  if (typeof data === 'string') return enc.encode(data).buffer;
  return enc.encode(JSON.stringify(data)).buffer;
}

self.onmessage = async (e) => {
  const { file } = e.data;
  const t0 = performance.now();
  try {
    await store.clear();
    const zip = await openZip(file);
    let batch = [], bytes = 0, files = 0;
    const flush = async () => { if (batch.length) { const b = batch; batch = []; bytes = 0; await store.putMany(b); } };
    const write = async (path, data) => {
      const buf = toBuffer(data);
      batch.push([path, buf]);
      bytes += buf.byteLength; files++;
      if (bytes > 12e6 || batch.length >= 150) await flush();
    };
    const progress = (p, msg) => {
      if (p && typeof p === 'object') ({ p, msg } = { p: p.p ?? p.progress ?? 0, msg: p.msg ?? p.message });
      self.postMessage({ type: 'progress', p, msg });
    };
    await convertAll({ read: zip.read, list: zip.list, write, progress });
    await flush();
    await store.put(store.META, { done: true, date: Date.now(), version: 1, files, seconds: Math.round((performance.now() - t0) / 1000) });
    self.postMessage({ type: 'done', files, seconds: (performance.now() - t0) / 1000 });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err), stack: err && err.stack });
  }
};
