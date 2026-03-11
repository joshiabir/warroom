# 🛡 UAE WAR ROOM — Ops Center Console

A self-hosted situational awareness dashboard for Dubai/UAE.
**No third-party CORS proxies** — the Node.js server fetches RSS feeds directly server-side.

---

## 📁 Project Structure

```
warroom/
├── server.js          # Node.js backend — RSS proxy + static file server
├── package.json
├── start.sh           # Quick start script
└── public/
    └── index.html     # Frontend war room console
```

---

## 🚀 Quick Start

### Requirements
- Node.js 16+ (no npm packages needed — zero dependencies)

### Run
```bash
# Clone / upload files to your server, then:
cd warroom
node server.js
```

Open: `http://your-server-ip:3000`

---

## ⚙️ Configuration

### Change port
```bash
PORT=8080 node server.js
```

### Run on port 80 (needs sudo or authbind)
```bash
sudo PORT=80 node server.js
```

### Run with PM2 (production / keep alive after SSH disconnect)
```bash
npm install -g pm2
pm2 start server.js --name warroom
pm2 save
pm2 startup
```

### Run with systemd
Create `/etc/systemd/system/warroom.service`:
```ini
[Unit]
Description=UAE War Room Console
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/warroom
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable warroom
sudo systemctl start warroom
```

---

## 🔌 API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/feeds` | All feeds combined (JSON) |
| `GET /api/feed/:id` | Single feed by ID |
| `GET /api/status` | Server + cache health |

### Feed IDs
`aljazeera`, `gulfnews`, `reuters`, `khaleej`, `thenational`, `arabianbusiness`

---

## 📡 Adding More Feeds

Edit `RSS_FEEDS` array in `server.js`:
```js
{
  id: 'myfeed',
  name: 'MY SOURCE',
  url: 'https://example.com/rss.xml',
  tag: 'CUSTOM',
  tagClass: 'tag-general'
}
```

---

## ✈️ Adding Real Flight Data (DXB)

Replace `generateFlightData()` in `public/index.html` with a call to:
- **AviationStack** (free tier): `http://api.aviationstack.com/v1/flights?access_key=KEY&dep_iata=DXB`
- **FlightAware AeroAPI**: `https://aeroapi.flightaware.com/aeroapi/airports/OMDB/flights`

---

## 🔒 Security Notes
- This console is for internal/private network use
- Add HTTP Basic Auth via nginx reverse proxy for public-facing deployment
- Recommended: put behind Cloudflare Access or VPN
