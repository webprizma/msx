export interface ServerTemplate {
  id: string;
  name: string;
  platform: string;
  description: string;
  difficulty: 'Новичок' | 'Средний' | 'Продвинутый';
  pros: string[];
  cons: string[];
  code: string;
  instructions: string[];
  filename: string;
}

export interface PitfallItem {
  id: string;
  title: string;
  severity: 'critical' | 'warning' | 'info';
  tvImpact: string;
  problem: string;
  solution: string;
  sampleCode?: string;
}

export interface RoadmapStep {
  step: number;
  title: string;
  timeEstimate: string;
  summary: string;
  tasks: string[];
  tips: string;
}

export const SERVER_TEMPLATES: ServerTemplate[] = [
  {
    id: 'github-pages',
    name: 'GitHub Pages / Cloudflare (Бессерверный)',
    platform: 'Облако (Бесплатно навсегда)',
    description: 'Идеальное решение для 95% пользователей: настоящий валидный HTTPS, нулевые затраты, не нужно держать включенным компьютер 24/7.',
    difficulty: 'Новичок',
    pros: [
      'Настоящий доверенный SSL/HTTPS (нет ошибки Mixed Content на ТВ)',
      'Работает 24/7 без включенного ПК или Raspberry Pi',
      'Полностью бесплатно',
      'Легко обновлять через веб-интерфейс GitHub'
    ],
    cons: [
      'Статический JSON (нет динамических серверных скриптов, но для меню MSX они и не нужны)'
    ],
    filename: 'index.html / msx.json',
    instructions: [
      'Создайте бесплатный репозиторий на github.com (например, `my-msx-portal`).',
      'Загрузите в корень файл `start.json` (скачайте его из нашего Конструктора).',
      'Зайдите в Settings -> Pages репозитория и включите Source: Deploy from a branch (main / root).',
      'Через 1 минуту ваш сервер готов по адресу `https://ваш-логин.github.io/my-msx-portal/start.json`!',
      'Введите эту ссылку в MSX на телевизоре в поле «Параметр запуска».'
    ],
    code: `// Пример структуры репозитория:
// my-msx-portal/
//  ├── start.json      <- главный файл меню
//  └── icons/          <- ваши логотипы и фоны (по желанию)

// GitHub Pages автоматически отдает Access-Control-Allow-Origin: *
// и полноценный доверенный SSL-сертификат Let's Encrypt!`
  },
  {
    id: 'nodejs-express',
    name: 'Node.js + Express (Домашний ПК / NAS / OrangePi)',
    platform: 'Node.js 18+',
    description: 'Классический локальный сервер для домашней сети с правильными заголовками CORS, сбросом кэша и поддержкой автообновления.',
    difficulty: 'Средний',
    pros: [
      'Полный контроль, возможность отдавать динамические плейлисты',
      'Мгновенный отклик в домашней гигабитной сети',
      'Легко добавить авторизацию или парсинг внешних источников'
    ],
    cons: [
      'Компьютер или сервер должен быть включен',
      'На новых ТВ с WebOS/Tizen нужно решить вопрос с HTTPS (см. раздел «Подводные камни»)'
    ],
    filename: 'server.js',
    instructions: [
      'Установите Node.js (если еще не установлен) с сайта nodejs.org.',
      'Создайте папку `msx-server` и выполните `npm init -y && npm install express`.',
      'Сохраните код ниже в файл `server.js`. Положите `start.json` рядом.',
      'Запустите: `node server.js`.',
      'Сервер доступен по адресу `http://192.168.1.XXX:8080/start.json`.'
    ],
    code: `const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8080;

// ВАЖНО: Разрешаем CORS для запросов со Smart TV
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Отдача главного файла параметров MSX
app.get('/start.json', (req, res) => {
  // Запрещаем кэширование, чтобы ТВ сразу видел правки
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const filePath = path.join(__dirname, 'start.json');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'start.json not found' });
  }
});

// Раздача статики (иконки, фоны)
app.use('/static', express.static(path.join(__dirname, 'static')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`[MSX Server] Сервер запущен на http://0.0.0.0:\${PORT}\`);
  console.log(\`[MSX Server] Параметр запуска: http://<IP_ВАШЕГО_ПК>:\${PORT}/start.json\`);
});`
  },
  {
    id: 'docker-nginx',
    name: 'Docker + Nginx (Synology, QNAP, TrueNAS, Raspberry Pi)',
    platform: 'Docker / Linux',
    description: 'Надежный продакшн-вариант в контейнере с максимальной скоростью отдачи статики и минимальным потреблением RAM (< 15 МБ).',
    difficulty: 'Продвинутый',
    pros: [
      'Стабильная работа годами без падений и перезагрузок',
      'Потребляет всего 10-15 МБ оперативной памяти',
      'Идеально подходит для NAS и домашних микрокомпьютеров'
    ],
    cons: [
      'Требуется установленный Docker'
    ],
    filename: 'docker-compose.yml + nginx.conf',
    instructions: [
      'Создайте директорию на вашем сервере/NAS: `mkdir -p ~/msx-server/html`.',
      'Положите сгенерированный `start.json` в `~/msx-server/html/start.json`.',
      'Создайте файл `nginx.conf` и `docker-compose.yml` в папке `~/msx-server`.',
      'Запустите: `docker compose up -d`.'
    ],
    code: `# docker-compose.yml
version: '3.8'
services:
  msx-nginx:
    image: nginx:alpine
    container_name: msx-home-server
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro

# nginx.conf:
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;

    location / {
        # Критически важные заголовки для MSX
        add_header 'Access-Control-Allow-Origin' '*' always;
        add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' '*' always;
        add_header 'Cache-Control' 'no-store, no-cache, must-revalidate, proxy-revalidate' always;

        default_type application/json;
        try_files $uri $uri/ =404;
    }
}`
  },
  {
    id: 'python-server',
    name: 'Python One-Liner (Для быстрой проверки за 30 секунд)',
    platform: 'Python 3.x',
    description: 'Самый быстрый способ запустить сервер прямо сейчас на Windows/macOS/Linux без установки сторонних библиотек.',
    difficulty: 'Новичок',
    pros: [
      'Никаких зависимостей и сборщиков',
      'Запуск за 5 секунд из терминала'
    ],
    cons: [
      'Стандартный http.server не отдает заголовок CORS без обертки (ниже дан скрипт с CORS)'
    ],
    filename: 'msx_server.py',
    instructions: [
      'Сохраните код в файл `msx_server.py` в папке с вашим `start.json`.',
      'В терминале или командной строке выполните: `python msx_server.py`.',
      'Сервер поднимется на порту 8080.'
    ],
    code: `import http.server
import socketserver

PORT = 8080

class MSXRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Обязательные заголовки для Media Station X
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

with socketserver.TCPServer(("0.0.0.0", PORT), MSXRequestHandler) as httpd:
    print(f"MSX сервер запущен: http://0.0.0.0:{PORT}/start.json")
    httpd.serve_forever()`
  }
];

export const PITFALLS_LIST: PitfallItem[] = [
  {
    id: 'mixed-content',
    title: '1. Mixed Content: Ошибка HTTP внутри HTTPS на ТВ',
    severity: 'critical',
    tvImpact: 'Samsung Tizen 6+ (2021+), LG webOS 6+ (2021+), Google TV',
    problem: 'Приложение Media Station X из официального магазина LG Content Store или Samsung Apps запускается по защищенному протоколу HTTPS (https://msx.benzac.de). Если в настройках вы укажете локальный незащищенный адрес (например, http://192.168.1.50:8080/start.json), современный браузер телевизора заблокирует запрос как небезопасный (Mixed Content Block)! Пользователь увидит ошибку "Connection failed" или бесконечную загрузку.',
    solution: 'Три проверенных пути решения: 1) Бесплатный хостинг на GitHub Pages / Cloudflare Pages — вы получаете настоящий валидный HTTPS с зеленым замком, и ТВ без проблем скачивает ваш start.json. 2) Использование бесплатного сервиса DuckDNS + Let\'s Encrypt / Cloudflare Tunnel на домашнем роутере/сервере. 3) Вход в MSX через браузер ТВ по HTTP адресу.',
    sampleCode: `// ❌ Ошибка на современных ТВ (Mixed Content):
// Параметр запуска: http://192.168.1.15:8080/start.json

// ✅ Успешно на любом телевизоре:
// Параметр запуска: https://my-username.github.io/my-msx/start.json`
  },
  {
    id: 'self-signed-ssl',
    title: '2. Ловушка самоподписанного SSL сертификата (Self-Signed Cert)',
    severity: 'critical',
    tvImpact: 'Все телевизоры Samsung Tizen, LG webOS, Apple TV',
    problem: 'Многие разработчики думают: "Ага, нужен HTTPS! Сгенерирую self-signed openssl сертификат на роутере". Но на телевизорах Smart TV НЕТ кнопки "Всё равно перейти" или "Принять небезопасный сертификат"! ТВ молча оборвет соединение с ошибкой SSL Handshake / Unknown Authority.',
    solution: 'Никогда не используйте самоподписанные сертификаты для Smart TV. Используйте доменное имя (можно бесплатное *.duckdns.org или любой свой домен за 100 рублей) + бесплатный официальный сертификат Let\'s Encrypt / Certbot, либо хостинг GitHub/Vercel, где сертификат выпускается автоматически.'
  },
  {
    id: 'cors-headers',
    title: '3. Отсутствие заголовка CORS (Access-Control-Allow-Origin: *)',
    severity: 'critical',
    tvImpact: 'Все платформы без исключения',
    problem: 'Media Station X — это SPA (Single Page Application). Он загружает ваш start.json через JavaScript fetch()/XMLHttpRequest. Если веб-сервер не пришлет заголовок Access-Control-Allow-Origin: *, браузер ТВ заблокирует чтение файла политикой Same-Origin Policy.',
    solution: 'Всегда настраивайте веб-сервер на возврат заголовка Access-Control-Allow-Origin: * для всех ответов и метода OPTIONS.',
    sampleCode: `// Express:
res.header("Access-Control-Allow-Origin", "*");

// Nginx:
add_header "Access-Control-Allow-Origin" "*" always;`
  },
  {
    id: 'tv-cache',
    title: '4. Агрессивное кэширование в Tizen и webOS',
    severity: 'warning',
    tvImpact: 'LG webOS, Samsung Tizen',
    problem: 'Телевизоры экономят трафик и процессорное время, поэтому движки WebKit/Chromium в Smart TV кэшируют ответы HTTP насмерть. Вы изменили ссылку в start.json на сервере, перезапускаете MSX на ТВ — а там старый список приложений!',
    solution: '1) Добавляйте строгие заголовки Cache-Control: no-store, no-cache, must-revalidate. 2) В MSX используйте принудительную перезагрузку (кнопка Перезагрузить в меню настроек или изменение параметра запуска с версией ?v=2).'
  },
  {
    id: 'dhcp-ip-lease',
    title: '5. «Плавающий» IP-адрес домашнего ПК (DHCP)',
    severity: 'warning',
    tvImpact: 'Локальные домашние серверы (ПК, малинка, ноутбук)',
    problem: 'Роутер выдает домашнему ПК адрес по DHCP на 24 часа. После перезагрузки роутера или ПК адрес сменился с 192.168.1.100 на 192.168.1.104. Телевизор больше не видит сервер, приходится заново вбивать длинную ссылку пультом.',
    solution: 'В настройках домашнего роутера (Keenetic, Mikrotik, TP-Link, Asus) жестко закрепите статический IP-адрес за MAC-адресом вашего ПК/сервера (DHCP Static Lease / Привязка IP к MAC).'
  },
  {
    id: 'grid-coordinates',
    title: '6. Ошибки сетки координат (layout: "x,y,w,h")',
    severity: 'info',
    tvImpact: 'Навигация пультом ДУ (стрелки Up, Down, Left, Right)',
    problem: 'MSX использует сеточную модель. Сетка по умолчанию — 12 колонок. Формат layout: "X,Y,Ширина,Высота". Если указать x=10 и w=4 (сумма 14 > 12), кнопка вылезет за пределы экрана. Если координаты наложатся друг на друга, фокус пульта может застрять.',
    solution: 'Используйте кратные значения ширины: 3 (по 4 плитки в строке: 0, 3, 6, 9), 4 (по 3 плитки: 0, 4, 8) или 6 (по 2 крупные плитки). Наш встроенный Конструктор автоматически рассчитывает координаты без пересечений.'
  },
  {
    id: 'old-tv-browsers',
    title: '7. Устаревший движок браузера на старых ТВ (2015-2018 гг.)',
    severity: 'info',
    tvImpact: 'Старые телевизоры со старыми версиями Chromium (53-65)',
    problem: 'Некоторые подключаемые сторонние веб-приложения могут использовать современный JavaScript (Optional Chaining ?., Nullish coalescing ??), который крашит JS-движок на старых моделях ТВ.',
    solution: 'Для старых моделей выбирайте облегченные версии клиентов (например, Lampa lite или OTT-play) и избегайте тяжелых WebGL-эффектов.'
  }
];

export const ROADMAP_STEPS: RoadmapStep[] = [
  {
    step: 1,
    title: 'Выбор архитектуры: Где разместить сервер?',
    timeEstimate: '15 минут',
    summary: 'Определитесь, хотите ли вы держать сервер в локальной сети (ПК / NAS / Raspberry Pi) или использовать бесплатный облачный хостинг (GitHub Pages).',
    tasks: [
      'Оцените модель телевизора: если ТВ новее 2020 года, рекомендуется вариант с надежным HTTPS (GitHub Pages или Cloudflare).',
      'Если нужен доступ к локальным сетевым папкам и TorrServe на домашнем ПК — выберите локальный сервер (Node.js/Docker) с привязкой статического IP в роутере.',
      'Скачайте или подготовьте шаблон сервера из вкладки «Шаблоны серверов».'
    ],
    tips: 'Рекомендация: начните с GitHub Pages или нашего встроенного онлайн-сервера — это позволит всё протестировать за 2 минуты без настройки локального софта!'
  },
  {
    step: 2,
    title: 'Формирование структуры start.json и подбор приложений',
    timeEstimate: '20 минут',
    summary: 'Настройте список нужных приложений (Lampa, VoKino, Deeplex, TorrServe, IPTV, YouTube) и оформление меню.',
    tasks: [
      'Откройте вкладку «Конструктор плейлиста» в этом приложении.',
      'Выберите готовые пресеты приложений или добавьте свои ссылки.',
      'Настройте категории («Фильмы», «ТВ каналы», «Утилиты», «Музыка»).',
      'Задайте красивый фоновый рисунок и цветовую схему.',
      'Проверьте координаты сетки в визуальном редакторе.'
    ],
    tips: 'Сетка в MSX рассчитана на 12 колонок. Оптимальный размер плитки 3x3 (4 приложения в ряд).'
  },
  {
    step: 3,
    title: 'Тестирование в виртуальном симуляторе Smart TV',
    timeEstimate: '10 минут',
    summary: 'Проверьте, как меню будет выглядеть на реальном экране и как по нему перемещается курсор с пульта.',
    tasks: [
      'Перейдите во вкладку «Симулятор ТВ».',
      'Используйте виртуальный пульт или клавиши клавиатуры (Стрелки + Enter + Esc) для навигации.',
      'Убедитесь, что все плитки фокусируются без «мертвых зон» и застреваний.',
      'Проверьте всплывающие бейджи и описания.'
    ],
    tips: 'Нажмите клавишу Enter / OK на виртуальном пульте, чтобы смоделировать запуск приложения.'
  },
  {
    step: 4,
    title: 'Запуск сервера и проверка сетевых заголовков',
    timeEstimate: '15 минут',
    summary: 'Разверните сервер и убедитесь, что он отдает правильные заголовки CORS и MIME-тип.',
    tasks: [
      'Запустите выбранный сервер (Node.js, Docker, Python или GitHub Pages).',
      'Откройте браузер на компьютере или смартфоне и перейдите по адресу вашего start.json.',
      'Убедитесь, что браузер отображает чистый JSON без ошибок.',
      'Проверьте в DevTools (F12 -> Network), что сервер отдает `Access-Control-Allow-Origin: *`.'
    ],
    tips: 'Не забывайте про заголовок `Cache-Control: no-cache`, иначе при правках телевизор будет показывать старую версию.'
  },
  {
    step: 5,
    title: 'Подключение телевизора к вашему серверу',
    timeEstimate: '5 минут',
    summary: 'Финальный шаг: вводим ссылку в Media Station X на самом телевизоре.',
    tasks: [
      'Включите телевизор и запустите Media Station X.',
      'Нажмите на пульте кнопку Settings (шестеренка в правом верхнем углу).',
      'Выберите пункт «Start Parameter» (Параметр запуска) -> «Setup» (Настройка).',
      'Введите адрес вашего сервера (например: `https://.../api/msx/start.json` или ваш GitHub адрес).',
      'Нажмите «Done» (Готово) и подтвердите загрузку.',
      'Наслаждайтесь вашим собственным, персонализированным ТВ-порталом!'
    ],
    tips: 'Если вводить длинный адрес пультом неудобно, подключите беспроводную клавиатуру к USB-порту телевизора или используйте мобильное приложение пульта (LG ThinQ или Samsung SmartThings) со смартфона.'
  }
];
