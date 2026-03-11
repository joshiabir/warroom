/**
 * UAE WAR ROOM — RSS Proxy Server
 * Run: node server.js
 * Serves the frontend + proxies RSS feeds server-side (no browser CORS issues)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ─── RSS Feed Definitions ───────────────────────────────────────────────────
const RSS_FEEDS = [
  {
    id: 'aljazeera',
    name: 'AL JAZEERA',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    tag: 'CONFLICT',
    tagClass: 'tag-conflict'
  },
  {
    id: 'gulfnews',
    name: 'GULF NEWS',
    url: 'https://gulfnews.com/rss',
    tag: 'REGIONAL',
    tagClass: 'tag-security'
  },
  {
    id: 'reuters',
    name: 'REUTERS',
    url: 'https://feeds.reuters.com/reuters/worldNews',
    tag: 'WORLD',
    tagClass: 'tag-general'
  },
  {
    id: 'khaleej',
    name: 'KHALEEJ TIMES',
    url: 'https://www.khaleejtimes.com/rss',
    tag: 'UAE',
    tagClass: 'tag-air'
  },
  {
    id: 'thenational',
    name: 'THE NATIONAL',
    url: 'https://www.thenationalnews.com/rss/home.xml',
    tag: 'UAE',
    tagClass: 'tag-air'
  },
  {
    id: 'arabianbusiness',
    name: 'ARABIAN BUSINESS',
    url: 'https://www.arabianbusiness.com/rss',
    tag: 'GULF',
    tagClass: 'tag-security'
  }
];

// ─── Fetch a URL server-side ────────────────────────────────────────────────
function fetchUrl(targetUrl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get({
      hostname: parsed.hostname,
      path: parsed.path,
      port: parsed.port,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: timeoutMs
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Simple XML parser (no dependencies) ───────────────────────────────────
function parseRSS(xmlText) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
    const block = itemMatch[1];

    const get = (tag) => {
      // Try CDATA first
      const cdataRe = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>`, 'i');
      const plainRe  = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const cdata = cdataRe.exec(block);
      if (cdata) return cdata[1].trim();
      const plain = plainRe.exec(block);
      if (plain) return plain[1].replace(/<[^>]+>/g, '').trim();
      return '';
    };

    const title = get('title');
    if (!title) continue;

    items.push({
      title,
      description: get('description').slice(0, 300),
      link: get('link') || get('guid'),
      pubDate: get('pubDate') || get('dc:date') || ''
    });
  }

  return items;
}

// ─── Cache (5 min TTL) ──────────────────────────────────────────────────────
const cache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedFeed(feed) {
  const now = Date.now();
  if (cache[feed.id] && (now - cache[feed.id].ts) < CACHE_TTL) {
    return cache[feed.id].data;
  }

  const CONFLICT_KW = ['attack','strike','missile','drone','conflict','war','explosion','military','threat','security','emergency','alert','crisis','incident','bomb','shoot','fire','clash'];
  const UAE_KW = ['uae','dubai','abu dhabi','emirates','sharjah','gulf','middle east','iran','yemen','israel','hamas','houthi','hezbollah','oman','qatar','bahrain','riyadh'];

  try {
    const xml = await fetchUrl(feed.url);
    const items = parseRSS(xml).slice(0, 12).map(item => {
      const combined = (item.title + ' ' + item.description).toLowerCase();
      return {
        ...item,
        isConflict: CONFLICT_KW.some(k => combined.includes(k)),
        isUAE: UAE_KW.some(k => combined.includes(k)),
        source: feed.name,
        sourceId: feed.id,
        tag: feed.tag,
        tagClass: feed.tagClass
      };
    });

    cache[feed.id] = { ts: now, data: { ok: true, items, count: items.length } };
    return cache[feed.id].data;
  } catch (err) {
    console.error(`[${feed.id}] fetch error:`, err.message);
    return { ok: false, items: [], error: err.message };
  }
}

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers (in case frontend is on different port during dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // ── /api/feeds — all feeds combined
  if (pathname === '/api/feeds') {
    try {
      const results = await Promise.allSettled(RSS_FEEDS.map(f => getCachedFeed(f)));
      const feeds = {};
      results.forEach((r, i) => {
        feeds[RSS_FEEDS[i].id] = r.status === 'fulfilled' ? r.value : { ok: false, items: [], error: 'rejected' };
      });
      const allItems = Object.values(feeds).flatMap(f => f.items);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ feeds, allItems, ts: Date.now() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── /api/feed/:id — single feed
  const singleMatch = pathname.match(/^\/api\/feed\/(\w+)$/);
  if (singleMatch) {
    const feed = RSS_FEEDS.find(f => f.id === singleMatch[1]);
    if (!feed) { res.writeHead(404); res.end('Not found'); return; }
    const data = await getCachedFeed(feed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // ── /api/status
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'operational',
      feeds: RSS_FEEDS.map(f => ({
        id: f.id,
        name: f.name,
        cached: !!cache[f.id],
        age: cache[f.id] ? Math.round((Date.now() - cache[f.id].ts) / 1000) + 's' : null
      })),
      ts: Date.now()
    }));
    return;
  }

  // ── Serve static files (the frontend)
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🛡  UAE WAR ROOM SERVER`);
  console.log(`   Running on http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api/feeds`);
  console.log(`   Feeds: ${RSS_FEEDS.map(f => f.id).join(', ')}\n`);
});
