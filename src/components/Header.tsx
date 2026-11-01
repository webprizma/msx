import React from 'react';
import { Tv, Copy, Check } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  tvAddress: string;
  serverUrl: string;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, tvAddress, serverUrl }) => {
  const [copied, setCopied] = React.useState(false);

  const navItems = [
    { id: 'iptv', label: 'IPTV Плеер (Архив)' },
    { id: 'builder', label: 'Конструктор' }
  ];

  const handleCopyTvAddress = () => {
    navigator.clipboard.writeText(tvAddress || serverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium text-slate-300">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 px-2 rounded-md cursor-pointer ${
              activeTab === item.id
                ? 'text-sky-400 bg-sky-950/40 border-b-2 border-sky-400 font-semibold'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Zone 3: Primary Action - Copy TV Parameter */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={handleCopyTvAddress}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-900 bg-sky-400 hover:bg-sky-300 active:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm"
          title="Скопировать параметр запуска для Media Station X (например, 192.168.1.244)"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-slate-950" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Адрес скопирован!' : `Скопировать для ТВ (${tvAddress || '192.168.1.244'})`}</span>
        </button>
      </div>
    </header>
  );
};
