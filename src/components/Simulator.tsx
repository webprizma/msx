import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MsxPlaylist, MsxItem } from '../types/msx';
import { playNavSound } from '../utils/audio';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  RotateCcw,
  Volume2,
  VolumeX,
  ExternalLink,
  Layers,
  Sparkles,
  Home,
  Menu,
  Info
} from 'lucide-react';

interface SimulatorProps {
  playlist: MsxPlaylist;
}

export const Simulator: React.FC<SimulatorProps> = ({ playlist }) => {
  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [launchedApp, setLaunchedApp] = useState<MsxItem | null>(null);
  const [currentTime, setCurrentTime] = useState('');

  // Update clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, []);

  const currentMenu = playlist.menu[activeMenuIndex] || playlist.menu[0];
  const items: MsxItem[] = useMemo(() => {
    return currentMenu?.data?.pages?.[0]?.items || [];
  }, [currentMenu]);

  // Keep focused index within bounds
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, focusedIndex]);

  // Play sound helper
  const triggerSound = useCallback((type: 'move' | 'select' | 'back') => {
    if (soundEnabled) {
      playNavSound(type);
    }
  }, [soundEnabled]);

  // Navigation handlers
  const handleNav = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (items.length === 0) return;
    triggerSound('move');

    setFocusedIndex((prev) => {
      // 12 columns grid navigation estimate: 4 items per row (each w=3)
      const colsPerRow = 4;
      if (direction === 'left') {
        return prev > 0 ? prev - 1 : items.length - 1;
      }
      if (direction === 'right') {
        return prev < items.length - 1 ? prev + 1 : 0;
      }
      if (direction === 'up') {
        return prev >= colsPerRow ? prev - colsPerRow : prev;
      }
      if (direction === 'down') {
        return prev + colsPerRow < items.length ? prev + colsPerRow : prev;
      }
      return prev;
    });
  }, [items.length, triggerSound]);

  const handleSelect = useCallback(() => {
    const currentItem = items[focusedIndex];
    if (currentItem) {
      triggerSound('select');
      setLaunchedApp(currentItem);
    }
  }, [items, focusedIndex, triggerSound]);

  const handleBack = useCallback(() => {
    triggerSound('back');
    if (launchedApp) {
      setLaunchedApp(null);
    } else if (activeMenuIndex > 0) {
      setActiveMenuIndex(0);
      setFocusedIndex(0);
    }
  }, [launchedApp, activeMenuIndex, triggerSound]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Backspace'].includes(e.key)) {
        // Prevent default page scroll when interacting with simulator
        e.preventDefault();
      }

      switch (e.key) {
        case 'ArrowUp':
          handleNav('up');
          break;
        case 'ArrowDown':
          handleNav('down');
          break;
        case 'ArrowLeft':
          handleNav('left');
          break;
        case 'ArrowRight':
          handleNav('right');
          break;
        case 'Enter':
          handleSelect();
          break;
        case 'Escape':
        case 'Backspace':
          handleBack();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNav, handleSelect, handleBack]);

  // Parse layout string "x,y,w,h"
  const getGridStyle = (layout: string) => {
    const parts = (layout || '0,0,3,3').split(',').map(n => parseInt(n.trim(), 10) || 0);
    const colSpan = Math.min(12, Math.max(1, parts[2] || 3));
    const rowSpan = Math.max(1, parts[3] || 3);
    return {
      gridColumn: `span ${colSpan} / span ${colSpan}`,
      minHeight: `${rowSpan * 38}px`
    };
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Smart TV Viewport (16:9 Screen) */}
      <div className="lg:col-span-8 flex flex-col gap-4">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-300">Интерактивный экран Media Station X</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-400">Управление: клавиатура (стрелки, Enter, Esc) или пульт справа</span>
          </div>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-sky-400" /> : <VolumeX className="w-3.5 h-3.5 text-slate-500" />}
            <span>{soundEnabled ? 'Звук кликов ВКЛ' : 'Звук кликов ВЫКЛ'}</span>
          </button>
        </div>

        {/* TV Hardware Frame */}
        <div className="relative rounded-2xl p-3 bg-gradient-to-b from-slate-800 via-slate-900 to-black shadow-2xl border border-slate-700/80">
          {/* Subtle TV top bezel and camera/sensor dot */}
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-slate-700/60" />

          {/* Actual TV Screen Aspect Ratio 16:9 */}
          <div
            className="relative w-full aspect-video rounded-lg overflow-hidden bg-slate-950 flex flex-col justify-between text-white select-none border border-black shadow-inner"
            style={{
              backgroundImage: playlist.background ? `url(${playlist.background})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          >
            {/* Dark Scrim overlay for legibility */}
            <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[2px]" />

            {/* Screen Content */}
            <div className="relative z-10 p-5 flex flex-col h-full justify-between">
              {/* MSX Header Bar */}
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-white/10 text-xs">
                  <div className="flex items-center gap-3">
                    <div className="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-400/40 text-sky-300 font-semibold uppercase tracking-wider text-[10px]">
                      MSX Engine
                    </div>
                    <span className="font-semibold text-sm tracking-tight text-white/95">
                      {playlist.name || 'Media Station X'}
                    </span>
                    {playlist.headline && (
                      <span className="hidden sm:inline text-white/60 text-xs">
                        {playlist.headline}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-white/80 font-mono tabular-nums text-xs">
                    <span>{currentTime}</span>
                  </div>
                </div>

                {/* Categories Tab Strip */}
                <div className="flex items-center gap-2 pt-3 pb-1 overflow-x-auto no-scrollbar">
                  {playlist.menu.map((menuItem, idx) => (
                    <button
                      key={menuItem.id || idx}
                      onClick={() => {
                        triggerSound('select');
                        setActiveMenuIndex(idx);
                        setFocusedIndex(0);
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                        activeMenuIndex === idx
                          ? 'bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/20'
                          : 'bg-white/10 hover:bg-white/20 text-white/80'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>{menuItem.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid of Apps / Tiles */}
              <div className="my-auto py-2">
                {items.length === 0 ? (
                  <div className="text-center py-12 text-white/50 text-sm">
                    В этой категории пока нет добавленных приложений.
                  </div>
                ) : (
                  <div className="grid grid-cols-12 gap-3 max-h-[320px] overflow-y-auto pr-1">
                    {items.map((item, idx) => {
                      const isFocused = idx === focusedIndex;
                      return (
                        <div
                          key={item.id || idx}
                          style={getGridStyle(item.layout)}
                          onClick={() => {
                            setFocusedIndex(idx);
                            handleSelect();
                          }}
                          className={`relative rounded-xl p-3 flex flex-col justify-between transition-all duration-150 cursor-pointer overflow-hidden ${
                            isFocused
                              ? 'scale-[1.04] z-20 bg-sky-500/30 ring-3 ring-sky-400 ring-offset-2 ring-offset-slate-950 shadow-xl shadow-sky-500/30'
                              : 'bg-white/10 hover:bg-white/15 border border-white/10 backdrop-blur-md'
                          }`}
                        >
                          {/* Badge if present */}
                          {item.badge && (
                            <span className="absolute top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white/90 border border-white/10 truncate max-w-[90px]">
                              {item.badge}
                            </span>
                          )}

                          {/* App Icon */}
                          <div className="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center p-1.5 border border-white/15 overflow-hidden">
                            {item.icon ? (
                              <img
                                src={item.icon}
                                alt={item.label}
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                  // Fallback to placeholder if icon link breaks
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            ) : (
                              <Sparkles className="w-5 h-5 text-sky-400" />
                            )}
                          </div>

                          {/* App Title & Description */}
                          <div className="mt-2">
                            <h4 className="text-xs font-bold text-white tracking-tight leading-tight truncate">
                              {item.label}
                            </h4>
                            <p className="text-[10px] text-white/70 truncate mt-0.5">
                              {item.description || item.action}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* MSX Footer Navigation Hint */}
              <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-white/60">
                <div className="flex items-center gap-3">
                  <span>OK: Открыть</span>
                  <span>·</span>
                  <span>Стрелки: Перемещение</span>
                  <span>·</span>
                  <span>Назад: Выход</span>
                </div>
                <div className="text-[10px] text-white/40">
                  {items[focusedIndex]?.action || 'Выберите элемент'}
                </div>
              </div>
            </div>

            {/* Simulated Launched Application Modal */}
            {launchedApp && (
              <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-lg flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
                <div className="w-16 h-16 rounded-2xl bg-sky-500/20 border border-sky-400/40 flex items-center justify-center p-2 mb-4">
                  {launchedApp.icon ? (
                    <img
                      src={launchedApp.icon}
                      alt={launchedApp.label}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Sparkles className="w-8 h-8 text-sky-400" />
                  )}
                </div>
                <h3 className="text-lg font-bold text-white mb-1">
                  Запуск: {launchedApp.label}
                </h3>
                <p className="text-xs text-slate-300 max-w-md mb-2">
                  {launchedApp.description || 'Веб-приложение для Media Station X'}
                </p>
                <div className="text-xs font-mono px-3 py-1.5 rounded bg-black/60 border border-white/10 text-sky-300 mb-6 max-w-full truncate">
                  Команда: {launchedApp.action}
                </div>

                <div className="flex items-center gap-3">
                  {launchedApp.action.startsWith('link:') ? (
                    <a
                      href={launchedApp.action.replace('link:', '')}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Открыть сайт в новой вкладке</span>
                    </a>
                  ) : (
                    <button
                      onClick={() => alert(`Выполняется команда MSX: ${launchedApp.action}`)}
                      className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      Выполнить команду
                    </button>
                  )}
                  <button
                    onClick={() => setLaunchedApp(null)}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    Вернуться в меню (Назад)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* TV Stand / Base bar */}
          <div className="w-32 h-2 mx-auto bg-gradient-to-r from-transparent via-slate-700 to-transparent rounded-full mt-1.5 opacity-60" />
        </div>
      </div>

      {/* Realistic Smart TV Remote Control */}
      <div className="lg:col-span-4 flex flex-col items-center">
        <div className="w-64 bg-slate-900 border border-slate-700/80 rounded-3xl p-5 shadow-2xl flex flex-col items-center select-none">
          <div className="w-full flex items-center justify-between text-[11px] text-slate-400 pb-3 mb-2 border-b border-slate-800">
            <span className="font-semibold text-slate-300 tracking-wider">TV REMOTE</span>
            <div className="w-2 h-2 rounded-full bg-emerald-500" title="Подключен" />
          </div>

          {/* Power and Input buttons */}
          <div className="w-full flex items-center justify-between mb-4">
            <button
              onClick={() => {
                triggerSound('select');
                setActiveMenuIndex(0);
                setFocusedIndex(0);
              }}
              className="w-10 h-10 rounded-full bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-400 flex items-center justify-center cursor-pointer transition-colors"
              title="Сброс / Home"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">D-PAD</span>
            <button
              onClick={() => {
                triggerSound('select');
                setLaunchedApp(null);
              }}
              className="w-10 h-10 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              title="Домой"
            >
              <Home className="w-4 h-4" />
            </button>
          </div>

          {/* D-Pad Cross */}
          <div className="relative w-44 h-44 rounded-full bg-slate-800 border-2 border-slate-700 p-2 flex items-center justify-center shadow-inner my-2">
            {/* UP */}
            <button
              onClick={() => handleNav('up')}
              className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-10 rounded-t-xl bg-slate-700/70 hover:bg-sky-500 hover:text-slate-950 active:bg-sky-400 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              title="Вверх (Стрелка вверх)"
            >
              <ChevronUp className="w-5 h-5" />
            </button>

            {/* DOWN */}
            <button
              onClick={() => handleNav('down')}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 w-14 h-10 rounded-b-xl bg-slate-700/70 hover:bg-sky-500 hover:text-slate-950 active:bg-sky-400 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              title="Вниз (Стрелка вниз)"
            >
              <ChevronDown className="w-5 h-5" />
            </button>

            {/* LEFT */}
            <button
              onClick={() => handleNav('left')}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-14 rounded-l-xl bg-slate-700/70 hover:bg-sky-500 hover:text-slate-950 active:bg-sky-400 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              title="Влево (Стрелка влево)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* RIGHT */}
            <button
              onClick={() => handleNav('right')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-14 rounded-r-xl bg-slate-700/70 hover:bg-sky-500 hover:text-slate-950 active:bg-sky-400 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
              title="Вправо (Стрелка вправо)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

            {/* CENTER OK BUTTON */}
            <button
              onClick={handleSelect}
              className="w-16 h-16 rounded-full bg-slate-900 border border-slate-600 hover:border-sky-400 hover:bg-sky-500/20 active:scale-95 text-white font-bold text-xs flex items-center justify-center cursor-pointer transition-all shadow-md"
              title="Выбрать / Запустить (Enter)"
            >
              OK
            </button>
          </div>

          {/* Action Row: Back, Menu, Info */}
          <div className="w-full grid grid-cols-3 gap-2 mt-4">
            <button
              onClick={handleBack}
              className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-xs font-medium flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
              title="Назад (Esc)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="text-[10px]">Назад</span>
            </button>
            <button
              onClick={() => {
                triggerSound('select');
                setActiveMenuIndex((prev) => (prev + 1) % playlist.menu.length);
              }}
              className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-xs font-medium flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
              title="Сменить категорию"
            >
              <Menu className="w-3.5 h-3.5" />
              <span className="text-[10px]">Меню</span>
            </button>
            <button
              onClick={() => {
                triggerSound('select');
                alert(`Фокус на: ${items[focusedIndex]?.label || 'Ничего не выбрано'}\nДействие: ${items[focusedIndex]?.action || 'Нет'}`);
              }}
              className="py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-xs font-medium flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
              title="Инфо об элементе"
            >
              <Info className="w-3.5 h-3.5" />
              <span className="text-[10px]">Инфо</span>
            </button>
          </div>

          {/* 4 Colored TV function buttons */}
          <div className="w-full grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-800">
            <button
              onClick={() => { triggerSound('move'); setActiveMenuIndex(0); }}
              className="h-3 rounded-full bg-red-500 hover:opacity-80 transition-opacity cursor-pointer"
              title="Красная кнопка (Все)"
            />
            <button
              onClick={() => { triggerSound('move'); if (playlist.menu[1]) setActiveMenuIndex(1); }}
              className="h-3 rounded-full bg-emerald-500 hover:opacity-80 transition-opacity cursor-pointer"
              title="Зеленая кнопка"
            />
            <button
              onClick={() => { triggerSound('move'); if (playlist.menu[2]) setActiveMenuIndex(2); }}
              className="h-3 rounded-full bg-amber-500 hover:opacity-80 transition-opacity cursor-pointer"
              title="Желтая кнопка"
            />
            <button
              onClick={() => { triggerSound('move'); setSoundEnabled(!soundEnabled); }}
              className="h-3 rounded-full bg-sky-500 hover:opacity-80 transition-opacity cursor-pointer"
              title="Синяя кнопка (Звук)"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
