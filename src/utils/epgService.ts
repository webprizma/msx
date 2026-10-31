import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import type { EpgProgram } from '../types/iptv.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../iptv-cache');
const CACHE_FILE_GZ = path.join(CACHE_DIR, 'epg-data.json.gz');

// Verified reliable Russian / CIS IPTV EPG mirrors
export const EPG_MIRROR_SOURCES: string[] = [
  'https://rus.epg.team/7.1.xml?pkg=442',
  'https://epg.it999.ru/epg2.xml.gz',
  'https://epg.it999.ru/edem.xml.gz',
  'https://iptvx.one/epg/epg_lite.xml.gz',
  'http://programtv.ru/xmltv.xml.gz'
];

// In-memory cache for ultra-fast lookups
const programsByChannel = new Map<string, EpgProgram[]>();
const channelAliases = new Map<string, string>(); // normalized name -> tvgId
let isSyncing = false;
let lastSyncTime = 0;
let totalProgrammesCount = 0;
let currentMirrorSource = EPG_MIRROR_SOURCES[0];

export function getEpgSyncStatus() {
  return {
    isSyncing,
    channelsCount: programsByChannel.size,
    totalProgrammes: totalProgrammesCount,
    lastSyncTime,
    currentMirror: currentMirrorSource,
    mirrorsAvailable: EPG_MIRROR_SOURCES.length
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
  if (!name) return '';
  return name.toLowerCase().replace(/[\s\-_!?:.,/\\()[\]]+/g, '').trim();
}

function stripSuffixes(name: string): string {
  if (!name) return '';
  // Strip HD, FHD, UHD, 4K, HDR, 50fps, double, timezone shifts (+2, +4, etc.)
  return name
    .replace(/[\s\-_]*(?:hd|fhd|uhd|4k|hdr|50fps|orig|original|double|\+2|\+4|\+6|\+7|\+8)$/i, '')
    .trim();
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
        lastSyncTime = parsed.timestamp || Date.now();
        console.log(`[EPG Service] Loaded durable cache with ${count} programs for ${programsByChannel.size} channels.`);
      }
    }
  } catch (e) {
    console.warn('[EPG Service] Notice loading disk cache:', e);
  }
}

// Asynchronously save compact gzipped snapshot to disk (~4MB)
async function persistDurableCache() {
  try {
    const compactChannels: Record<string, CompactProgram[]> = {};
    for (const [k, progs] of programsByChannel.entries()) {
      compactChannels[k] = progs.map(p => [p.start, p.end, p.title || '', p.category || '', p.description || '']);
    }

    const snapshot = {
      timestamp: Date.now(),
      aliases: Object.fromEntries(channelAliases),
      channels: compactChannels
    };

    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot), 'utf8'));
    await fs.promises.writeFile(CACHE_FILE_GZ, compressed);
    console.log(`[EPG Service] Successfully persisted durable cache (${(compressed.length / 1024 / 1024).toFixed(2)} MB)`);
  } catch (saveErr) {
    console.warn('[EPG Service] Could not persist compressed cache:', saveErr);
  }
}

/**
 * Streams and parses XMLTV data from a single URL (supports both plain XML and GZIP).
 */
async function parseEpgFromStream(url: string): Promise<{ channelCount: number; progCount: number }> {
  const isGz = url.toLowerCase().includes('.gz');
  console.log(`[EPG Service] Fetching stream from: ${url} (gzipped: ${isGz})`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Encoding': 'gzip, deflate, br'
    },
    signal: AbortSignal.timeout(120000)
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Set up chunk reader: if gzipped, decompress on-the-fly with node zlib
  let chunkIterable: AsyncIterable<Buffer | string>;
  if (isGz) {
    const nodeStream = Readable.fromWeb(response.body as any);
    const gunzip = zlib.createGunzip();
    nodeStream.pipe(gunzip);
    chunkIterable = gunzip;
  } else {
    // Plain web stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    chunkIterable = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            const { done, value } = await reader.read();
            if (done) return { done: true, value: undefined };
            return { done: false, value: decoder.decode(value, { stream: true }) };
          }
        };
      }
    };
  }

  let buffer = '';
  const tempMap = new Map<string, EpgProgram[]>();
  let totalProgrammes = 0;
  let lastFlushTime = Date.now();

  for await (const chunk of chunkIterable) {
    const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    buffer += chunkStr;

    // 1. Extract channels and ALL their <display-name> aliases
    const chBlockRegex = /<channel\s+id="([^"]+)">([\s\S]*?)<\/channel>/gi;
    let chMatch;
    let lastChIndex = 0;
    while ((chMatch = chBlockRegex.exec(buffer)) !== null) {
      lastChIndex = chBlockRegex.lastIndex;
      const chId = chMatch[1];
      const inner = chMatch[2];

      // Index direct chId normalized
      channelAliases.set(normalizeName(chId), chId);

      const dispRegex = /<display-name[^>]*>([^<]+)<\/display-name>/gi;
      let dMatch;
      while ((dMatch = dispRegex.exec(inner)) !== null) {
        const rawName = decodeXmlEntities(dMatch[1]).trim();
        if (rawName) {
          channelAliases.set(normalizeName(rawName), chId);
          const stripped = stripSuffixes(rawName);
          if (stripped && stripped !== rawName) {
            channelAliases.set(normalizeName(stripped), chId);
          }
        }
      }
    }

    // 2. Extract programmes <programme ...> ... </programme>
    const progRegex = /<programme\s+([^>]+)>([\s\S]*?)<\/programme>/gi;
    let progMatch;
    let lastProgIndex = 0;

    while ((progMatch = progRegex.exec(buffer)) !== null) {
      lastProgIndex = progRegex.lastIndex;
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
      const desc = rawDesc.length > 250 ? rawDesc.slice(0, 250) + '...' : rawDesc;
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

    // Progressively merge early channels into main memory so they become immediately queryable
    if (Date.now() - lastFlushTime > 1500) {
      for (const [chId, list] of tempMap.entries()) {
        const existing = programsByChannel.get(chId) || [];
        const merged = deduplicateEpg([...existing, ...list]);
        programsByChannel.set(chId, merged);
      }
      totalProgrammesCount = totalProgrammes;
      lastFlushTime = Date.now();
    }

    // Cut parsed buffer safely to keep memory low
    const safeCut = Math.max(lastChIndex, lastProgIndex);
    if (safeCut > 0) {
      buffer = buffer.slice(safeCut);
    } else if (buffer.length > 300000) {
      const lastProgClose = buffer.lastIndexOf('</programme>');
      if (lastProgClose !== -1) {
        buffer = buffer.slice(lastProgClose + 12);
      }
    }
  }

  // Final merge & deduplication
  for (const [chId, list] of tempMap.entries()) {
    const existing = programsByChannel.get(chId) || [];
    const merged = deduplicateEpg([...existing, ...list]);
    programsByChannel.set(chId, merged);
  }

  return { channelCount: tempMap.size, progCount: totalProgrammes };
}

/**
 * Resilient multi-mirror EPG synchronization.
 * If the primary URL fails or provides no programs, it automatically fails over to backup mirrors.
 */
export async function syncEpg(customUrl?: string): Promise<{ success: boolean; channelsCount: number; message: string; mirror: string }> {
  if (isSyncing) {
    return {
      success: false,
      channelsCount: programsByChannel.size,
      message: 'Синхронизация уже выполняется...',
      mirror: currentMirrorSource
    };
  }

  isSyncing = true;
  console.log(`[EPG Service] Starting EPG synchronization with resilient mirrors...`);

  const urlsToTry: string[] = [];
  if (customUrl && !urlsToTry.includes(customUrl)) {
    urlsToTry.push(customUrl);
  }
  for (const m of EPG_MIRROR_SOURCES) {
    if (!urlsToTry.includes(m)) {
      urlsToTry.push(m);
    }
  }

  let lastError: Error | null = null;
  let successMirror = '';

  try {
    for (const url of urlsToTry) {
      try {
        currentMirrorSource = url;
        console.log(`[EPG Service] Attempting sync from mirror: ${url}`);
        const result = await parseEpgFromStream(url);

        if (result.progCount > 0 || programsByChannel.size > 0) {
          successMirror = url;
          lastSyncTime = Date.now();
          totalProgrammesCount = Array.from(programsByChannel.values()).reduce((acc, p) => acc + p.length, 0);
          console.log(`[EPG Service] Sync SUCCESS via ${url}: indexed ${totalProgrammesCount} programmes across ${programsByChannel.size} channels!`);

          // Persist durable cache
          await persistDurableCache();

          return {
            success: true,
            channelsCount: programsByChannel.size,
            message: `Загружено телегида: ${totalProgrammesCount} передач для ${programsByChannel.size} каналов`,
            mirror: url
          };
        }
      } catch (mirrorErr: any) {
        console.warn(`[EPG Service] Mirror ${url} failed: ${mirrorErr?.message || mirrorErr}. Trying next mirror...`);
        lastError = mirrorErr;
      }
    }

    // If all online mirrors failed, but we still have durable cache in memory:
    if (programsByChannel.size > 0) {
      return {
        success: true,
        channelsCount: programsByChannel.size,
        message: `Использован долговечный локальный кэш (${programsByChannel.size} каналов)`,
        mirror: 'local-durable-cache'
      };
    }

    throw lastError || new Error('Все зеркала EPG недоступны');
  } catch (err: any) {
    console.error('[EPG Service] Final error syncing EPG across all mirrors:', err);
    return {
      success: false,
      channelsCount: programsByChannel.size,
      message: err.message || 'Ошибка загрузки EPG',
      mirror: 'none'
    };
  } finally {
    isSyncing = false;
  }
}

// Helper to return deduplicated program list
function resolveAndDedupe(list?: EpgProgram[]): EpgProgram[] {
  if (!list || list.length === 0) return [];
  return deduplicateEpg(list);
}

/**
 * Ultra-smart channel lookup supporting:
 * - Direct tvgId (ch001, ch1, 1, 442_01, etc.)
 * - Direct channelName & tvgName
 * - Normalized names & stripped suffixes (HD, FHD, UHD, 4K, HDR, 50fps)
 * - Channel aliases extracted from all <display-name> tags
 */
export function getChannelEpg(tvgId?: string, channelName?: string, tvgName?: string): EpgProgram[] {
  // 1. Direct match by tvgId
  if (tvgId) {
    if (programsByChannel.has(tvgId)) {
      return resolveAndDedupe(programsByChannel.get(tvgId));
    }
    const lowerId = tvgId.toLowerCase();
    if (programsByChannel.has(lowerId)) {
      return resolveAndDedupe(programsByChannel.get(lowerId));
    }

    // Check alias by normalized tvgId
    const aliasByTvgId = channelAliases.get(normalizeName(tvgId));
    if (aliasByTvgId && programsByChannel.has(aliasByTvgId)) {
      return resolveAndDedupe(programsByChannel.get(aliasByTvgId));
    }

    // Numeric variations: ch001, ch01, ch1, 1
    const numMatch = tvgId.match(/\d+/);
    if (numMatch) {
      const num = parseInt(numMatch[0], 10);
      const padded3 = `ch${String(num).padStart(3, '0')}`;
      const padded2 = `ch${String(num).padStart(2, '0')}`;
      const unpadded = `ch${num}`;
      const bareNum = String(num);
      if (programsByChannel.has(padded3)) return resolveAndDedupe(programsByChannel.get(padded3));
      if (programsByChannel.has(padded2)) return resolveAndDedupe(programsByChannel.get(padded2));
      if (programsByChannel.has(unpadded)) return resolveAndDedupe(programsByChannel.get(unpadded));
      if (programsByChannel.has(bareNum)) return resolveAndDedupe(programsByChannel.get(bareNum));
    }
  }

  // 2. Direct match by tvgName
  if (tvgName) {
    if (programsByChannel.has(tvgName)) {
      return resolveAndDedupe(programsByChannel.get(tvgName));
    }
    const normTvgName = normalizeName(tvgName);
    const aliasId = channelAliases.get(normTvgName);
    if (aliasId && programsByChannel.has(aliasId)) {
      return resolveAndDedupe(programsByChannel.get(aliasId));
    }
    const strippedTvgName = normalizeName(stripSuffixes(tvgName));
    const strippedAliasId = channelAliases.get(strippedTvgName);
    if (strippedAliasId && programsByChannel.has(strippedAliasId)) {
      return resolveAndDedupe(programsByChannel.get(strippedAliasId));
    }
  }

  // 3. Match by channelName
  if (channelName) {
    if (programsByChannel.has(channelName)) {
      return resolveAndDedupe(programsByChannel.get(channelName));
    }

    const norm = normalizeName(channelName);
    const mappedId = channelAliases.get(norm);
    if (mappedId && programsByChannel.has(mappedId)) {
      return resolveAndDedupe(programsByChannel.get(mappedId));
    }

    // Strip common suffixes (HD, FHD, UHD, HDR, 4K, Double, +2, +4, +6)
    const strippedNorm = normalizeName(stripSuffixes(channelName));
    if (strippedNorm && strippedNorm !== norm) {
      const fallbackId = channelAliases.get(strippedNorm);
      if (fallbackId && programsByChannel.has(fallbackId)) {
        return resolveAndDedupe(programsByChannel.get(fallbackId));
      }
    }

    // Substring / fuzzy match across all registered aliases
    for (const [aliasNorm, id] of channelAliases.entries()) {
      if (
        aliasNorm === norm ||
        aliasNorm === strippedNorm ||
        (norm.length > 4 && aliasNorm.includes(norm)) ||
        (aliasNorm.length > 4 && norm.includes(aliasNorm))
      ) {
        if (programsByChannel.has(id)) {
          return resolveAndDedupe(programsByChannel.get(id));
        }
      }
    }
  }

  return [];
}
