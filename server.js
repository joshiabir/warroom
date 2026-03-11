/**
 * UAE WAR ROOM — RSS Proxy Server
 * Run: node server.js
 * Serves the frontend + proxies RSS feeds server-side (no browser CORS issues)
 */

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// ─── RSS Feed Definitions ───────────────────────────────────────────────────
// Mix of direct feeds + Google News RSS (reliable, never blocks)
// Google News RSS format: https://news.google.com/rss/search?q=QUERY&hl=en-US&gl=US&ceid=US:en
const RSS_FEEDS = [
  {
    id: 'aljazeera',
    name: 'AL JAZEERA',
    url: 'https://www.aljazeera.com/xml/rss/all.xml',
    tag: 'CONFLICT',
    tagClass: 'tag-conflict'
  },
  {
    id: 'dubaichronicle',
    name: 'DUBAI CHRONICLE',
    url: 'https://www.dubaichronicle.com/feed',
    tag: 'DUBAI',
    tagClass: 'tag-conflict'
  },
  {
    id: 'gnews_uae',
    name: 'UAE NEWS',
    url: 'https://news.google.com/rss/search?q=UAE+Dubai&hl=en-US&gl=US&ceid=US:en',
    tag: 'UAE',
    tagClass: 'tag-air'
  },
  {
    id: 'gnews_gulf',
    name: 'GULF REGION',
    url: 'https://news.google.com/rss/search?q=Gulf+Dubai+Abu+Dhabi&hl=en-US&gl=US&ceid=US:en',
    tag: 'GULF',
    tagClass: 'tag-security'
  },
  {
    id: 'gnews_iran',
    name: 'IRAN/CONFLICT',
    url: 'https://news.google.com/rss/search?q=Iran+UAE+missile+attack&hl=en-US&gl=US&ceid=US:en',
    tag: 'CONFLICT',
    tagClass: 'tag-conflict'
  },
  {
    id: 'gnews_dxb',
    name: 'DXB AIRPORT',
    url: 'https://news.google.com/rss/search?q=Dubai+airport+DXB+flights&hl=en-US&gl=US&ceid=US:en',
    tag: 'AVIATION',
    tagClass: 'tag-air'
  },
  {
    id: 'gnews_middleeast',
    name: 'MIDDLE EAST',
    url: 'https://news.google.com/rss/search?q=Middle+East+conflict+security&hl=en-US&gl=US&ceid=US:en',
    tag: 'REGION',
    tagClass: 'tag-security'
  },
  {
    id: 'gnews_thenational',
    name: 'THE NATIONAL',
    url: 'https://news.google.com/rss/search?q=site:thenationalnews.com&hl=en-US&gl=US&ceid=US:en',
    tag: 'UAE',
    tagClass: 'tag-air'
  },
  {
    id: 'gnews_khaleejtimes',
    name: 'KHALEEJ TIMES',
    url: 'https://news.google.com/rss/search?q=site:khaleejtimes.com&hl=en-US&gl=US&ceid=US:en',
    tag: 'UAE',
    tagClass: 'tag-air'
  },
  {
    id: 'gnews_arabianbusiness',
    name: 'ARABIAN BUSINESS',
    url: 'https://news.google.com/rss/search?q=site:arabianbusiness.com&hl=en-US&gl=US&ceid=US:en',
    tag: 'GULF',
    tagClass: 'tag-security'
  }
];

// ─── OSINT Intel Feeds (live Google News RSS per topic/source) ─────────────
const OSINT_FEEDS = [
  { id: 'osint_ncema',      handle: '@UAE_NCEMA',       url: 'https://x.com/UAE_NCEMA',           type: 'official',   query: 'UAE NCEMA emergency alert' },
  { id: 'osint_dubaipolice',handle: '@DubaiPoliceHQ',   url: 'https://x.com/DubaiPoliceHQ',       type: 'official',   query: 'Dubai Police security incident' },
  { id: 'osint_dxbairport', handle: '@DXB_Airport',     url: 'https://x.com/DXB_Airport',         type: 'aviation',   query: 'Dubai International Airport DXB operations' },
  { id: 'osint_uaeinterior',handle: '@UAEInterior',     url: 'https://x.com/UAEInterior',         type: 'official',   query: 'UAE Interior Ministry security' },
  { id: 'osint_fr24',       handle: 'FLIGHTRADAR24',    url: 'https://www.flightradar24.com/25.07,55.17/9', type: 'aviation', query: 'Dubai airspace flights DXB Emirates' },
  { id: 'osint_defender',   handle: '@OSINTdefender',   url: 'https://x.com/OSINTdefender',       type: 'intel',      query: 'UAE Gulf Arabia OSINT military' },
  { id: 'osint_houthi',     handle: 'HOUTHI/YEMEN',     url: 'https://liveuamap.com/middle-east', type: 'threat',     query: 'Houthi attack Yemen missile drone UAE' },
  { id: 'osint_emirates',   handle: '@EmiratesAirline', url: 'https://x.com/emirates',            type: 'aviation',   query: 'Emirates Airline EK flight disruption' },
  { id: 'osint_maritime',   handle: 'GULF MARITIME',    url: 'https://www.maritimebulletin.net',  type: 'maritime',   query: 'Gulf of Oman Arabian Sea shipping attack tanker' },
  { id: 'osint_acled',      handle: 'ACLED MENA',       url: 'https://acleddata.com/middle-east-north-africa/', type: 'intel', query: 'Middle East conflict violence incident Gulf' },
];

// Cache for OSINT feeds (3 min TTL — fresher than news)
const osintCache = {};
const OSINT_TTL = 3 * 60 * 1000;

async function getOSINTFeed(source) {
  const now = Date.now();
  if (osintCache[source.id] && (now - osintCache[source.id].ts) < OSINT_TTL) {
    return osintCache[source.id].data;
  }
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(source.query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const xml = await fetchUrl(rssUrl);
    const items = parseRSS(xml).slice(0, 5).map(item => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      description: item.description
    }));
    osintCache[source.id] = { ts: now, data: { ok: true, items } };
    return osintCache[source.id].data;
  } catch (err) {
    console.error(`[osint:${source.id}] ${err.message}`);
    return { ok: false, items: [], error: err.message };
  }
}

// ─── Fetch a URL server-side with gzip support ──────────────────────────────
function fetchUrl(targetUrl, timeoutMs = 12000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed = url.parse(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      path: parsed.path || '/',
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      headers: {
        // Realistic browser UA — many sites block "bot" UAs
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      },
      timeout: timeoutMs
    };

    const req = lib.get(options, (res) => {
      // Follow redirects (301, 302, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        res.resume(); // drain socket
        return fetchUrl(nextUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}`));
      }

      // Handle gzip/deflate encoding
      const encoding = res.headers['content-encoding'];
      let stream = res;

      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }

      let data = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => data += chunk);
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout fetching ${parsed.hostname}`)); });
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

const CONFLICT_KW = ['attack','strike','missile','drone','conflict','war','explosion','military','threat','security','emergency','alert','crisis','incident','bomb','shoot','fire','clash','ceasefire','troops','hostage','sanctions'];
const UAE_KW = ['uae','dubai','abu dhabi','emirates','sharjah','gulf','middle east','iran','yemen','israel','hamas','houthi','hezbollah','oman','qatar','bahrain','riyadh','saudi','mbs','ncema','dxb','etihad','expo'];

async function getCachedFeed(feed) {
  const now = Date.now();
  if (cache[feed.id] && (now - cache[feed.id].ts) < CACHE_TTL) {
    console.log(`[${feed.id}] cache hit (${Math.round((now - cache[feed.id].ts)/1000)}s old)`);
    return cache[feed.id].data;
  }

  try {
    console.log(`[${feed.id}] fetching ${feed.url}`);
    const xml = await fetchUrl(feed.url);

    if (!xml || xml.trim().length === 0) throw new Error('Empty response');
    if (!xml.includes('<item') && !xml.includes('<entry')) throw new Error('No RSS items in response');

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

    console.log(`[${feed.id}] ✓ ${items.length} items`);
    cache[feed.id] = { ts: now, data: { ok: true, items, count: items.length } };
    return cache[feed.id].data;

  } catch (err) {
    console.error(`[${feed.id}] ✗ ${err.message}`);
    // Return stale cache if available rather than empty
    if (cache[feed.id]) {
      console.log(`[${feed.id}] returning stale cache`);
      return { ...cache[feed.id].data, stale: true };
    }
    return { ok: false, items: [], error: err.message };
  }
}

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

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

  // ── /api/dxb — live DXB flight data
  // Uses AeroDataBox free tier via RapidAPI — set RAPIDAPI_KEY env var to enable
  // Falls back to Google News RSS for DXB when no key is set
  if (pathname === '/api/dxb') {
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '';

    if (RAPIDAPI_KEY) {
      // Live data via AeroDataBox (free tier: 1000 calls/month)
      try {
        const now = new Date();
        const pad = n => String(n).padStart(2,'0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
        const timeStr = `${pad(now.getHours())}:00`;
        const depUrl = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/OMDB/${dateStr}T${timeStr}/${dateStr}T${pad((now.getHours()+6)%24)}:00?withLeg=false&direction=Both&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false`;

        const xml = await new Promise((resolve, reject) => {
          const opts = {
            hostname: 'aerodatabox.p.rapidapi.com',
            path: depUrl.replace('https://aerodatabox.p.rapidapi.com',''),
            headers: {
              'x-rapidapi-host': 'aerodatabox.p.rapidapi.com',
              'x-rapidapi-key': RAPIDAPI_KEY
            }
          };
          const req = https.get(opts, res2 => {
            let d = ''; res2.on('data', c => d+=c); res2.on('end', () => resolve(d));
          });
          req.on('error', reject);
          req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
        });

        const json = JSON.parse(xml);
        const mapFlight = f => ({
          flight: f.number || '???',
          dest: f.movement?.airport?.iata || '???',
          city: f.movement?.airport?.name?.split(' ')[0] || '???',
          status: f.status === 'Expected' ? 'ON TIME' : f.status === 'Delayed' ? 'DELAYED' : f.status === 'Cancelled' ? 'CANCELLED' : f.status || 'ON TIME',
          direction: f.movement?.type === 'Arrival' ? 'ARR' : 'DEP',
          time: f.movement?.scheduledTime?.local?.slice(11,16) || ''
        });

        const flights = [
          ...(json.departures || []).slice(0,6).map(mapFlight),
          ...(json.arrivals   || []).slice(0,6).map(mapFlight)
        ];

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, source: 'live', flights, ts: Date.now() }));
      } catch(e) {
        console.error('[dxb] AeroDataBox error:', e.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, source: 'error', flights: [], error: e.message }));
      }
    } else {
      // No API key — return news headlines about DXB from the RSS cache
      try {
        const dxbFeed = RSS_FEEDS.find(f => f.id === 'gnews_dxb');
        const data = await getCachedFeed(dxbFeed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, source: 'news', items: data.items || [], ts: Date.now() }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, source: 'news', items: [], error: e.message }));
      }
    }
    return;
  }

  // ── /api/feed/:id — single feed (useful for debugging)
  const singleMatch = pathname.match(/^\/api\/feed\/(\w+)$/);
  if (singleMatch) {
    const feed = RSS_FEEDS.find(f => f.id === singleMatch[1]);
    if (!feed) { res.writeHead(404); res.end('Not found'); return; }
    const data = await getCachedFeed(feed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  // ── /api/status — shows what's cached and what's failing
  if (pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'operational',
      feeds: RSS_FEEDS.map(f => ({
        id: f.id,
        name: f.name,
        url: f.url,
        cached: !!cache[f.id],
        ok: cache[f.id]?.data?.ok,
        items: cache[f.id]?.data?.count || 0,
        age: cache[f.id] ? Math.round((Date.now() - cache[f.id].ts) / 1000) + 's' : 'not fetched',
        error: cache[f.id]?.data?.error || null
      })),
      ts: Date.now()
    }));
    return;
  }

  // ── /api/osint — live intel signals
  if (pathname === '/api/osint') {
    try {
      const results = await Promise.allSettled(OSINT_FEEDS.map(s => getOSINTFeed(s)));
      const signals = OSINT_FEEDS.map((s, i) => ({
        id: s.id,
        handle: s.handle,
        url: s.url,
        type: s.type,
        items: results[i].status === 'fulfilled' ? results[i].value.items : [],
        ok: results[i].status === 'fulfilled' ? results[i].value.ok : false
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ signals, ts: Date.now() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Serve static files (the frontend)
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(__dirname, 'public', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🛡  UAE WAR ROOM SERVER`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Debug: http://localhost:${PORT}/api/status`);
  console.log(`   Feeds: ${RSS_FEEDS.length} sources configured\n`);

  // Pre-warm cache on startup
  console.log('Pre-warming feed cache...');
  RSS_FEEDS.forEach(f => getCachedFeed(f));
});

