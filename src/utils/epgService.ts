import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { EpgProgram } from '../types/iptv.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../iptv-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'epg-data.json');

// Memory cache for fast lookups
// Key: channel id or normalized channel name -> Array of EpgProgram
const programsByChannel = new Map<string, EpgProgram[]>();
const channelAliases = new Map<string, string>(); // name.toLowerCase() -> tvgId
let isSyncing = false;
let lastSyncTime = 0;

function parseXmltvDate(str: string): number {
  if (!str) return 0;
  // Format: YYYYMMDDHHMMSS [+-]HHMM or YYYYMMDDHHMMSS
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/);
  if (!match) return 0;
  const [_, y, m, d, h, min, s, tz] = match;
  const tzFormatted = tz ? `${tz.substring(0, 3)}:${tz.substring(3)}` : 'Z';
  const iso = `${y}-${m}-${d}T${h}:${min}:${s}${tzFormatted}`;
  return new Date(iso).getTime();
}

function decodeXmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'");
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s\-_!?:.,/\\()[\]]+/g, '').trim();
}

// Load cache from disk if available
export function initEpgCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) {
            programsByChannel.set(k, v);
          }
        }
        console.log(`[EPG Service] Loaded cached EPG for ${programsByChannel.size} channels from disk.`);
      }
    }
  } catch (e) {
    console.error('[EPG Service] Error loading disk cache:', e);
  }
}

// Fetch and stream parse XMLTV file from provider (TV.Team, etc.)
export async function syncEpg(epgUrl: string = 'https://rus.epg.team/7.1.xml?pkg=442'): Promise<{ success: boolean; channelsCount: number; message: string }> {
  if (isSyncing) {
    return { success: false, channelsCount: programsByChannel.size, message: 'Синхронизация уже выполняется...' };
  }

  isSyncing = true;
  console.log(`[EPG Service] Starting background EPG sync from ${epgUrl}...`);

  try {
    const response = await fetch(epgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(60000)
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch EPG: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const tempMap = new Map<string, EpgProgram[]>();
    const tempAliases = new Map<string, string>();
    let totalProgrammes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 1. Extract channel mapping <channel id="..."> <display-name>...</display-name> </channel>
      let chMatch;
      const chRegex = /<channel\s+id="([^"]+)">[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>[\s\S]*?<\/channel>/gi;
      while ((chMatch = chRegex.exec(buffer)) !== null) {
        const chId = chMatch[1];
        const chName = decodeXmlEntities(chMatch[2]).trim();
        tempAliases.set(normalizeName(chName), chId);
      }

      // 2. Extract programmes <programme ...> ... </programme> regardless of attribute order
      let progMatch;
      const progRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/gi;
      let lastIndex = 0;

      while ((progMatch = progRegex.exec(buffer)) !== null) {
        lastIndex = progRegex.lastIndex;
        const attrs = progMatch[1];
        const inner = progMatch[2];

        const chIdMatch = attrs.match(/channel="([^"]+)"/i);
        const startMatch = attrs.match(/start="([^"]+)"/i);
        const stopMatch = attrs.match(/stop="([^"]+)"/i);

        if (!chIdMatch || !startMatch || !stopMatch) continue;

        const chId = chIdMatch[1];
        const start = parseXmltvDate(startMatch[1]);
        const end = parseXmltvDate(stopMatch[1]);
        if (!start || !end) continue;

        const titleMatch = inner.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const descMatch = inner.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
        const catMatch = inner.match(/<category[^>]*>([\s\S]*?)<\/category>/i);

        const title = decodeXmlEntities(titleMatch ? titleMatch[1].trim() : 'Передача');
        const desc = decodeXmlEntities(descMatch ? descMatch[1].trim() : '');
        const category = decodeXmlEntities(catMatch ? catMatch[1].trim() : 'ТВ');

        const now = Date.now();
        const prog: EpgProgram = {
          id: `epg-${chId}-${start}`,
          channelId: chId,
          title,
          description: desc,
          category,
          start,
          end,
          isLive: now >= start && now < end,
          hasArchive: end <= now
        };

        if (!tempMap.has(chId)) {
          tempMap.set(chId, []);
        }
        tempMap.get(chId)!.push(prog);
        totalProgrammes++;
      }

      // Keep only unprocessed buffer remainder
      if (lastIndex > 0) {
        buffer = buffer.slice(lastIndex);
      } else if (buffer.length > 500000) {
        // Prevent buffer from growing unbounded if no complete tag found
        const safeCut = buffer.lastIndexOf('</programme>');
        if (safeCut !== -1) {
          buffer = buffer.slice(safeCut + 12);
        }
      }
    }

    // Sort programmes by time for each channel
    for (const [chId, list] of tempMap.entries()) {
      list.sort((a, b) => a.start - b.start);
      programsByChannel.set(chId, list);
    }
    for (const [normName, chId] of tempAliases.entries()) {
      channelAliases.set(normName, chId);
    }

    lastSyncTime = Date.now();
    console.log(`[EPG Service] Successfully indexed ${totalProgrammes} real programmes for ${tempMap.size} channels!`);

    // Persist small snapshot to disk
    try {
      const diskObj: Record<string, EpgProgram[]> = {};
      for (const [k, v] of programsByChannel.entries()) {
        diskObj[k] = v;
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(diskObj), 'utf8');
    } catch (saveErr) {
      console.error('[EPG Service] Could not write cache to disk:', saveErr);
    }

    return {
      success: true,
      channelsCount: programsByChannel.size,
      message: `Загружено ${totalProgrammes} телепередач для ${programsByChannel.size} каналов`
    };
  } catch (err: any) {
    console.error('[EPG Service] Error syncing EPG:', err);
    return { success: false, channelsCount: programsByChannel.size, message: err.message || 'Ошибка загрузки EPG' };
  } finally {
    isSyncing = false;
  }
}

// Get programs for a given channel by tvgId, tvgName, or channelName
export function getChannelEpg(tvgId?: string, channelName?: string): EpgProgram[] {
  // 1. Direct match by tvgId
  if (tvgId && programsByChannel.has(tvgId)) {
    return programsByChannel.get(tvgId)!;
  }

  // 2. Direct match by channelName
  if (channelName && programsByChannel.has(channelName)) {
    return programsByChannel.get(channelName)!;
  }

  // 3. Match by normalized name alias
  if (channelName) {
    const norm = normalizeName(channelName);
    const mappedId = channelAliases.get(norm);
    if (mappedId && programsByChannel.has(mappedId)) {
      return programsByChannel.get(mappedId)!;
    }

    // Substring search in channel aliases
    for (const [aliasNorm, id] of channelAliases.entries()) {
      if (aliasNorm.includes(norm) || norm.includes(aliasNorm)) {
        if (programsByChannel.has(id)) {
          return programsByChannel.get(id)!;
        }
      }
    }
  }

  // Not found in real EPG
  return [];
}
