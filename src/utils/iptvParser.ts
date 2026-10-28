import { Channel, EpgProgram } from '../types/iptv';

export function parseM3uPlaylist(content: string, defaultCatchupDays = 7): Channel[] {
  const lines = content.split('\n');
  const channels: Channel[] = [];
  let currentChannel: Partial<Channel> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXTINF:')) {
      currentChannel = {};

      // Parse attributes using regex
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const catchupMatch = line.match(/catchup="([^"]*)"/i);
      const catchupDaysMatch = line.match(/catchup-days="([^"]*)"/i);
      const catchupSourceMatch = line.match(/catchup-source="([^"]*)"/i);

      // Extract channel title after last comma
      const lastCommaIdx = line.lastIndexOf(',');
      const title = lastCommaIdx !== -1 ? line.substring(lastCommaIdx + 1).trim() : 'Без названия';

      currentChannel.id = `ch-${channels.length + 1}-${Date.now()}`;
      currentChannel.name = title || tvgNameMatch?.[1] || 'Канал';
      currentChannel.logo = tvgLogoMatch?.[1] || '';
      currentChannel.group = groupMatch?.[1] || 'Общие';
      currentChannel.tvgId = tvgIdMatch?.[1] || tvgNameMatch?.[1] || title;
      currentChannel.catchupDays = catchupDaysMatch ? parseInt(catchupDaysMatch[1], 10) : defaultCatchupDays;
      currentChannel.catchupSource = catchupSourceMatch?.[1];
      currentChannel.catchupType = catchupMatch?.[1] || 'shift';
    } else if (line.length > 0 && !line.startsWith('#') && currentChannel) {
      currentChannel.streamUrl = line;
      if (currentChannel.name && currentChannel.streamUrl) {
        channels.push(currentChannel as Channel);
      }
      currentChannel = null;
    }
  }

  return channels;
}

export function buildArchiveStreamUrl(channel: Channel, program: EpgProgram): string {
  const startSec = Math.floor(program.start / 1000);
  const endSec = Math.floor(program.end / 1000);
  const durationSec = endSec - startSec;

  if (channel.catchupSource) {
    let source = channel.catchupSource;
    source = source.replace('{utc}', String(startSec));
    source = source.replace('{lutc}', String(endSec));
    source = source.replace('{duration}', String(durationSec));
    source = source.replace('{offset}', String(startSec));

    if (source.startsWith('http')) {
      return source;
    }
    const separator = channel.streamUrl.includes('?') ? '&' : '?';
    return `${channel.streamUrl}${separator}${source.replace(/^\?/, '')}`;
  }

  // Default provider catchup format (iLook / Edem / Flussonic / standard HLS shift)
  const sep = channel.streamUrl.includes('?') ? '&' : '?';
  return `${channel.streamUrl}${sep}utc=${startSec}&lutc=${endSec}`;
}

// Helper: Build stream URL for an exact seek timestamp
export function buildTimestampArchiveUrl(channel: Channel, timestampSec: number, endTimestampSec?: number): string {
  const endSec = endTimestampSec || (timestampSec + 3600);
  const durationSec = Math.max(60, endSec - timestampSec);

  if (channel.catchupSource) {
    let source = channel.catchupSource;
    source = source.replace('{utc}', String(timestampSec));
    source = source.replace('{lutc}', String(endSec));
    source = source.replace('{duration}', String(durationSec));
    source = source.replace('{offset}', String(timestampSec));

    if (source.startsWith('http')) {
      return source;
    }
    const separator = channel.streamUrl.includes('?') ? '&' : '?';
    return `${channel.streamUrl}${separator}${source.replace(/^\?/, '')}`;
  }

  const sep = channel.streamUrl.includes('?') ? '&' : '?';
  return `${channel.streamUrl}${sep}utc=${timestampSec}&lutc=${endSec}`;
}

// Find program in schedule matching a given timestamp
export function findProgramForTimestamp(epgList: EpgProgram[], timestamp: number): EpgProgram | null {
  if (!epgList || epgList.length === 0) return null;
  const match = epgList.find(p => timestamp >= p.start && timestamp < p.end);
  if (match) return match;
  if (timestamp < epgList[0].start) return epgList[0];
  return epgList[epgList.length - 1];
}

// Generates an authentic 7-day TV program schedule tailored to each channel's name and genre
export function generateSample7DayEpg(channel: Channel): EpgProgram[] {
  const programs: EpgProgram[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Simple string hash for channel-specific variance
  let hash = 0;
  const str = `${channel.id}-${channel.name}-${channel.group}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  const seed = Math.abs(hash);

  const lowerName = channel.name.toLowerCase();
  const lowerGroup = (channel.group || '').toLowerCase();

  // Genre specific templates
  let templates: { title: string; duration: number; desc: string; category?: string }[] = [];

  if (lowerGroup.includes('кино') || lowerName.includes('кино') || lowerName.includes('фильм') || lowerName.includes('cinema')) {
    templates = [
      { title: 'Художественный фильм: Престиж', duration: 130, desc: 'Два иллюзиониста начинают смертельную войну за секрет непревзойденного трюка.', category: 'Триллер' },
      { title: 'Боевик: Джон Уик', duration: 105, desc: 'Бывший наемный убийца возвращается в дело, чтобы отомстить мафии.', category: 'Боевик' },
      { title: 'Фантастика: Интерстеллар', duration: 169, desc: 'Команда исследователей отправляется сквозь червоточину в поисках нового дома для человечества.', category: 'Фантастика' },
      { title: 'Драма: Зеленая миля', duration: 180, desc: 'История начальника блока смертников и необычного заключенного, наделенного даром исцеления.', category: 'Драма' },
      { title: 'Комедия: 1+1 (Неприкасаемые)', duration: 112, desc: 'Аристократ, прикованный к инвалидному креслу, нанимает парня, только что освободившегося из тюрьмы.', category: 'Комедия' },
      { title: 'Детектив: Достать ножи', duration: 130, desc: 'Частный сыщик расследует загадочную смерть известного писателя в кругу его корыстной семьи.', category: 'Детектив' }
    ];
  } else if (lowerGroup.includes('спорт') || lowerName.includes('матч') || lowerName.includes('спорт') || lowerName.includes('sport')) {
    templates = [
      { title: 'Новости спорта: Главные события к этому часу', duration: 30, desc: 'Обзор мировых рекордов, трансферных новостей и результатов турниров.', category: 'Новости' },
      { title: 'Все на Матч! Прямой эфир', duration: 60, desc: 'Аналитическая студия: прогнозы экспертов и разбор прошедших матчей.', category: 'Аналитика' },
      { title: 'Футбол: Лига Чемпионов. Обзор тура', duration: 90, desc: 'Лучшие моменты, опасные атаки и голы европейского футбольного уикенда.', category: 'Футбол' },
      { title: 'Хоккей: КХЛ. Регулярный чемпионат', duration: 150, desc: 'Трансляция центрального матча игрового дня Континентальной Хоккейной Лиги.', category: 'Хоккей' },
      { title: 'Громко! Авторская программа', duration: 60, desc: 'Острые дискуссии, инсайды и интервью со звездами мирового спорта.', category: 'Ток-шоу' }
    ];
  } else if (lowerGroup.includes('познав') || lowerName.includes('discovery') || lowerName.includes('planet') || lowerName.includes('наук')) {
    templates = [
      { title: 'Как это устроено: Заводы и технологии', duration: 30, desc: 'За кулисами высокотехнологичных производств и создания повседневных вещей.', category: 'Наука' },
      { title: 'Тайны Вселенной: Загадки черных дыр', duration: 60, desc: 'Астрофизики раскрывают природу самых мощных гравитационных объектов космоса.', category: 'Космос' },
      { title: 'Дикая природа Африки: Сезон дождей', duration: 55, desc: 'Уникальные съемки диких животных в период великой миграции.', category: 'Природа' },
      { title: 'Разрушители легенд: Специальный выпуск', duration: 50, desc: 'Проверка популярных городских мифов с помощью научных экспериментов.', category: 'Шоу' }
    ];
  } else if (lowerName.includes('первый') || lowerName.includes('1 hd')) {
    templates = [
      { title: 'Доброе утро', duration: 180, desc: 'Утренний информационно-развлекательный канал: новости, советы и встречи с гостями.', category: 'Утро' },
      { title: 'Новости Первого канала', duration: 30, desc: 'Оперативная информационная картина дня в России и мире.', category: 'Новости' },
      { title: 'Информационная программа «Время»', duration: 60, desc: 'Главный вечерний выпуск: ключевые события, репортажи спецкоров и аналитика.', category: 'Новости' },
      { title: 'Голос: Новый сезон', duration: 120, desc: 'Главное вокальное шоу страны: слепые прослушивания и поединки участников.', category: 'Шоу' },
      { title: 'Вечерний выпуск: Человек и закон', duration: 55, desc: 'Журналистские расследования, криминальная хроника и правовой комментарий.', category: 'Расследования' },
      { title: 'Премьерный сериал: За час до рассвета', duration: 50, desc: 'Захватывающий исторический детектив о борьбе с преступностью.', category: 'Сериал' }
    ];
  } else if (lowerName.includes('россия') || lowerName.includes('russia')) {
    templates = [
      { title: 'Утро России', duration: 180, desc: 'Главная утренняя программа: новости регионов, экономика и полезные советы.', category: 'Утро' },
      { title: 'Вести: Главный выпуск', duration: 45, desc: 'События дня, репортажи с мест событий и прямые включения корреспондентов.', category: 'Новости' },
      { title: '60 Минут: Общественно-политическое ток-шоу', duration: 90, desc: 'Прямой эфир с политиками и экспертами на главные темы дня.', category: 'Ток-шоу' },
      { title: 'Тайны следствия: Новый сезон', duration: 60, desc: 'Мария Швецова и ее команда берутся за расследование сложнейших преступлений.', category: 'Сериал' },
      { title: 'Вечер с Владимиром Соловьевым', duration: 120, desc: 'Информационно-аналитическая программа о мировой политике.', category: 'Аналитика' }
    ];
  } else {
    // Default diversified schedule
    templates = [
      { title: `${channel.name}: Утренний эфир`, duration: 90, desc: `Утренняя программа и главные анонсы телеканала ${channel.name}.`, category: 'Утро' },
      { title: 'Выпуск новостей к этому часу', duration: 30, desc: 'Актуальные события, картина дня и прогноз погоды.', category: 'Новости' },
      { title: 'Документальное расследование', duration: 60, desc: 'Специальный репортаж и поиск ответов на острые вопросы современности.', category: 'Документальное' },
      { title: 'Популярный сериал', duration: 50, desc: 'Продолжение захватывающей многосерийной драмы.', category: 'Сериал' },
      { title: 'Дневное ток-шоу', duration: 75, desc: 'Обсуждение реальных историй и мнений гостей в студии.', category: 'Ток-шоу' },
      { title: `${channel.name}: Вечерний прайм-тайм`, duration: 90, desc: `Главное вечернее событие в эфире телеканала ${channel.name}.`, category: 'Кино' },
      { title: 'Художественный фильм', duration: 110, desc: 'Большое вечернее кино в высоком качестве.', category: 'Кино' },
      { title: 'Ночной эфир', duration: 80, desc: 'Музыкальные композиции, ночные обзоры и анонсы завтрашнего дня.', category: 'Ночь' }
    ];
  }

  // Generate 7 days in the past + today + tomorrow
  const startDay = new Date();
  startDay.setHours(0, 0, 0, 0);
  startDay.setDate(startDay.getDate() - 7);

  // Offset channel timeline starting point by seed to ensure every channel has unique schedule timing
  const startOffsetMs = (seed % 45) * 60 * 1000;
  let currentPointer = startDay.getTime() + startOffsetMs;
  const endTime = now + dayMs;

  let templateIdx = seed % templates.length;
  while (currentPointer < endTime) {
    const tmpl = templates[templateIdx % templates.length];
    const durationMs = tmpl.duration * 60 * 1000;
    const progEnd = currentPointer + durationMs;

    const isLive = now >= currentPointer && now < progEnd;
    const isPast = progEnd <= now;
    const isWithin7Days = currentPointer >= (now - (7 * dayMs));

    const prog: EpgProgram = {
      id: `epg-${channel.id}-${currentPointer}`,
      channelId: channel.id,
      title: tmpl.title,
      description: tmpl.desc,
      category: tmpl.category,
      start: currentPointer,
      end: progEnd,
      isLive,
      hasArchive: isPast && isWithin7Days
    };

    if (prog.hasArchive) {
      prog.archiveUrl = buildArchiveStreamUrl(channel, prog);
    }

    programs.push(prog);
    currentPointer = progEnd;
    templateIdx++;
  }

  return programs;
}
