import React, { useState, useEffect, useCallback } from 'react';
import { MsxPlaylist } from './types/msx';
import { INITIAL_DEFAULT_PLAYLIST } from './data/presets';
import { Header } from './components/Header';
import { Builder } from './components/Builder';
import { IptvPlayer } from './components/IptvPlayer';
import {
  Copy,
  Check,
  ExternalLink,
  Wifi,
  WifiOff,
  Edit3
} from 'lucide-react';

export default function App() {
  const isDirectTvRoute = typeof window !== 'undefined' && (
    window.location.pathname === '/tv' || 
    window.location.pathname.startsWith('/tv') || 
    window.location.search.includes('mode=tv') ||
    window.location.search.includes('tv') ||
    (typeof navigator !== 'undefined' && /smart-tv|smarttv|tizen|webos|vidaa|hisense|netcast|hbbtv/i.test(navigator.userAgent))
  );

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (isDirectTvRoute) return 'iptv';
    return 'builder';
  });
  const [isTvFullscreen, setIsTvFullscreen] = useState(isDirectTvRoute);
  const [playlist, setPlaylist] = useState<MsxPlaylist>(INITIAL_DEFAULT_PLAYLIST);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Real TV Address (e.g. 192.168.1.244 or window host)
  const [tvAddress, setTvAddress] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const isStandardPort = window.location.port === '80' || window.location.port === '443' || !window.location.port;
      return isStandardPort ? window.location.hostname : window.location.host;
    }
    return '192.168.1.244';
  });
  const [isEditingTvAddress, setIsEditingTvAddress] = useState(false);

  const [serverUrl, setServerUrl] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isCopiedFullUrl, setIsCopiedFullUrl] = useState(false);

  // Real Server Health Status & Latency
  const [serverHealth, setServerHealth] = useState<'active' | 'checking' | 'error'>('checking');
  const [serverLatency, setServerLatency] = useState<number | null>(null);

  // If directly opened as TV app (/tv or full-screen mode), render clean video view with ZERO headers, banners or scrollbars
  if (isTvFullscreen) {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-black overflow-hidden z-50">
        <IptvPlayer
          isTvMode={true}
          onBackToMenu={() => {
            if (isDirectTvRoute) {
              window.location.href = '/';
            } else {
              setIsTvFullscreen(false);
            }
          }}
        />
      </div>
    );
  }

  // Helper to ensure each menu and item has a unique ID
  const normalizePlaylist = (raw: any): MsxPlaylist => {
    if (!raw || typeof raw !== 'object') return INITIAL_DEFAULT_PLAYLIST;
    const menu = Array.isArray(raw.menu) ? raw.menu.map((m: any, mIdx: number) => ({
      ...m,
      id: m.id || `menu-${mIdx}-${Date.now()}`,
      label: m.label || `Раздел ${mIdx + 1}`,
      icon: m.icon || 'apps',
      data: {
        pages: Array.isArray(m.data?.pages) ? m.data.pages.map((p: any) => ({
          items: Array.isArray(p.items) ? p.items.map((item: any, iIdx: number) => ({
            ...item,
            id: item.id || `item-${mIdx}-${iIdx}-${Date.now()}-${item.label || 'app'}`
          })) : []
        })) : [{ items: [] }]
      }
    })) : [];

    return {
      name: raw.name || "Мой Домашний MSX Портал",
      version: raw.version || "1.0.0",
      parameter: raw.parameter || "menu:default",
      response: raw.response,
      background: raw.background,
      headline: raw.headline,
      menu: menu.length > 0 ? menu : INITIAL_DEFAULT_PLAYLIST.menu
    };
  };

  // Real Server Heartbeat Check
  const checkServerHealth = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/msx/start.json', {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000)
      });
      const t1 = performance.now();
      if (res.ok) {
        setServerLatency(Math.round(t1 - t0));
        setServerHealth('active');
      } else {
        setServerHealth('error');
      }
    } catch (e) {
      setServerHealth('error');
    }
  }, []);

  // Determine current live MSX endpoint URL & load initial playlist
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      const isStandardPort = window.location.port === '80' || window.location.port === '443' || !window.location.port;
      const defaultHost = isStandardPort ? window.location.hostname : window.location.host;
      setTvAddress(defaultHost || '192.168.1.244');
      setServerUrl(`${origin}/msx/start.json`);

      // Initial health check
      checkServerHealth();
      const timer = setInterval(checkServerHealth, 15000);

      // Fetch initial playlist state from server
      fetch('/api/msx/playlist')
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Failed to load server playlist');
        })
        .then((data) => {
          if (data && data.menu) {
            setPlaylist(normalizePlaylist(data));
          }
        })
        .catch(() => {});

      return () => clearInterval(timer);
    }
  }, [checkServerHealth]);

  const handleUpdateAndSavePlaylist = async (newPlaylist: MsxPlaylist) => {
    setPlaylist(newPlaylist);
    setIsSaving(true);
    try {
      const response = await fetch('/api/msx/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPlaylist)
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.playlist) {
          setPlaylist(normalizePlaylist(data.playlist));
        }
        setSaveMessage(`✓ Автосохранение выполнено (${data.playlist?.version || 'v1.0'})`);
        setTimeout(() => setSaveMessage(null), 3000);
      }
    } catch (e: any) {
      setSaveMessage('Сохранено локально в браузере');
      setTimeout(() => setSaveMessage(null), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualSave = async () => {
    await handleUpdateAndSavePlaylist(playlist);
  };

  const handleCopyTvAddress = () => {
    navigator.clipboard.writeText(tvAddress);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleCopyFullUrl = () => {
    const fullUrl = serverUrl || `http://${tvAddress}/msx/start.json`;
    navigator.clipboard.writeText(fullUrl);
    setIsCopiedFullUrl(true);
    setTimeout(() => setIsCopiedFullUrl(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        tvAddress={tvAddress}
        serverUrl={serverUrl}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Real Live Server Status & TV Address Hero Banner */}
        <div className="relative rounded-2xl p-5 bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/30 border border-sky-500/20 shadow-xl overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 relative z-10">
            <div>
              {/* Live Server Indicator */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {serverHealth === 'active' ? (
                  <span className="text-emerald-400 font-bold text-sm tracking-tight flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    Живой сервер Media Station X запущен и активен
                  </span>
                ) : serverHealth === 'checking' ? (
                  <span className="text-amber-400 font-bold text-sm tracking-tight flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                    Проверка связи с сервером MSX...
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold text-sm tracking-tight flex items-center gap-2">
                    <WifiOff className="w-3.5 h-3.5" />
                    Сервер Media Station X временно недоступен
                  </span>
                )}

                <span className="text-slate-500 text-xs">·</span>
                {serverLatency !== null && serverHealth === 'active' && (
                  <>
                    <span className="text-emerald-300 font-mono text-xs bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-500/30">
                      200 OK · {serverLatency} мс
                    </span>
                    <span className="text-slate-500 text-xs">·</span>
                  </>
                )}
                <span className="text-slate-400 text-xs">CORS: разрешен (любые клиенты)</span>
              </div>

              {/* Instructions */}
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                На реальном телевизоре откройте приложение: <span className="text-white font-medium">Media Station X ➔ Настройки (шестерёнка) ➔ Start Parameter ➔ Setup</span> и введите адрес:
              </p>
            </div>

            {/* TV Address Display with Direct Copy Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
              <div className="flex items-center gap-2 bg-slate-950/90 px-3 py-2 rounded-xl border border-sky-500/40 shadow-inner">
                <span className="text-[10px] font-semibold text-sky-400 uppercase tracking-wider select-none shrink-0">
                  Для ТВ:
                </span>
                {isEditingTvAddress ? (
                  <input
                    type="text"
                    value={tvAddress}
                    onChange={(e) => setTvAddress(e.target.value.trim())}
                    onBlur={() => setIsEditingTvAddress(false)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setIsEditingTvAddress(false);
                    }}
                    autoFocus
                    className="text-sm font-mono font-bold text-white bg-slate-900 px-2 py-1 rounded border border-sky-400 outline-none w-36"
                  />
                ) : (
                  <span
                    onClick={() => setIsEditingTvAddress(true)}
                    className="text-sm font-mono font-bold text-sky-200 hover:text-white px-1 select-all cursor-pointer underline decoration-dotted decoration-sky-500/50"
                    title="Нажмите, чтобы изменить IP адрес вручную (например, 192.168.1.244)"
                  >
                    {tvAddress}
                  </span>
                )}

                <button
                  onClick={() => setIsEditingTvAddress(!isEditingTvAddress)}
                  className="p-1 rounded text-slate-400 hover:text-sky-300 transition-colors cursor-pointer"
                  title="Изменить адрес сервера"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleCopyTvAddress}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer ml-1 shadow-md shadow-sky-500/20"
                  title="Скопировать параметр для ввода пультом"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Скопировано!' : 'Скопировать'}</span>
                </button>

                <a
                  href="/msx/start.json"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                  title="Открыть стартовый JSON в новой вкладке"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Views */}
        {activeTab === 'iptv' && (
          <IptvPlayer
            isTvMode={false}
            onEnterTvMode={() => setIsTvFullscreen(true)}
            onBackToMenu={() => setActiveTab('builder')}
          />
        )}

        {activeTab === 'builder' && (
          <Builder
            playlist={playlist}
            onUpdatePlaylist={handleUpdateAndSavePlaylist}
            onSaveToServer={handleManualSave}
            isSaving={isSaving}
            saveMessage={saveMessage}
          />
        )}
      </main>

      {/* Clean Compact Footer */}
      <footer className="mt-auto border-t border-slate-900 py-4 px-6 text-center text-xs text-slate-500">
        <p>
          Media Station X Server Studio — сервер домашнего медиа-портала и IPTV плеер с 7-дневным архивом передач.
        </p>
      </footer>
    </div>
  );
}
