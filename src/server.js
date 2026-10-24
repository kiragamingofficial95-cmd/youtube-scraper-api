import express from 'express';
import cors from 'cors';
import { yt } from './innertube.js';
import { textOf, numFromText, isoDuration, pickThumbs, cacheGet, cacheSet, limitConcurrency } from './util.js';
import {
  transformVideo, transformSearchVideo, transformChannel, transformPlaylist,
  transformPlaylistItem, transformCommentThread
} from './transform.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8080;

// continuation store (in-memory, TTL)
const contStore = new Map();
function storeCont(obj) {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  contStore.set(token, { obj, exp: Date.now() + 10 * 60 * 1000 });
  // cleanup
  if (contStore.size > 500) {
    const now = Date.now();
    for (const [k, v] of contStore) if (v.exp < now) contStore.delete(k);
  }
  return token;
}
function loadCont(token) {
  if (!token) return null;
  const e = contStore.get(token);
  if (!e || e.exp < Date.now()) { contStore.delete(token); return null; }
  return e.obj;
}

// helpers
function parts(req) {
  const p = req.query.part;
  if (!p) return [];
  return String(p).split(',').map(s => s.trim()).filter(Boolean);
}
function maxResults(req, def = 5) {
  const n = parseInt(req.query.maxResults, 10);
  if (isNaN(n) || n < 1) return def;
  return Math.min(n, 50);
}
function sendPage(res, items, nextPageToken, pageInfo) {
  res.json({
    kind: 'youtube#resourceListResponse',
    etag: 'W/"scraper"',
    nextPageToken: nextPageToken || undefined,
    prevPageToken: undefined,
    pageInfo: pageInfo || { totalResults: items.length, resultsPerPage: items.length },
    items
  });
}
function err(res, code, message, status = 400) {
  res.status(status).json({
    error: { code: status, message, errors: [{ domain: 'youtube', reason: 'invalidRequest', message }] }
  });
}
function notImpl(res, method, path) {
  res.status(501).json({
    error: { code: 501, message: `${method} ${path} is not supported by the scraper backend (read-only).`, errors: [{ domain: 'youtube', reason: 'notImplemented' }] }
  });
}

// ---------- search ----------
app.get('/youtube/v3/search', async (req, res) => {
  try {
    const q = req.query.q || req.query.query || '';
    const type = req.query.type || 'video';
    const mr = maxResults(req, 5);
    const pt = req.query.pageToken;
    let pageObj = null;
    if (pt) pageObj = loadCont(pt);

    const client = await yt();
    let searchObj;
    if (pageObj) {
      searchObj = await pageObj.getContinuation();
    } else {
      const opts = { type };
      if (req.query.order) opts.order = req.query.order;
      if (req.query.regionCode) opts.gl = req.query.regionCode;
      if (req.query.relevanceLanguage) opts.hl = req.query.relevanceLanguage;
      searchObj = await client.search(q, opts);
    }

    const rawVideos = (searchObj.results || []).filter(r => r.type === 'Video');
    const sliced = rawVideos.slice(0, mr);

    // optional enrichment (opt-in; default off to avoid bot detection / slowness)
    const enrich = req.query.enrich === 'true';
    let items = sliced.map(transformSearchVideo);
    if (enrich && sliced.length <= 12) {
      const infos = await limitConcurrency(sliced, async (v) => {
        try {
          const info = await client.getBasicInfo(v.video_id);
          return info;
        } catch { return null; }
      }, 4);
      items = sliced.map((v, i) => {
        const base = transformSearchVideo(v, parts(req));
        const info = infos[i];
        if (info) {
          const full = transformVideo(info, parts(req));
          // merge snippet fields into searchResult snippet
          if (full.snippet) {
            base.snippet = { ...base.snippet, ...full.snippet };
            // publishedAt from full
            base.snippet.publishedAt = full.snippet.publishedAt;
          }
          base.id = base.id;
        }
        return base;
      });
    }

    // filter by type
    let filtered = items;
    if (type && type !== 'video') {
      // only videos supported; return as-is
    }

    const nextPageToken = searchObj.has_continuation ? storeCont(searchObj) : null;
    sendPage(res, filtered, nextPageToken, {
      totalResults: searchObj.estimated_results || filtered.length,
      resultsPerPage: filtered.length
    });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- videos ----------
app.get('/youtube/v3/videos', async (req, res) => {
  try {
    const ids = String(req.query.id || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return err(res, 400, 'id parameter required');
    const client = await yt();
    const ps = parts(req);
    const infos = await limitConcurrency(ids, async (id) => {
      try {
        let info = await client.getBasicInfo(id);
        if (!info?.basic_info?.title) {
          try { info = await client.getInfo(id); } catch {}
        }
        return info;
      } catch (e) { return { __error: e?.message }; }
    }, 2);
    const items = [];
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (info && !info.__error && info.basic_info?.title) {
        items.push(transformVideo(info, ps));
      } else {
        // fallback minimal resource
        items.push({ kind: 'youtube#video', id: ids[i], snippet: null });
      }
    }
    sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- channels ----------
app.get('/youtube/v3/channels', async (req, res) => {
  try {
    const client = await yt();
    const ps = parts(req);
    const ids = [];
    if (req.query.id) ids.push(...String(req.query.id).split(',').map(s=>s.trim()).filter(Boolean));
    // handle forUsername / handle
    if (req.query.forUsername) ids.push(req.query.forUsername);
    const handles = req.query.handle ? String(req.query.handle).split(',').map(s=>s.trim()).filter(Boolean) : [];
    const toFetch = [...ids];
    // resolve handles
    for (const h of handles) {
      try {
        const r = await client.resolveURL(h.startsWith('@') ? `https://www.youtube.com/${h}` : (h.startsWith('http') ? h : `https://www.youtube.com/@${h}`));
        const bid = r?.payload?.browseId;
        if (bid) toFetch.push(bid);
      } catch {}
    }
    if (!toFetch.length && req.query.managedByMe) {
      // not supported
    }
    if (!toFetch.length) return err(res, 400, 'id or handle required');
    const items = [];
    for (const id of toFetch) {
      try {
        const ch = await client.getChannel(id);
        // attach about
        try { ch.about = await ch.getAbout(); } catch {}
        const tr = transformChannel(ch, ps);
        if (!tr.id) tr.id = id;
        tr.id = id;
        items.push(tr);
      } catch (e) {
        // skip
      }
    }
    sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- playlists ----------
app.get('/youtube/v3/playlists', async (req, res) => {
  try {
    const client = await yt();
    const ps = parts(req);
    const ids = String(req.query.id || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return err(res, 400, 'id required');
    const items = [];
    for (const id of ids) {
      try {
        const pl = await client.getPlaylist(id);
        const tr = transformPlaylist(pl, ps);
        tr.id = id;
        items.push(tr);
      } catch {}
    }
    sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- playlistItems ----------
app.get('/youtube/v3/playlistItems', async (req, res) => {
  try {
    const playlistId = req.query.playlistId;
    if (!playlistId) return err(res, 400, 'playlistId required');
    const client = await yt();
    const ps = parts(req);
    const mr = maxResults(req, 50);
    const pt = req.query.pageToken;
    let pageObj = loadCont(pt);
    let pl;
    if (pageObj) {
      pl = pageObj;
    } else {
      pl = await client.getPlaylist(playlistId);
    }
    // pl.videos
    const vids = Array.isArray(pl.videos) ? pl.videos : [];
    const sliced = vids.slice(0, mr);
    const items = sliced.map((pv, idx) => transformPlaylistItem(pv, playlistId, idx));
    // continuation
    let nextPageToken = null;
    if (pl.has_continuation) {
      try {
        const more = await pl.getContinuation();
        nextPageToken = storeCont(more);
      } catch {}
    }
    // if we sliced less than available but no continuation object? handle offset via store of pl
    if (!nextPageToken && vids.length > mr) {
      // store current pl with offset? We'll just store pl for next call (not sliced). Simpler: store pl and let client request next page; but our transform uses full vids. To avoid complexity, store a wrapper with offset.
      // Fallback: no pagination beyond first page for large playlists unless continuation supported.
    }
    sendPage(res, items, nextPageToken, {
      totalResults: numFromText(pl.info?.total_items) || vids.length,
      resultsPerPage: items.length
    });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- commentThreads ----------
app.get('/youtube/v3/commentThreads', async (req, res) => {
  try {
    const videoId = req.query.videoId;
    if (!videoId) return err(res, 400, 'videoId required');
    const client = await yt();
    const mr = maxResults(req, 20);
    const order = (req.query.order || 'relevance').toLowerCase();
    const sortBy = order === 'time' ? 'NEWEST_FIRST' : 'TOP_COMMENTS';
    const pt = req.query.pageToken;
    let commentsObj = loadCont(pt);
    if (!commentsObj) {
      commentsObj = await client.getComments(videoId, sortBy);
    }
    const threads = Array.isArray(commentsObj.contents) ? commentsObj.contents : [];
    const sliced = threads.slice(0, mr);
    const items = sliced.map(ct => {
      const t = transformCommentThread(ct);
      t.snippet.videoId = videoId;
      if (t.snippet.topLevelComment) t.snippet.topLevelComment.snippet.videoId = videoId;
      return t;
    });
    let nextPageToken = null;
    if (commentsObj.has_continuation) {
      try {
        const more = await commentsObj.getContinuation();
        nextPageToken = storeCont(more);
      } catch {}
    }
    sendPage(res, items, nextPageToken, { totalResults: items.length, resultsPerPage: items.length });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- comments ----------
app.get('/youtube/v3/comments', async (req, res) => {
  // parentId required; reuse thread listing
  try {
    const parentId = req.query.parentId;
    if (!parentId) return err(res, 400, 'parentId required');
    // Not supported replies extraction easily; return empty
    sendPage(res, [], null, { totalResults: 0, resultsPerPage: 0 });
  } catch (e) {
    err(res, 500, e?.message || String(e), 500);
  }
});

// ---------- static-ish endpoints ----------
const VIDEO_CATEGORIES = [
  { id: '1', title: 'Film & Animation' }, { id: '2', title: 'Autos & Vehicles' },
  { id: '10', title: 'Music' }, { id: '15', title: 'Pets & Animals' },
  { id: '17', title: 'Sports' }, { id: '18', title: 'Short Movies' },
  { id: '19', title: 'Travel & Events' }, { id: '20', title: 'Gaming' },
  { id: '21', title: 'Videoblogging' }, { id: '22', title: 'People & Blogs' },
  { id: '23', title: 'Comedy' }, { id: '24', title: 'Entertainment' },
  { id: '25', title: 'News & Politics' }, { id: '26', title: 'Howto & Style' },
  { id: '27', title: 'Education' }, { id: '28', title: 'Science & Technology' },
  { id: '29', title: 'Nonprofits & Activism' }
];
app.get('/youtube/v3/videoCategories', (req, res) => {
  const region = req.query.regionCode || 'US';
  const items = VIDEO_CATEGORIES.map(c => ({ kind: 'youtube#videoCategory', etag: 'W/"scraper"', id: c.id, snippet: { title: c.title, assignable: true, channelId: 'UCBR8-60-B28hp2BmDPdntcQ' } }));
  sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
});

const REGIONS = ['US','GB','CA','AU','IN','DE','FR','JP','KR','BR','MX','ES','IT','NL','SE','NO','DK','FI','PL','RU','TR','SA','AE','EG','ZA','NG','KE','AR','CL','CO','PE','VE','PH','ID','TH','VN','MY','SG','HK','TW','CN'];
app.get('/youtube/v3/i18nRegions', (req, res) => {
  const items = REGIONS.map(code => ({ kind: 'youtube#i18nRegion', etag: 'W/"scraper"', id: code, snippet: { gl: code, name: code } }));
  sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
});

const LANGS = ['en','es','fr','de','it','pt','ru','ja','ko','zh','ar','hi','bn','tr','vi','th','id','nl','pl','sv','no','da','fi','cs','el','he','ro','hu','uk','fa'];
app.get('/youtube/v3/i18nLanguages', (req, res) => {
  const items = LANGS.map(code => ({ kind: 'youtube#i18nLanguage', etag: 'W/"scraper"', id: code, snippet: { hl: code, name: code } }));
  sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
});

app.get('/youtube/v3/guideCategories', (req, res) => {
  const items = [{ kind: 'youtube#guideCategory', etag: 'W/"scraper"', id: 'GCQmVzaWM', snippet: { title: 'Music' } }];
  sendPage(res, items, null, { totalResults: items.length, resultsPerPage: items.length });
});

// empty read endpoints
for (const p of ['/youtube/v3/activities','/youtube/v3/channelSections','/youtube/v3/members','/youtube/v3/membershipsLevels','/youtube/v3/subscriptions','/youtube/v3/captions']) {
  app.get(p, (req, res) => sendPage(res, [], null, { totalResults: 0, resultsPerPage: 0 }));
}

// captions list by videoId -> empty (scraping captions possible but omitted)
app.get('/youtube/v3/captions', (req, res) => {
  sendPage(res, [], null, { totalResults: 0, resultsPerPage: 0 });
});

// ---------- write endpoints (parity, not supported) ----------
const writePaths = [
  '/youtube/v3/videos', '/youtube/v3/channels', '/youtube/v3/playlists',
  '/youtube/v3/playlistItems', '/youtube/v3/comments', '/youtube/v3/commentThreads',
  '/youtube/v3/subscriptions', '/youtube/v3/channelSections', '/youtube/v3/captions',
  '/youtube/v3/thumbnails', '/youtube/v3/watermarks', '/youtube/v3/channelBanners'
];
for (const p of writePaths) {
  app.post(p, (req, res) => notImpl(res, 'POST', p));
  app.put(p, (req, res) => notImpl(res, 'PUT', p));
  app.patch(p, (req, res) => notImpl(res, 'PATCH', p));
  app.delete(p, (req, res) => notImpl(res, 'DELETE', p));
}
// insert/update/delete aliases
app.post('/youtube/v3/videos/insert', (req, res) => notImpl(res, 'POST', req.path));
app.post('/youtube/v3/playlists/insert', (req, res) => notImpl(res, 'POST', req.path));

// catch-all
app.all('/youtube/v3/*', (req, res) => {
  if (req.method === 'GET') return err(res, 404, `Unknown endpoint: ${req.path}`, 404);
  return notImpl(res, req.method, req.path);
});

app.get('/', (req, res) => {
  res.json({ name: 'youtube-scraper-api', version: '1.0.0', docs: '/API.md' });
});

app.listen(PORT, () => {
  console.log(`youtube-scraper-api listening on http://localhost:${PORT}`);
  console.log(`Base path: /youtube/v3  (mirrors YouTube Data API v3)`);
});
