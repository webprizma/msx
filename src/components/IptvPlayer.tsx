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
  AlertCircle,
  X,
  ArrowLeft
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const timelineHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seekDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hudTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Responsive TV 1920x1080 Viewport Scaler
  const [tvScale, setTvScale] = useState<number>(1);
  const [remoteDebugKey, setRemoteDebugKey] = useState<string | null>(null);

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

  // 1. DYNAMIC TV 1920x1080 VIEWPORT SCALE ENGINE
  // Automatically fits the UI into any Smart TV resolution (960x540, 720p, 1080p, 4K) without 4x zoom!
  useEffect(() => {
    const updateScale = () => {
      const screenW = window.innerWidth || document.documentElement.clientWidth || 1920;
      const screenH = window.innerHeight || document.documentElement.clientHeight || 1080;
      const scaleX = screenW / 1920;
      const scaleY = screenH / 1080;
      const s = Math.min(scaleX, scaleY);
      setTvScale(s > 0 ? s : 1);
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

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

  // Whenever selectedChannel changes, regenerate UNIQUE EPG for that channel and update bottom metadata
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

  // Trigger brief on-screen HUD for TV Remote feedback
  const triggerRemoteHud = (actionName: string) => {
    setRemoteDebugKey(actionName);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => setRemoteDebugKey(null), 1500);
  };

  // 2. UNIVERSAL TV REMOTE KEY NORMALIZER (Hisense VIDAA, webOS, Tizen, Android TV, Keyboard)
  const normalizeTvKey = useCallback((e: KeyboardEvent): string => {
    const code = e.keyCode || e.which;
    const key = (e.key || '').toLowerCase();

    // OK / Enter / Select
    if (code === 13 || code === 32 || key === 'enter' || key === 'ok' || key === 'select' || key === 'accept') {
      return 'OK';
    }

    // Directional Arrows
    if (code === 38 || key === 'arrowup' || key === 'up') return 'UP';
    if (code === 40 || key === 'arrowdown' || key === 'down') return 'DOWN';
    if (code === 37 || key === 'arrowleft' || key === 'left') return 'LEFT';
    if (code === 39 || key === 'arrowright' || key === 'right') return 'RIGHT';

    // Back / Return / Escape
    if (
      code === 27 ||
      code === 8 ||
      code === 10009 || // Tizen Return
      code === 461 ||   // webOS Back
      code === 10008 ||
      code === 88 ||    // X key
      key === 'escape' ||
      key === 'backspace' ||
      key === 'back' ||
      key === 'goback' ||
      key === 'return'
    ) {
      return 'BACK';
    }

    // Media Play / Pause
    if (code === 415 || code === 19 || code === 10252 || code === 179 || key.includes('play') || key.includes('pause')) {
      return 'PLAY_PAUSE';
    }

    // Rewind / Fast-Forward
    if (code === 412 || key.includes('rewind')) return 'REWIND';
    if (code === 417 || key.includes('fastforward')) return 'FAST_FORWARD';

    // Channel Up / Down
    if (code === 427 || code === 33) return 'CHANNEL_UP';
    if (code === 428 || code === 34) return 'CHANNEL_DOWN';

    return key;
  }, []);

  // 3. TV REMOTE EVENT HANDLER
  useEffect(() => {
    const handleTvKey = (e: KeyboardEvent) => {
      const action = normalizeTvKey(e);

      // Prevent default page scroll on navigation buttons
      if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK'].includes(action)) {
        e.preventDefault();
        e.stopPropagation();
      }

      triggerRemoteHud(action);

      // --- STATE: OVERLAY 'none' (Pure Fullscreen Video) ---
      if (overlayMode === 'none') {
        switch (action) {
          case 'OK':
          case 'UP':
            setOverlayMode('channels');
            if (selectedChannel) {
              const idx = filteredChannels.findIndex(c => c.id === selectedChannel.id);
              if (idx !== -1) setFocusedChannelIndex(idx);
            }
            break;

          case 'DOWN':
            setOverlayMode('timeline');
            setSeekTimestamp(isArchiveMode ? seekTimestamp : Date.now());
            setActiveTimelineProgram(currentPlayingProgram);
            resetTimelineAutoHide();
            break;

          case 'LEFT':
          case 'REWIND':
            handleSeekToTimestamp(seekTimestamp - 60000);
            setOverlayMode('timeline');
            resetTimelineAutoHide();
            break;

          case 'RIGHT':
          case 'FAST_FORWARD':
            handleSeekToTimestamp(Math.min(Date.now(), seekTimestamp + 60000));
            setOverlayMode('timeline');
            resetTimelineAutoHide();
            break;

          case 'CHANNEL_UP':
            if (filteredChannels.length > 0 && selectedChannel) {
              const idx = filteredChannels.findIndex(c => c.id === selectedChannel.id);
              if (idx > 0) setSelectedChannel(filteredChannels[idx - 1]);
            }
            break;

          case 'CHANNEL_DOWN':
            if (filteredChannels.length > 0 && selectedChannel) {
              const idx = filteredChannels.findIndex(c => c.id === selectedChannel.id);
              if (idx < filteredChannels.length - 1) setSelectedChannel(filteredChannels[idx + 1]);
            }
            break;

          case 'BACK':
            onBackToMenu?.();
            break;
        }
        return;
      }

      // --- STATE: OVERLAY 'channels' (Channel List Open) ---
      if (overlayMode === 'channels') {
        switch (action) {
          case 'UP':
            setFocusedChannelIndex(prev => Math.max(0, prev - 1));
            break;

          case 'DOWN':
            setFocusedChannelIndex(prev => Math.min(filteredChannels.length - 1, prev + 1));
            break;

          case 'LEFT':
            {
              const curGrpIdx = groups.indexOf(activeGroup);
              const nextGrpIdx = (curGrpIdx - 1 + groups.length) % groups.length;
              setActiveGroup(groups[nextGrpIdx]);
              setFocusedChannelIndex(0);
            }
            break;

          case 'RIGHT':
            {
              const curGrpIdx = groups.indexOf(activeGroup);
              const nextGrpIdx = (curGrpIdx + 1) % groups.length;
              setActiveGroup(groups[nextGrpIdx]);
              setFocusedChannelIndex(0);
            }
            break;

          case 'OK':
            if (filteredChannels[focusedChannelIndex]) {
              const ch = filteredChannels[focusedChannelIndex];
              setSelectedChannel(ch);
              setOverlayMode('epg');
              setFocusedProgramIndex(0);
            }
            break;

          case 'BACK':
            setOverlayMode('none');
            break;
        }
        return;
      }

      // --- STATE: OVERLAY 'epg' (Program Schedule for Channel) ---
      if (overlayMode === 'epg') {
        switch (action) {
          case 'UP':
            setFocusedProgramIndex(prev => Math.max(0, prev - 1));
            break;

          case 'DOWN':
            setFocusedProgramIndex(prev => Math.min(filteredEpg.length - 1, prev + 1));
            break;

          case 'LEFT':
            setSelectedDayOffset(prev => Math.max(-7, prev - 1));
            setFocusedProgramIndex(0);
            break;

          case 'RIGHT':
            setSelectedDayOffset(prev => Math.min(0, prev + 1));
            setFocusedProgramIndex(0);
            break;

          case 'OK':
            if (filteredEpg[focusedProgramIndex]) {
              const prog = filteredEpg[focusedProgramIndex];
              if (prog.isLive) {
                setPromptProgram(prog);
                setPromptFocusedChoice('live');
                setOverlayMode('prompt');
              } else {
                handlePlayArchiveProgram(prog, true);
              }
            }
            break;

          case 'BACK':
            setOverlayMode('channels');
            break;
        }
        return;
      }

      // --- STATE: OVERLAY 'prompt' (Choice: Live vs Start from beginning) ---
      if (overlayMode === 'prompt') {
        switch (action) {
          case 'UP':
          case 'LEFT':
            setPromptFocusedChoice('live');
            break;

          case 'DOWN':
          case 'RIGHT':
            setPromptFocusedChoice('start');
            break;

          case 'OK':
            if (promptFocusedChoice === 'live') {
              handleJumpToLive();
            } else if (promptProgram) {
              handlePlayArchiveProgram(promptProgram, true);
            }
            setOverlayMode('none');
            break;

          case 'BACK':
            setOverlayMode('epg');
            break;
        }
        return;
      }

      // --- STATE: OVERLAY 'timeline' (Bottom Timeshift OSD Bar) ---
      if (overlayMode === 'timeline') {
        resetTimelineAutoHide();

        switch (action) {
          case 'LEFT':
          case 'REWIND':
            {
              const newTime = seekTimestamp - 60000;
              setSeekTimestamp(newTime);

              // Auto-switch to previous program if seek moves past program start!
              const matched = findProgramForTimestamp(epgList, newTime);
              if (matched) {
                setActiveTimelineProgram(matched);
              }

              if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
              seekDebounceTimeoutRef.current = setTimeout(() => {
                handleSeekToTimestamp(newTime);
              }, 1200);
            }
            break;

          case 'RIGHT':
          case 'FAST_FORWARD':
            {
              const now = Date.now();
              const newTime = Math.min(now, seekTimestamp + 60000);
              setSeekTimestamp(newTime);

              // Auto-switch to next program if seek moves past program end!
              const matched = findProgramForTimestamp(epgList, newTime);
              if (matched) {
                setActiveTimelineProgram(matched);
              }

              if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
              seekDebounceTimeoutRef.current = setTimeout(() => {
                handleSeekToTimestamp(newTime);
              }, 1200);
            }
            break;

          case 'OK':
            if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
            handleSeekToTimestamp(seekTimestamp);
            setOverlayMode('none');
            break;

          case 'UP':
          case 'BACK':
            setOverlayMode('none');
            break;
        }
        return;
      }
    };

    window.addEventListener('keydown', handleTvKey, true);
    document.addEventListener('keydown', handleTvKey, true);

    // Keep focus active on window
    window.focus();

    return () => {
      window.removeEventListener('keydown', handleTvKey, true);
      document.removeEventListener('keydown', handleTvKey, true);
      if (timelineHideTimeoutRef.current) clearTimeout(timelineHideTimeoutRef.current);
      if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    };
  }, [
    normalizeTvKey,
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
    <div
      ref={containerRef}
      tabIndex={0}
      className="fixed inset-0 w-screen h-screen bg-black text-white overflow-hidden select-none font-sans outline-none"
    >
      {/* 1. FULLSCREEN VIDEO LAYER (Always takes 100% of TV screen) */}
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
              Загрузка {selectedChannel?.name ? `(${selectedChannel.name})` : ''}...
            </p>
          </div>
        )}

        {/* Stream Error Notice */}
        {playerError && (
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 max-w-xl p-4 rounded-2xl bg-rose-950/90 border border-rose-500/50 text-rose-200 text-sm flex items-center gap-3 backdrop-blur-md z-20">
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

      {/* 2. SCALED 1920x1080 UI LAYER (Fits 100% of ANY Smart TV without 4x zoom) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '1920px',
          height: '1080px',
          transform: `scale(${tvScale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
          overflow: 'hidden'
        }}
        className="z-30"
      >
        {/* Remote Feedback HUD (Flashes when a button is pressed) */}
        {remoteDebugKey && (
          <div className="absolute top-8 right-8 px-4 py-2 rounded-xl bg-slate-950/90 border border-sky-400 text-sky-300 font-mono text-sm shadow-2xl flex items-center gap-2 animate-in fade-in duration-100">
            <span>🎮 Пульт:</span>
            <span className="font-bold text-white uppercase">{remoteDebugKey}</span>
            <span className="text-xs text-slate-500">[{overlayMode}]</span>
          </div>
        )}

        {/* WEB TOP BAR (Only in desktop browser preview, hidden in TV mode) */}
        {!isTvMode && (
          <div className="absolute top-0 inset-x-0 p-6 flex items-center justify-between bg-gradient-to-b from-black/90 to-transparent pointer-events-auto">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center shadow-lg">
                <Tv className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-3">
                  IPTV Плеер Smart TV
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                    Архив 7 дней
                  </span>
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Канал: <span className="text-sky-300 font-semibold">{selectedChannel?.name || 'Не выбран'}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {onEnterTvMode && (
                <button
                  onClick={onEnterTvMode}
                  className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-bold rounded-xl text-sm flex items-center gap-2 shadow-lg cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" />
                  Режим ТВ (Во весь экран)
                </button>
              )}

              <button
                onClick={() => setOverlayMode(overlayMode === 'channels' ? 'none' : 'channels')}
                className="px-4 py-2.5 bg-slate-800/90 hover:bg-slate-700 text-white rounded-xl text-sm flex items-center gap-2 cursor-pointer"
              >
                Каналы (ОК)
              </button>

              <button
                onClick={() => setOverlayMode('settings')}
                className="p-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-xl cursor-pointer"
                title="Настройки плейлиста"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* 3. CHANNELS OVERLAY DRAWER (Triggered by remote "OK") */}
        {overlayMode === 'channels' && (
          <div className="absolute inset-y-0 left-0 w-[460px] bg-slate-950/95 backdrop-blur-2xl border-r border-slate-800/80 flex flex-col shadow-2xl pointer-events-auto animate-in slide-in-from-left duration-200">
            {/* Header */}
            <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <Radio className="w-5 h-5 text-sky-400" />
                  Список телеканалов
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  {filteredChannels.length} каналов · Нажмите <kbd className="px-1.5 py-0.5 bg-slate-800 rounded font-mono text-sky-300 text-xs">OK</kbd> для программы
                </p>
              </div>
              <button
                onClick={() => setOverlayMode('none')}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-2 p-4 overflow-x-auto no-scrollbar border-b border-slate-800/50">
              {groups.map((group) => (
                <button
                  key={group}
                  onClick={() => {
                    setActiveGroup(group);
                    setFocusedChannelIndex(0);
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                    activeGroup === group
                      ? 'bg-sky-500 text-slate-950 shadow-md font-bold'
                      : 'bg-slate-900/90 text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>

            {/* Channel Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
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
                    className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all ${
                      isFocused
                        ? 'bg-sky-500/30 ring-4 ring-sky-400 shadow-2xl text-white font-bold scale-[1.02]'
                        : isSelected
                        ? 'bg-slate-900 text-sky-300 border border-sky-500/40'
                        : 'hover:bg-slate-900/60 text-slate-300 border border-transparent'
                    }`}
                  >
                    <span className="w-8 text-center text-sm font-mono text-slate-500">
                      {idx + 1}
                    </span>

                    <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0">
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
                        <Tv className="w-6 h-6 text-slate-600" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate leading-tight">
                        {channel.name}
                      </p>
                      <p className="text-xs text-slate-400 truncate mt-1">
                        {channel.group || 'Канал'}
                      </p>
                    </div>

                    <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-amber-300 border border-amber-500/20 font-semibold">
                      7д
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Remote Navigation Hint */}
            <div className="p-4 bg-slate-900/90 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <span>▲▼ Каналы · ◄► Группы</span>
              <span className="text-sky-300 font-bold">ОК: Телепрограмма</span>
            </div>
          </div>
        )}

        {/* 4. EPG SCHEDULE OVERLAY DRAWER (Triggered by selecting a channel) */}
        {overlayMode === 'epg' && selectedChannel && (
          <div className="absolute inset-y-0 left-[460px] w-[620px] bg-slate-950/95 backdrop-blur-2xl border-r border-slate-800/80 flex flex-col shadow-2xl pointer-events-auto animate-in slide-in-from-left duration-200">
            {/* Header */}
            <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setOverlayMode('channels')}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 cursor-pointer"
                  title="Назад к списку каналов"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    {selectedChannel.name}
                  </h2>
                  <p className="text-xs text-sky-400 flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-4 h-4" />
                    Телепрограмма & Архив на 7 дней
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOverlayMode('none')}
                className="p-2 rounded-xl text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 7-Day Selector Bar */}
            <div className="flex items-center gap-2 p-4 overflow-x-auto no-scrollbar border-b border-slate-800/50">
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
                    className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
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
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                    className={`p-4 rounded-2xl cursor-pointer transition-all ${
                      isFocused
                        ? 'bg-sky-500/30 ring-4 ring-sky-400 shadow-2xl text-white scale-[1.01]'
                        : isCurrentLive
                        ? 'bg-sky-950/70 border border-sky-500/50 text-slate-100'
                        : 'bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <span className="text-xs font-mono font-bold text-sky-400 flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        {formatTime(prog.start)} — {formatTime(prog.end)}
                      </span>

                      {prog.isLive ? (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-1.5 animate-pulse">
                          <span className="w-2 h-2 rounded-full bg-rose-400" />
                          ЭФИР
                        </span>
                      ) : prog.hasArchive ? (
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1.5">
                          <History className="w-3.5 h-3.5" />
                          АРХИВ
                        </span>
                      ) : null}
                    </div>

                    <h3 className="text-sm font-bold text-white leading-snug">
                      {prog.title}
                    </h3>

                    {prog.description && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {prog.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Remote Navigation Hint */}
            <div className="p-4 bg-slate-900/90 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
              <span>▲▼ Передачи · ◄► Дни архива</span>
              <span className="text-sky-300 font-bold">ОК: Запустить просмотр</span>
            </div>
          </div>
        )}

        {/* 5. MODAL PROMPT: LIVE OR START FROM BEGINNING? */}
        {overlayMode === 'prompt' && promptProgram && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6 pointer-events-auto">
            <div className="w-[560px] p-8 rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-150">
              <div className="w-16 h-16 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center mb-5">
                <Tv className="w-8 h-8 text-sky-400" />
              </div>

              <h3 className="text-2xl font-bold text-white mb-2">
                {promptProgram.title}
              </h3>
              <p className="text-sm text-sky-400 font-mono mb-8">
                {formatTime(promptProgram.start)} — {formatTime(promptProgram.end)} · {selectedChannel?.name}
              </p>

              <div className="w-full flex flex-col gap-4">
                <button
                  onClick={() => {
                    handleJumpToLive();
                    setOverlayMode('none');
                  }}
                  className={`w-full py-4 px-6 rounded-2xl text-base font-bold flex items-center justify-center gap-3 cursor-pointer transition-all ${
                    promptFocusedChoice === 'live'
                      ? 'bg-rose-500 text-white ring-4 ring-rose-400/60 shadow-2xl scale-[1.03]'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  <Radio className="w-5 h-5 text-white animate-pulse" />
                  Смотреть прямой эфир
                </button>

                <button
                  onClick={() => {
                    handlePlayArchiveProgram(promptProgram, true);
                    setOverlayMode('none');
                  }}
                  className={`w-full py-4 px-6 rounded-2xl text-base font-bold flex items-center justify-center gap-3 cursor-pointer transition-all ${
                    promptFocusedChoice === 'start'
                      ? 'bg-sky-500 text-slate-950 ring-4 ring-sky-400/60 shadow-2xl scale-[1.03]'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                  }`}
                >
                  <RotateCcw className="w-5 h-5" />
                  Смотреть с начала (Архив)
                </button>
              </div>

              <button
                onClick={() => setOverlayMode('epg')}
                className="mt-6 text-sm text-slate-400 hover:text-white cursor-pointer"
              >
                Отмена (Back)
              </button>
            </div>
          </div>
        )}

        {/* 6. TIMELINE / TIMESHIFT OSD BAR (Triggered by remote "DOWN") */}
        {(overlayMode === 'timeline' || !isTvMode) && selectedChannel && (
          <div
            className={`absolute bottom-0 inset-x-0 transition-all duration-300 pointer-events-auto ${
              overlayMode === 'timeline'
                ? 'translate-y-0 opacity-100'
                : isTvMode
                ? 'translate-y-full opacity-0 pointer-events-none'
                : 'translate-y-0 opacity-100'
            }`}
          >
            <div className="bg-gradient-to-t from-black via-black/95 to-transparent p-10 pt-16">
              <div className="max-w-6xl mx-auto flex flex-col gap-4">
                {/* Channel & Program Info Header */}
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700 p-1.5 flex items-center justify-center overflow-hidden shrink-0 shadow-xl">
                      {selectedChannel.logo ? (
                        <img
                          src={selectedChannel.logo}
                          alt={selectedChannel.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Tv className="w-8 h-8 text-sky-400" />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-white">
                          {selectedChannel.name}
                        </span>
                        {isArchiveMode ? (
                          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold flex items-center gap-1.5">
                            <History className="w-4 h-4" />
                            АРХИВ / ТАЙМШИФТ
                          </span>
                        ) : (
                          <span className="text-xs px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                            ПРЯМОЙ ЭФИР
                          </span>
                        )}
                      </div>

                      <h2 className="text-xl font-bold text-sky-200 mt-1">
                        {activeTimelineProgram?.title || 'Трансляция телеканала'}
                      </h2>
                      {activeTimelineProgram?.description && (
                        <p className="text-sm text-slate-400 max-w-4xl line-clamp-1 mt-1 leading-relaxed">
                          {activeTimelineProgram.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {isArchiveMode && (
                      <button
                        onClick={handleJumpToLive}
                        className="px-5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-sm flex items-center gap-2 cursor-pointer shadow-xl"
                      >
                        <Radio className="w-4 h-4" />
                        В прямой эфир
                      </button>
                    )}
                  </div>
                </div>

                {/* Timeline Progress Bar & Time */}
                <div className="flex flex-col gap-2">
                  <div className="relative w-full h-4 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-sky-500 to-indigo-500 rounded-full transition-all duration-150"
                      style={{ width: `${progProgressPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm font-mono text-slate-400">
                    <span>
                      {activeTimelineProgram
                        ? formatTime(activeTimelineProgram.start)
                        : '00:00'}
                    </span>
                    <span className="font-bold text-sky-300 text-base">
                      Позиция: {formatSecondsToClock(seekTimestamp)}
                    </span>
                    <span>
                      {activeTimelineProgram
                        ? formatTime(activeTimelineProgram.end)
                        : '00:00'}
                    </span>
                  </div>
                </div>

                {/* Navigation Hints */}
                <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800/60">
                  <span>
                    ◄ Влево / Вправо ►: Перемотка (с автопереключением передач)
                  </span>
                  <span className="text-sky-300 font-bold">
                    ОК: Применить · ▲/Back: Скрыть
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 7. SETTINGS MODAL */}
        {overlayMode === 'settings' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-6 pointer-events-auto">
            <div className="w-[600px] p-8 rounded-3xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col">
              <div className="flex items-center justify-between pb-4 mb-6 border-b border-slate-800">
                <h3 className="text-xl font-bold text-white flex items-center gap-3">
                  <Settings className="w-6 h-6 text-sky-400" />
                  Настройки IPTV Плейлиста
                </h3>
                <button
                  onClick={() => setOverlayMode('none')}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveSettings} className="flex flex-col gap-5 text-sm">
                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">
                    Ссылка на M3U / M3U8 плейлист провайдера
                  </label>
                  <input
                    type="text"
                    required
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="http://rus.hls.gd/pl/19/.../playlist.m3u8"
                    className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-sky-500"
                  />
                  <p className="text-xs text-slate-400 mt-1.5">
                    Поддерживаются ссылки формата Tivimate / HLS / Ott Play с 7-дневным архивом catchup.
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">
                    Глубина архива (дней): {settings.archiveDays}
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="1"
                      max="7"
                      value={settings.archiveDays}
                      onChange={(e) => setSettings({ ...settings, archiveDays: parseInt(e.target.value, 10) })}
                      className="flex-1 accent-sky-400 h-2 bg-slate-800 rounded-lg cursor-pointer"
                    />
                    <span className="font-bold text-sky-400 text-base">{settings.archiveDays} дней</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setOverlayMode('none')}
                    className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl cursor-pointer"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold rounded-xl cursor-pointer disabled:opacity-50"
                  >
                    {isSavingSettings ? 'Загрузка...' : 'Сохранить и загрузить'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
