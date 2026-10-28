import React, { useState, useEffect } from 'react';
import { MsxPlaylist } from './types/msx';
import { INITIAL_DEFAULT_PLAYLIST } from './data/presets';
import { Header } from './components/Header';
import { Simulator } from './components/Simulator';
import { Builder } from './components/Builder';
import { PitfallsGuide } from './components/PitfallsGuide';
import { HostingTemplates } from './components/HostingTemplates';
import { RoadmapPlan } from './components/RoadmapPlan';
import { JsonViewer } from './components/JsonViewer';
import { IptvPlayer } from './components/IptvPlayer';
import {
  Tv,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Layers,
  ShieldAlert,
  Server,
  FileCode,
  ListTodo
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<string>(() => {
    if (typeof window !== 'undefined' && (window.location.pathname === '/tv' || window.location.pathname.startsWith('/tv'))) {
      return 'iptv';
    }
    return 'builder';
  });
  const [playlist, setPlaylist] = useState<MsxPlaylist>(INITIAL_DEFAULT_PLAYLIST);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [isServerHealthy, setIsServerHealthy] = useState<boolean | null>(null);

  // Helper to ensure each menu and item has a unique ID (MSX standard JSON doesn't require id)
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

  // Determine current live MSX endpoint URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const liveEndpoint = `${window.location.origin}/api/msx/start.json`;
      setServerUrl(liveEndpoint);

      // Fetch initial state from server
      fetch('/api/msx/playlist')
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Failed to load server playlist');
        })
        .then((data) => {
          if (data && data.menu) {
            setPlaylist(normalizePlaylist(data));
            setIsServerHealthy(true);
          }
        })
        .catch(() => {
          // Fallback to local preset if backend is not ready
          setIsServerHealthy(false);
        });
    }
  }, []);

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

  const handleCopyEndpoint = () => {
    navigator.clipboard.writeText(serverUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        serverUrl={serverUrl}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Live Server Hero Banner */}
        <div className="relative rounded-2xl p-5 bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/30 border border-sky-500/20 shadow-xl overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sky-400 font-bold text-sm tracking-tight flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Живой сервер Media Station X запущен и активен
                </span>
                <span className="text-slate-500 text-xs">·</span>
                <span className="text-slate-400 text-xs">CORS: разрешен</span>
              </div>
              <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
                Вы можете прямо сейчас протестировать ваш портал на реальном телевизоре. Откройте на ТВ: <span className="text-white font-medium">Media Station X ➔ Настройки (шестерёнка) ➔ Start Parameter ➔ Setup</span> и введите этот адрес:
              </p>
            </div>

            <div className="flex items-center gap-2 bg-slate-950/80 p-2 rounded-xl border border-sky-500/30 shrink-0">
              <code className="text-xs font-mono text-sky-300 px-2 py-1 select-all max-w-[280px] sm:max-w-[340px] truncate">
                {serverUrl || 'Загрузка...'}
              </code>
              <button
                onClick={handleCopyEndpoint}
                className="p-2 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 transition-colors cursor-pointer"
                title="Скопировать ссылку для ТВ"
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <a
                href="/api/msx/start.json"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                title="Открыть сырой JSON в браузере"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Mobile/Compact Secondary Tab Strip */}
        <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto no-scrollbar pb-2">
          {[
            { id: 'iptv', label: 'IPTV (Архив)' },
            { id: 'builder', label: 'Конструктор' },
            { id: 'simulator', label: 'Симулятор ТВ' },
            { id: 'pitfalls', label: 'Подводные камни' },
            { id: 'templates', label: 'Шаблоны серверов' },
            { id: 'roadmap', label: 'План внедрения' },
            { id: 'json', label: 'JSON Плейлист' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Views */}
        {activeTab === 'iptv' && (
          <IptvPlayer onBackToMenu={() => setActiveTab('builder')} />
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

        {activeTab === 'simulator' && (
          <Simulator playlist={playlist} />
        )}

        {activeTab === 'pitfalls' && (
          <PitfallsGuide />
        )}

        {activeTab === 'templates' && (
          <HostingTemplates />
        )}

        {activeTab === 'roadmap' && (
          <RoadmapPlan />
        )}

        {activeTab === 'json' && (
          <JsonViewer
            playlist={playlist}
            onImportPlaylist={(imported) => setPlaylist(normalizePlaylist(imported))}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-900 py-6 px-6 text-center text-xs text-slate-500">
        <p>
          Media Station X Home Server Station — руководство, генератор плейлистов и симулятор для Smart TV (LG webOS, Samsung Tizen, Android TV).
        </p>
      </footer>
    </div>
  );
}
