import { PresetApp, MsxPlaylist } from '../types/msx';

export const POPULAR_PRESETS: PresetApp[] = [
  {
    id: 'lampa',
    name: 'Lampa TV',
    category: 'Кино',
    icon: 'https://lampa.mx/img/logo.png',
    action: 'link:http://lampa.mx',
    badge: 'Популярное',
    description: 'Один из лучших каталогов фильмов и сериалов с поддержкой торрентов и онлайн-балансеров.',
    recommendedLayout: '0,0,3,3',
    platformNotes: 'Отлично работает на Tizen, webOS и Android TV. Для торрентов нужен запущенный TorrServe.'
  },
  {
    id: 'vokino',
    name: 'VoKino Web',
    category: 'Кино',
    icon: 'https://vokino.tv/assets/img/logo.png',
    action: 'link:http://web.vokino.tv',
    badge: 'Каталог',
    description: 'Удобный онлайн-кинотеатр с большой базой кино, сериалов и мультфильмов.',
    recommendedLayout: '3,0,3,3',
    platformNotes: 'Имеет легкий веб-интерфейс, оптимизированный под пульт Smart TV.'
  },
  {
    id: 'deeplex',
    name: 'Deeplex',
    category: 'Кино',
    icon: 'https://deeplex.app/img/icons/icon-192x192.png',
    action: 'link:https://deeplex.app',
    badge: 'Медиа',
    description: 'Медиацентр для просмотра кино, сериалов и медиаконтента.',
    recommendedLayout: '6,0,3,3',
    platformNotes: 'Поддерживает современные кодеки и быстрый поиск.'
  },
  {
    id: 'torrserve',
    name: 'TorrServe Matrix',
    category: 'Инструменты',
    icon: 'https://raw.githubusercontent.com/YouROK/TorrServer/master/src/assets/icon.png',
    action: 'link:http://127.0.0.1:8090',
    badge: 'Торрент-движок',
    description: 'Локальный веб-интерфейс для воспроизведения торрентов без предварительного скачивания.',
    recommendedLayout: '9,0,3,3',
    platformNotes: 'Укажите IP вашего домашнего сервера (например, 192.168.1.100:8090).'
  },
  {
    id: 'youtube-tv',
    name: 'YouTube on TV',
    category: 'Видео',
    icon: 'https://www.youtube.com/s/desktop/270425a1/img/favicon_144x144.png',
    action: 'link:https://www.youtube.com/tv',
    badge: 'YouTube',
    description: 'Официальный полноэкранный интерфейс YouTube Leanback для телевизоров.',
    recommendedLayout: '0,3,3,3',
    platformNotes: 'На некоторых современных браузерах может требовать заголовок User-Agent Smart TV.'
  },
  {
    id: 'ottplay',
    name: 'OTT-Play',
    category: 'ТВ / IPTV',
    icon: 'https://cdn-icons-png.flaticon.com/512/3845/3845874.png',
    action: 'link:https://tv.ott-play.com',
    badge: 'Плеер IPTV',
    description: 'Универсальный и очень быстрый плеер для плейлистов m3u / IPTV провайдеров.',
    recommendedLayout: '3,3,3,3',
    platformNotes: 'Легкий плеер, специально спроектирован для слабых процессоров телевизоров.'
  },
  {
    id: 'plex',
    name: 'Plex Web Client',
    category: 'Домашний сервер',
    icon: 'https://plex.tv/wp-content/themes/plex/assets/img/favicons/favicon-196x196.png',
    action: 'link:https://app.plex.tv/desktop',
    badge: 'Plex',
    description: 'Доступ к вашей личной медиатеке фильмов, сериалов и музыки на домашнем сервере Plex.',
    recommendedLayout: '6,3,3,3',
    platformNotes: 'Требует аккаунт Plex или прямой локальный доступ.'
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin Web',
    category: 'Домашний сервер',
    icon: 'https://jellyfin.org/images/logo.svg',
    action: 'link:http://192.168.1.100:8096',
    badge: 'Open Source',
    description: 'Полностью бесплатный и свободный медиасервер для домашней коллекции.',
    recommendedLayout: '9,3,3,3',
    platformNotes: 'Замените 192.168.1.100 на реальный локальный IP адрес вашего Jellyfin сервера.'
  },
  {
    id: 'twitch',
    name: 'Twitch TV Web',
    category: 'Видео',
    icon: 'https://static.twitchcdn.net/assets/favicon-32-e5b523084e3a45247294.png',
    action: 'link:https://www.twitch.tv',
    badge: 'Стримы',
    description: 'Прямые трансляции игровых стримов и шоу.',
    recommendedLayout: '0,6,3,3',
    platformNotes: 'Рекомендуется настроить управление пультом в интерфейсе.'
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    category: 'Инструменты',
    icon: 'https://brands.home-assistant.io/homeassistant/icon.png',
    action: 'link:http://homeassistant.local:8123',
    badge: 'Умный дом',
    description: 'Панель управления умным домом прямо на экране телевизора в гостиной.',
    recommendedLayout: '3,6,3,3',
    platformNotes: 'Идеально для просмотра камер видеонаблюдения и статуса датчиков.'
  }
];

export const INITIAL_DEFAULT_PLAYLIST: MsxPlaylist = {
  name: "Мой Домашний MSX Портал",
  version: "1.0.0",
  parameter: "menu:default",
  response: "content:menu:default",
  background: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1920&q=80",
  headline: "Домашний медиа-сервер",
  menu: [
    {
      id: "menu-all",
      icon: "apps",
      label: "Все приложения",
      data: {
        pages: [
          {
            items: [
              {
                id: "item-1",
                type: "button",
                layout: "0,0,3,3",
                color: "msx-glass",
                icon: "https://lampa.mx/img/logo.png",
                label: "Lampa TV",
                badge: "Кино & Сериалы",
                action: "link:http://lampa.mx",
                description: "Онлайн каталог и торренты"
              },
              {
                id: "item-2",
                type: "button",
                layout: "3,0,3,3",
                color: "msx-glass",
                icon: "https://vokino.tv/assets/img/logo.png",
                label: "VoKino",
                badge: "Каталог",
                action: "link:http://web.vokino.tv",
                description: "Кинотеатр для ТВ"
              },
              {
                id: "item-3",
                type: "button",
                layout: "6,0,3,3",
                color: "msx-glass",
                icon: "https://deeplex.app/img/icons/icon-192x192.png",
                label: "Deeplex",
                badge: "Медиа",
                action: "link:https://deeplex.app",
                description: "Мультимедиа плеер"
              },
              {
                id: "item-4",
                type: "button",
                layout: "9,0,3,3",
                color: "msx-glass",
                icon: "https://raw.githubusercontent.com/YouROK/TorrServer/master/src/assets/icon.png",
                label: "TorrServe",
                badge: "Торренты",
                action: "link:http://127.0.0.1:8090",
                description: "Стриминг торрентов"
              },
              {
                id: "item-5",
                type: "button",
                layout: "0,3,3,3",
                color: "msx-glass",
                icon: "https://www.youtube.com/s/desktop/270425a1/img/favicon_144x144.png",
                label: "YouTube TV",
                badge: "Видео",
                action: "link:https://www.youtube.com/tv",
                description: "Видеосервис"
              },
              {
                id: "item-6",
                type: "button",
                layout: "3,3,3,3",
                color: "msx-glass",
                icon: "https://cdn-icons-png.flaticon.com/512/3845/3845874.png",
                label: "IPTV Player",
                badge: "Телевидение",
                action: "link:https://tv.ott-play.com",
                description: "Интернет-телеканалы"
              },
              {
                id: "item-7",
                type: "button",
                layout: "6,3,3,3",
                color: "msx-glass",
                icon: "https://plex.tv/wp-content/themes/plex/assets/img/favicons/favicon-196x196.png",
                label: "Plex Web",
                badge: "Медиасервер",
                action: "link:https://app.plex.tv/desktop",
                description: "Домашняя коллекция"
              },
              {
                id: "item-8",
                type: "button",
                layout: "9,3,3,3",
                color: "msx-glass",
                icon: "https://jellyfin.org/images/logo.svg",
                label: "Jellyfin Web",
                badge: "Локальный каталог",
                action: "link:http://192.168.1.100:8096",
                description: "Свободный сервер"
              }
            ]
          }
        ]
      }
    },
    {
      id: "menu-movies",
      icon: "movie",
      label: "Фильмы и Кино",
      data: {
        pages: [
          {
            items: [
              {
                id: "m-item-1",
                type: "button",
                layout: "0,0,4,4",
                icon: "https://lampa.mx/img/logo.png",
                label: "Lampa (Основной)",
                badge: "v1.7.0",
                action: "link:http://lampa.mx",
                description: "Просмотр фильмов и сериалов"
              },
              {
                id: "m-item-2",
                type: "button",
                layout: "4,0,4,4",
                icon: "https://vokino.tv/assets/img/logo.png",
                label: "VoKino Web",
                badge: "Web TV",
                action: "link:http://web.vokino.tv",
                description: "Онлайн каталог"
              },
              {
                id: "m-item-3",
                type: "button",
                layout: "8,0,4,4",
                icon: "https://deeplex.app/img/icons/icon-192x192.png",
                label: "Deeplex",
                badge: "HD / 4K",
                action: "link:https://deeplex.app",
                description: "Стриминг"
              }
            ]
          }
        ]
      }
    },
    {
      id: "menu-tools",
      icon: "settings",
      label: "Серверы & Утилиты",
      data: {
        pages: [
          {
            items: [
              {
                id: "t-item-1",
                type: "button",
                layout: "0,0,4,3",
                label: "TorrServe Matrix",
                badge: "Порт 8090",
                action: "link:http://127.0.0.1:8090",
                description: "Управление движком торрентов"
              },
              {
                id: "t-item-2",
                type: "button",
                layout: "4,0,4,3",
                label: "Home Assistant",
                badge: "Порт 8123",
                action: "link:http://homeassistant.local:8123",
                description: "Управление умным домом"
              },
              {
                id: "t-item-3",
                type: "button",
                layout: "8,0,4,3",
                label: "Проверить пинг",
                badge: "Тест MSX",
                action: "execute:info:Домашний MSX сервер доступен!",
                description: "Тестовая команда проверки"
              }
            ]
          }
        ]
      }
    }
  ]
};
