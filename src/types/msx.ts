export interface MsxItem {
  id: string;
  type: 'button' | 'default' | 'separator';
  layout: string; // e.g. "0,0,3,3" -> x, y, width, height (grid is 12x6 or 12x8)
  icon?: string;
  image?: string;
  label: string;
  badge?: string;
  color?: string; // e.g. "msx-glass", "msx-white", "#1e293b"
  action: string; // e.g. "link:https://lampa.mx", "content:...", "execute:info:..."
  description?: string;
}

export interface MsxPage {
  items: MsxItem[];
}

export interface MsxMenuItem {
  id: string;
  icon: string; // "apps", "movie", "tv", "music", "settings", "star", "folder"
  label: string;
  data: {
    pages: MsxPage[];
  };
}

export interface MsxPlaylist {
  name: string;
  version: string;
  parameter?: string;
  response?: string;
  background?: string;
  headline?: string;
  menu: MsxMenuItem[];
}

export interface PresetApp {
  id: string;
  name: string;
  category: string;
  icon: string;
  action: string;
  badge: string;
  description: string;
  recommendedLayout: string;
  platformNotes: string;
}
