import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { Channel, EpgProgram, IptvSettings } from '../types/iptv';
import {
  parseM3uPlaylist,
  generateSample7DayEpg,
  buildArchiveStreamUrl,
  buildTimestampArchiveUrl,
  findProgramForTimestamp
} from '../utils/iptvParser';
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
  ArrowLeft,
  FastForward,
  Rewind,
  X
} from 'lucide-react';

interface IptvPlayerProps {
  isTvMode?: boolean;
  onEnterTvMode?: () => void;
  onBackToMenu?: () => void;
}

type OverlayMode = 'none' | 'channels' | 'epg' | 'prompt' | 'timeline' | 'settings';

export const IptvPlayer: React.FC<IptvPlayerProps> = ({
  isTvMode = false,
  onEnterTvMode,
  onBackToMenu
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timelineHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seekDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Channels & EPG state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [focusedChannelIndex, setFocusedChannelIndex] = useState<number>(0);
  const [activeGroup, setActiveGroup] = useState<string>('Все');
  const [searchQuery, setSearchQuery] = useState('');
  const [epgList, setEpgList] = useState<EpgProgram[]>([]);
  const [focusedProgramIndex, setFocusedProgramIndex] = useState<number>(0);
  const [selectedDayOffset, setSelectedDayOffset] = useState<number>(0); // 0 = today, -1 = yesterday, down to -7

  // Overlay state: 'none', 'channels', 'epg', 'prompt', 'timeline', 'settings'
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(isTvMode ? 'none' : 'channels');
  const [promptProgram, setPromptProgram] = useState<EpgProgram | null>(null);
  const [promptFocusedChoice, setPromptFocusedChoice] = useState<'live' | 'start'>('live');

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [currentPlayingProgram, setCurrentPlayingProgram] = useState<EpgProgram | null>(null);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(false);

  // Timeshift Seek state (Unix ms timestamp)
  const [seekTimestamp, setSeekTimestamp] = useState<number>(Date.now());
  const [activeTimelineProgram, setActiveTimelineProgram] = useState<EpgProgram | null>(null);

  // Settings
  const [settings, setSettings] = useState<IptvSettings>({
    playlistUrl: 'http://rus.hls.gd/pl/19/61bbpl1xj1srq/playlist.m3u8',
    archiveDays: 7,
    providerType: 'ilook'
  });
  const [inputUrl, setInputUrl] = useState(settings.playlistUrl);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Format helpers
  const formatTime = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  const formatSecondsToClock = (ms: number) => {
    const d = new Date(ms);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
          setFocusedChannelIndex(0);
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
      setFocusedChannelIndex(0);
    } finally {
      setIsLoadingStream(false);
    }
  }, []);

  useEffect(() => {
    loadChannels(settings.playlistUrl);
  }, [loadChannels, settings.playlistUrl]);

  // FIX: Whenever selectedChannel changes, regenerate UNIQUE EPG for that channel and update bottom metadata
  useEffect(() => {
    if (!selectedChannel) return;
    const generated = generateSample7DayEpg(selectedChannel);
    setEpgList(generated);

    const nowProg = generated.find(p => p.isLive) || generated[0];
    setCurrentPlayingProgram(nowProg);
    setActiveTimelineProgram(nowProg);
    setSeekTimestamp(Date.now());
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
              setPlayerError('Ошибка загрузки потока провайдера. Проверьте активность подписки.');
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
      // Native Safari/Tizen/webOS HLS support
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoadingStream(false);
        video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      });
    } else {
      setPlayerError('Браузер не поддерживает HLS потоки.');
      setIsLoadingStream(false);
    }
  }, []);

  // Play channel live stream on channel change
  useEffect(() => {
    if (selectedChannel && !isArchiveMode) {
      playStream(selectedChannel.streamUrl);
    }
  }, [selectedChannel, isArchiveMode, playStream]);

  // Jump to Live Broadcast
  const handleJumpToLive = useCallback(() => {
    if (!selectedChannel) return;
    setIsArchiveMode(false);
    const liveProg = epgList.find(p => p.isLive) || epgList[0];
    setCurrentPlayingProgram(liveProg);
    setActiveTimelineProgram(liveProg);
    setSeekTimestamp(Date.now());
    playStream(selectedChannel.streamUrl);
  }, [selectedChannel, epgList, playStream]);

  // Play Archive from a specific program
  const handlePlayArchiveProgram = useCallback((program: EpgProgram, fromStart = true) => {
    if (!selectedChannel) return;
    const startSec = Math.floor(program.start / 1000);
    const endSec = Math.floor(program.end / 1000);
    const archiveUrl = buildTimestampArchiveUrl(selectedChannel, startSec, endSec);

    setIsArchiveMode(true);
    setCurrentPlayingProgram(program);
    setActiveTimelineProgram(program);
    setSeekTimestamp(fromStart ? program.start : Date.now());
    playStream(archiveUrl);
    setOverlayMode('none');
  }, [selectedChannel, playStream]);

  // Play Archive from an exact seek timestamp
  const handleSeekToTimestamp = useCallback((targetTimestamp: number) => {
    if (!selectedChannel) return;
    const now = Date.now();

    // If within 30 seconds of live, jump to live
    if (targetTimestamp >= now - 30000) {
      handleJumpToLive();
      return;
    }

    const matchedProgram = findProgramForTimestamp(epgList, targetTimestamp);
    const startSec = Math.floor(targetTimestamp / 1000);
    const endSec = matchedProgram ? Math.floor(matchedProgram.end / 1000) : startSec + 3600;

    const archiveUrl = buildTimestampArchiveUrl(selectedChannel, startSec, endSec);
    setIsArchiveMode(true);
    if (matchedProgram) {
      setCurrentPlayingProgram(matchedProgram);
      setActiveTimelineProgram(matchedProgram);
    }
    setSeekTimestamp(targetTimestamp);
    playStream(archiveUrl);
  }, [selectedChannel, epgList, handleJumpToLive, playStream]);

  // Reset auto-hide timer for Timeline
  const resetTimelineAutoHide = useCallback(() => {
    if (timelineHideTimeoutRef.current) {
      clearTimeout(timelineHideTimeoutRef.current);
    }
    timelineHideTimeoutRef.current = setTimeout(() => {
      setOverlayMode(prev => prev === 'timeline' ? 'none' : prev);
    }, 5000);
  }, []);

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
      setOverlayMode('none');
      loadChannels(inputUrl);
    } catch (e) {
      alert('Ошибка при сохранении настроек');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // TV Remote D-Pad / Keyboard Navigation Controller
  useEffect(() => {
    const handleTvKey = (e: KeyboardEvent) => {
      // Prevent default browser scrolling on arrow keys and space
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
      }

      // 1. STATE: OVERLAY 'none' (Pure Fullscreen Video)
      if (overlayMode === 'none') {
        switch (e.key) {
          case 'Enter':
          case 'OK':
          case ' ':
            // Pressing OK opens the Channel List
            setOverlayMode('channels');
            if (selectedChannel) {
              const idx = filteredChannels.findIndex(c => c.id === selectedChannel.id);
              if (idx !== -1) setFocusedChannelIndex(idx);
            }
            break;

          case 'ArrowDown':
            // Pressing DOWN opens the Timeshift / Timeline OSD Bar
            setOverlayMode('timeline');
            setSeekTimestamp(isArchiveMode ? seekTimestamp : Date.now());
            setActiveTimelineProgram(currentPlayingProgram);
            resetTimelineAutoHide();
            break;

          case 'ArrowUp':
            // Pressing UP opens the Channel List as well for convenience
            setOverlayMode('channels');
            break;

          case 'ArrowLeft':
            // Quick rewind 30s
            handleSeekToTimestamp(seekTimestamp - 30000);
            setOverlayMode('timeline');
            resetTimelineAutoHide();
            break;

          case 'ArrowRight':
            // Quick forward 30s
            handleSeekToTimestamp(Math.min(Date.now(), seekTimestamp + 30000));
            setOverlayMode('timeline');
            resetTimelineAutoHide();
            break;

          case 'Escape':
          case 'Backspace':
            onBackToMenu?.();
            break;
        }
        return;
      }

      // 2. STATE: OVERLAY 'channels' (Channel List Open)
      if (overlayMode === 'channels') {
        switch (e.key) {
          case 'ArrowUp':
            setFocusedChannelIndex(prev => Math.max(0, prev - 1));
            break;

          case 'ArrowDown':
            setFocusedChannelIndex(prev => Math.min(filteredChannels.length - 1, prev + 1));
            break;

          case 'ArrowLeft':
            // Switch to previous category/group
            {
              const curGrpIdx = groups.indexOf(activeGroup);
              const nextGrpIdx = (curGrpIdx - 1 + groups.length) % groups.length;
              setActiveGroup(groups[nextGrpIdx]);
              setFocusedChannelIndex(0);
            }
            break;

          case 'ArrowRight':
            // Switch to next category/group
            {
              const curGrpIdx = groups.indexOf(activeGroup);
              const nextGrpIdx = (curGrpIdx + 1) % groups.length;
              setActiveGroup(groups[nextGrpIdx]);
              setFocusedChannelIndex(0);
            }
            break;

          case 'Enter':
          case 'OK':
          case ' ':
            // Click on a channel: Select it and open its EPG schedule!
            if (filteredChannels[focusedChannelIndex]) {
              const ch = filteredChannels[focusedChannelIndex];
              setSelectedChannel(ch);
              setOverlayMode('epg');
              setFocusedProgramIndex(0);
            }
            break;

          case 'Escape':
          case 'Backspace':
            // Close channels and return to pure video
            setOverlayMode('none');
            break;
        }
        return;
      }

      // 3. STATE: OVERLAY 'epg' (Program Schedule Open for Selected Channel)
      if (overlayMode === 'epg') {
        switch (e.key) {
          case 'ArrowUp':
            setFocusedProgramIndex(prev => Math.max(0, prev - 1));
            break;

          case 'ArrowDown':
            setFocusedProgramIndex(prev => Math.min(filteredEpg.length - 1, prev + 1));
            break;

          case 'ArrowLeft':
            // Step back in archive days (-1 day, down to -7)
            setSelectedDayOffset(prev => Math.max(-7, prev - 1));
            setFocusedProgramIndex(0);
            break;

          case 'ArrowRight':
            // Step forward in archive days (up to 0 = today)
            setSelectedDayOffset(prev => Math.min(0, prev + 1));
            setFocusedProgramIndex(0);
            break;

          case 'Enter':
          case 'OK':
          case ' ':
            // Click on a program:
            if (filteredEpg[focusedProgramIndex]) {
              const prog = filteredEpg[focusedProgramIndex];
              if (prog.isLive) {
                // If LIVE: show modal prompt ("Смотреть прямой эфир" or "Смотреть с начала")
                setPromptProgram(prog);
                setPromptFocusedChoice('live');
                setOverlayMode('prompt');
              } else {
                // If past archive program: play directly!
                handlePlayArchiveProgram(prog, true);
              }
            }
            break;

          case 'Escape':
          case 'Backspace':
            // Back to channel list
            setOverlayMode('channels');
            break;
        }
        return;
      }

      // 4. STATE: OVERLAY 'prompt' (Choice: "Прямой эфир" или "Смотреть с начала")
      if (overlayMode === 'prompt') {
        switch (e.key) {
          case 'ArrowUp':
          case 'ArrowLeft':
            setPromptFocusedChoice('live');
            break;

          case 'ArrowDown':
          case 'ArrowRight':
            setPromptFocusedChoice('start');
            break;

          case 'Enter':
          case 'OK':
          case ' ':
            if (promptFocusedChoice === 'live') {
              handleJumpToLive();
            } else if (promptProgram) {
              handlePlayArchiveProgram(promptProgram, true);
            }
            setOverlayMode('none');
            break;

          case 'Escape':
          case 'Backspace':
            setOverlayMode('epg');
            break;
        }
        return;
      }

      // 5. STATE: OVERLAY 'timeline' (Bottom OSD Timeshift Bar)
      if (overlayMode === 'timeline') {
        resetTimelineAutoHide();

        switch (e.key) {
          case 'ArrowLeft':
            // Rewind 60 seconds
            {
              const newTime = seekTimestamp - 60000;
              setSeekTimestamp(newTime);

              // Seamlessly update program metadata if seek timestamp crosses program boundaries
              const matched = findProgramForTimestamp(epgList, newTime);
              if (matched) {
                setActiveTimelineProgram(matched);
              }

              // Debounce stream seek
              if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
              seekDebounceTimeoutRef.current = setTimeout(() => {
                handleSeekToTimestamp(newTime);
              }, 1200);
            }
            break;

          case 'ArrowRight':
            // Fast-forward 60 seconds (capped at current real time)
            {
              const now = Date.now();
              const newTime = Math.min(now, seekTimestamp + 60000);
              setSeekTimestamp(newTime);

              // Seamlessly update program metadata if seek timestamp crosses program boundaries
              const matched = findProgramForTimestamp(epgList, newTime);
              if (matched) {
                setActiveTimelineProgram(matched);
              }

              // Debounce stream seek
              if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
              seekDebounceTimeoutRef.current = setTimeout(() => {
                handleSeekToTimestamp(newTime);
              }, 1200);
            }
            break;

          case 'Enter':
          case 'OK':
          case ' ':
            // Immediately apply seek timestamp and hide OSD
            if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
            handleSeekToTimestamp(seekTimestamp);
            setOverlayMode('none');
            break;

          case 'ArrowUp':
          case 'Escape':
          case 'Backspace':
            setOverlayMode('none');
            break;
        }
        return;
      }
    };

    window.addEventListener('keydown', handleTvKey);
    return () => {
      window.removeEventListener('keydown', handleTvKey);
      if (timelineHideTimeoutRef.current) clearTimeout(timelineHideTimeoutRef.current);
      if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
    };
  }, [
    overlayMode,
    focusedChannelIndex,
    filteredChannels,
    selectedChannel,
    groups,
    activeGroup,
    focusedProgramIndex,
    filteredEpg,
    promptFocusedChoice,
    promptProgram,
    seekTimestamp,
    epgList,
    currentPlayingProgram,
    isArchiveMode,
    handleJumpToLive,
    handlePlayArchiveProgram,
    handleSeekToTimestamp,
    resetTimelineAutoHide,
    onBackToMenu
  ]);

  // Current program timeline calculations
  const progDurationMs = activeTimelineProgram
    ? Math.max(1, activeTimelineProgram.end - activeTimelineProgram.start)
    : 3600000;
  const progElapsedMs = activeTimelineProgram
    ? Math.max(0, Math.min(progDurationMs, seekTimestamp - activeTimelineProgram.start))
    : 0;
  const progProgressPercent = Math.round((progElapsedMs / progDurationMs) * 100);

  return (
    <div className="relative w-full h-full min-h-screen bg-black text-white overflow-hidden select-none font-sans">
      {/* 1. FULLSCREEN VIDEO LAYER */}
      <div className="absolute inset-0 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          autoPlay
          playsInline
        />

        {/* Loading Spinner */}
        {isLoadingStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10 pointer-events-none">
            <div className="w-16 h-16 border-4 border-sky-500/30 border-t-sky-400 rounded-full animate-spin mb-4" />
            <p className="text-sm font-semibold tracking-wide text-sky-200">
              Загрузка трансляции {selectedChannel?.name ? `(${selectedChannel.name})` : ''}...
            </p>
          </div>
        )}

        {/* Stream Error Notice */}
        {playerError && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 max-w-xl p-4 rounded-2xl bg-rose-950/90 border border-rose-500/50 text-rose-200 text-sm flex items-center gap-3 backdrop-blur-md z-20">
            <AlertCircle className="w-6 h-6 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-white mb-0.5">Ошибка воспроизведения</p>
              <p className="text-xs text-rose-300">{playerError}</p>
            </div>
            <button
              onClick={() => {
                if (selectedChannel) playStream(selectedChannel.streamUrl);
              }}
              className="px-3 py-1.5 bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold rounded-lg text-xs"
            >
              Повторить
            </button>
          </div>
        )}
      </div>

      {/* WEB DESKTOP HEADER (ONLY in Web Mode, NEVER in TV Mode) */}
      {!isTvMode && (
        <div className="relative z-30 flex items-center justify-between p-4 bg-gradient-to-b from-black/90 via-black/60 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center shadow-lg">
              <Tv className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white flex items-center gap-2">
                Домашний IPTV Плеер
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                  Архив 7 дней
                </span>
              </h1>
              <p className="text-xs text-slate-400">
                Канал: <span className="text-sky-300 font-semibold">{selectedChannel?.name || 'Не выбран'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onEnterTvMode && (
              <button
                onClick={onEnterTvMode}
                className="px-4 py-2 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 shadow-lg cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
                Режим ТВ (Во весь экран)
              </button>
            )}

            <button
              onClick={() => setOverlayMode(overlayMode === 'channels' ? 'none' : 'channels')}
              className="px-3 py-2 bg-slate-800/80 hover:bg-slate-700 text-white rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Layers className="w-4 h-4" />
              Каналы
            </button>

            <button
              onClick={() => setOverlayMode('settings')}
              className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded-xl cursor-pointer"
              title="Настройки плейлиста"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 2. CHANNELS OVERLAY DRAWER (Triggered by remote "OK" / "Enter") */}
      {overlayMode === 'channels' && (
        <div className="absolute inset-y-0 left-0 w-96 max-w-[85vw] bg-slate-950/95 backdrop-blur-xl border-r border-slate-800/80 z-40 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-sky-400" />
                Телеканалы
              </h2>
              <p className="text-xs text-slate-400">
                {filteredChannels.length} каналов · Нажмите <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-sky-300 text-[10px]">OK</kbd> для программы
              </p>
            </div>
            <button
              onClick={() => setOverlayMode('none')}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 p-3 overflow-x-auto no-scrollbar border-b border-slate-800/50">
            {groups.map((group) => (
              <button
                key={group}
                onClick={() => {
                  setActiveGroup(group);
                  setFocusedChannelIndex(0);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                  activeGroup === group
                    ? 'bg-sky-500 text-slate-950 shadow-md font-bold'
                    : 'bg-slate-900/90 text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {group}
              </button>
            ))}
          </div>

          {/* Search box in web view */}
          {!isTvMode && (
            <div className="p-3 border-b border-slate-800/50">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск канала..."
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          )}

          {/* Channel Items List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {filteredChannels.map((channel, idx) => {
              const isSelected = selectedChannel?.id === channel.id;
              const isFocused = focusedChannelIndex === idx;

              return (
                <div
                  key={channel.id}
                  onClick={() => {
                    setSelectedChannel(channel);
                    setFocusedChannelIndex(idx);
                    setOverlayMode('epg');
                  }}
                  className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                    isFocused
                      ? 'bg-sky-500/25 ring-2 ring-sky-400 shadow-lg text-white font-semibold'
                      : isSelected
                      ? 'bg-slate-900 text-sky-300 border border-sky-500/30'
                      : 'hover:bg-slate-900/60 text-slate-300 border border-transparent'
                  }`}
                >
                  <span className="w-6 text-center text-xs font-mono text-slate-500">
                    {idx + 1}
                  </span>

                  <div className="w-10 h-10 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt={channel.name}
                        className="w-full h-full object-contain p-1"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Tv className="w-5 h-5 text-slate-600" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold truncate leading-tight">
                      {channel.name}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                      {channel.group || 'Канал'}
                    </p>
                  </div>

                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-amber-300 border border-amber-500/20 font-medium">
                    7д
                  </span>
                </div>
              );
            })}
          </div>

          {/* Remote Navigation Hint */}
          <div className="p-3 bg-slate-900/80 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
            <span>▲▼ Каналы · ◄► Группы</span>
            <span className="text-sky-300 font-bold">ОК: Программа передач</span>
          </div>
        </div>
      )}

      {/* 3. EPG SCHEDULE OVERLAY DRAWER (Triggered by clicking a channel) */}
      {overlayMode === 'epg' && selectedChannel && (
        <div className="absolute inset-y-0 left-0 sm:left-96 w-full sm:w-[480px] max-w-full bg-slate-950/95 backdrop-blur-xl border-r border-slate-800/80 z-40 flex flex-col shadow-2xl animate-in slide-in-from-left duration-200">
          {/* Header */}
          <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOverlayMode('channels')}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
                title="Назад к списку каналов"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  {selectedChannel.name}
                </h2>
                <p className="text-xs text-sky-400 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  Телепрограмма & Архив на 7 дней
                </p>
              </div>
            </div>
            <button
              onClick={() => setOverlayMode('none')}
              className="p-2 rounded-xl text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 7-Day Selector Bar */}
          <div className="flex items-center gap-1.5 p-3 overflow-x-auto no-scrollbar border-b border-slate-800/50">
            {[-7, -6, -5, -4, -3, -2, -1, 0].map((offset) => {
              const label =
                offset === 0
                  ? 'Сегодня'
                  : offset === -1
                  ? 'Вчера'
                  : offset === -2
                  ? 'Позавчера'
                  : `${offset}д`;
              const isSelected = selectedDayOffset === offset;

              return (
                <button
                  key={offset}
                  onClick={() => {
                    setSelectedDayOffset(offset);
                    setFocusedProgramIndex(0);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-sky-500 text-slate-950 font-bold shadow-md'
                      : 'bg-slate-900/90 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Program Schedule List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredEpg.map((prog, idx) => {
              const isFocused = focusedProgramIndex === idx;
              const isCurrentLive = prog.isLive;

              return (
                <div
                  key={prog.id}
                  onClick={() => {
                    setFocusedProgramIndex(idx);
                    if (prog.isLive) {
                      setPromptProgram(prog);
                      setPromptFocusedChoice('live');
                      setOverlayMode('prompt');
                    } else {
                      handlePlayArchiveProgram(prog, true);
                    }
                  }}
                  className={`p-3 rounded-xl cursor-pointer transition-all ${
                    isFocused
                      ? 'bg-sky-500/25 ring-2 ring-sky-400 shadow-lg text-white'
                      : isCurrentLive
                      ? 'bg-sky-950/60 border border-sky-500/40 text-slate-100'
                      : 'bg-slate-900/50 hover:bg-slate-900 border border-slate-800/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-sky-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatTime(prog.start)} — {formatTime(prog.end)}
                    </span>

                    {prog.isLive ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-1 animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                        ЭФИР
                      </span>
                    ) : prog.hasArchive ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1">
                        <History className="w-3 h-3" />
                        АРХИВ
                      </span>
                    ) : null}
                  </div>

                  <h3 className="text-xs font-bold text-white leading-tight">
                    {prog.title}
                  </h3>

                  {prog.description && (
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                      {prog.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Remote Navigation Hint */}
          <div className="p-3 bg-slate-900/80 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
            <span>▲▼ Передачи · ◄► Дни</span>
            <span className="text-sky-300 font-bold">ОК: Запустить</span>
          </div>
        </div>
      )}

      {/* 4. MODAL PROMPT: LIVE OR START FROM BEGINNING? (User requested prompt) */}
      {overlayMode === 'prompt' && promptProgram && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center mb-4">
              <Tv className="w-7 h-7 text-sky-400" />
            </div>

            <h3 className="text-lg font-bold text-white mb-1">
              {promptProgram.title}
            </h3>
            <p className="text-xs text-sky-400 font-mono mb-6">
              {formatTime(promptProgram.start)} — {formatTime(promptProgram.end)} · {selectedChannel?.name}
            </p>

            <div className="w-full flex flex-col gap-3">
              <button
                onClick={() => {
                  handleJumpToLive();
                  setOverlayMode('none');
                }}
                className={`w-full py-3.5 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  promptFocusedChoice === 'live'
                    ? 'bg-rose-500 text-white ring-4 ring-rose-400/50 shadow-lg scale-[1.02]'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <Radio className="w-4 h-4 text-white animate-pulse" />
                Смотреть прямой эфир
              </button>

              <button
                onClick={() => {
                  handlePlayArchiveProgram(promptProgram, true);
                  setOverlayMode('none');
                }}
                className={`w-full py-3.5 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                  promptFocusedChoice === 'start'
                    ? 'bg-sky-500 text-slate-950 ring-4 ring-sky-400/50 shadow-lg scale-[1.02]'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                Смотреть с начала (Архив)
              </button>
            </div>

            <button
              onClick={() => setOverlayMode('epg')}
              className="mt-4 text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Отмена (Back)
            </button>
          </div>
        </div>
      )}

      {/* 5. TIMELINE / TIMESHIFT OSD BAR (Triggered by remote "DOWN" or Left/Right seek) */}
      {(overlayMode === 'timeline' || !isTvMode) && selectedChannel && (
        <div
          className={`absolute bottom-0 inset-x-0 z-30 transition-all duration-300 ${
            overlayMode === 'timeline'
              ? 'translate-y-0 opacity-100'
              : isTvMode
              ? 'translate-y-full opacity-0 pointer-events-none'
              : 'translate-y-0 opacity-100'
          }`}
        >
          <div className="bg-gradient-to-t from-black via-black/95 to-transparent p-6 pt-12">
            <div className="max-w-5xl mx-auto flex flex-col gap-3">
              {/* Top Row: Channel and Current Program Information */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-700 p-1 flex items-center justify-center overflow-hidden shrink-0 shadow-lg">
                    {selectedChannel.logo ? (
                      <img
                        src={selectedChannel.logo}
                        alt={selectedChannel.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Tv className="w-6 h-6 text-sky-400" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {selectedChannel.name}
                      </span>
                      {isArchiveMode ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1">
                          <History className="w-3 h-3" />
                          АРХИВ / ТАЙМШИФТ
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                          ПРЯМОЙ ЭФИР
                        </span>
                      )}
                    </div>

                    <h2 className="text-base font-bold text-sky-200 mt-0.5">
                      {activeTimelineProgram?.title || 'Прямой эфир телеканала'}
                    </h2>
                    {activeTimelineProgram?.description && (
                      <p className="text-xs text-slate-400 max-w-2xl line-clamp-1 mt-0.5">
                        {activeTimelineProgram.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {isArchiveMode && (
                    <button
                      onClick={handleJumpToLive}
                      className="px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-lg"
                    >
                      <Radio className="w-3.5 h-3.5" />
                      В прямой эфир
                    </button>
                  )}
                </div>
              </div>

              {/* Middle Row: Progress Bar & Seek Handle */}
              <div className="flex flex-col gap-1.5">
                <div className="relative w-full h-3 bg-slate-800 rounded-full overflow-hidden cursor-pointer">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-150"
                    style={{ width: `${progProgressPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>
                    {activeTimelineProgram
                      ? formatTime(activeTimelineProgram.start)
                      : '00:00'}
                  </span>
                  <span className="font-bold text-sky-300">
                    Текущая позиция: {formatSecondsToClock(seekTimestamp)}
                  </span>
                  <span>
                    {activeTimelineProgram
                      ? formatTime(activeTimelineProgram.end)
                      : '00:00'}
                  </span>
                </div>
              </div>

              {/* Bottom Row: TV Remote Navigation Hints */}
              <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/50">
                <span>
                  ◄ Влево / Вправо ►: Перемотка (с автопереключением передач)
                </span>
                <span className="text-sky-300 font-bold">
                  ОК: Применить перемотку · ▲/Back: Скрыть
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. SETTINGS MODAL */}
      {overlayMode === 'settings' && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-sky-400" />
                Настройки IPTV Плейлиста
              </h3>
              <button
                onClick={() => setOverlayMode('none')}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="flex flex-col gap-4 text-xs">
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
                  Поддерживаются плейлисты провайдеров (iLook / Edem / Sharavoz / VipLime) с 7-дневным архивом catchup.
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
                  onClick={() => setOverlayMode('none')}
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
