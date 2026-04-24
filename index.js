const express = require('express');
const cors = require('cors');
const AnimePahe = require('./lib/animepahe');

const app = express();
const PORT = process.env.PORT || 3000;

// PROXY_URL: base URL of your deployed AnimePahe-Proxy instance.
// e.g. https://your-proxy.up.railway.app
// Set this as an environment variable. proxy_url in /m3u8 responses will be null if not set.
const PROXY_URL = (process.env.PROXY_URL || '').replace(/\/$/, '');

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
}));
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Create AnimePahe instance
const pahe = new AnimePahe();

function mapErrorToStatusCode(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('not found')) return 404;
  if (text.includes('blocked') || text.includes('anti-bot')) return 503;
  if (text.includes('forbidden')) return 403;
  return 500;
}

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Animepahe API',
    endpoints: {
      search: '/search?q=naruto',
      episodes: '/episodes?session=anime-session-id',
      sources: '/sources?anime_session=xxx&episode_session=yyy',
      ids: '/ids?session=anime-session-id',
      m3u8: '/m3u8?url=kwik-url',
      health: '/health'
    },
    usage: {
      note: 'Use proxy_url from /m3u8 directly in your video player',
      step1: 'Search: GET /search?q=<title>',
      step2: 'Episodes: GET /episodes?session=<session>',
      step3: 'Sources: GET /sources?anime_session=<session>&episode_session=<session>',
      step4: 'M3U8: GET /m3u8?url=<kwik-url>',
      step5: 'Play: feed proxy_url from step 4 into your video player'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Animepahe API is alive!' });
});

app.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });
    const results = await pahe.search(q);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/episodes', async (req, res) => {
  try {
    const { session } = req.query;
    if (!session) return res.status(400).json({ error: 'Query parameter "session" is required' });
    const episodes = await pahe.getEpisodes(session);
    res.json(episodes);
  } catch (error) {
    console.error('Episodes error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/sources', async (req, res) => {
  try {
    const { anime_session, episode_session } = req.query;
    if (!anime_session || !episode_session) {
      return res.status(400).json({
        error: 'Query parameters "anime_session" and "episode_session" are required'
      });
    }
    const sources = await pahe.getSources(anime_session, episode_session);
    res.json(sources);
  } catch (error) {
    console.error('Sources error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/ids', async (req, res) => {
  try {
    const { session } = req.query;
    if (!session) return res.status(400).json({ error: 'Query parameter "session" is required' });
    const ids = await pahe.getIds(session);
    res.json(ids);
  } catch (error) {
    console.error('IDs error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

app.get('/m3u8', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Query parameter "url" is required' });

    const result = await pahe.resolveKwikWithNode(url);

    // Build proxy_url pointing at the dedicated AnimePahe-Proxy service.
    // The proxy accepts: GET /m3u8-proxy?url=<encoded-m3u8>&headers=<encoded-json>
    const headersJson = JSON.stringify({
      Referer: result.referer,
      Origin: result.origin
    });

    const proxy_url = PROXY_URL
      ? `${PROXY_URL}/m3u8-proxy?url=${encodeURIComponent(result.m3u8)}&headers=${encodeURIComponent(headersJson)}`
      : null;

    res.json({
      m3u8: result.m3u8,
      referer: result.referer,
      headers: {
        Referer: result.referer,
        Origin: result.origin
      },
      proxy_url
    });
  } catch (error) {
    console.error('M3U8 resolution error:', error);
    res.status(mapErrorToStatusCode(error.message)).json({ error: error.message });
  }
});

// CORS preflight
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Authorization');
  res.sendStatus(200);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Animepahe API running on port ${PORT}`);
    if (PROXY_URL) {
      console.log(`Proxy URL: ${PROXY_URL}`);
    } else {
      console.warn('PROXY_URL not set — proxy_url will be null in /m3u8 responses.');
    }
  });
}
