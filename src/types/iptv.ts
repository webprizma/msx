export interface Channel {
  id: string;
  name: string;
  logo: string;
  group: string;
  streamUrl: string;
  tvgId?: string;
  catchupDays: number;
  catchupSource?: string;
  catchupType?: string;
}

export interface EpgProgram {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  category?: string;
  start: number; // Unix timestamp in ms
  end: number;   // Unix timestamp in ms
  isLive?: boolean;
  hasArchive?: boolean;
  archiveUrl?: string;
}

export interface IptvSettings {
  playlistUrl: string;
  epgUrl?: string;
  archiveDays: number;
  providerType: string;
}
