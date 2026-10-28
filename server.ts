import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.resolve(__dirname, 'msx-data.json');
const IPTV_SETTINGS_FILE = path.resolve(__dirname, 'iptv-settings.json');

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

let iptvSettings = {
  playlistUrl: 'http://rus.hls.gd/pl/19/61bbpl1xj1srq/playlist.m3u8',
  archiveDays: 7,
  providerType: 'ilook'
};

try {
  if (fs.existsSync(IPTV_SETTINGS_FILE)) {
    iptvSettings = JSON.parse(fs.readFileSync(IPTV_SETTINGS_FILE, 'utf8'));
  }
} catch (e) {}

// In-memory default MSX playlist state
let currentMsxPlaylist: any = {
  name: "Мой Домашний MSX Портал",
  version: "1.0.0",
  parameter: "menu:default",
  response: "content:menu:default",
  background: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1920&q=80",
  headline: "Домашний медиа-сервер",
  menu: [
    {
      id: "menu-all",
      icon: "apps",
      label: "Все приложения",
      data: {
        pages: [
          {
            items: [
              {
                id: "item-1",
                type: "button",
                layout: "0,0,3,3",
                color: "msx-glass",
                icon: "https://lampa.mx/img/logo.png",
                label: "Lampa TV",
                badge: "Кино & Сериалы",
                action: "link:http://lampa.mx"
              },
              {
                id: "item-2",
                type: "button",
                layout: "3,0,3,3",
                color: "msx-glass",
                icon: "https://vokino.tv/assets/img/logo.png",
                label: "VoKino",
                badge: "Каталог",
                action: "link:http://web.vokino.tv"
              },
              {
                id: "item-3",
                type: "button",
                layout: "6,0,3,3",
                color: "msx-glass",
                icon: "https://deeplex.app/img/icons/icon-192x192.png",
                label: "Deeplex",
                badge: "Медиа",
                action: "link:https://deeplex.app"
              },
              {
                id: "item-4",
                type: "button",
                layout: "9,0,3,3",
                color: "msx-glass",
                icon: "https://raw.githubusercontent.com/YouROK/TorrServer/master/src/assets/icon.png",
                label: "TorrServe",
                badge: "Торренты",
                action: "link:http://127.0.0.1:8090"
              },
              {
                id: "item-5",
                type: "button",
                layout: "0,3,3,3",
                color: "msx-glass",
                icon: "https://www.youtube.com/s/desktop/270425a1/img/favicon_144x144.png",
                label: "YouTube TV",
                badge: "Видео",
                action: "link:https://www.youtube.com/tv"
              },
              {
                id: "item-6",
                type: "button",
                layout: "3,3,3,3",
                color: "msx-glass",
                icon: "https://cdn-icons-png.flaticon.com/512/3845/3845874.png",
                label: "Моё ТВ (Архив 7д)",
                badge: "IPTV Архив",
                action: "link:{PREFIX}{SERVER}/tv"
              },
              {
                id: "item-7",
                type: "button",
                layout: "6,3,3,3",
                color: "msx-glass",
                icon: "https://plex.tv/wp-content/themes/plex/assets/img/favicons/favicon-196x196.png",
                label: "Plex Web",
                badge: "Домашний сервер",
                action: "link:https://app.plex.tv/desktop"
              },
              {
                id: "item-8",
                type: "button",
                layout: "9,3,3,3",
                color: "msx-glass",
                icon: "https://jellyfin.org/images/logo.svg",
                label: "Jellyfin Web",
                badge: "Локальный каталог",
                action: "link:http://192.168.1.100:8096"
              }
            ]
          }
        ]
      }
    },
    {
      id: "menu-movies",
      icon: "movie",
      label: "Фильмы и Кино",
      data: {
        pages: [
          {
            items: [
              {
                id: "m-item-1",
                type: "button",
                layout: "0,0,4,4",
                icon: "https://lampa.mx/img/logo.png",
                label: "Lampa (Основной)",
                action: "link:http://lampa.mx"
              },
              {
                id: "m-item-2",
                type: "button",
                layout: "4,0,4,4",
                icon: "https://vokino.tv/assets/img/logo.png",
                label: "VoKino Web",
                action: "link:http://web.vokino.tv"
              },
              {
                id: "m-item-3",
                type: "button",
                layout: "8,0,4,4",
                icon: "https://deeplex.app/img/icons/icon-192x192.png",
                label: "Deeplex",
                action: "link:https://deeplex.app"
              }
            ]
          }
        ]
      }
    },
    {
      id: "menu-tools",
      icon: "settings",
      label: "Инструменты & Серверы",
      data: {
        pages: [
          {
            items: [
              {
                id: "t-item-1",
                type: "button",
                layout: "0,0,4,3",
                label: "TorrServe Matrix (Локальный)",
                badge: "Порт 8090",
                action: "link:http://127.0.0.1:8090"
              },
              {
                id: "t-item-2",
                type: "button",
                layout: "4,0,4,3",
                label: "Home Assistant",
                badge: "Умный дом",
                action: "link:http://homeassistant.local:8123"
              },
              {
                id: "t-item-3",
                type: "button",
                layout: "8,0,4,3",
                label: "Проверить соединение",
                badge: "Тест",
                action: "execute:info:Домашний MSX сервер работает штатно!"
              }
            ]
          }
        ]
      }
    }
  ]
};

// CORS and Cache Headers middleware for MSX endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Load persistent data from disk if present
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.menu)) {
      currentMsxPlaylist = parsed;
    }
  }
} catch (e) {
  console.error('Error reading msx-data.json:', e);
}

function sendJson(res: express.Response, data: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json(data);
}

// Helper: Start Object required by MSX specification (Settings -> Start Parameter)
function getStartObject() {
  const ver = currentMsxPlaylist.version || '1.0.0';
  return {
    name: currentMsxPlaylist.name || "MSX Home Server",
    version: ver,
    parameter: `menu:{PREFIX}{SERVER}/msx/menu.json?v=${ver}`
  };
}

// Helper: Menu Root Object loaded by MSX via the parameter
function getMenuObject() {
  return {
    headline: currentMsxPlaylist.headline || "Домашний медиа-сервер",
    background: currentMsxPlaylist.background || "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1920&q=80",
    menu: currentMsxPlaylist.menu || []
  };
}

// 1. Start Object Endpoints (MSX setup entry point)
app.get('/msx/start.json', (req, res) => sendJson(res, getStartObject()));
app.get('/start.json', (req, res) => sendJson(res, getStartObject()));
app.get('/api/msx/start.json', (req, res) => sendJson(res, getStartObject()));
app.get('/msx.json', (req, res) => sendJson(res, getStartObject()));

// 2. Menu Root Object Endpoints (Fetched automatically by MSX from start parameter)
app.get('/msx/menu.json', (req, res) => sendJson(res, getMenuObject()));
app.get('/menu.json', (req, res) => sendJson(res, getMenuObject()));
app.get('/api/msx/menu.json', (req, res) => sendJson(res, getMenuObject()));

// 3. Full playlist endpoint for the web builder
app.get('/api/msx/playlist', (req, res) => {
  res.json(currentMsxPlaylist);
});

// API to update current playlist from builder (automatically persists and increments version)
app.post('/api/msx/playlist', (req, res) => {
  try {
    const newPlaylist = req.body;
    if (!newPlaylist || typeof newPlaylist !== 'object') {
      return res.status(400).json({ error: 'Invalid playlist object' });
    }

    // Auto-increment version counter so MSX automatically invalidates its cache
    const currentVerStr = String(currentMsxPlaylist.version || '1.0.0');
    const match = currentVerStr.match(/(\d+)$/);
    const rev = match ? parseInt(match[1], 10) + 1 : Date.now();
    newPlaylist.version = `1.0.${rev}`;

    currentMsxPlaylist = newPlaylist;

    // Persist to disk
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(currentMsxPlaylist, null, 2), 'utf8');
    } catch (fsErr) {
      console.error('Failed to write to msx-data.json:', fsErr);
    }

    res.json({
      success: true,
      message: `Плейлист сохранён (версия ${currentMsxPlaylist.version})`,
      playlist: currentMsxPlaylist
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// API to reset to default template
app.post('/api/msx/reset', (req, res) => {
  // Can be called to reset
  res.json({ success: true, playlist: currentMsxPlaylist });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// IPTV API Endpoints
app.get('/api/iptv/settings', (req, res) => {
  res.json(iptvSettings);
});

app.post('/api/iptv/settings', (req, res) => {
  try {
    iptvSettings = { ...iptvSettings, ...req.body };
    fs.writeFileSync(IPTV_SETTINGS_FILE, JSON.stringify(iptvSettings, null, 2), 'utf8');
    res.json({ success: true, settings: iptvSettings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/iptv/channels', async (req, res) => {
  const targetUrl = (req.query.url as string) || iptvSettings.playlistUrl;
  if (!targetUrl) {
    return res.json([]);
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (response.ok) {
      const text = await response.text();
      if (text.includes('#EXTINF:')) {
        const lines = text.split('\n');
        const channels: any[] = [];
        let curr: any = null;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('#EXTINF:')) {
            curr = {};
            const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
            const groupMatch = line.match(/group-title="([^"]*)"/i);
            const catchupDaysMatch = line.match(/catchup-days="([^"]*)"/i);
            const catchupSourceMatch = line.match(/catchup-source="([^"]*)"/i);
            const lastComma = line.lastIndexOf(',');
            curr.name = lastComma !== -1 ? line.substring(lastComma + 1).trim() : 'Канал';
            curr.id = `ch-${channels.length + 1}`;
            curr.logo = tvgLogoMatch?.[1] || '';
            curr.group = groupMatch?.[1] || 'Общие';
            curr.catchupDays = catchupDaysMatch ? parseInt(catchupDaysMatch[1], 10) : 7;
            curr.catchupSource = catchupSourceMatch?.[1];
          } else if (line.length > 0 && !line.startsWith('#') && curr) {
            curr.streamUrl = line;
            if (curr.name && curr.streamUrl) {
              channels.push(curr);
            }
            curr = null;
          }
        }

        if (channels.length > 0) {
          return res.json(channels);
        }
      }
    }
  } catch (e) {
    // Return empty array on failure so frontend falls back to sample channels
  }

  return res.json([]);
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // In dev mode, mount Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // In production, if MSX or client requests JSON on root, return currentMsxPlaylist
    app.get('/', (req, res, next) => {
      const ua = (req.headers['user-agent'] || '').toLowerCase();
      const accept = (req.headers['accept'] || '').toLowerCase();
      const isMsx = ua.includes('msx') || ua.includes('mediastationx') || ua.includes('smarttv') || ua.includes('hbbtv');
      const wantsJson = accept.includes('application/json') && !accept.includes('text/html');

      if (isMsx || wantsJson) {
        return sendJson(res, getStartObject());
      }
      next();
    });

    // In production, serve built dist files
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`MSX Home Server running on http://0.0.0.0:${port}`);
    console.log(`MSX Endpoint: http://0.0.0.0:${port}/msx/start.json`);
    console.log(`Zero-Slash TV Input: <LXC_IP>:${port}`);
  });

  // In production (e.g. Proxmox LXC), also bind port 80 if available for zero-slash TV input: <LXC_IP>
  if (process.env.NODE_ENV === 'production' && port !== 80) {
    try {
      const server80 = app.listen(80, '0.0.0.0', () => {
        console.log(`[Zero-Slash Mode] Also listening on port 80! You can enter just <LXC_IP> on your TV!`);
      });
      server80.on('error', () => {
        // Silently skip if port 80 is not available
      });
    } catch (e) {}
  }
}

startServer();
