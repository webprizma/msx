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

// Generates an authentic 7-day TV program schedule for testing the 7-day catchup archive
export function generateSample7DayEpg(channel: Channel): EpgProgram[] {
  const programs: EpgProgram[] = [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const showTemplates = [
    { title: 'Утреннее шоу', duration: 120, desc: 'Информационно-развлекательная программа, новости и прогнозы.' },
    { title: 'Новости дня', duration: 30, desc: 'Главные мировые и региональные события к этому часу.' },
    { title: 'Документальный фильм: Тайны Вселенной', duration: 60, desc: 'Научно-популярный фильм о космосе и технологиях.' },
    { title: 'Художественный фильм: Престиж', duration: 130, desc: 'Захватывающий триллер о соперничестве двух великих иллюзионистов.' },
    { title: 'Кулинарный поединок', duration: 50, desc: 'Лучшие шеф-повара соревнуются в приготовлении авторских блюд.' },
    { title: 'Вечерний выпуск новостей', duration: 40, desc: 'Итоги дня, аналитика и комментарии экспертов.' },
    { title: 'Большое вечернее кино: Интерстеллар', duration: 160, desc: 'Фантастическая драма о путешествии сквозь червоточину времени.' },
    { title: 'Ночной эфир: Музыкальный хит-парад', duration: 90, desc: 'Лучшие треки и клипы недели в непрерывном миксе.' }
  ];

  // Generate 7 days in the past + today + tomorrow
  const startDay = new Date();
  startDay.setHours(0, 0, 0, 0);
  startDay.setDate(startDay.getDate() - 7);

  let currentPointer = startDay.getTime();
  const endTime = now + dayMs;

  let templateIdx = 0;
  while (currentPointer < endTime) {
    const tmpl = showTemplates[templateIdx % showTemplates.length];
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
