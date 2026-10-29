import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import type { EpgProgram } from '../types/iptv.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../iptv-cache');
const CACHE_FILE_GZ = path.join(CACHE_DIR, 'epg-data.json.gz');

// In-memory cache for ultra-fast lookups
const programsByChannel = new Map<string, EpgProgram[]>();
const channelAliases = new Map<string, string>(); // normalized name -> tvgId
let isSyncing = false;
let lastSyncTime = 0;
let totalProgrammesCount = 0;

export function getEpgSyncStatus() {
  return {
    isSyncing,
    channelsCount: programsByChannel.size,
    totalProgrammes: totalProgrammesCount,
    lastSyncTime
  };
}

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

// Compact program array format: [start, end, title, category, description]
type CompactProgram = [number, number, string, string, string];

/**
 * Deduplicate programs: if multiple entries exist for the same time slot or overlapping same movie,
 * merge them into a single clean entry, prioritizing the one WITH description and without trailing dots.
 */
export function deduplicateEpg(programs: EpgProgram[]): EpgProgram[] {
  if (!programs || programs.length <= 1) return programs || [];

  // Sort primarily by start time ascending, then by description length descending (richer description first)
  const sorted = [...programs].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const aDescLen = (a.description || '').trim().length;
    const bDescLen = (b.description || '').trim().length;
    return bDescLen - aDescLen;
  });

  const result: EpgProgram[] = [];

  for (const prog of sorted) {
    const cleanTitle = (prog.title || 'Передача').trim().replace(/\.+$/, '');
    const cleanProg: EpgProgram = {
      ...prog,
      title: cleanTitle
    };

    if (result.length === 0) {
      result.push(cleanProg);
      continue;
    }

    const prev = result[result.length - 1];

    // Check duplicate conditions
    const sameStart = Math.abs(cleanProg.start - prev.start) < 90000; // within 1.5 minutes
    const sameEnd = Math.abs(cleanProg.end - prev.end) < 90000;
    const prevNormTitle = normalizeName(prev.title);
    const progNormTitle = normalizeName(cleanProg.title);
    const sameTitle =
      prevNormTitle === progNormTitle ||
      (prevNormTitle.length > 5 && progNormTitle.includes(prevNormTitle)) ||
      (progNormTitle.length > 5 && prevNormTitle.includes(progNormTitle));

    const isDuplicate = sameStart || (sameEnd && sameTitle) || (sameTitle && cleanProg.start < prev.end);

    if (isDuplicate) {
      const prevDesc = (prev.description || '').trim();
      const progDesc = (cleanProg.description || '').trim();

      // If new entry has richer description, prefer its description and title
      if (progDesc.length > prevDesc.length) {
        prev.description = cleanProg.description;
        prev.title = cleanProg.title;
      }

      // Upgrade category if current is generic 'ТВ'
      if ((!prev.category || prev.category === 'ТВ') && cleanProg.category && cleanProg.category !== 'ТВ') {
        prev.category = cleanProg.category;
      }

      // Span full duration
      prev.start = Math.min(prev.start, cleanProg.start);
      prev.end = Math.max(prev.end, cleanProg.end);
      const now = Date.now();
      prev.isLive = now >= prev.start && now < prev.end;
      prev.hasArchive = prev.end <= now;
    } else {
      result.push(cleanProg);
    }
  }

  return result;
}

// Initialize cache from disk (fast gzipped snapshot, ~4MB instead of 230MB)
export function initEpgCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    if (fs.existsSync(CACHE_FILE_GZ)) {
      const gzipped = fs.readFileSync(CACHE_FILE_GZ);
      const jsonStr = zlib.gunzipSync(gzipped).toString('utf8');
      const parsed = JSON.parse(jsonStr);

      if (parsed && typeof parsed === 'object') {
        const now = Date.now();
        let count = 0;

        if (parsed.aliases && typeof parsed.aliases === 'object') {
          for (const [k, v] of Object.entries(parsed.aliases)) {
            channelAliases.set(k, String(v));
          }
        }

        if (parsed.channels && typeof parsed.channels === 'object') {
          for (const [chId, rawList] of Object.entries(parsed.channels)) {
            if (Array.isArray(rawList)) {
              const restored: EpgProgram[] = (rawList as CompactProgram[]).map(([start, end, title, cat, desc]) => ({
                id: `epg-${chId}-${start}`,
                channelId: chId,
                title,
                description: desc,
                category: cat,
                start,
                end,
                isLive: now >= start && now < end,
                hasArchive: end <= now
              }));
              const deduped = deduplicateEpg(restored);
              programsByChannel.set(chId, deduped);
              count += deduped.length;
            }
          }
        }

        totalProgrammesCount = count;
        console.log(`[EPG Service] Loaded ${count} programs for ${programsByChannel.size} channels from gzipped cache.`);
      }
    }
  } catch (e) {
    console.warn('[EPG Service] Notice loading disk cache:', e);
  }
}

// Background sync from XMLTV URL (e.g. https://rus.epg.team/7.1.xml?pkg=442)
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
      signal: AbortSignal.timeout(90000)
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to fetch EPG: HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const tempMap = new Map<string, EpgProgram[]>();
    let totalProgrammes = 0;
    let lastFlushTime = Date.now();

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
        channelAliases.set(normalizeName(chName), chId);
      }

      // 2. Extract programmes <programme ...> ... </programme>
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
        const rawDesc = decodeXmlEntities(descMatch ? descMatch[1].trim() : '');
        const desc = rawDesc.length > 200 ? rawDesc.slice(0, 200) + '...' : rawDesc;
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

      // Incrementally flush parsed channels to main map every 1s so early channels (ch001, ch002...)
      // become immediately available without waiting for full download!
      if (Date.now() - lastFlushTime > 1000) {
        for (const [chId, list] of tempMap.entries()) {
          programsByChannel.set(chId, list);
        }
        totalProgrammesCount = totalProgrammes;
        lastFlushTime = Date.now();
      }

      // Retain unparsed chunk remainder
      if (lastIndex > 0) {
        buffer = buffer.slice(lastIndex);
      } else if (buffer.length > 400000) {
        const safeCut = buffer.lastIndexOf('</programme>');
        if (safeCut !== -1) {
          buffer = buffer.slice(safeCut + 12);
        }
      }
    }

    // Sort programmes by start time and deduplicate for all channels
    for (const [chId, list] of tempMap.entries()) {
      const deduped = deduplicateEpg(list);
      programsByChannel.set(chId, deduped);
    }

    lastSyncTime = Date.now();
    totalProgrammesCount = totalProgrammes;
    console.log(`[EPG Service] Successfully indexed ${totalProgrammes} programmes for ${tempMap.size} channels!`);

    // Asynchronously save compact gzipped snapshot to disk (~4MB)
    try {
      const compactChannels: Record<string, CompactProgram[]> = {};
      for (const [k, progs] of programsByChannel.entries()) {
        compactChannels[k] = progs.map(p => [p.start, p.end, p.title || '', p.category || '', p.description || '']);
      }

      const snapshot = {
        aliases: Object.fromEntries(channelAliases),
        channels: compactChannels
      };

      const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
      fs.promises.writeFile(CACHE_FILE_GZ, compressed).catch(err => {
        console.warn('[EPG Service] Could not write compressed cache:', err);
      });
    } catch (saveErr) {
      console.warn('[EPG Service] Could not prepare compressed cache:', saveErr);
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

// Helper to return deduplicated program list
function resolveAndDedupe(list?: EpgProgram[]): EpgProgram[] {
  if (!list || list.length === 0) return [];
  return deduplicateEpg(list);
}

// Ultra-smart channel lookup supporting tvgId (ch001, ch1, 1), name, aliases, stripped suffixes
export function getChannelEpg(tvgId?: string, channelName?: string): EpgProgram[] {
  // 1. Direct match by tvgId
  if (tvgId) {
    if (programsByChannel.has(tvgId)) {
      return resolveAndDedupe(programsByChannel.get(tvgId));
    }
    const lowerId = tvgId.toLowerCase();
    if (programsByChannel.has(lowerId)) {
      return resolveAndDedupe(programsByChannel.get(lowerId));
    }

    // Numeric variations: ch001, ch01, ch1
    const numMatch = tvgId.match(/\d+/);
    if (numMatch) {
      const num = parseInt(numMatch[0], 10);
      const padded3 = `ch${String(num).padStart(3, '0')}`;
      const padded2 = `ch${String(num).padStart(2, '0')}`;
      const unpadded = `ch${num}`;
      if (programsByChannel.has(padded3)) return resolveAndDedupe(programsByChannel.get(padded3));
      if (programsByChannel.has(padded2)) return resolveAndDedupe(programsByChannel.get(padded2));
      if (programsByChannel.has(unpadded)) return resolveAndDedupe(programsByChannel.get(unpadded));
    }
  }

  // 2. Direct match by channelName
  if (channelName && programsByChannel.has(channelName)) {
    return resolveAndDedupe(programsByChannel.get(channelName));
  }

  // 3. Match by normalized name alias
  if (channelName) {
    const norm = normalizeName(channelName);
    const mappedId = channelAliases.get(norm);
    if (mappedId && programsByChannel.has(mappedId)) {
      return resolveAndDedupe(programsByChannel.get(mappedId));
    }

    // Strip common suffixes (HD, FHD, Double, +2, +4, +6) for fallback
    const stripped = norm.replace(/(hd|fhd|double|\+2|\+4|\+6)$/, '');
    if (stripped && stripped !== norm) {
      const fallbackId = channelAliases.get(stripped);
      if (fallbackId && programsByChannel.has(fallbackId)) {
        return resolveAndDedupe(programsByChannel.get(fallbackId));
      }
    }

    // Substring search in channel aliases
    for (const [aliasNorm, id] of channelAliases.entries()) {
      if (aliasNorm === norm || (norm.length > 4 && aliasNorm.includes(norm)) || (aliasNorm.length > 4 && norm.includes(aliasNorm))) {
        if (programsByChannel.has(id)) {
          return resolveAndDedupe(programsByChannel.get(id));
        }
      }
    }
  }

  return [];
}
