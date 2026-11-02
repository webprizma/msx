import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { Channel, EpgProgram } from '../types/iptv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const CACHE_DIR = path.resolve(__dirname, '../../iptv-cache');
const DB_PATH = path.join(CACHE_DIR, 'iptv.sqlite');

// Safe dynamic loader for better-sqlite3: Prevents service crashes if better-sqlite3 is not installed on host
let BetterSqlite3: any = null;
try {
  BetterSqlite3 = require('better-sqlite3');
} catch (e: any) {
  BetterSqlite3 = null;
  console.warn('[Database] Notice: better-sqlite3 is not available in node_modules. Using high-performance in-memory indexed engine with disk persistence.');
}

let dbInstance: any = null;

// In-memory fallback structures if better-sqlite3 is unavailable
let memChannels: Channel[] = [];
const memProgramsByChannel = new Map<string, EpgProgram[]>();
const memAliases = new Map<string, string>();
let memLastSyncTime = 0;

function getDb(): any {
  if (!BetterSqlite3) return null;
  if (!dbInstance) {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      dbInstance = new BetterSqlite3(DB_PATH);
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('synchronous = NORMAL');
      initTables(dbInstance);
    } catch (err) {
      console.warn('[Database] Notice initializing SQLite:', err);
      dbInstance = null;
    }
  }
  return dbInstance;
}

function initTables(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      group_title TEXT NOT NULL,
      logo TEXT,
      stream_url TEXT NOT NULL,
      tvg_id TEXT,
      tvg_name TEXT,
      order_index INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_channels_group ON channels(group_title);
    CREATE INDEX IF NOT EXISTS idx_channels_tvg_id ON channels(tvg_id);

    CREATE TABLE IF NOT EXISTS channel_aliases (
      alias TEXT PRIMARY KEY,
      target_channel_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS epg_programs (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      description TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_epg_lookup ON epg_programs(channel_id, start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_epg_times ON epg_programs(start_time, end_time);
    CREATE INDEX IF NOT EXISTS idx_epg_title ON epg_programs(title);

    CREATE TABLE IF NOT EXISTS db_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
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

// ----------------------------------------------------
// Public Database API
// ----------------------------------------------------

export interface DbStats {
  engine: string;
  isSqlite: boolean;
  channelsCount: number;
  programsCount: number;
  aliasesCount: number;
  dbSizeBytes: number;
  lastSyncTime: number;
  isFresh: boolean;
}

export function getDatabaseStats(): DbStats {
  const db = getDb();
  let channelsCount = 0;
  let programsCount = 0;
  let aliasesCount = 0;
  let lastSyncTime = 0;

  if (db) {
    try {
      const chRow = db.prepare('SELECT COUNT(*) as count FROM channels').get() as { count: number };
      channelsCount = chRow?.count || 0;

      const progRow = db.prepare('SELECT COUNT(*) as count FROM epg_programs').get() as { count: number };
      programsCount = progRow?.count || 0;

      const aliasRow = db.prepare('SELECT COUNT(*) as count FROM channel_aliases').get() as { count: number };
      aliasesCount = aliasRow?.count || 0;

      const metaRow = db.prepare('SELECT value FROM db_meta WHERE key = ?').get('last_sync_time') as { value: string } | undefined;
      if (metaRow?.value) {
        lastSyncTime = parseInt(metaRow.value, 10) || 0;
      }
    } catch (e) {
      console.warn('[Database] Error reading SQLite stats:', e);
    }
  } else {
    // In-memory stats
    channelsCount = memChannels.length;
    for (const list of memProgramsByChannel.values()) {
      programsCount += list.length;
    }
    aliasesCount = memAliases.size;
    lastSyncTime = memLastSyncTime;
  }

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) {
      dbSizeBytes = fs.statSync(DB_PATH).size;
    }
  } catch {}

  const isFresh = channelsCount > 0 && programsCount > 0 && (Date.now() - lastSyncTime < 24 * 3600 * 1000);

  return {
    engine: db ? 'SQLite (WAL)' : 'Indexed Memory + Disk Cache',
    isSqlite: !!db,
    channelsCount,
    programsCount,
    aliasesCount,
    dbSizeBytes,
    lastSyncTime,
    isFresh
  };
}

/**
 * Returns all channels ordered by their original index
 */
export function getAllChannelsFromDb(): Channel[] {
  const db = getDb();
  if (db) {
    try {
      const rows = db.prepare('SELECT * FROM channels ORDER BY order_index ASC').all() as any[];
      if (rows && rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          name: r.name,
          group: r.group_title,
          logo: r.logo || '',
          streamUrl: r.stream_url,
          tvgId: r.tvg_id || undefined,
          tvgName: r.tvg_name || undefined,
          catchupDays: 7
        }));
      }
    } catch (e) {
      console.error('[SQLite] Error fetching channels:', e);
    }
  }

  // Fallback to in-memory channels
  return memChannels;
}

/**
 * Resolves canonical channel ID through aliases (normalized names, tvg-id, etc.)
 */
export function resolveCanonicalChannelId(channelId?: string, name?: string, tvgName?: string): string {
  const db = getDb();
  if (!channelId && !name && !tvgName) return '';

  const checkAlias = (term: string): string | null => {
    if (!term) return null;
    const norm = normalizeName(term);

    if (db) {
      const row = db.prepare('SELECT target_channel_id FROM channel_aliases WHERE alias = ? LIMIT 1').get(norm) as { target_channel_id: string } | undefined;
      if (row?.target_channel_id) return row.target_channel_id;

      const stripped = normalizeName(stripSuffixes(term));
      if (stripped && stripped !== norm) {
        const row2 = db.prepare('SELECT target_channel_id FROM channel_aliases WHERE alias = ? LIMIT 1').get(stripped) as { target_channel_id: string } | undefined;
        if (row2?.target_channel_id) return row2.target_channel_id;
      }
    } else {
      if (memAliases.has(norm)) return memAliases.get(norm)!;
      const stripped = normalizeName(stripSuffixes(term));
      if (stripped && memAliases.has(stripped)) return memAliases.get(stripped)!;
    }
    return null;
  };

  // Direct ID check in channels table
  if (channelId) {
    if (db) {
      const directRow = db.prepare('SELECT id FROM channels WHERE id = ? OR tvg_id = ? LIMIT 1').get(channelId, channelId) as { id: string } | undefined;
      if (directRow?.id) return directRow.id;

      const directEpg = db.prepare('SELECT channel_id FROM epg_programs WHERE channel_id = ? LIMIT 1').get(channelId) as { channel_id: string } | undefined;
      if (directEpg?.channel_id) return directEpg.channel_id;
    } else {
      const direct = memChannels.find(c => c.id === channelId || c.tvgId === channelId);
      if (direct) return direct.id;
      if (memProgramsByChannel.has(channelId)) return channelId;
    }

    const aliasMatch = checkAlias(channelId);
    if (aliasMatch) return aliasMatch;
  }

  if (tvgName) {
    const aliasMatch = checkAlias(tvgName);
    if (aliasMatch) return aliasMatch;
  }

  if (name) {
    const aliasMatch = checkAlias(name);
    if (aliasMatch) return aliasMatch;
  }

  return channelId || '';
}

/**
 * Get EPG programs for a specific channel, with optional time range (e.g. for a specific day)
 */
export function getChannelEpgFromDb(
  channelId?: string,
  name?: string,
  tvgName?: string,
  startTimeMs?: number,
  endTimeMs?: number
): EpgProgram[] {
  const canonicalId = resolveCanonicalChannelId(channelId, name, tvgName);
  if (!canonicalId) return [];

  const now = Date.now();
  const db = getDb();

  if (db) {
    try {
      let rows: any[] = [];
      if (startTimeMs !== undefined && endTimeMs !== undefined) {
        // Fast index query for exact date window
        const stmt = db.prepare(`
          SELECT * FROM epg_programs 
          WHERE channel_id = ? AND end_time > ? AND start_time < ?
          ORDER BY start_time ASC
        `);
        rows = stmt.all(canonicalId, startTimeMs, endTimeMs);
      } else {
        // Query all recent and upcoming programs for this channel (-7 days to +2 days)
        const minTime = now - 7 * 24 * 3600 * 1000;
        const stmt = db.prepare(`
          SELECT * FROM epg_programs 
          WHERE channel_id = ? AND end_time >= ?
          ORDER BY start_time ASC
        `);
        rows = stmt.all(canonicalId, minTime);
      }

      if (rows && rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          channelId: r.channel_id,
          title: r.title,
          description: r.description || '',
          category: r.category || 'ТВ',
          start: r.start_time,
          end: r.end_time,
          isLive: now >= r.start_time && now < r.end_time,
          hasArchive: r.end_time <= now
        }));
      }
    } catch (e) {
      console.error('[SQLite] Error querying EPG:', e);
    }
  }

  // In-memory fallback
  const list = memProgramsByChannel.get(canonicalId) || [];
  if (startTimeMs !== undefined && endTimeMs !== undefined) {
    return list
      .filter(p => p.end > startTimeMs && p.start < endTimeMs)
      .map(p => ({
        ...p,
        isLive: now >= p.start && now < p.end,
        hasArchive: p.end <= now
      }));
  }

  return list.map(p => ({
    ...p,
    isLive: now >= p.start && now < p.end,
    hasArchive: p.end <= now
  }));
}

/**
 * Batch query currently airing program titles for all provided channels in one single lightning-fast query
 */
export function getBatchLiveProgramsFromDb(
  channels: Array<{ id: string; tvgId?: string; tvgName?: string; name: string }>
): Record<string, string> {
  const db = getDb();
  const now = Date.now();
  const result: Record<string, string> = {};

  if (db) {
    try {
      const rows = db.prepare(`
        SELECT channel_id, title 
        FROM epg_programs 
        WHERE start_time <= ? AND end_time > ?
      `).all(now, now) as Array<{ channel_id: string; title: string }>;

      const liveByCanonical = new Map<string, string>();
      for (const r of rows) {
        liveByCanonical.set(r.channel_id, r.title);
      }

      for (const ch of channels) {
        const canonical = resolveCanonicalChannelId(ch.tvgId || ch.id, ch.name, ch.tvgName);
        let title = liveByCanonical.get(canonical);

        if (!title && ch.id) title = liveByCanonical.get(ch.id);
        if (!title && ch.tvgId) title = liveByCanonical.get(ch.tvgId);

        if (title) {
          result[ch.id] = title;
          result[ch.name] = title;
          if (ch.tvgId) result[ch.tvgId] = title;
        }
      }
      return result;
    } catch (e) {
      console.error('[SQLite] Error getting batch live:', e);
    }
  }

  // Fallback in-memory batch live
  for (const ch of channels) {
    const canonical = resolveCanonicalChannelId(ch.tvgId || ch.id, ch.name, ch.tvgName);
    const list = memProgramsByChannel.get(canonical) || [];
    const live = list.find(p => p.start <= now && p.end > now);
    if (live) {
      result[ch.id] = live.title;
      result[ch.name] = live.title;
      if (ch.tvgId) result[ch.tvgId] = live.title;
    }
  }

  return result;
}

/**
 * Query programs for Admin DB Viewer:
 * - Search by channel, day, and title query
 */
export function queryDbForViewer(params: {
  channelId?: string;
  dayOffset?: number;
  search?: string;
  limit?: number;
  offset?: number;
}): { total: number; programs: any[] } {
  const db = getDb();
  const limit = Math.min(100, params.limit || 50);
  const offset = params.offset || 0;
  const now = Date.now();

  let dayStart = 0;
  let dayEnd = 0;
  if (params.dayOffset !== undefined) {
    const tzOffsetMs = 3 * 3600 * 1000;
    const nowInMsk = new Date(Date.now() + tzOffsetMs);
    const targetInMsk = new Date(nowInMsk);
    targetInMsk.setUTCDate(targetInMsk.getUTCDate() + params.dayOffset);
    targetInMsk.setUTCHours(0, 0, 0, 0);
    dayStart = targetInMsk.getTime() - tzOffsetMs;
    dayEnd = dayStart + 24 * 3600 * 1000;
  }

  if (db) {
    let whereClauses: string[] = [];
    let queryParams: any[] = [];

    if (params.channelId) {
      const canonical = resolveCanonicalChannelId(params.channelId);
      whereClauses.push('channel_id = ?');
      queryParams.push(canonical || params.channelId);
    }

    if (params.dayOffset !== undefined) {
      whereClauses.push('end_time > ? AND start_time < ?');
      queryParams.push(dayStart, dayEnd);
    }

    if (params.search) {
      whereClauses.push('(title LIKE ? OR description LIKE ?)');
      const term = `%${params.search.trim()}%`;
      queryParams.push(term, term);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    try {
      const countRow = db.prepare(`SELECT COUNT(*) as count FROM epg_programs ${whereSql}`).get(...queryParams) as { count: number };
      const total = countRow?.count || 0;

      const dataRows = db.prepare(`
        SELECT * FROM epg_programs 
        ${whereSql} 
        ORDER BY start_time ASC 
        LIMIT ? OFFSET ?
      `).all(...queryParams, limit, offset) as any[];

      const programs = dataRows.map(r => ({
        id: r.id,
        channelId: r.channel_id,
        title: r.title,
        description: r.description,
        category: r.category,
        start: r.start_time,
        end: r.end_time,
        isLive: now >= r.start_time && now < r.end_time,
        hasArchive: r.end_time <= now
      }));

      return { total, programs };
    } catch (e) {
      console.error('[SQLite] Error in queryDbForViewer:', e);
    }
  }

  // In-memory viewer query
  let matched: EpgProgram[] = [];
  const canonicalId = params.channelId ? resolveCanonicalChannelId(params.channelId) : '';
  const searchLower = params.search ? params.search.toLowerCase().trim() : '';

  for (const [chId, list] of memProgramsByChannel.entries()) {
    if (canonicalId && chId !== canonicalId) continue;
    for (const p of list) {
      if (params.dayOffset !== undefined && (p.end <= dayStart || p.start >= dayEnd)) continue;
      if (searchLower) {
        const tMatch = (p.title || '').toLowerCase().includes(searchLower);
        const dMatch = (p.description || '').toLowerCase().includes(searchLower);
        if (!tMatch && !dMatch) continue;
      }
      matched.push(p);
    }
  }

  matched.sort((a, b) => a.start - b.start);
  const total = matched.length;
  const sliced = matched.slice(offset, offset + limit).map(p => ({
    ...p,
    isLive: now >= p.start && now < p.end,
    hasArchive: p.end <= now
  }));

  return { total, programs: sliced };
}

/**
 * ATOMIC DATABASE SYNC & REPLACE:
 * Writes incoming channels and EPG into database (SQLite if available, plus in-memory mirrors).
 */
export function atomicSaveToDb(
  channels: Channel[],
  programsByChannel: Map<string, EpgProgram[]>,
  aliases: Map<string, string>
): { success: boolean; channelsCount: number; programsCount: number; message: string } {
  // Verification guard: Ensure we never overwrite good data with empty or broken download
  if (!channels || channels.length < 5) {
    throw new Error(`Валидация не пройдена: список каналов содержит всего ${channels?.length || 0} каналов (минимум 5). База данных не изменена.`);
  }

  let totalProgsToInsert = 0;
  for (const list of programsByChannel.values()) {
    totalProgsToInsert += list.length;
  }

  if (totalProgsToInsert < 500) {
    throw new Error(`Валидация не пройдена: расписание содержит всего ${totalProgsToInsert} передач (минимум 500). База данных не изменена.`);
  }

  // Update in-memory structures
  memChannels = [...channels];
  memProgramsByChannel.clear();
  for (const [k, v] of programsByChannel.entries()) {
    memProgramsByChannel.set(k, v);
  }
  memAliases.clear();
  for (const [k, v] of aliases.entries()) {
    memAliases.set(k, v);
  }
  memLastSyncTime = Date.now();

  const db = getDb();
  if (db) {
    console.log(`[SQLite Sync] Beginning atomic transaction for ${channels.length} channels and ${totalProgsToInsert} programs...`);
    const syncTx = db.transaction(() => {
      // 1. Wipe existing tables for clean daily data
      db.exec(`
        DELETE FROM channels;
        DELETE FROM channel_aliases;
        DELETE FROM epg_programs;
      `);

      // 2. Insert channels
      const insertChannel = db.prepare(`
        INSERT INTO channels (id, name, group_title, logo, stream_url, tvg_id, tvg_name, order_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      channels.forEach((ch, idx) => {
        insertChannel.run(
          ch.id,
          ch.name,
          ch.group || 'Общие',
          ch.logo || null,
          ch.streamUrl,
          ch.tvgId || null,
          ch.tvgName || null,
          idx
        );
      });

      // 3. Insert aliases
      const insertAlias = db.prepare(`
        INSERT OR REPLACE INTO channel_aliases (alias, target_channel_id)
        VALUES (?, ?)
      `);

      for (const [alias, targetId] of aliases.entries()) {
        if (alias && targetId) {
          insertAlias.run(normalizeName(alias), targetId);
        }
      }

      for (const ch of channels) {
        const target = ch.tvgId || ch.id;
        if (ch.id) insertAlias.run(normalizeName(ch.id), target);
        if (ch.tvgId) insertAlias.run(normalizeName(ch.tvgId), target);
        if (ch.name) {
          insertAlias.run(normalizeName(ch.name), target);
          const stripped = stripSuffixes(ch.name);
          if (stripped) insertAlias.run(normalizeName(stripped), target);
        }
        if (ch.tvgName) {
          insertAlias.run(normalizeName(ch.tvgName), target);
          const stripped = stripSuffixes(ch.tvgName);
          if (stripped) insertAlias.run(normalizeName(stripped), target);
        }
      }

      // 4. Insert EPG programs
      const insertProg = db.prepare(`
        INSERT OR REPLACE INTO epg_programs (id, channel_id, title, category, description, start_time, end_time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const [chId, progList] of programsByChannel.entries()) {
        for (const p of progList) {
          insertProg.run(
            p.id || `epg-${chId}-${p.start}`,
            chId,
            p.title || 'Передача',
            p.category || 'ТВ',
            p.description || '',
            p.start,
            p.end
          );
        }
      }

      // 5. Update metadata
      const setMeta = db.prepare(`
        INSERT OR REPLACE INTO db_meta (key, value, updated_at)
        VALUES (?, ?, ?)
      `);

      const now = Date.now();
      setMeta.run('last_sync_time', String(now), now);
      setMeta.run('channels_count', String(channels.length), now);
      setMeta.run('programs_count', String(totalProgsToInsert), now);
    });

    try {
      syncTx();
      console.log(`[SQLite Sync] SUCCESS! Atomically committed ${channels.length} channels and ${totalProgsToInsert} programs.`);
    } catch (err: any) {
      console.error('[SQLite Sync] Transaction failed, all changes rolled back safely:', err);
      throw err;
    }
  }

  return {
    success: true,
    channelsCount: channels.length,
    programsCount: totalProgsToInsert,
    message: `Данные успешно сохранены: ${channels.length} каналов и ${totalProgsToInsert.toLocaleString()} передач.`
  };
}

/**
 * Automatically seeds database on server startup using cached playlist and EPG files.
 */
export function seedDatabaseIfEmpty() {
  const db = getDb();
  if (db) {
    const chCountRow = db.prepare('SELECT COUNT(*) as count FROM channels').get() as { count: number };
    if (chCountRow && chCountRow.count > 0) {
      console.log(`[Database] SQLite contains ${chCountRow.count} channels. Initial seed complete.`);
      return;
    }
  }

  console.log('[Database] Seeding channels and EPG from local disk cache files...');
  try {
    const playlistFile = path.join(CACHE_DIR, 'playlist-channels.json');
    const epgGzFile = path.join(CACHE_DIR, 'epg-data.json.gz');

    let channels: Channel[] = [];
    if (fs.existsSync(playlistFile)) {
      channels = JSON.parse(fs.readFileSync(playlistFile, 'utf8'));
    }

    const programsByChannel = new Map<string, EpgProgram[]>();
    const aliases = new Map<string, string>();

    if (fs.existsSync(epgGzFile)) {
      const gzipped = fs.readFileSync(epgGzFile);
      const jsonStr = zlib.gunzipSync(gzipped).toString('utf8');
      const parsed = JSON.parse(jsonStr);

      if (parsed.aliases) {
        for (const [k, v] of Object.entries(parsed.aliases)) {
          aliases.set(k, String(v));
        }
      }

      if (parsed.channels) {
        const now = Date.now();
        for (const [chId, list] of Object.entries(parsed.channels)) {
          if (Array.isArray(list)) {
            const restored: EpgProgram[] = (list as any[]).map(([start, end, title, cat, desc]) => ({
              id: `epg-${chId}-${start}`,
              channelId: chId,
              title,
              category: cat,
              description: desc,
              start,
              end,
              isLive: now >= start && now < end,
              hasArchive: end <= now
            }));
            programsByChannel.set(chId, restored);
          }
        }
      }
    }

    if (channels.length > 0 && programsByChannel.size > 0) {
      atomicSaveToDb(channels, programsByChannel, aliases);
      console.log(`[Database] Seeded ${channels.length} channels and EPG into database successfully!`);
    }
  } catch (err) {
    console.warn('[Database] Notice during initial seed:', err);
  }
}
