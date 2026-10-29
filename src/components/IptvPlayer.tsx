import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { Channel, EpgProgram, IptvSettings } from '../types/iptv';
import {
  parseM3uPlaylist,
  generateSample7DayEpg,
  buildTimestampArchiveUrl,
  findProgramForTimestamp
} from '../utils/iptvParser';
import {
  Tv,
  Calendar,
  Clock,
  History,
  Radio,
  Search,
  Settings,
  RotateCcw,
  AlertCircle,
  X,
  ArrowLeft,
  Info
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
  const channelListRef = useRef<HTMLDivElement | null>(null);
  const epgListRef = useRef<HTMLDivElement | null>(null);
  const categoryBarRef = useRef<HTMLDivElement | null>(null);
  const daySelectorRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const timelineHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const seekDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bottomHintTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Bottom hint visibility (auto-hides after 3 seconds)
  const [showBottomHint, setShowBottomHint] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
    epgUrl: 'https://rus.epg.team/7.1.xml?pkg=442',
    archiveDays: 7,
    providerType: 'tvteam'
  });
  const [inputUrl, setInputUrl] = useState(settings.playlistUrl);
  const [inputEpgUrl, setInputEpgUrl] = useState(settings.epgUrl || 'https://rus.epg.team/7.1.xml?pkg=442');
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSyncingEpg, setIsSyncingEpg] = useState(false);
  const [isLoadingEpg, setIsLoadingEpg] = useState(false);

  // Auto-hide bottom hint after 3 seconds of inactivity
  const pokeBottomHint = useCallback(() => {
    setShowBottomHint(true);
    if (bottomHintTimerRef.current) clearTimeout(bottomHintTimerRef.current);
    bottomHintTimerRef.current = setTimeout(() => {
      setShowBottomHint(false);
    }, 3000);
  }, []);

  useEffect(() => {
    pokeBottomHint();
    return () => {
      if (bottomHintTimerRef.current) clearTimeout(bottomHintTimerRef.current);
    };
  }, [pokeBottomHint]);

  // Show a temporary toast (e.g. for future programs or status notices)
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  // Guarantee that any toast notification unconditionally hides after 2.8 seconds
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Format helpers with Moscow Timezone (Europe/Moscow, UTC+3) as standard for Russian IPTV/EPG
  const formatTime = useCallback((ms: number) => {
    if (!ms) return '--:--';
    try {
      return new Date(ms).toLocaleTimeString('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      const d = new Date(ms + 3 * 3600000 + new Date(ms).getTimezoneOffset() * 60000);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
  }, []);

  const formatSecondsToClock = useCallback((ms: number) => {
    if (!ms) return '--:--:--';
    try {
      return new Date(ms).toLocaleTimeString('ru-RU', {
        timeZone: 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      const d = new Date(ms + 3 * 3600000 + new Date(ms).getTimezoneOffset() * 60000);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }, []);

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

  // VIRTUALIZED CHANNEL LIST: Only render 36 visible items around focusedChannelIndex to eliminate 3s freeze
  const CHANNEL_ITEM_HEIGHT = 62;
  const CHANNEL_WINDOW_SIZE = 36;
  const channelStartIndex = Math.max(0, focusedChannelIndex - Math.floor(CHANNEL_WINDOW_SIZE / 2));
  const channelEndIndex = Math.min(filteredChannels.length, channelStartIndex + CHANNEL_WINDOW_SIZE);
  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(channelStartIndex, channelEndIndex).map((ch, i) => ({
      channel: ch,
      actualIndex: channelStartIndex + i
    }));
  }, [filteredChannels, channelStartIndex, channelEndIndex]);

  // Filter EPG by selected day (0 = today, -1 = yesterday, +1 = tomorrow, etc.) in Moscow Time
  const filteredEpg = useMemo(() => {
    const tzOffsetMs = 3 * 3600 * 1000;
    const nowInMsk = new Date(Date.now() + tzOffsetMs);
    const targetInMsk = new Date(nowInMsk);
    targetInMsk.setUTCDate(targetInMsk.getUTCDate() + selectedDayOffset);
    targetInMsk.setUTCHours(0, 0, 0, 0);

    const dayStartUtc = targetInMsk.getTime() - tzOffsetMs;
    const dayEndUtc = dayStartUtc + 24 * 3600 * 1000;

    // Show any program that overlaps with this day
    return epgList.filter(p => p.end > dayStartUtc && p.start < dayEndUtc);
  }, [epgList, selectedDayOffset]);

  // Load settings on mount
  useEffect(() => {
    fetch('/api/iptv/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          if (data.playlistUrl) {
            setSettings(prev => ({ ...prev, ...data }));
            setInputUrl(data.playlistUrl);
          }
          if (data.epgUrl) {
            setInputEpgUrl(data.epgUrl);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Fetch or load channels
  const loadChannels = useCallback(async (playlistUrl: string, retryCount = 1) => {
    setIsLoadingStream(true);
    setPlayerError(null);
    try {
      const response = await fetch(`/api/iptv/channels?url=${encodeURIComponent(playlistUrl || '')}`);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          setChannels(data);
          setSelectedChannel(prev => {
            if (prev) {
              const matched = data.find(c => c.id === prev.id || c.name === prev.name);
              if (matched) return matched;
            }
            return data[0];
          });
          return;
        }
      }
      throw new Error('Playlist returned empty');
    } catch (e: any) {
      console.warn('[IptvPlayer] Error loading channels:', e);
      if (retryCount <= 4) {
        setTimeout(() => loadChannels(playlistUrl, retryCount + 1), 2000);
      } else {
        showToast('Не удалось загрузить список каналов. Проверьте сеть или настройки.');
      }
    } finally {
      setIsLoadingStream(false);
    }
  }, []);

  useEffect(() => {
    loadChannels(settings.playlistUrl);
  }, [loadChannels, settings.playlistUrl]);

  // Whenever selectedChannel changes, fetch REAL EPG from backend
  useEffect(() => {
    if (!selectedChannel) return;
    let isCancelled = false;
    let retryTimer: NodeJS.Timeout | null = null;
    setIsLoadingEpg(true);

    const tvgId = selectedChannel.tvgId || '';
    const name = selectedChannel.name || '';

    const fetchEpg = (attempt = 1) => {
      fetch(`/api/iptv/epg?channelId=${encodeURIComponent(tvgId)}&name=${encodeURIComponent(name)}`)
        .then(res => (res.ok ? res.json() : []))
        .then((realPrograms: EpgProgram[]) => {
          if (isCancelled) return;
          const now = Date.now();

          if (Array.isArray(realPrograms) && realPrograms.length > 0) {
            // Re-evaluate isLive and hasArchive with current client timestamp
            const programs = realPrograms.map(p => ({
              ...p,
              isLive: now >= p.start && now < p.end,
              hasArchive: p.end <= now
            }));
            setEpgList(programs);

            const liveProg = programs.find(p => p.isLive) || programs.find(p => p.end <= now) || programs[0];
            setCurrentPlayingProgram(liveProg);
            setActiveTimelineProgram(liveProg);
            setSeekTimestamp(now);
            setIsArchiveMode(false);
            setIsLoadingEpg(false);

            // Auto-check: if no programs overlap selectedDayOffset, align to closest day with programs
            const tzOffsetMs = 3 * 3600 * 1000;
            const nowInMsk = new Date(Date.now() + tzOffsetMs);
            const hasProgramsForCurrentDay = programs.some(p => {
              const targetInMsk = new Date(nowInMsk);
              targetInMsk.setUTCDate(targetInMsk.getUTCDate() + selectedDayOffset);
              targetInMsk.setUTCHours(0, 0, 0, 0);
              const start = targetInMsk.getTime() - tzOffsetMs;
              const end = start + 24 * 3600 * 1000;
              return p.end > start && p.start < end;
            });

            if (!hasProgramsForCurrentDay) {
              for (const off of [0, -1, 1, -2, -3, -4, -5, -6, -7]) {
                const targetInMsk = new Date(nowInMsk);
                targetInMsk.setUTCDate(targetInMsk.getUTCDate() + off);
                targetInMsk.setUTCHours(0, 0, 0, 0);
                const s = targetInMsk.getTime() - tzOffsetMs;
                const e = s + 24 * 3600 * 1000;
                if (programs.some(p => p.end > s && p.start < e)) {
                  setSelectedDayOffset(off);
                  break;
                }
              }
            }
          } else {
            // Check if server is still syncing EPG in background
            fetch('/api/iptv/epg/status')
              .then(res => (res.ok ? res.json() : null))
              .then(status => {
                if (isCancelled) return;
                const isSyncing = status?.isSyncing ?? false;

                if (isSyncing && attempt <= 20) {
                  // Keep polling every 1.5s while server is downloading / parsing EPG
                  retryTimer = setTimeout(() => {
                    if (!isCancelled) fetchEpg(attempt + 1);
                  }, 1500);
                } else if (attempt <= 4) {
                  // Retry up to 4 times for initial boot
                  retryTimer = setTimeout(() => {
                    if (!isCancelled) fetchEpg(attempt + 1);
                  }, 2000);
                } else {
                  // Truly no EPG for this channel
                  setEpgList([]);
                  const fallbackLive: EpgProgram = {
                    id: `live-${selectedChannel.id}`,
                    channelId: selectedChannel.id,
                    title: selectedChannel.name,
                    description: 'Прямой эфир телеканала',
                    category: selectedChannel.group || 'ТВ',
                    start: now - 3600000,
                    end: now + 3600000,
                    isLive: true,
                    hasArchive: false
                  };
                  setCurrentPlayingProgram(fallbackLive);
                  setActiveTimelineProgram(fallbackLive);
                  setSeekTimestamp(now);
                  setIsArchiveMode(false);
                  setIsLoadingEpg(false);
                }
              })
              .catch(() => {
                if (isCancelled) return;
                if (attempt <= 4) {
                  retryTimer = setTimeout(() => {
                    if (!isCancelled) fetchEpg(attempt + 1);
                  }, 2000);
                } else {
                  setEpgList([]);
                  setIsLoadingEpg(false);
                }
              });
          }
        })
        .catch(() => {
          if (isCancelled) return;
          setEpgList([]);
          setIsLoadingEpg(false);
        });
    };

    fetchEpg(1);

    return () => {
      isCancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [selectedChannel, selectedDayOffset]);

  // INSTANT AUTO-ALIGNMENT ON OVERLAY OPEN
  // When opening channels or epg drawer, immediately center categories, channels, dates, and programs
  useEffect(() => {
    if (overlayMode === 'channels') {
      const alignChannelsOnOpen = () => {
        // 1. Center active category tab
        const catBtn = document.getElementById(`cat-btn-${encodeURIComponent(activeGroup)}`);
        if (catBtn) {
          catBtn.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
        }

        // 2. Center focused channel in list
        const container = channelListRef.current;
        const itemEl = document.getElementById(`ch-item-${focusedChannelIndex}`);
        if (container && itemEl) {
          const cHeight = container.clientHeight;
          const iTop = itemEl.offsetTop;
          const iHeight = itemEl.clientHeight;
          container.scrollTo({ top: Math.max(0, iTop - (cHeight / 2) + (iHeight / 2)), behavior: 'auto' });
        }
      };

      alignChannelsOnOpen();
      const r1 = requestAnimationFrame(alignChannelsOnOpen);
      const t1 = setTimeout(alignChannelsOnOpen, 40);
      const t2 = setTimeout(alignChannelsOnOpen, 120);

      return () => {
        cancelAnimationFrame(r1);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    if (overlayMode === 'epg') {
      const alignEpgOnOpen = () => {
        // 1. Center active day selector tab (e.g. Сегодня)
        const dayBtn = document.getElementById(`day-btn-${selectedDayOffset}`);
        if (dayBtn) {
          dayBtn.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
        }

        // 2. Center focused program in schedule list
        const container = epgListRef.current;
        const itemEl = document.getElementById(`epg-item-${focusedProgramIndex}`);
        if (container && itemEl) {
          const cHeight = container.clientHeight;
          const iTop = itemEl.offsetTop;
          const iHeight = itemEl.clientHeight;
          container.scrollTo({ top: Math.max(0, iTop - (cHeight / 2) + (iHeight / 2)), behavior: 'auto' });
        }
      };

      alignEpgOnOpen();
      const r1 = requestAnimationFrame(alignEpgOnOpen);
      const t1 = setTimeout(alignEpgOnOpen, 40);
      const t2 = setTimeout(alignEpgOnOpen, 120);

      return () => {
        cancelAnimationFrame(r1);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [overlayMode]);

  // AUTO-SCROLL FOR CATEGORY TABS (Smooth tracking on user navigation)
  useEffect(() => {
    if (overlayMode !== 'channels') return;
    const itemEl = document.getElementById(`cat-btn-${encodeURIComponent(activeGroup)}`);
    if (itemEl) {
      itemEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeGroup]);

  // AUTO-SCROLL FOR EPG DAY SELECTOR TABS (Smooth tracking on user navigation)
  useEffect(() => {
    if (overlayMode !== 'epg') return;
    const itemEl = document.getElementById(`day-btn-${selectedDayOffset}`);
    if (itemEl) {
      itemEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [selectedDayOffset]);

  // SMART AUTO-SCROLL FOR CHANNELS (Smooth tracking on user navigation)
  useEffect(() => {
    if (overlayMode !== 'channels') return;
    const container = channelListRef.current;
    if (!container) return;
    const itemEl = document.getElementById(`ch-item-${focusedChannelIndex}`);
    if (itemEl) {
      const cHeight = container.clientHeight;
      const iTop = itemEl.offsetTop;
      const iHeight = itemEl.clientHeight;
      const targetScroll = iTop - (cHeight / 2) + (iHeight / 2);
      container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [focusedChannelIndex]);

  // SMART AUTO-SCROLL FOR EPG PROGRAMS (Smooth tracking on user navigation)
  useEffect(() => {
    if (overlayMode !== 'epg') return;
    const container = epgListRef.current;
    if (!container) return;
    const itemEl = document.getElementById(`epg-item-${focusedProgramIndex}`);
    if (itemEl) {
      const cHeight = container.clientHeight;
      const iTop = itemEl.offsetTop;
      const iHeight = itemEl.clientHeight;
      const targetScroll = iTop - (cHeight / 2) + (iHeight / 2);
      container.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [focusedProgramIndex]);

  // Automatically focus & center the current live program when EPG loads or date changes
  useEffect(() => {
    if (overlayMode === 'epg' && filteredEpg.length > 0) {
      const now = Date.now();
      const liveIdx = filteredEpg.findIndex(p => p.isLive || (p.start <= now && p.end > now));
      let targetIdx = 0;
      if (liveIdx !== -1) {
        targetIdx = liveIdx;
      } else {
        const upcomingIdx = filteredEpg.findIndex(p => p.start >= now);
        targetIdx = upcomingIdx !== -1 ? upcomingIdx : 0;
      }
      setFocusedProgramIndex(targetIdx);

      setTimeout(() => {
        const container = epgListRef.current;
        const itemEl = document.getElementById(`epg-item-${targetIdx}`);
        if (container && itemEl) {
          const cHeight = container.clientHeight;
          const iTop = itemEl.offsetTop;
          const iHeight = itemEl.clientHeight;
          container.scrollTo({ top: Math.max(0, iTop - (cHeight / 2) + (iHeight / 2)), behavior: 'auto' });
        }
      }, 30);
    }
  }, [overlayMode, selectedDayOffset, filteredEpg.length]);

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
    const now = Date.now();

    // Prevent selecting future programs
    if (program.start > now) {
      showToast('Передача ещё не началась (Анонс)');
      return;
    }

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
      const newSettings: IptvSettings = {
        ...settings,
        playlistUrl: inputUrl,
        epgUrl: inputEpgUrl
      };
      await fetch('/api/iptv/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      setSettings(newSettings);
      setOverlayMode('none');
      showToast('Настройки сохранены!');
      loadChannels(inputUrl);
    } catch (e: any) {
      showToast('Ошибка при сохранении настроек');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Manual EPG Sync handler
  const handleSyncEpg = async () => {
    setIsSyncingEpg(true);
    showToast('Синхронизация EPG запущена...');
    try {
      const res = await fetch('/api/iptv/epg/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epgUrl: inputEpgUrl })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'Телепрограмма успешно загружена!');
        // Refresh EPG for currently selected channel
        if (selectedChannel) {
          const epgRes = await fetch(`/api/iptv/epg?channelId=${encodeURIComponent(selectedChannel.tvgId || '')}&name=${encodeURIComponent(selectedChannel.name)}`);
          if (epgRes.ok) {
            const list = await epgRes.json();
            if (Array.isArray(list) && list.length > 0) {
              const now = Date.now();
              setEpgList(list.map(p => ({ ...p, isLive: now >= p.start && now < p.end, hasArchive: p.end <= now })));
            }
          }
        }
      } else {
        showToast(data.message || 'Ошибка обновления EPG');
      }
    } catch (e: any) {
      showToast(`Ошибка сети: ${e.message}`);
    } finally {
      setIsSyncingEpg(false);
    }
  };

  // Keep focus on root container for TV remote events
  useEffect(() => {
    containerRef.current?.focus();
    const interval = setInterval(() => {
      if (document.activeElement === document.body || !document.activeElement) {
        containerRef.current?.focus();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // UNIVERSAL TV REMOTE KEY NORMALIZER
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

  // TV REMOTE EVENT HANDLER
  useEffect(() => {
    const handleTvKey = (e: KeyboardEvent) => {
      const action = normalizeTvKey(e);

      if (['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'BACK'].includes(action)) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Wake up the bottom hints on any remote action if watching video
      if (overlayMode === 'none') {
        pokeBottomHint();
      }

      // 1. STATE: OVERLAY 'none' (Watching Pure Fullscreen Video)
      if (overlayMode === 'none') {
        switch (action) {
          case 'OK':
          case 'UP':
            if (selectedChannel) {
              const grp = selectedChannel.group || 'Все';
              setActiveGroup(grp);
              const curList = grp === 'Все' ? channels : channels.filter(c => c.group === grp);
              const idx = curList.findIndex(c => c.id === selectedChannel.id);
              setFocusedChannelIndex(idx !== -1 ? idx : 0);
            }
            setOverlayMode('channels');
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
            // CRITICAL FIX: DO NOT exit to black screen when watching TV!
            // Just display the bottom hint briefly to confirm TV is active.
            pokeBottomHint();
            break;
        }
        return;
      }

      // 2. STATE: OVERLAY 'channels' (Channel List Open on the Left)
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
              const nextGrp = groups[nextGrpIdx];
              setActiveGroup(nextGrp);
              setFocusedChannelIndex(0);
              const btn = document.getElementById(`cat-btn-${encodeURIComponent(nextGrp)}`);
              if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
            break;

          case 'RIGHT':
            {
              const curGrpIdx = groups.indexOf(activeGroup);
              const nextGrpIdx = (curGrpIdx + 1) % groups.length;
              const nextGrp = groups[nextGrpIdx];
              setActiveGroup(nextGrp);
              setFocusedChannelIndex(0);
              const btn = document.getElementById(`cat-btn-${encodeURIComponent(nextGrp)}`);
              if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
            break;

          case 'OK':
            if (filteredChannels[focusedChannelIndex]) {
              const ch = filteredChannels[focusedChannelIndex];
              setSelectedChannel(ch);
              setSelectedDayOffset(0);
              setOverlayMode('epg');
            }
            break;

          case 'BACK':
            setOverlayMode('none');
            break;
        }
        return;
      }

      // 3. STATE: OVERLAY 'epg' (Program Schedule on the Left)
      if (overlayMode === 'epg') {
        switch (action) {
          case 'UP':
            setFocusedProgramIndex(prev => Math.max(0, prev - 1));
            break;

          case 'DOWN':
            setFocusedProgramIndex(prev => Math.min(filteredEpg.length - 1, prev + 1));
            break;

          case 'LEFT':
            {
              const nextOffset = Math.max(-7, selectedDayOffset - 1);
              setSelectedDayOffset(nextOffset);
              setFocusedProgramIndex(0);
              const btn = document.getElementById(`day-btn-${nextOffset}`);
              if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
            break;

          case 'RIGHT':
            {
              const nextOffset = Math.min(1, selectedDayOffset + 1);
              setSelectedDayOffset(nextOffset);
              setFocusedProgramIndex(0);
              const btn = document.getElementById(`day-btn-${nextOffset}`);
              if (btn) btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
            break;

          case 'OK':
            if (filteredEpg[focusedProgramIndex]) {
              const prog = filteredEpg[focusedProgramIndex];
              const now = Date.now();

              // Prevent selecting future programs
              if (prog.start > now) {
                showToast('Передача ещё не началась (Анонс)');
                break;
              }

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
            // Step back to channel list on the left!
            setOverlayMode('channels');
            break;
        }
        return;
      }

      // 4. STATE: OVERLAY 'prompt' (Choice: Live vs Start from beginning)
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

      // 5. STATE: OVERLAY 'timeline' (Bottom Timeshift OSD Bar)
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

    return () => {
      window.removeEventListener('keydown', handleTvKey, true);
      document.removeEventListener('keydown', handleTvKey, true);
      if (timelineHideTimeoutRef.current) clearTimeout(timelineHideTimeoutRef.current);
      if (seekDebounceTimeoutRef.current) clearTimeout(seekDebounceTimeoutRef.current);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
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
    pokeBottomHint
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
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#000000',
        color: '#ffffff',
        overflow: 'hidden',
        userSelect: 'none',
        outline: 'none'
      }}
    >
      {/* 1. FULLSCREEN VIDEO LAYER (100% of TV screen) */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          backgroundColor: '#000000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        <video
          ref={videoRef}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          autoPlay
          playsInline
        />

        {/* Loading Spinner */}
        {isLoadingStream && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              zIndex: 10,
              pointerEvents: 'none'
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                border: '4px solid rgba(56, 189, 248, 0.3)',
                borderTopColor: '#38bdf8',
                marginBottom: '14px',
                animation: 'spin 1s linear infinite'
              }}
            />
            <p style={{ fontSize: '15px', fontWeight: 'bold', color: '#bae6fd' }}>
              Загрузка {selectedChannel?.name ? `(${selectedChannel.name})` : ''}...
            </p>
          </div>
        )}

        {/* Toast Notification (e.g. "Передача еще не началась") */}
        {toastMessage && (
          <div
            style={{
              position: 'absolute',
              top: '40px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              border: '2px solid #38bdf8',
              color: '#ffffff',
              padding: '10px 24px',
              borderRadius: '24px',
              fontSize: '14px',
              fontWeight: 'bold',
              boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Info style={{ width: '18px', height: '18px', color: '#38bdf8' }} />
            {toastMessage}
          </div>
        )}

        {/* Stream Error Notice */}
        {playerError && (
          <div
            style={{
              position: 'absolute',
              bottom: '100px',
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: '600px',
              padding: '16px 24px',
              borderRadius: '16px',
              backgroundColor: 'rgba(88, 28, 28, 0.95)',
              border: '2px solid #ef4444',
              color: '#fecaca',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              zIndex: 20
            }}
          >
            <AlertCircle style={{ width: '28px', height: '28px', color: '#f87171', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 'bold', color: '#ffffff', marginBottom: '4px' }}>Ошибка воспроизведения</p>
              <p style={{ fontSize: '13px', color: '#fca5a5' }}>{playerError}</p>
            </div>
            <button
              onClick={() => {
                if (selectedChannel) playStream(selectedChannel.streamUrl);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#ef4444',
                color: '#000000',
                fontWeight: 'bold',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Повторить
            </button>
          </div>
        )}
      </div>

      {/* 2. AUTO-HIDING BOTTOM REMOTE HINT BAR (Hides after 3 seconds) */}
      {overlayMode === 'none' && showBottomHint && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(10, 15, 29, 0.92)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: '30px',
            padding: '8px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            fontSize: '13px',
            color: '#cbd5e1',
            zIndex: 25,
            boxShadow: '0 6px 25px rgba(0,0,0,0.7)',
            transition: 'opacity 0.3s ease'
          }}
        >
          <span><b style={{ color: '#38bdf8' }}>ОК:</b> Список каналов</span>
          <span><b style={{ color: '#38bdf8' }}>▼:</b> Таймшифт & Перемотка</span>
          <span><b style={{ color: '#38bdf8' }}>◄ ►:</b> -1 мин / +1 мин</span>
        </div>
      )}

      {/* 3. CHANNELS OVERLAY DRAWER (Snappy Left-docked drawer) */}
      {overlayMode === 'channels' && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            left: 0,
            width: '380px',
            maxWidth: '45vw',
            backgroundColor: '#0b1121',
            borderRight: '2px solid rgba(56, 189, 248, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
            boxShadow: '6px 0 35px rgba(0,0,0,0.9)'
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Radio style={{ width: '18px', height: '18px', color: '#38bdf8' }} />
                Телеканалы
              </h2>
              <p style={{ fontSize: '11px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                {filteredChannels.length} каналов · <b style={{ color: '#38bdf8' }}>OK:</b> открыть передачу
              </p>
            </div>
            <button
              onClick={() => setOverlayMode('none')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px'
              }}
            >
              <X style={{ width: '20px', height: '20px' }} />
            </button>
          </div>

          {/* Category Tabs */}
          <div
            ref={categoryBarRef}
            style={{
              display: 'flex',
              gap: '6px',
              padding: '10px 16px',
              overflowX: 'auto',
              borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
              scrollbarWidth: 'none',
              scrollBehavior: 'smooth'
            }}
          >
            {groups.map((group) => {
              const isSelected = activeGroup === group;
              return (
                <button
                  key={group}
                  id={`cat-btn-${encodeURIComponent(group)}`}
                  onClick={() => {
                    setActiveGroup(group);
                    setFocusedChannelIndex(0);
                  }}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: isSelected ? 'bold' : 'normal',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #38bdf8' : '1px solid transparent',
                    backgroundColor: isSelected ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
                    color: isSelected ? '#ffffff' : '#94a3b8',
                    boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.5)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {group}
                </button>
              );
            })}
          </div>

          {/* Channel Items List: High-Performance Virtualized Windowed Renderer */}
          <div
            ref={channelListRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              position: 'relative',
              padding: 0
            }}
          >
            <div
              style={{
                height: `${filteredChannels.length * CHANNEL_ITEM_HEIGHT}px`,
                position: 'relative',
                width: '100%'
              }}
            >
              {visibleChannels.map(({ channel, actualIndex }) => {
                const isSelected = selectedChannel?.id === channel.id;
                const isFocused = focusedChannelIndex === actualIndex;

                return (
                  <div
                    key={channel.id || actualIndex}
                    id={`ch-item-${actualIndex}`}
                    onClick={() => {
                      setSelectedChannel(channel);
                      setFocusedChannelIndex(actualIndex);
                      setSelectedDayOffset(0);
                      setOverlayMode('epg');
                    }}
                    style={{
                      position: 'absolute',
                      top: `${actualIndex * CHANNEL_ITEM_HEIGHT + 4}px`,
                      left: '12px',
                      right: '12px',
                      height: `${CHANNEL_ITEM_HEIGHT - 6}px`,
                      boxSizing: 'border-box',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '8px 14px',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      backgroundColor: isFocused
                        ? '#0284c7'
                        : isSelected
                        ? 'rgba(30, 41, 59, 0.9)'
                        : 'rgba(17, 24, 39, 0.6)',
                      color: '#ffffff',
                      border: isFocused
                        ? '3px solid #38bdf8'
                        : isSelected
                        ? '1px solid rgba(56, 189, 248, 0.5)'
                        : '1px solid transparent',
                      boxShadow: isFocused ? '0 0 15px rgba(56, 189, 248, 0.5)' : 'none'
                    }}
                  >
                    <span style={{ width: '28px', textAlign: 'center', fontSize: '12px', color: isFocused ? '#ffffff' : '#64748b', fontFamily: 'monospace' }}>
                      {actualIndex + 1}
                    </span>

                    <div
                      style={{
                        position: 'relative',
                        width: '38px',
                        height: '38px',
                        borderRadius: '8px',
                        backgroundColor: '#0f172a',
                        border: '1px solid rgba(51, 65, 85, 0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0
                      }}
                    >
                      <Tv style={{ position: 'absolute', width: '20px', height: '20px', color: '#475569' }} />
                      {channel.logo ? (
                        <img
                          src={channel.logo}
                          alt={channel.name}
                          style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'contain', padding: '2px', zIndex: 1 }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '13px', fontWeight: 'bold', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {channel.name}
                      </p>
                      <p style={{ fontSize: '11px', color: isFocused ? '#bae6fd' : '#94a3b8', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {channel.group || 'Общие'}
                      </p>
                    </div>

                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 'bold',
                        padding: '2px 6px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(245, 158, 11, 0.25)',
                        color: '#fbbf24',
                        border: '1px solid rgba(245, 158, 11, 0.4)'
                      }}
                    >
                      7д
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer Hints */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(15, 23, 42, 0.98)',
              borderTop: '1px solid rgba(51, 65, 85, 0.8)',
              fontSize: '11px',
              color: '#94a3b8',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <span>▲▼ Каналы · ◄► Группы</span>
            <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>ОК: Программа</span>
          </div>
        </div>
      )}

      {/* 4. EPG SCHEDULE OVERLAY DRAWER (Docked to the LEFT edge!) */}
      {overlayMode === 'epg' && selectedChannel && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            bottom: 0,
            left: 0,
            width: '440px',
            maxWidth: '50vw',
            backgroundColor: '#0b1121',
            borderRight: '2px solid rgba(56, 189, 248, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 40,
            boxShadow: '6px 0 35px rgba(0,0,0,0.9)'
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(51, 65, 85, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => setOverlayMode('channels')}
                style={{
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: 'none',
                  color: '#ffffff',
                  padding: '6px 10px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px'
                }}
              >
                <ArrowLeft style={{ width: '16px', height: '16px' }} />
                Каналы
              </button>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>
                  {selectedChannel.name}
                </h2>
                <p style={{ fontSize: '11px', color: '#38bdf8', margin: '2px 0 0 0' }}>
                  Архив на 7 дней
                </p>
              </div>
            </div>
            <button
              onClick={() => setOverlayMode('none')}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <X style={{ width: '20px', height: '20px' }} />
            </button>
          </div>

          {/* 7-Day Selector Bar */}
          <div
            ref={daySelectorRef}
            style={{
              display: 'flex',
              gap: '6px',
              padding: '10px 16px',
              overflowX: 'auto',
              borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
              scrollbarWidth: 'none',
              scrollBehavior: 'smooth'
            }}
          >
            {[-7, -6, -5, -4, -3, -2, -1, 0, 1].map((offset) => {
              const tzOffsetMs = 3 * 3600 * 1000;
              const nowInMsk = new Date(Date.now() + tzOffsetMs);
              const targetInMsk = new Date(nowInMsk);
              targetInMsk.setUTCDate(targetInMsk.getUTCDate() + offset);
              targetInMsk.setUTCHours(12, 0, 0, 0);
              const d = new Date(targetInMsk.getTime() - tzOffsetMs);
              const dayStr = d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'short' });

              const label =
                offset === 1
                  ? 'Завтра'
                  : offset === 0
                  ? 'Сегодня'
                  : offset === -1
                  ? 'Вчера'
                  : offset === -2
                  ? 'Позавчера'
                  : dayStr;
              const isSelected = selectedDayOffset === offset;

              return (
                <button
                  key={offset}
                  id={`day-btn-${offset}`}
                  onClick={() => {
                    setSelectedDayOffset(offset);
                    setFocusedProgramIndex(0);
                  }}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: isSelected ? 'bold' : 'normal',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #38bdf8' : '1px solid transparent',
                    backgroundColor: isSelected ? '#0284c7' : 'rgba(30, 41, 59, 0.8)',
                    color: isSelected ? '#ffffff' : '#94a3b8',
                    boxShadow: isSelected ? '0 0 12px rgba(56, 189, 248, 0.5)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Program Schedule List with Smart Centered Auto-Scroll */}
          <div
            ref={epgListRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            {isLoadingEpg ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                <Clock style={{ width: '28px', height: '28px', margin: '0 auto 10px auto', color: '#38bdf8' }} />
                <p style={{ margin: 0, fontWeight: 'bold', color: '#bae6fd' }}>Загрузка телегида...</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#64748b' }}>Получение программы передач</p>
              </div>
            ) : filteredEpg.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                <Calendar style={{ width: '28px', height: '28px', margin: '0 auto 10px auto', color: '#64748b' }} />
                <p style={{ margin: 0, fontWeight: 'bold' }}>
                  {epgList.length > 0 ? 'Нет программы на выбранный день' : 'Программа передач для этого канала отсутствует'}
                </p>
                <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#64748b' }}>
                  {epgList.length > 0 ? 'Используйте ◄ ► для выбора дня с записями архива' : 'Прямой эфир доступен для просмотра'}
                </p>
              </div>
            ) : (
              filteredEpg.map((prog, idx) => {
                const isFocused = focusedProgramIndex === idx;
                const isCurrentLive = prog.isLive;
                const isFuture = prog.start > Date.now();

                return (
                  <div
                    key={prog.id}
                    id={`epg-item-${idx}`}
                    onClick={() => {
                      setFocusedProgramIndex(idx);
                      if (isFuture) {
                        showToast('Передача ещё не началась (Анонс)');
                        return;
                      }
                      if (prog.isLive) {
                        setPromptProgram(prog);
                        setPromptFocusedChoice('live');
                        setOverlayMode('prompt');
                      } else {
                        handlePlayArchiveProgram(prog, true);
                      }
                    }}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '10px',
                      cursor: isFuture ? 'not-allowed' : 'pointer',
                      backgroundColor: isFocused
                        ? '#0284c7'
                        : isCurrentLive
                        ? 'rgba(12, 74, 110, 0.6)'
                        : isFuture
                        ? 'rgba(15, 23, 42, 0.4)'
                        : 'rgba(17, 24, 39, 0.6)',
                      color: isFuture && !isFocused ? '#64748b' : '#ffffff',
                      border: isFocused
                        ? '3px solid #38bdf8'
                        : isCurrentLive
                        ? '1px solid rgba(56, 189, 248, 0.6)'
                        : '1px solid rgba(51, 65, 85, 0.5)',
                      boxShadow: isFocused ? '0 0 15px rgba(56, 189, 248, 0.5)' : 'none',
                      opacity: isFuture && !isFocused ? 0.65 : 1.0
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: 'bold', color: isFocused ? '#ffffff' : isFuture ? '#64748b' : '#38bdf8' }}>
                        {formatTime(prog.start)} — {formatTime(prog.end)}
                      </span>

                      {prog.isLive ? (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 'bold',
                            padding: '2px 6px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(239, 68, 68, 0.3)',
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.5)'
                          }}
                        >
                          ● ЭФИР
                        </span>
                      ) : isFuture ? (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 'bold',
                            padding: '2px 6px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(71, 85, 105, 0.3)',
                            color: '#94a3b8'
                          }}
                        >
                          СКОРО
                        </span>
                      ) : prog.hasArchive ? (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 'bold',
                            padding: '2px 6px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(245, 158, 11, 0.25)',
                            color: '#fbbf24',
                            border: '1px solid rgba(245, 158, 11, 0.4)'
                          }}
                        >
                          АРХИВ
                        </span>
                      ) : null}
                    </div>

                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', margin: '0 0 3px 0', lineHeight: 1.3 }}>
                      {prog.title}
                    </h3>

                    {prog.description && (
                      <p style={{ fontSize: '11px', color: isFocused ? '#bae6fd' : '#94a3b8', margin: 0, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {prog.description}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Hints */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(15, 23, 42, 0.98)',
              borderTop: '1px solid rgba(51, 65, 85, 0.8)',
              fontSize: '11px',
              color: '#94a3b8',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <span>▲▼ Передачи · ◄► Дни архива</span>
            <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>ОК: Смотреть</span>
          </div>
        </div>
      )}

      {/* 5. MODAL PROMPT: LIVE VS START FROM BEGINNING */}
      {overlayMode === 'prompt' && promptProgram && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '460px',
              maxWidth: '90vw',
              padding: '28px',
              borderRadius: '24px',
              backgroundColor: '#0f172a',
              border: '2px solid rgba(56, 189, 248, 0.5)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.9)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center'
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                backgroundColor: 'rgba(56, 189, 248, 0.2)',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}
            >
              <Tv style={{ width: '28px', height: '28px', color: '#38bdf8' }} />
            </div>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#ffffff', margin: '0 0 6px 0' }}>
              {promptProgram.title}
            </h3>
            <p style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'monospace', margin: '0 0 24px 0' }}>
              {formatTime(promptProgram.start)} — {formatTime(promptProgram.end)} · {selectedChannel?.name}
            </p>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={() => {
                  handleJumpToLive();
                  setOverlayMode('none');
                }}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  borderRadius: '14px',
                  fontSize: '15px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  border: promptFocusedChoice === 'live' ? '3px solid #f87171' : '1px solid rgba(51, 65, 85, 0.8)',
                  backgroundColor: promptFocusedChoice === 'live' ? '#ef4444' : '#1e293b',
                  color: '#ffffff',
                  boxShadow: promptFocusedChoice === 'live' ? '0 0 20px rgba(239, 68, 68, 0.5)' : 'none'
                }}
              >
                ● Смотреть прямой эфир
              </button>

              <button
                onClick={() => {
                  handlePlayArchiveProgram(promptProgram, true);
                  setOverlayMode('none');
                }}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  borderRadius: '14px',
                  fontSize: '15px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  border: promptFocusedChoice === 'start' ? '3px solid #38bdf8' : '1px solid rgba(51, 65, 85, 0.8)',
                  backgroundColor: promptFocusedChoice === 'start' ? '#0284c7' : '#1e293b',
                  color: '#ffffff',
                  boxShadow: promptFocusedChoice === 'start' ? '0 0 20px rgba(56, 189, 248, 0.5)' : 'none'
                }}
              >
                <RotateCcw style={{ width: '18px', height: '18px' }} />
                Смотреть с начала (Архив)
              </button>
            </div>

            <button
              onClick={() => setOverlayMode('epg')}
              style={{
                marginTop: '18px',
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Отмена (Back)
            </button>
          </div>
        </div>
      )}

      {/* 6. TIMELINE / TIMESHIFT OSD BAR (Triggered by remote "DOWN") */}
      {overlayMode === 'timeline' && selectedChannel && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'rgba(5, 8, 17, 0.96)',
            borderTop: '2px solid rgba(56, 189, 248, 0.5)',
            padding: '20px 32px',
            zIndex: 50,
            boxShadow: '0 -10px 40px rgba(0,0,0,0.9)'
          }}
        >
          <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(51, 65, 85, 0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0
                  }}
                >
                  {selectedChannel.logo ? (
                    <img
                      src={selectedChannel.logo}
                      alt={selectedChannel.name}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <Tv style={{ width: '24px', height: '24px', color: '#38bdf8' }} />
                  )}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#ffffff' }}>
                      {selectedChannel.name}
                    </span>
                    {isArchiveMode ? (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 'bold',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(245, 158, 11, 0.3)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245, 158, 11, 0.5)'
                        }}
                      >
                        АРХИВ / ТАЙМШИФТ
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 'bold',
                          padding: '2px 8px',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.5)'
                        }}
                      >
                        ● ПРЯМОЙ ЭФИР
                      </span>
                    )}
                  </div>

                  <h2 style={{ fontSize: '15px', fontWeight: 'bold', color: '#7dd3fc', margin: '3px 0 0 0' }}>
                    {activeTimelineProgram?.title || 'Телепрограмма'}
                  </h2>
                </div>
              </div>

              {isArchiveMode && (
                <button
                  onClick={handleJumpToLive}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '10px',
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  ● В прямой эфир
                </button>
              )}
            </div>

            {/* Middle row: Progress Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#1e293b',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    backgroundColor: '#38bdf8',
                    borderRadius: '4px',
                    width: `${progProgressPercent}%`
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  color: '#94a3b8'
                }}
              >
                <span>{activeTimelineProgram ? formatTime(activeTimelineProgram.start) : '00:00'}</span>
                <span style={{ color: '#fef08a', fontWeight: 'bold' }}>
                  Позиция: {formatSecondsToClock(seekTimestamp)}
                </span>
                <span>{activeTimelineProgram ? formatTime(activeTimelineProgram.end) : '00:00'}</span>
              </div>
            </div>

            {/* Bottom hints */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '11px',
                color: '#94a3b8',
                borderTop: '1px solid rgba(51, 65, 85, 0.6)',
                paddingTop: '6px'
              }}
            >
              <span>◄ Влево / Вправо ►: Перемотка (с автопереключением передач)</span>
              <span style={{ color: '#38bdf8', fontWeight: 'bold' }}>ОК: Применить · ▲/Back: Закрыть</span>
            </div>
          </div>
        </div>
      )}

      {/* 7. SETTINGS MODAL */}
      {overlayMode === 'settings' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            padding: '20px'
          }}
        >
          <div
            style={{
              width: '500px',
              maxWidth: '90vw',
              padding: '24px',
              borderRadius: '20px',
              backgroundColor: '#0f172a',
              border: '2px solid rgba(56, 189, 248, 0.5)',
              boxShadow: '0 10px 40px rgba(0,0,0,0.9)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid rgba(51, 65, 85, 0.8)', paddingBottom: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings style={{ width: '18px', height: '18px', color: '#38bdf8' }} />
                Настройки IPTV
              </h3>
              <button
                onClick={() => setOverlayMode('none')}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                  Ссылка на M3U / M3U8 плейлист:
                </label>
                <input
                  type="text"
                  required
                  value={inputUrl}
                  onChange={(e) => setInputUrl(e.target.value)}
                  placeholder="http://rus.hls.gd/pl/19/.../playlist.m3u8"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#020617',
                    border: '1px solid #334155',
                    color: '#ffffff',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                  Ссылка на телегид EPG (XMLTV):
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={inputEpgUrl}
                    onChange={(e) => setInputEpgUrl(e.target.value)}
                    placeholder="https://rus.epg.team/7.1.xml?pkg=442"
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      borderRadius: '8px',
                      backgroundColor: '#020617',
                      border: '1px solid #334155',
                      color: '#ffffff',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSyncEpg}
                    disabled={isSyncingEpg}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '8px',
                      backgroundColor: isSyncingEpg ? '#334155' : 'rgba(56, 189, 248, 0.2)',
                      border: '1px solid rgba(56, 189, 248, 0.4)',
                      color: '#38bdf8',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: isSyncingEpg ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {isSyncingEpg ? 'Загрузка...' : 'Обновить EPG'}
                  </button>
                </div>
                <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0 0' }}>
                  TV.Team 7 дней архива: <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>https://rus.epg.team/7.1.xml?pkg=442</span>
                </p>
              </div>

              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                  Глубина архива: {settings.archiveDays} дней
                </label>
                <input
                  type="range"
                  min="1"
                  max="7"
                  value={settings.archiveDays}
                  onChange={(e) => setSettings({ ...settings, archiveDays: parseInt(e.target.value, 10) })}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                  Часовой пояс телепрограммы (EPG):
                </label>
                <select
                  value={settings.timeZoneOffset === undefined ? 'auto' : settings.timeZoneOffset}
                  onChange={(e) => {
                    const val = e.target.value === 'auto' ? 'auto' : parseInt(e.target.value, 10);
                    setSettings({ ...settings, timeZoneOffset: val });
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#020617',
                    border: '1px solid #334155',
                    color: '#ffffff',
                    fontSize: '12px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                >
                  <option value="auto">Авто (системное время ТВ/устройства)</option>
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
                <p style={{ fontSize: '11px', color: '#64748b', margin: '4px 0 0 0' }}>
                  Для большинства каналов TV.Team выберите UTC+3 (Москва), если часы ТВ сбиты
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setOverlayMode('none')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    backgroundColor: '#1e293b',
                    color: '#94a3b8',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSavingSettings}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '8px',
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  {isSavingSettings ? 'Сохранение...' : 'Сохранить и загрузить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
