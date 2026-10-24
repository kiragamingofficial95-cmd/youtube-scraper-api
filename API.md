# YouTube Scraper API

A scraper-backed, drop-in replacement for the **YouTube Data API v3**. It exposes the same REST paths, query parameters, and response envelopes as the official API, but collects data by scraping YouTube (via InnerTube) instead of using an API key/quota.

## Base URL

```
http://localhost:8080/youtube/v3
```

Mirrors `https://www.googleapis.com/youtube/v3`.

## Authentication

No API key or OAuth is required. The `key` query parameter (if sent) is ignored. Write operations are not supported by a scraper backend and return `501 Not Implemented`.

## Common query parameters

Search supports `enrich=true` to fetch per-video details (slower, may trigger bot checks). By default search returns snippet data only.

| Param | Description |
|---|---|
| `part` | Comma-separated parts (snippet, contentDetails, statistics, status, player, ...) |
| `maxResults` | 1-50 (default 5 for search, 50 for lists) |
| `pageToken` | Opaque continuation token returned as `nextPageToken` |
| `fields` | Not enforced; full resource returned |

## Endpoints

### Search
`GET /search`

| Param | Description |
|---|---|
| `q` / `query` | Search query |
| `type` | `video` (default), `channel`, `playlist` (only video supported) |
| `order` | relevance, date, rating, viewCount, title |
| `regionCode` | ISO country code |
| `relevanceLanguage` | ISO language code |
| `maxResults`, `pageToken` | pagination |

Response: `youtube#searchListResponse` with `items[]` of `youtube#searchResult`.

### Videos
`GET /videos?id=ID1,ID2&part=...`

Returns full video resources (snippet, contentDetails, statistics, status, player).

### Channels
`GET /channels?id=ID&part=...`
Also supports `handle=@name` and `forUsername`.

### Playlists
`GET /playlists?id=ID&part=...`

### Playlist items
`GET /playlistItems?playlistId=ID&part=...&maxResults=&pageToken=`

### Comment threads
`GET /commentThreads?videoId=ID&part=snippet&order=relevance|time&maxResults=&pageToken=`

> Note: YouTube may require sign-in to view comments; in that case an empty list is returned.

### Comments
`GET /comments?parentId=ID` (replies not supported; returns empty)

### Video categories
`GET /videoCategories?regionCode=US`

### i18n regions / languages
`GET /i18nRegions`, `GET /i18nLanguages`

### Guide categories
`GET /guideCategories`

### Read-only empty stubs
`/activities`, `/channelSections`, `/members`, `/membershipsLevels`, `/subscriptions`, `/captions` return empty lists (scraping not implemented).

## Write operations

All `POST/PUT/PATCH/DELETE` on resource collections return:

```json
{ "error": { "code": 501, "message": "... not supported by the scraper backend (read-only)." } }
```

## Example

```bash
# search
curl "http://localhost:8080/youtube/v3/search?q=nodejs&maxResults=3&part=snippet"

# video details
curl "http://localhost:8080/youtube/v3/videos?id=dQw4w9WgXcQ&part=snippet,contentDetails,statistics"

# channel
curl "http://localhost:8080/youtube/v3/channels?id=UCuAXFkgsw1L7xaCfnd5JJOw&part=snippet,statistics"

# playlist
curl "http://localhost:8080/youtube/v3/playlists?id=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&part=snippet,contentDetails"

# playlist items
curl "http://localhost:8080/youtube/v3/playlistItems?playlistId=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&part=snippet,contentDetails&maxResults=10"
```

## Running

```bash
cd youtube-scraper-api
npm install
npm start
```

Server listens on `PORT` (default 8080).

## Limitations

- Scraping is unofficial and may break when YouTube changes its frontend.
- Exact `publishedAt` for search results is enriched via per-video fetch (may be slower).
- Comments may be gated behind sign-in.
- Write operations are not supported.
- Quota/rate limits are governed by YouTube's anti-bot measures; run responsibly.
EOF