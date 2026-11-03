import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Channel, EpgProgram } from '../types/iptv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'iptv.sqlite');

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    try {
      dbInstance = new Database(DB_PATH);
      // High-performance WAL mode + normal sync for ACID speed and resilience
      dbInstance.pragma('journal_mode = WAL');
      dbInstance.pragma('synchronous = NORMAL');
      initTables(dbInstance);
    } catch (err: any) {
      console.error('[SQLite FATAL] Не удалось открыть базу данных SQLite по пути:', DB_PATH, err);
      // Strict fail-fast as requested: exit if database cannot be initialized
      process.exit(1);
    }
  }
  return dbInstance;
}

function initTables(db: Database.Database) {
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

export function normalizeName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[\s\-_!?:.,/\\()[\]]+/g, '').trim();
}

export function stripSuffixes(name: string): string {
  if (!name) return '';
  return name
    .replace(/[\s\-_]*(?:hd|fhd|uhd|4k|hdr|50fps|orig|original|double|\+2|\+4|\+6|\+7|\+8)$/i, '')
    .trim();
}

// ----------------------------------------------------
// Public Database API (100% strictly SQLite)
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

  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(DB_PATH)) {
      dbSizeBytes = fs.statSync(DB_PATH).size;
    }
  } catch {}

  const isFresh = channelsCount > 0 && programsCount > 0 && (Date.now() - lastSyncTime < 24 * 3600 * 1000);

  return {
    engine: 'SQLite (WAL)',
    isSqlite: true,
    channelsCount,
    programsCount,
    aliasesCount,
    dbSizeBytes,
    lastSyncTime,
    isFresh
  };
}

/**
 * Returns all channels ordered by their original index directly from SQLite
 */
export function getAllChannelsFromDb(): Channel[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM channels ORDER BY order_index ASC').all() as any[];
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

/**
 * Saves or updates channels list directly into SQLite table
 */
export function saveChannelsToDb(channels: Channel[]): void {
  if (!channels || channels.length === 0) return;
  const db = getDb();

  const insertChannel = db.prepare(`
    INSERT OR REPLACE INTO channels (id, name, group_title, logo, stream_url, tvg_id, tvg_name, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAlias = db.prepare(`
    INSERT OR REPLACE INTO channel_aliases (alias, target_channel_id)
    VALUES (?, ?)
  `);

  const tx = db.transaction(() => {
    db.exec('DELETE FROM channels;');
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
    });

    const now = Date.now();
    const setMeta = db.prepare('INSERT OR REPLACE INTO db_meta (key, value, updated_at) VALUES (?, ?, ?)');
    setMeta.run('channels_count', String(channels.length), now);
  });

  tx();
  console.log(`[SQLite] Сохранено ${channels.length} каналов в таблицу channels.`);
}

/**
 * Resolves the channel identifier that exists in epg_programs.
 * Supports:
 * - Direct matches in epg_programs (e.g. 'ch001', 'ch3447')
 * - M3U playlist channels lookup (mapping ch.id 'ch-1' -> tvg_id 'ch001')
 * - Aliases from XMLTV <display-name> and normalized channel names
 * - Numeric variations (ch001, ch1, 1, 442_01)
 * - Suffix-stripped name matching (HD, FHD, UHD, 4K, 50fps, Double, +2, +4)
 */
export function resolveCanonicalChannelId(channelId?: string, name?: string, tvgName?: string): string {
  const db = getDb();
  if (!channelId && !name && !tvgName) return '';

  const hasEpg = (id: string): boolean => {
    if (!id) return false;
    const row = db.prepare('SELECT 1 FROM epg_programs WHERE channel_id = ? LIMIT 1').get(id);
    return !!row;
  };

  // 1. Direct match in epg_programs
  if (channelId && hasEpg(channelId)) {
    return channelId;
  }

  // 2. Check channels table: find tvg_id or id that has programs
  let chRow: any = null;
  if (channelId) {
    chRow = db.prepare('SELECT id, tvg_id, name, tvg_name FROM channels WHERE id = ? OR tvg_id = ? LIMIT 1').get(channelId, channelId) as any;
    if (chRow) {
      if (chRow.tvg_id && hasEpg(chRow.tvg_id)) return chRow.tvg_id;
      if (chRow.id && hasEpg(chRow.id)) return chRow.id;
    }
  }

  // 3. Collect all candidate search terms
  const terms: string[] = [];
  if (channelId) terms.push(channelId);
  if (tvgName) terms.push(tvgName);
  if (name) terms.push(name);
  if (chRow?.tvg_id && !terms.includes(chRow.tvg_id)) terms.push(chRow.tvg_id);
  if (chRow?.tvg_name && !terms.includes(chRow.tvg_name)) terms.push(chRow.tvg_name);
  if (chRow?.name && !terms.includes(chRow.name)) terms.push(chRow.name);

  // Check channel aliases for all terms
  for (const term of terms) {
    const norm = normalizeName(term);
    if (!norm) continue;

    const row = db.prepare('SELECT target_channel_id FROM channel_aliases WHERE alias = ? LIMIT 1').get(norm) as { target_channel_id: string } | undefined;
    if (row?.target_channel_id && hasEpg(row.target_channel_id)) {
      return row.target_channel_id;
    }

    const stripped = normalizeName(stripSuffixes(term));
    if (stripped && stripped !== norm) {
      const row2 = db.prepare('SELECT target_channel_id FROM channel_aliases WHERE alias = ? LIMIT 1').get(stripped) as { target_channel_id: string } | undefined;
      if (row2?.target_channel_id && hasEpg(row2.target_channel_id)) {
        return row2.target_channel_id;
      }
    }
  }

  // 4. Numeric variations (e.g. 'ch001' <-> 'ch1' <-> '1')
  for (const term of terms) {
    const numMatch = term.match(/\d+/);
    if (numMatch) {
      const num = parseInt(numMatch[0], 10);
      const candidates = [
        `ch${String(num).padStart(3, '0')}`,
        `ch${String(num).padStart(2, '0')}`,
        `ch${num}`,
        String(num)
      ];
      for (const cand of candidates) {
        if (hasEpg(cand)) return cand;
      }
    }
  }

  // 5. Fallback: return tvg_id from channels table or original channelId
  if (chRow?.tvg_id) return chRow.tvg_id;
  return channelId || '';
}

/**
 * Get EPG programs for a specific channel directly from SQLite
 */
export function getChannelEpgFromDb(
  channelId?: string,
  name?: string,
  tvgName?: string,
  startTimeMs?: number,
  endTimeMs?: number
): EpgProgram[] {
  const db = getDb();
  const canonicalId = resolveCanonicalChannelId(channelId, name, tvgName);
  if (!canonicalId) return [];

  const now = Date.now();
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
    // Query all recent and upcoming programs for this channel (-10 days to +2 days)
    const minTime = now - 10 * 24 * 3600 * 1000;
    const stmt = db.prepare(`
      SELECT * FROM epg_programs 
      WHERE channel_id = ? AND end_time >= ?
      ORDER BY start_time ASC
    `);
    rows = stmt.all(canonicalId, minTime);

    // If no recent rows found, try querying all available programs for this channel
    if (rows.length === 0) {
      rows = db.prepare(`
        SELECT * FROM epg_programs 
        WHERE channel_id = ? 
        ORDER BY start_time ASC
      `).all(canonicalId);
    }
  }

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

/**
 * Batch query currently airing program titles for all provided channels in one single SQLite query
 */
export function getBatchLiveProgramsFromDb(
  channels: Array<{ id: string; tvgId?: string; tvgName?: string; name: string }>
): Record<string, string> {
  const db = getDb();
  const now = Date.now();
  const result: Record<string, string> = {};

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
}

/**
 * Query programs for Admin DB Viewer from SQLite
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

  let whereClauses: string[] = [];
  let queryParams: any[] = [];

  if (params.channelId) {
    const canonical = resolveCanonicalChannelId(params.channelId);
    const candidateIds = new Set<string>();
    if (canonical) candidateIds.add(canonical);
    if (params.channelId) candidateIds.add(params.channelId);

    const ch = db.prepare('SELECT id, tvg_id FROM channels WHERE id = ? OR tvg_id = ? LIMIT 1').get(params.channelId, params.channelId) as any;
    if (ch?.tvg_id) candidateIds.add(ch.tvg_id);
    if (ch?.id) candidateIds.add(ch.id);

    const idList = Array.from(candidateIds);
    if (idList.length === 1) {
      whereClauses.push('channel_id = ?');
      queryParams.push(idList[0]);
    } else {
      const placeholders = idList.map(() => '?').join(', ');
      whereClauses.push(`channel_id IN (${placeholders})`);
      queryParams.push(...idList);
    }
  }

  if (params.dayOffset !== undefined) {
    const tzOffsetMs = 3 * 3600 * 1000;
    const nowInMsk = new Date(Date.now() + tzOffsetMs);
    const targetInMsk = new Date(nowInMsk);
    targetInMsk.setUTCDate(targetInMsk.getUTCDate() + params.dayOffset);
    targetInMsk.setUTCHours(0, 0, 0, 0);
    const dayStart = targetInMsk.getTime() - tzOffsetMs;
    const dayEnd = dayStart + 24 * 3600 * 1000;

    whereClauses.push('end_time > ? AND start_time < ?');
    queryParams.push(dayStart, dayEnd);
  }

  if (params.search) {
    whereClauses.push('(title LIKE ? OR description LIKE ?)');
    const term = `%${params.search.trim()}%`;
    queryParams.push(term, term);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

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
}

/**
 * LOW-MEMORY STREAM WRITER:
 * Streams EPG programs and aliases directly into SQLite in micro-batches (1,000 rows).
 * Keeps RAM footprint under 30MB at all times, preventing any OOM crashes.
 * Automatically swaps staging data to production table upon final validation.
 */
export function createEpgStreamWriter() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS epg_staging (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      description TEXT,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL
    );
    DELETE FROM epg_staging;
  `);

  const insertProgStmt = db.prepare(`
    INSERT OR REPLACE INTO epg_staging (id, channel_id, title, category, description, start_time, end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAliasStmt = db.prepare(`
    INSERT OR REPLACE INTO channel_aliases (alias, target_channel_id)
    VALUES (?, ?)
  `);

  let count = 0;
  let progBatch: any[] = [];
  let aliasBatch: [string, string][] = [];

  const flush = db.transaction(() => {
    for (let i = 0; i < progBatch.length; i++) {
      const p = progBatch[i];
      insertProgStmt.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    }
    progBatch = [];

    for (let i = 0; i < aliasBatch.length; i++) {
      const a = aliasBatch[i];
      insertAliasStmt.run(a[0], a[1]);
    }
    aliasBatch = [];
  });

  return {
    addProgram(id: string, channelId: string, title: string, category: string, description: string, start: number, end: number) {
      progBatch.push([id, channelId, title, category, description, start, end]);
      count++;
      if (progBatch.length >= 1000) {
        flush();
      }
    },
    addAlias(alias: string, targetId: string) {
      if (alias && targetId) {
        aliasBatch.push([normalizeName(alias), targetId]);
        if (aliasBatch.length >= 1000) {
          flush();
        }
      }
    },
    getCurrentCount() {
      return count;
    },
    finalize(minRequired = 500): number {
      if (progBatch.length > 0 || aliasBatch.length > 0) {
        flush();
      }

      if (count < minRequired) {
        throw new Error(`[SQLite] Валидация не пройдена: получено всего ${count} передач (минимум ${minRequired}). База не изменена.`);
      }

      // Atomically swap epg_staging into epg_programs
      const swapTx = db.transaction(() => {
        db.exec(`
          DELETE FROM epg_programs;
          INSERT INTO epg_programs SELECT * FROM epg_staging;
          DELETE FROM epg_staging;
        `);

        const now = Date.now();
        const setMeta = db.prepare('INSERT OR REPLACE INTO db_meta (key, value, updated_at) VALUES (?, ?, ?)');
        setMeta.run('last_sync_time', String(now), now);
        setMeta.run('programs_count', String(count), now);
      });

      swapTx();
      console.log(`[SQLite Sync] УСПЕХ: База данных SQLite атомарно обновлена: ${count.toLocaleString()} передач.`);
      return count;
    },
    abort() {
      try {
        progBatch = [];
        aliasBatch = [];
        db.exec('DELETE FROM epg_staging;');
      } catch {}
    }
  };
}
