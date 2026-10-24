import app from './app.js';

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`youtube-scraper-api listening on http://localhost:${PORT}`);
  console.log(`Base path: /youtube/v3  (mirrors YouTube Data API v3)`);
});
