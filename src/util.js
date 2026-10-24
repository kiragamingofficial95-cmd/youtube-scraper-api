export function textOf(t) {
  if (t == null) return null;
  if (typeof t === 'string') return t;
  if (typeof t === 'object') {
    if (typeof t.text === 'string') return t.text;
    if (Array.isArray(t.runs)) return t.runs.map(r => r.text || '').join('');
    if (t.simpleText) return t.simpleText;
  }
  return null;
}

export function numFromText(s) {
  if (s == null) return null;
  const str = String(s).replace(/,/g, '');
  const m = str.match(/([\d.]+)\s*([kmb])?/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const suf = (m[2] || '').toLowerCase();
  if (suf === 'k') n *= 1e3;
  else if (suf === 'm') n *= 1e6;
  else if (suf === 'b') n *= 1e9;
  else {
    const m2 = str.match(/([\d.]+)([kmb])/i);
    if (m2) {
      const suf2 = m2[2].toLowerCase();
      if (suf2 === 'k') n *= 1e3;
      else if (suf2 === 'm') n *= 1e6;
      else if (suf2 === 'b') n *= 1e9;
    }
  }
  return Math.round(n);
}

export function isoDuration(seconds) {
  if (seconds == null) return null;
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  let out = 'PT';
  if (h) out += h + 'H';
  if (m) out += m + 'M';
  if (sec || (!h && !m)) out += sec + 'S';
  return out;
}

export function pickThumbs(thumbs) {
  const out = {};
  if (!Array.isArray(thumbs) || !thumbs.length) return out;
  const sorted = [...thumbs].sort((a, b) => (a.width || 0) - (b.width || 0));
  const map = (key, idx) => {
    const t = sorted[Math.min(idx, sorted.length - 1)];
    if (t) out[key] = { url: t.url, width: t.width, height: t.height };
  };
  map('default', 0);
  map('medium', Math.min(1, sorted.length - 1));
  map('high', sorted.length - 1);
  if (sorted.length >= 4) {
    map('standard', Math.min(2, sorted.length - 1));
    map('maxres', sorted.length - 1);
  }
  return out;
}

export function nowIso() { return new Date().toISOString(); }

export function parsePublishedText(txt) {
  // best-effort: return null (exact date unknown from relative text)
  return null;
}

// simple in-memory cache
const cache = new Map();
export function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return undefined;
  if (e.exp && Date.now() > e.exp) { cache.delete(key); return undefined; }
  return e.val;
}
export function cacheSet(key, val, ttlMs = 300000) {
  cache.set(key, { val, exp: Date.now() + ttlMs });
}

export async function limitConcurrency(items, fn, limit = 4) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { __error: e?.message || String(e) }; }
    }
  });
  await Promise.all(workers);
  return results;
}
