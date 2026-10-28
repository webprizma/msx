import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { Channel, EpgProgram, IptvSettings } from '../types/iptv';
import { parseM3uPlaylist, generateSample7DayEpg, buildArchiveStreamUrl } from '../utils/iptvParser';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Tv,
  Calendar,
  Clock,
  History,
  Radio,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Film,
  Sparkles,
  Layers,
  AlertCircle,
  CheckCircle2,
  Download
} from 'lucide-react';

interface IptvPlayerProps {
  onBackToMenu?: () => void;
}

export const IptvPlayer: React.FC<IptvPlayerProps> = ({ onBackToMenu }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Channels & EPG state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [activeGroup, setActiveGroup] = useState<string>('Все');
  const [searchQuery, setSearchQuery] = useState('');
  const [epgList, setEpgList] = useState<EpgProgram[]>([]);
  const [selectedDayOffset, setSelectedDayOffset] = useState<number>(0); // 0 = today, -1 = yesterday, down to -7

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [currentPlayingProgram, setCurrentPlayingProgram] = useState<EpgProgram | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(false);

  // Overlays state
  const [showChannelList, setShowChannelList] = useState(true);
  const [showEpgDrawer, setShowEpgDrawer] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Settings
  const [settings, setSettings] = useState<IptvSettings>({
    playlistUrl: 'http://rus.hls.gd/pl/19/61bbpl1xj1srq/playlist.m3u8',
    archiveDays: 7,
    providerType: 'ilook'
  });
  const [inputUrl, setInputUrl] = useState(settings.playlistUrl);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Load settings on mount
  useEffect(() => {
    fetch('/api/iptv/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.playlistUrl) {
          setSettings(data);
          setInputUrl(data.playlistUrl);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch or load channels
  const loadChannels = useCallback(async (playlistUrl: string) => {
    setIsLoadingStream(true);
    setPlayerError(null);
    try {
      const response = await fetch(`/api/iptv/channels?url=${encodeURIComponent(playlistUrl)}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setChannels(data);
          setSelectedChannel(data[0]);
          return;
        }
      }
      throw new Error('Fallback to default sample channels');
    } catch (e) {
      // Fallback: load built-in high quality test channels with 7-day archive support
      const sampleM3u = `#EXTM3U url-tvg="http://epg.it999.ru/edem.xml.gz" catchup="shift" catchup-days="7"
#EXTINF:-1 tvg-id="1" tvg-name="Первый Канал HD" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Perviy_Kanal_logo_2012.svg/300px-Perviy_Kanal_logo_2012.svg.png" group-title="Общие",Первый Канал HD
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="2" tvg-name="Россия 1 HD" tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Rossiya_1_logo_2012.svg/300px-Rossiya_1_logo_2012.svg.png" group-title="Общие",Россия 1 HD
https://test-streams.mux.dev/test_001/stream.m3u8
#EXTINF:-1 tvg-id="3" tvg-name="Кинопремьера HD" tvg-logo="https://cdn-icons-png.flaticon.com/512/2798/2798007.png" group-title="Кино",Кинопремьера HD
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="4" tvg-name="Матч ТВ HD" tvg-logo="https://cdn-icons-png.flaticon.com/512/861/861512.png" group-title="Спорт",Матч ТВ HD
https://test-streams.mux.dev/test_001/stream.m3u8
#EXTINF:-1 tvg-id="5" tvg-name="Discovery Channel" tvg-logo="https://cdn-icons-png.flaticon.com/512/2991/2991148.png" group-title="Познавательные",Discovery Channel HD
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="6" tvg-name="ТНТ HD" tvg-logo="https://cdn-icons-png.flaticon.com/512/3845/3845874.png" group-title="Развлекательные",ТНТ HD
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`;

      const parsed = parseM3uPlaylist(sampleM3u, 7);
      setChannels(parsed);
      setSelectedChannel(parsed[0]);
    } finally {
      setIsLoadingStream(false);
    }
  }, []);

  useEffect(() => {
    loadChannels(settings.playlistUrl);
  }, [loadChannels, settings.playlistUrl]);

  // Load EPG whenever selected channel changes
  useEffect(() => {
    if (!selectedChannel) return;
    const generated = generateSample7DayEpg(selectedChannel);
    setEpgList(generated);

    const nowProg = generated.find(p => p.isLive) || generated[0];
    setCurrentPlayingProgram(nowProg);
    setIsArchiveMode(false);
  }, [selectedChannel]);

  // Stream Playback Handler with HLS.js
  const playStream = useCallback((streamUrl: string) => {
    setPlayerError(null);
    setIsLoadingStream(true);

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90
      });
      hlsRef.current = hls;

      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoadingStream(false);
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setPlayerError('Ошибка сети потока. Если плейлист не активен, проверьте подписку у провайдера.');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
          setIsLoadingStream(false);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari/iOS/Tizen HLS support
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoadingStream(false);
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      });
    } else {
      setPlayerError('Ваш браузер не поддерживает воспроизведение HLS потоков.');
      setIsLoadingStream(false);
    }
  }, []);

  // Play channel live stream on channel change
  useEffect(() => {
    if (selectedChannel && !isArchiveMode) {
      playStream(selectedChannel.streamUrl);
    }
  }, [selectedChannel, isArchiveMode, playStream]);

  // Play archive program
  const handlePlayArchiveProgram = (program: EpgProgram) => {
    if (!selectedChannel) return;
    const archiveUrl = program.archiveUrl || buildArchiveStreamUrl(selectedChannel, program);
    setIsArchiveMode(true);
    setCurrentPlayingProgram(program);
    playStream(archiveUrl);
  };

  // Switch back to live broadcast
  const handleJumpToLive = () => {
    if (!selectedChannel) return;
    setIsArchiveMode(false);
    const liveProg = epgList.find(p => p.isLive) || epgList[0];
    setCurrentPlayingProgram(liveProg);
    playStream(selectedChannel.streamUrl);
  };

  // Filter groups
  const groups = useMemo(() => {
    const set = new Set<string>();
    channels.forEach(ch => {
      if (ch.group) set.add(ch.group);
    });
    return ['Все', ...Array.from(set)];
  }, [channels]);

  // Filter channels by group and search
  const filteredChannels = useMemo(() => {
    return channels.filter(ch => {
      const matchGroup = activeGroup === 'Все' || ch.group === activeGroup;
      const matchSearch = ch.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchGroup && matchSearch;
    });
  }, [channels, activeGroup, searchQuery]);

  // Filter EPG by selected day (0 = today, -1 = yesterday, etc.)
  const filteredEpg = useMemo(() => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + selectedDayOffset);
    targetDate.setHours(0, 0, 0, 0);
    const dayStart = targetDate.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    return epgList.filter(p => p.start >= dayStart && p.start < dayEnd);
  }, [epgList, selectedDayOffset]);

  // Save Settings handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    try {
      const newSettings = { ...settings, playlistUrl: inputUrl };
      await fetch('/api/iptv/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      setSettings(newSettings);
      setShowSettingsModal(false);
      loadChannels(inputUrl);
    } catch (e) {
      alert('Ошибка при сохранении настроек');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Keyboard navigation for TV remote (D-Pad)
  useEffect(() => {
    const handleTvRemote = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          // Next channel
          if (filteredChannels.length > 0 && selectedChannel) {
            const idx = filteredChannels.findIndex(c => c.id === selectedChannel.id);
            if (idx > 0) setSelectedChannel(filteredChannels[idx - 1]);
          }
          break;
        case 'ArrowDown':
          // Previous channel
          if (filteredChannels.length > 0 && selectedChannel) {
            const idx = filteredChannels.findIndex(c => c.id === selectedChannel.id);
            if (idx < filteredChannels.length - 1) setSelectedChannel(filteredChannels[idx + 1]);
          }
          break;
        case 'ArrowLeft':
          setShowChannelList(prev => !prev);
          break;
        case 'ArrowRight':
          setShowEpgDrawer(prev => !prev);
          break;
        case ' ':
          if (videoRef.current) {
            if (videoRef.current.paused) videoRef.current.play();
            else videoRef.current.pause();
          }
          break;
        case 'Escape':
        case 'Backspace':
          if (isArchiveMode) handleJumpToLive();
          else if (onBackToMenu) onBackToMenu();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleTvRemote);
    return () => window.removeEventListener('keydown', handleTvRemote);
  }, [filteredChannels, selectedChannel, isArchiveMode, onBackToMenu]);

  // Format time helpers
  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const getDayLabel = (offset: number) => {
    if (offset === 0) return 'Сегодня';
    if (offset === -1) return 'Вчера';
    if (offset === -2) return 'Позавчера';
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div className="relative w-full h-[88vh] min-h-[640px] bg-black text-slate-100 rounded-2xl overflow-hidden border border-slate-800 flex flex-col select-none">
      {/* Top TV Bar */}
      <div className="z-30 flex items-center justify-between px-5 py-3 bg-slate-950/90 backdrop-blur-md border-b border-slate-800">
        <div className="flex items-center gap-3">
          {onBackToMenu && (
            <button
              onClick={onBackToMenu}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>В меню MSX</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-400">
              <Tv className="w-4 h-4" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-white">
                IPTV Smart Cinema Player
              </span>
              <span className="text-[11px] text-slate-400 ml-2 hidden sm:inline">
                Архив 7 дней · EPG Телепрограмма
              </span>
            </div>
          </div>
        </div>

        {/* Live / Archive Badge */}
        <div className="flex items-center gap-3">
          {isArchiveMode ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-semibold animate-pulse">
              <History className="w-3.5 h-3.5" />
              <span>ПРОСМОТР АРХИВА</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>ПРЯМОЙ ЭФИР</span>
            </div>
          )}

          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-sky-400" />
            <span>Плейлист M3U</span>
          </button>
        </div>
      </div>

      {/* Main Player & Panes Area */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* Left Drawer: Channels List */}
        {showChannelList && (
          <div className="w-72 sm:w-80 bg-slate-950/95 backdrop-blur-md border-r border-slate-800/80 z-20 flex flex-col h-full shrink-0">
            {/* Search and Groups */}
            <div className="p-3 border-b border-slate-800 flex flex-col gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск телеканала..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-700/80 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Group tabs */}
              <div className="flex gap-1 overflow-x-auto no-scrollbar py-0.5">
                {groups.map(grp => (
                  <button
                    key={grp}
                    onClick={() => setActiveGroup(grp)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors ${
                      activeGroup === grp
                        ? 'bg-sky-500 text-slate-950 font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {grp}
                  </button>
                ))}
              </div>
            </div>

            {/* Channels Scroll Area */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filteredChannels.length === 0 ? (
                <div className="text-center py-10 text-xs text-slate-500">
                  Каналы не найдены
                </div>
              ) : (
                filteredChannels.map((ch, idx) => {
                  const isSelected = selectedChannel?.id === ch.id;
                  return (
                    <div
                      key={ch.id}
                      onClick={() => {
                        setSelectedChannel(ch);
                        setIsArchiveMode(false);
                      }}
                      className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-sky-500/20 border border-sky-400/50 text-white shadow-md'
                          : 'hover:bg-slate-900/80 border border-transparent text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[10px] font-mono text-slate-500 w-5 text-right">
                          {idx + 1}
                        </span>
                        <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                          {ch.logo ? (
                            <img src={ch.logo} alt={ch.name} className="w-full h-full object-contain" />
                          ) : (
                            <Tv className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs font-bold truncate">{ch.name}</h4>
                          <span className="text-[10px] text-slate-500 truncate block">
                            {ch.group}
                          </span>
                        </div>
                      </div>

                      {ch.catchupDays > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                          {ch.catchupDays}дн архив
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Center: Video Viewport */}
        <div className="relative flex-1 bg-black flex flex-col justify-between overflow-hidden">
          {/* Main Video Element */}
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              playsInline
              onClick={() => {
                if (videoRef.current) {
                  if (videoRef.current.paused) videoRef.current.play();
                  else videoRef.current.pause();
                }
              }}
            />

            {/* Loading Spinner */}
            {isLoadingStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10">
                <div className="w-10 h-10 border-3 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" />
                <span className="text-xs text-slate-300 font-medium">Загрузка потока телеканала...</span>
              </div>
            )}

            {/* Error Message */}
            {playerError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center z-10">
                <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
                <h3 className="text-sm font-bold text-white mb-1">Ошибка воспроизведения</h3>
                <p className="text-xs text-slate-300 max-w-md mb-4">{playerError}</p>
                <button
                  onClick={() => selectedChannel && playStream(selectedChannel.streamUrl)}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg cursor-pointer"
                >
                  Попробовать снова
                </button>
              </div>
            )}
          </div>

          {/* Bottom On-Screen Playback Controls */}
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black via-black/80 to-transparent p-5 z-20 flex flex-col gap-3">
            {/* Current Playing Program Card */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/80 backdrop-blur-md p-3 rounded-xl border border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-black/50 p-1 border border-white/10 shrink-0 flex items-center justify-center">
                  {selectedChannel?.logo ? (
                    <img src={selectedChannel.logo} alt={selectedChannel.name} className="w-full h-full object-contain" />
                  ) : (
                    <Tv className="w-5 h-5 text-sky-400" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">{selectedChannel?.name}</span>
                    <span className="text-[10px] text-slate-400">·</span>
                    <span className="text-[11px] font-semibold text-sky-400">
                      {currentPlayingProgram?.title || 'Прямой эфир'}
                    </span>
                  </div>
                  {currentPlayingProgram && (
                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                      <Clock className="w-3 h-3 text-slate-500" />
                      <span>{formatTime(currentPlayingProgram.start)} — {formatTime(currentPlayingProgram.end)}</span>
                      {currentPlayingProgram.description && (
                        <>
                          <span>·</span>
                          <span className="truncate max-w-xs">{currentPlayingProgram.description}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isArchiveMode && (
                <button
                  onClick={handleJumpToLive}
                  className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-lg"
                >
                  <Radio className="w-3.5 h-3.5 animate-pulse" />
                  <span>В прямой эфир</span>
                </button>
              )}
            </div>

            {/* Controls Row */}
            <div className="flex items-center justify-between text-xs text-white">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (videoRef.current) {
                      if (videoRef.current.paused) videoRef.current.play();
                      else videoRef.current.pause();
                    }
                  }}
                  className="w-9 h-9 rounded-full bg-white text-slate-950 flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                <button
                  onClick={() => {
                    if (videoRef.current) {
                      videoRef.current.muted = !isMuted;
                      setIsMuted(!isMuted);
                    }
                  }}
                  className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>

                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setVolume(v);
                    if (videoRef.current) {
                      videoRef.current.volume = v;
                      videoRef.current.muted = false;
                      setIsMuted(false);
                    }
                  }}
                  className="w-20 accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowChannelList(!showChannelList)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    showChannelList ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Каналы (Стрелка влево)
                </button>
                <button
                  onClick={() => setShowEpgDrawer(!showEpgDrawer)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    showEpgDrawer ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  Архив 7 дней (Стрелка вправо)
                </button>
                <button
                  onClick={() => {
                    if (!document.fullscreenElement) {
                      videoRef.current?.requestFullscreen?.();
                    } else {
                      document.exitFullscreen?.();
                    }
                  }}
                  className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 cursor-pointer"
                  title="Полноэкранный режим"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Drawer: 7-Day EPG Schedule & Catchup Archive */}
        {showEpgDrawer && (
          <div className="w-80 sm:w-96 bg-slate-950/95 backdrop-blur-md border-l border-slate-800/80 z-20 flex flex-col h-full shrink-0">
            {/* EPG Header */}
            <div className="p-3 border-b border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-sky-400" />
                  <span>Телепрограмма & Архив (7 дней)</span>
                </h3>
                <span className="text-[10px] text-amber-400 font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                  Архив 7дн
                </span>
              </div>

              {/* 7-Day Selector Bar */}
              <div className="flex gap-1 overflow-x-auto no-scrollbar py-1">
                {[-7, -6, -5, -4, -3, -2, -1, 0].map((offset) => (
                  <button
                    key={offset}
                    onClick={() => setSelectedDayOffset(offset)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                      selectedDayOffset === offset
                        ? 'bg-sky-500 text-slate-950 font-bold shadow'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {getDayLabel(offset)}
                  </button>
                ))}
              </div>
            </div>

            {/* EPG Program List for Selected Day */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredEpg.length === 0 ? (
                <div className="text-center py-12 text-xs text-slate-500">
                  На этот день телепрограмма отсутствует
                </div>
              ) : (
                filteredEpg.map((prog) => {
                  const isCurrent = currentPlayingProgram?.id === prog.id;
                  return (
                    <div
                      key={prog.id}
                      onClick={() => {
                        if (prog.isLive) {
                          handleJumpToLive();
                        } else if (prog.hasArchive) {
                          handlePlayArchiveProgram(prog);
                        } else {
                          alert(`Передача «${prog.title}» ещё не началась или вышла за пределы 7-дневного архива.`);
                        }
                      }}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                        isCurrent
                          ? 'bg-sky-500/20 border-sky-400 text-white shadow-md'
                          : prog.isLive
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                          : prog.hasArchive
                          ? 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-200'
                          : 'bg-slate-950 border-slate-900 text-slate-500 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono font-semibold text-slate-400">
                          {formatTime(prog.start)} — {formatTime(prog.end)}
                        </span>

                        {prog.isLive ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500 text-slate-950 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                            В ЭФИРЕ
                          </span>
                        ) : prog.hasArchive ? (
                          <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <History className="w-2.5 h-2.5" />
                            АРХИВ
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-500">СКОРО</span>
                        )}
                      </div>

                      <h4 className="text-xs font-bold leading-snug line-clamp-2">
                        {prog.title}
                      </h4>

                      {prog.description && (
                        <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">
                          {prog.description}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal (Paste M3U Playlist URL) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-sky-400" />
                <span>Настройка IPTV плейлиста провайдера</span>
              </h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Ссылка на M3U / M3U8 плейлист провайдера
                </label>
                <input
                  type="text"
                  required
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="http://rus.hls.gd/pl/19/.../playlist.m3u8"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-sky-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Вставьте ссылку на ваш плейлист (например, из личного кабинета iLookTV / Edem / Sharavoz).
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Глубина архива (дней): 7
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="7"
                    value={settings.archiveDays}
                    onChange={(e) => setSettings({ ...settings, archiveDays: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-sky-400"
                  />
                  <span className="font-bold text-sky-400">{settings.archiveDays} дней</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {isSavingSettings ? 'Загрузка...' : 'Сохранить и загрузить каналы'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
