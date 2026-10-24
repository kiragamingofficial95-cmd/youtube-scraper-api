import { textOf, numFromText, isoDuration, pickThumbs, nowIso } from './util.js';

export function transformVideo(info, parts = []) {
  const b = info.basic_info || {};
  const p = info.primary_info || {};
  const s = info.secondary_info || {};
  const micro = info.player_microformat || info.microformat || {};
  const res = { kind: 'youtube#video', id: b.id || info.id };
  const want = (name) => parts.length === 0 || parts.includes(name);

  if (want('snippet')) {
    const thumbs = pickThumbs(b.thumbnail || []);
    const tags = Array.isArray(b.keywords) ? b.keywords : (Array.isArray(b.tags) ? b.tags : []);
    res.snippet = {
      publishedAt: b.publish_date || b.upload_date || null,
      channelId: b.channel_id || null,
      title: b.title || null,
      description: b.short_description || textOf(s.description) || null,
      thumbnails: thumbs,
      channelTitle: b.author || null,
      tags,
      categoryId: b.category || null,
      liveBroadcastContent: b.is_live ? 'live' : (b.is_upcoming ? 'upcoming' : 'none'),
      defaultLanguage: null,
      localized: { title: b.title || null, description: b.short_description || null }
    };
  }
  if (want('contentDetails')) {
    res.contentDetails = {
      duration: isoDuration(b.duration),
      dimension: '2d',
      definition: 'hd',
      caption: (info.captions && info.captions.caption_tracks && info.captions.caption_tracks.length) ? 'true' : 'false',
      licensedContent: false,
      contentRating: {},
      projection: 'rectangular'
    };
  }
  if (want('statistics')) {
    res.statistics = {
      viewCount: b.view_count != null ? String(b.view_count) : (textOf(p.view_count)?.replace(/[^0-9]/g, '') || null),
      likeCount: b.like_count != null ? String(b.like_count) : null,
      favoriteCount: '0',
      commentCount: null
    };
  }
  if (want('status')) {
    res.status = {
      uploadStatus: 'processed',
      privacyStatus: 'public',
      license: 'youtube',
      embeddable: true,
      publicStatsViewable: true,
      madeForKids: false
    };
  }
  if (want('player')) {
    res.player = { embedHtml: `<iframe width="640" height="360" src="https://www.youtube.com/embed/${b.id}" frameborder="0" allowfullscreen></iframe>` };
  }
  if (want('topicDetails')) {
    res.topicDetails = { topicCategories: [] };
  }
  if (want('recordingDetails')) {
    res.recordingDetails = {};
  }
  if (want('fileDetails') || want('processingDetails') || want('suggestions')) {
    // not available via scraping
  }
  return res;
}

export function transformSearchVideo(v, parts = []) {
  const id = v.video_id;
  const thumbs = pickThumbs(v.thumbnails || []);
  const res = { kind: 'youtube#searchResult', id: { kind: 'youtube#video', videoId: id } };
  if (true) {
    res.snippet = {
      publishedAt: null,
      channelId: v.author?.id || null,
      title: textOf(v.title) || null,
      description: textOf(v.description_snippet) || textOf(v.snippets?.[0]) || null,
      thumbnails: thumbs,
      channelTitle: v.author?.name || null,
      liveBroadcastContent: v.is_live ? 'live' : 'none'
    };
  }
  return res;
}

export function transformChannel(ch, parts = []) {
  const meta = ch.metadata || {};
  const header = ch.header?.content || {};
  const about = ch.about || null;
  const res = { kind: 'youtube#channel', id: meta.external_id || meta.channel_id || header?.metadata?.rows?.[0]?.metadata_parts?.[0]?.text?.text };
  // try id from metadata
  const channelId = meta.external_id || null;
  res.id = channelId || res.id;
  const want = (name) => parts.length === 0 || parts.includes(name);

  // subscriber text
  let subsText = null;
  try { subsText = (about?.metadata?.subscriber_count) || null; } catch {}
  if (!subsText) {
    try {
      const rows = header?.metadata?.metadata_rows || [];
      for (const r of rows) for (const p of (r.metadata_parts || [])) {
        const t = textOf(p.text);
        if (t && /subscribers/i.test(t)) subsText = t;
      }
    } catch {}
  }
  // view count text
  let viewsText = null;
  try { viewsText = about?.metadata?.view_count || null; } catch {}
  // country
  let country = null;
  try { country = about?.metadata?.country || null; } catch {}
  // description
  const description = meta.description || textOf(header?.description) || null;
  // custom url
  const customUrl = meta.vanity_channel_url ? meta.vanity_channel_url.replace('http://www.youtube.com/', '').replace('https://www.youtube.com/', '') : null;
  // avatar thumbs
  const thumbs = pickThumbs(meta.avatar || header?.image?.sources || []);

  if (want('snippet')) {
    res.snippet = {
      title: meta.title || textOf(header?.title) || null,
      description: description || null,
      customUrl: customUrl,
      publishedAt: null,
      thumbnails: thumbs,
      defaultLanguage: null,
      localized: { title: meta.title || null, description: description || null },
      country: country
    };
  }
  if (want('statistics')) {
    res.statistics = {
      viewCount: numFromText(viewsText) != null ? String(numFromText(viewsText)) : null,
      subscriberCount: numFromText(subsText) != null ? String(numFromText(subsText)) : null,
      hiddenSubscriberCount: false,
      videoCount: null
    };
  }
  if (want('contentDetails')) {
    res.contentDetails = {
      relatedPlaylists: { likes: null, favorites: null, uploads: null }
    };
  }
  if (want('brandingSettings')) {
    res.brandingSettings = {
      channel: { title: meta.title || null, description: description || null, keywords: meta.keywords || null, defaultLanguage: null, country: country },
      image: {}
    };
  }
  if (want('status')) {
    res.status = { privacyStatus: 'public', isLinked: true, longUploadsStatus: 'longUploadsUnspecified' };
  }
  return res;
}

export function transformPlaylist(pl, parts = []) {
  const info = pl.info || {};
  const author = info.author || {};
  const thumbs = pickThumbs(info.thumbnails || []);
  const itemCount = numFromText(info.total_items) || (Array.isArray(pl.videos) ? pl.videos.length : 0);
  const res = { kind: 'youtube#playlist', id: null };
  // playlist id not in info; caller sets
  const want = (name) => parts.length === 0 || parts.includes(name);
  if (want('snippet')) {
    res.snippet = {
      publishedAt: null,
      channelId: author.id || null,
      title: textOf(info.title) || info.title || null,
      description: info.description || null,
      thumbnails: thumbs,
      channelTitle: author.name || null,
      defaultLanguage: null,
      localized: { title: textOf(info.title) || info.title || null, description: info.description || null }
    };
  }
  if (want('contentDetails')) {
    res.contentDetails = { itemCount };
  }
  if (want('status')) {
    res.status = { privacyStatus: (info.privacy || 'public').toLowerCase() };
  }
  if (want('player')) {
    res.player = { embedHtml: '' };
  }
  return res;
}

export function transformPlaylistItem(pv, playlistId, position) {
  const meta = pv.metadata || {};
  const lockMeta = meta.metadata || {};
  // title
  const title = textOf(meta.title) || null;
  // video id
  const videoId = pv.content_id || null;
  // thumbnails
  const thumbs = pickThumbs(pv.content_image?.image || []);
  // published approx
  let publishedAt = null;
  // try metadata rows for date
  try {
    const rows = lockMeta.metadata_rows || [];
    for (const r of rows) for (const part of (r.metadata_parts || [])) {
      const t = textOf(part.text);
      if (t && /\d/.test(t) && /(ago|20\d\d)/i.test(t)) {
        // leave as null if relative; if looks like year, try parse
      }
    }
  } catch {}
  const item = {
    kind: 'youtube#playlistItem',
    id: `${playlistId}_${videoId}_${position}`,
    snippet: {
      publishedAt: publishedAt,
      channelId: null,
      title: title,
      description: null,
      thumbnails: thumbs,
      channelTitle: null,
      videoOwnerChannelId: null,
      videoOwnerChannelTitle: null,
      playlistId: playlistId,
      position: position,
      resourceId: { kind: 'youtube#video', videoId: videoId }
    },
    contentDetails: {
      videoId: videoId,
      videoPublishedAt: publishedAt
    },
    status: { privacyStatus: 'public' }
  };
  return item;
}

export function transformCommentThread(ct) {
  // best effort; may be empty due to sign-in wall
  const c = ct.comment || {};
  const res = { kind: 'youtube#commentThread', id: null, snippet: {} };
  // try fields
  const author = c.author || c.author_text || null;
  const text = textOf(c.content) || textOf(c.text) || null;
  const published = c.published_time || c.published || null;
  res.snippet = {
    channelId: null,
    videoId: null,
    topLevelComment: {
      kind: 'youtube#comment',
      id: null,
      snippet: {
        authorDisplayName: (author && (author.name || textOf(author))) || null,
        authorProfileImageUrl: (author && author.thumbnails?.[0]?.url) || null,
        authorChannelUrl: null,
        authorChannelId: { value: (author && author.id) || null },
        channelId: null,
        videoId: null,
        textDisplay: text,
        textOriginal: text,
        parentId: null,
        canRate: true,
        viewerRating: 'none',
        likeCount: numFromText(textOf(c.vote_count) || c.like_count) || 0,
        publishedAt: published,
        updatedAt: published
      }
    },
    canReply: true,
    totalReplyCount: (ct.replies && Array.isArray(ct.replies) ? ct.replies.length : 0),
    isPublic: true
  };
  return res;
}
