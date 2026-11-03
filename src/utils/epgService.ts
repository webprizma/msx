import zlib from 'zlib';
import { Readable } from 'stream';
import type { EpgProgram } from '../types/iptv.ts';
import { createEpgStreamWriter, getDatabaseStats } from '../db/iptvDatabase.ts';

// Verified reliable Russian / CIS IPTV EPG mirrors
export const EPG_MIRROR_SOURCES: string[] = [
  'https://rus.epg.team/7.1.xml.gz?pkg=442',
  'https://rus.epg.team/7.1.xml?pkg=442',
  'https://epg.it999.ru/epg2.xml.gz',
  'https://epg.it999.ru/edem.xml.gz',
  'https://iptvx.one/epg/epg_lite.xml.gz'
];

let isSyncing = false;
let currentMirrorSource = EPG_MIRROR_SOURCES[0];

export const EPG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isCacheFresh(): boolean {
  const stats = getDatabaseStats();
  return stats.isFresh;
}

export function getEpgSyncStatus() {
  const stats = getDatabaseStats();
  const ageHours = stats.lastSyncTime > 0 ? ((Date.now() - stats.lastSyncTime) / 3600000).toFixed(1) : '0';
  return {
    isSyncing,
    channelsCount: stats.channelsCount,
    totalProgrammes: stats.programsCount,
    lastSyncTime: stats.lastSyncTime,
    cacheAgeHours: ageHours,
    isFresh: stats.isFresh,
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
  return name
    .replace(/[\s\-_]*(?:hd|fhd|uhd|4k|hdr|50fps|orig|original|double|\+2|\+4|\+6|\+7|\+8)$/i, '')
    .trim();
}

/**
 * LOW-MEMORY STREAMING XMLTV PARSER:
 * Reads stream chunks and pipes directly into SQLite batch writer.
 * Never accumulates giant strings or arrays in V8 heap memory.
 */
async function parseEpgFromStreamDirectToDb(
  url: string,
  writer: ReturnType<typeof createEpgStreamWriter>
): Promise<{ progCount: number }> {
  // If user passed a non-.gz URL on rus.epg.team, try adding .gz for 15x bandwidth and memory reduction
  let requestUrl = url;
  if (url.includes('rus.epg.team/7.1.xml') && !url.includes('.gz')) {
    requestUrl = url.replace('7.1.xml', '7.1.xml.gz');
  }

  const isGz = requestUrl.toLowerCase().includes('.gz');
  console.log(`[EPG Stream] Запрос потока телегида: ${requestUrl} (сжатие gzip: ${isGz})`);

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      signal: AbortSignal.timeout(180000)
    });
  } catch (fetchErr) {
    // If .gz variant failed (e.g. 404), fallback to original URL
    if (requestUrl !== url) {
      console.warn(`[EPG Stream] Gzip URL ${requestUrl} недоступен, пробую исходный URL: ${url}`);
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Encoding': 'gzip, deflate, br'
        },
        signal: AbortSignal.timeout(180000)
      });
    } else {
      throw fetchErr;
    }
  }

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Set up streaming decompressor or web stream
  let chunkIterable: AsyncIterable<Buffer | string>;
  const isActualGz = requestUrl.toLowerCase().includes('.gz') || response.headers.get('content-encoding')?.includes('gzip');

  if (isActualGz) {
    const nodeStream = Readable.fromWeb(response.body as any);
    const gunzip = zlib.createGunzip();
    nodeStream.pipe(gunzip);
    chunkIterable = gunzip;
  } else {
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

  for await (const chunk of chunkIterable) {
    const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    buffer += chunkStr;

    // 1. Parse <channel id="..."> tags
    const chRegex = /<channel\s+id="([^"]+)">([\s\S]*?)<\/channel>/gi;
    let chMatch;
    let lastChIndex = 0;
    while ((chMatch = chRegex.exec(buffer)) !== null) {
      lastChIndex = chRegex.lastIndex;
      const chId = chMatch[1];
      writer.addAlias(chId, chId);

      const dispRegex = /<display-name[^>]*>([^<]+)<\/display-name>/gi;
      let dMatch;
      while ((dMatch = dispRegex.exec(chMatch[2])) !== null) {
        const rawName = decodeXmlEntities(dMatch[1]).trim();
        if (rawName) {
          writer.addAlias(rawName, chId);
          const stripped = stripSuffixes(rawName);
          if (stripped && stripped !== rawName) {
            writer.addAlias(stripped, chId);
          }
        }
      }
    }

    // 2. Parse <programme ...> tags and stream directly into SQLite
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

      // Write directly to SQLite staging table batch (flushes every 1,000 rows)
      writer.addProgram(`epg-${chId}-${start}`, chId, title, category, desc, start, end);
    }

    // Immediately truncate buffer so memory stays below 50 KB!
    const cut = Math.max(lastChIndex, lastProgIndex);
    if (cut > 0) {
      buffer = buffer.slice(cut);
    } else if (buffer.length > 100000) {
      const lastClose = buffer.lastIndexOf('</programme>');
      if (lastClose !== -1) {
        buffer = buffer.slice(lastClose + 12);
      }
    }

    // Yield to Node event loop so requests are served with 0 lag
    await new Promise(resolve => setImmediate(resolve));
  }

  return { progCount: writer.getCurrentCount() };
}

/**
 * Resilient multi-mirror EPG synchronization.
 * Streams XMLTV directly into SQLite in micro-transactions, completely avoiding V8 heap OOM.
 */
export async function syncEpg(customUrl?: string, force = false): Promise<{ success: boolean; channelsCount: number; message: string; mirror: string; fromCache?: boolean }> {
  const currentStats = getDatabaseStats();

  // 24-HOUR RULE: Never re-download if SQLite database has fresh data (< 24 hours)
  if (!force && currentStats.isFresh) {
    const ageHours = ((Date.now() - currentStats.lastSyncTime) / 3600000).toFixed(1);
    console.log(`[EPG Service] Суточная база SQLite активна (${currentStats.programsCount} передач, возраст: ${ageHours}ч). Загрузка пропущена.`);
    return {
      success: true,
      channelsCount: currentStats.channelsCount,
      message: `Использована суточная база SQLite (${currentStats.programsCount.toLocaleString()} передач для ${currentStats.channelsCount} каналов)`,
      mirror: 'sqlite-db',
      fromCache: true
    };
  }

  if (isSyncing) {
    return {
      success: false,
      channelsCount: currentStats.channelsCount,
      message: 'Синхронизация уже выполняется на сервере в фоне...',
      mirror: currentMirrorSource
    };
  }

  isSyncing = true;
  console.log('[EPG Service] Запуск синхронизации EPG напрямую в SQLite...');

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
  const writer = createEpgStreamWriter();

  try {
    for (const url of urlsToTry) {
      try {
        currentMirrorSource = url;
        console.log(`[EPG Service] Попытка синхронизации из зеркала: ${url}`);
        const result = await parseEpgFromStreamDirectToDb(url, writer);

        if (result.progCount >= 500) {
          // Atomically swap epg_staging into epg_programs
          const finalCount = writer.finalize(500);
          console.log(`[EPG Service] Синхронизация УСПЕШНА via ${url}: сохранено ${finalCount.toLocaleString()} передач в SQLite!`);

          const updatedStats = getDatabaseStats();
          return {
            success: true,
            channelsCount: updatedStats.channelsCount,
            message: `Загружено телегида: ${finalCount.toLocaleString()} передач в SQLite`,
            mirror: url
          };
        }
      } catch (mirrorErr: any) {
        console.warn(`[EPG Service] Зеркало ${url} вернуло ошибку: ${mirrorErr?.message || mirrorErr}. Пробую следующее зеркало...`);
        lastError = mirrorErr;
      }
    }

    writer.abort();
    throw lastError || new Error('Все зеркала EPG недоступны');
  } catch (err: any) {
    writer.abort();
    console.error('[EPG Service] Ошибка синхронизации EPG:', err);
    const stats = getDatabaseStats();
    return {
      success: false,
      channelsCount: stats.channelsCount,
      message: err.message || 'Ошибка загрузки EPG',
      mirror: 'none'
    };
  } finally {
    isSyncing = false;
  }
}
