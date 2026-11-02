import React, { useState, useEffect } from 'react';
import { IptvSettings } from '../types/iptv';
import {
  Settings,
  Save,
  RefreshCw,
  Tv,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Layers,
  Clock,
  Radio,
  Check,
  Zap
} from 'lucide-react';

interface IptvSettingsTabProps {
  onGoToPlayer?: () => void;
}

export const IptvSettingsTab: React.FC<IptvSettingsTabProps> = ({ onGoToPlayer }) => {
  const [settings, setSettings] = useState<IptvSettings>({
    playlistUrl: 'http://rus.hls.gd/pl/19/61bbpl1xj1srq/playlist.m3u8',
    epgUrl: 'https://rus.epg.team/7.1.xml?pkg=442',
    archiveDays: 7,
    providerType: 'tvteam',
    timeZoneOffset: 'auto'
  });

  const [inputUrl, setInputUrl] = useState(settings.playlistUrl);
  const [inputEpgUrl, setInputEpgUrl] = useState(settings.epgUrl || 'https://rus.epg.team/7.1.xml?pkg=442');
  const [archiveDays, setArchiveDays] = useState(settings.archiveDays || 7);
  const [timeZoneOffset, setTimeZoneOffset] = useState<string | number>(settings.timeZoneOffset ?? 'auto');

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingEpg, setIsSyncingEpg] = useState(false);
  const [isRefreshingChannels, setIsRefreshingChannels] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // EPG & Server stats
  const [epgStatus, setEpgStatus] = useState<any>(null);
  const [channelsCount, setChannelsCount] = useState<number | null>(null);

  const fetchCurrentSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/iptv/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        if (data.playlistUrl) setInputUrl(data.playlistUrl);
        if (data.epgUrl) setInputEpgUrl(data.epgUrl);
        if (data.archiveDays !== undefined) setArchiveDays(data.archiveDays);
        if (data.timeZoneOffset !== undefined) setTimeZoneOffset(data.timeZoneOffset);
      }
    } catch (e) {
      console.warn('Failed to load IPTV settings', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const [epgRes, chRes] = await Promise.all([
        fetch('/api/iptv/epg/status'),
        fetch('/api/iptv/channels')
      ]);
      if (epgRes.ok) {
        setEpgStatus(await epgRes.json());
      }
      if (chRes.ok) {
        const chList = await chRes.json();
        if (Array.isArray(chList)) setChannelsCount(chList.length);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchCurrentSettings();
    fetchStats();
  }, []);

  const showStatus = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      const payload: IptvSettings = {
        ...settings,
        playlistUrl: inputUrl.trim(),
        epgUrl: inputEpgUrl.trim(),
        archiveDays: Number(archiveDays),
        timeZoneOffset: timeZoneOffset === 'auto' ? 'auto' : Number(timeZoneOffset)
      };

      const res = await fetch('/api/iptv/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings || payload);
        showStatus('✓ Настройки IPTV успешно сохранены! Телевизор автоматически загрузит новый плейлист.', 'success');
        fetchStats();
      } else {
        throw new Error('Server returned error');
      }
    } catch (err: any) {
      showStatus(`Ошибка при сохранении настроек: ${err.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncEpgNow = async () => {
    setIsSyncingEpg(true);
    showStatus('Запуск фоновой синхронизации телегида...', 'info');
    try {
      const res = await fetch('/api/iptv/epg/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epgUrl: inputEpgUrl.trim() }),
        signal: AbortSignal.timeout(10000)
      });
      const data = await res.json();
      showStatus(data.message || 'Синхронизация выполняется в фоне на сервере...', 'info');

      // Poll status every 2 seconds until finished
      let pollCount = 0;
      const pollTimer = setInterval(async () => {
        pollCount++;
        try {
          const statusRes = await fetch('/api/iptv/epg/status', { signal: AbortSignal.timeout(5000) });
          if (statusRes.ok) {
            const st = await statusRes.json();
            setEpgStatus(st);
            if (!st.isSyncing || pollCount >= 60) {
              clearInterval(pollTimer);
              setIsSyncingEpg(false);
              showStatus(`✓ Телепрограмма успешно обновлена! ${st.totalProgrammes?.toLocaleString()} передач для ${st.channelsCount} каналов.`, 'success');
              fetchStats();
            } else {
              showStatus(`Идёт обработка телепрограммы... Загружено передач: ${st.totalProgrammes?.toLocaleString()} (${st.channelsCount} каналов)`, 'info');
            }
          }
        } catch (pollErr) {
          if (pollCount >= 60) {
            clearInterval(pollTimer);
            setIsSyncingEpg(false);
          }
        }
      }, 2000);
    } catch (e: any) {
      showStatus(`Ошибка запуска синхронизации: ${e.message}`, 'error');
      setIsSyncingEpg(false);
    }
  };

  const handleForceReloadChannels = async () => {
    setIsRefreshingChannels(true);
    showStatus('Принудительное обновление списка каналов...', 'info');
    try {
      const res = await fetch(`/api/iptv/channels?url=${encodeURIComponent(inputUrl.trim())}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setChannelsCount(data.length);
          showStatus(`✓ Список каналов обновлен! Загружено ${data.length} каналов.`, 'success');
        }
      } else {
        throw new Error('Failed to fetch channels');
      }
    } catch (e: any) {
      showStatus(`Ошибка обновления каналов: ${e.message}`, 'error');
    } finally {
      setIsRefreshingChannels(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full flex flex-col gap-6 pb-12">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-sky-400" />
            Настройки IPTV & Плейлиста
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Управляйте плейлистом и телепрограммой в одном месте с компьютера. Телевизор автоматически применяет эти настройки без ввода текста пультом.
          </p>
        </div>

        {onGoToPlayer && (
          <button
            onClick={onGoToPlayer}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500/20 text-sm font-semibold transition-colors cursor-pointer shrink-0"
          >
            <Tv className="w-4 h-4" />
            <span>Открыть плеер</span>
          </button>
        )}
      </div>

      {/* Notification Toast */}
      {statusMessage && (
        <div
          className={`flex items-center gap-3 p-4 rounded-xl border text-sm font-medium transition-all ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : statusMessage.type === 'error'
              ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              : 'bg-sky-950/60 border-sky-500/40 text-sky-200'
          }`}
        >
          {statusMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : statusMessage.type === 'error' ? (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          ) : (
            <RefreshCw className="w-5 h-5 text-sky-400 animate-spin shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Status Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Каналов в базе</span>
            <Radio className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-2xl font-bold text-white">
            {channelsCount !== null ? `${channelsCount} шт.` : 'Загрузка...'}
          </p>
          <span className="text-[11px] text-slate-500 mt-1">
            Кэшируются сервером для мгновенного старта на ТВ
          </span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Глубина архива</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-bold text-amber-400">
            {archiveDays} {archiveDays === 1 ? 'день' : archiveDays < 5 ? 'дня' : 'дней'}
          </p>
          <span className="text-[11px] text-slate-500 mt-1">
            Перемотка и таймшифт по протоколу flussonic/shift
          </span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
            <span>Телепрограмма (EPG)</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400">
            {epgStatus?.channelsCount ? `${epgStatus.channelsCount} кан.` : 'Активна'}
          </p>
          <span className="text-[11px] text-slate-500 mt-1">
            {epgStatus?.totalProgrammes ? `${epgStatus.totalProgrammes.toLocaleString()} передач в памяти` : 'Зеркала и кэш'}
          </span>
        </div>
      </div>

      {/* Main Settings Form */}
      <form onSubmit={handleSaveSettings} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 flex flex-col gap-6 shadow-xl">
        {/* Quick Provider Presets */}
        <div>
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
            Быстрые шаблоны провайдеров (в 1 клик):
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              {
                name: 'TV.Team (Текущий)',
                playlist: 'http://rus.hls.gd/pl/19/61bbpl1xj1srq/playlist.m3u8',
                epg: 'https://rus.epg.team/7.1.xml?pkg=442',
                archive: 7,
                badge: 'Архив 7д'
              },
              {
                name: 'ILookTV / Edem',
                playlist: 'https://vip-tv.fun/api/playlist/ВАШ_КЛЮЧ/m3u8',
                epg: 'https://epg.it999.ru/edem.xml.gz',
                archive: 4,
                badge: 'Архив 4д'
              },
              {
                name: 'Glanz TV',
                playlist: 'http://ottg.tv/ВАШ_ОТТ_КЛЮЧ/playlist.m3u8',
                epg: 'https://epg.it999.ru/epg2.xml.gz',
                archive: 7,
                badge: 'Архив 7д'
              },
              {
                name: 'CBilling',
                playlist: 'http://cbilling.tv/ВАШ_ТОКЕН/playlist.m3u8',
                epg: 'http://programtv.ru/xmltv.xml.gz',
                archive: 7,
                badge: 'Архив 7д'
              }
            ].map((prov) => {
              const isSelected = inputUrl === prov.playlist;
              return (
                <button
                  key={prov.name}
                  type="button"
                  onClick={() => {
                    setInputUrl(prov.playlist);
                    setInputEpgUrl(prov.epg);
                    setArchiveDays(prov.archive);
                    showStatus(`Выбран шаблон «${prov.name}». Замените ключ в ссылке (если нужно) и нажмите «Сохранить».`, 'info');
                  }}
                  className={`p-3 rounded-xl text-left border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                    isSelected
                      ? 'bg-sky-500/20 border-sky-400 text-white shadow-md shadow-sky-500/10'
                      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <span className="text-xs font-bold leading-tight flex items-center justify-between">
                    {prov.name}
                    {isSelected && <Check className="w-3.5 h-3.5 text-sky-400" />}
                  </span>
                  <span className="text-[10px] text-amber-400 font-medium">
                    {prov.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Playlist URL Input */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-white flex items-center justify-between">
            <span>Ссылка на плейлист (M3U / M3U8):</span>
            <button
              type="button"
              onClick={handleForceReloadChannels}
              disabled={isRefreshingChannels}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-normal cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingChannels ? 'animate-spin' : ''}`} />
              <span>Перезагрузить каналы с сервера</span>
            </button>
          </label>
          <input
            type="text"
            required
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="http://rus.hls.gd/pl/19/.../playlist.m3u8"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none transition-all"
          />
          <p className="text-xs text-slate-500">
            Поддерживаются любые плейлисты M3U/M3U8 с тегами <code className="text-slate-400">catchup="shift"</code>, <code className="text-slate-400">catchup-days</code>, <code className="text-slate-400">tvg-id</code>.
          </p>
        </div>

        {/* EPG URL Input */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-white flex items-center justify-between">
            <span>Ссылка на телегид EPG (XMLTV):</span>
            <button
              type="button"
              onClick={handleSyncEpgNow}
              disabled={isSyncingEpg}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-normal cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingEpg ? 'animate-spin' : ''}`} />
              <span>{isSyncingEpg ? 'Синхронизация...' : 'Синхронизировать EPG сейчас'}</span>
            </button>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputEpgUrl}
              onChange={(e) => setInputEpgUrl(e.target.value)}
              placeholder="https://rus.epg.team/7.1.xml?pkg=442"
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:border-sky-400 focus:ring-1 focus:ring-sky-400 outline-none transition-all"
            />
          </div>
          <p className="text-xs text-slate-500">
            TV.Team пакет с 7-дневным архивом: <span className="font-mono text-slate-400 select-all">https://rus.epg.team/7.1.xml?pkg=442</span>. Сервер кэширует гид на диск и автоматически задействует зеркала.
          </p>
        </div>

        {/* Archive Days & Timezone Offset */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Глубина архива передач: <span className="text-sky-400 font-bold">{archiveDays} дней</span>
            </label>
            <input
              type="range"
              min="1"
              max="7"
              value={archiveDays}
              onChange={(e) => setArchiveDays(parseInt(e.target.value, 10))}
              className="w-full accent-sky-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 mt-1">
              <span>1 день</span>
              <span>3 дня</span>
              <span>5 дней</span>
              <span>7 дней</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Часовой пояс телепрограммы (EPG):
            </label>
            <select
              value={timeZoneOffset}
              onChange={(e) => setTimeZoneOffset(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs outline-none focus:border-sky-400 transition-all"
            >
              <option value="auto">Авто (системное время ТВ)</option>
              <option value="3">UTC+3 — Москва, Санкт-Петербург, Минск (MSK)</option>
              <option value="2">UTC+2 — Калининград</option>
              <option value="4">UTC+4 — Самара, Ижевск</option>
              <option value="5">UTC+5 — Екатеринбург, Уфа, Тюмень</option>
              <option value="6">UTC+6 — Омск</option>
              <option value="7">UTC+7 — Красноярск, Новосибирск</option>
              <option value="8">UTC+8 — Иркутск</option>
              <option value="9">UTC+9 — Якутск</option>
              <option value="10">UTC+10 — Владивосток</option>
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Если в гиде на ТВ передачи смещены на 1-3 часа, выберите UTC+3 принудительно.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-800 mt-2">
          <span className="text-xs text-slate-400">
            Изменения вступают в силу немедленно на сервере и во всех плеерах
          </span>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-sky-500/20 cursor-pointer"
          >
            {isSaving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Сохранение...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Сохранить настройки</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
