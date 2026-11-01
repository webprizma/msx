import React from 'react';
import { Tv } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  const navItems = [
    { id: 'iptv', label: 'IPTV Плеер' },
    { id: 'iptv-settings', label: 'Настройки IPTV' },
    { id: 'builder', label: 'Конструктор' }
  ];

  return (
    <header className="flex items-center justify-between gap-6 px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-50">
      {/* Zone 1: Brand wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
          <Tv className="w-5 h-5" />
        </div>
        <span className="text-lg font-bold tracking-tight text-white whitespace-nowrap">
          MSX Server Studio
        </span>
      </div>

      {/* Zone 2: Navigation links */}
      <nav className="flex items-center gap-3 sm:gap-6 text-sm font-medium text-slate-300">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 px-2.5 rounded-lg cursor-pointer ${
              activeTab === item.id
                ? 'text-sky-400 bg-sky-950/60 border-b-2 border-sky-400 font-semibold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
};
