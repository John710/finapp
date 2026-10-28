<div align="center">
<p align="center">
  <img src="/docs/logo.png" width="180">
</p>

<h1 align="center">FinApp</h1>
 
**Самохостируемый трекер личных финансов с открытым исходным кодом**
 
[![Docker Image](https://ghcr-badge.egpl.dev/john710/finapp/size?color=%2344cc11&tag=latest&label=размер+образа)](https://github.com/John710/finapp/pkgs/container/finapp)
[![GitHub release](https://img.shields.io/github/v/release/John710/finapp?color=%2344cc11)](https://github.com/John710/finapp/releases)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/John710/finapp/docker.yml?label=сборка)](https://github.com/John710/finapp/actions)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL%20v3-blue.svg)](LICENSE)
 
[🇬🇧 English version](/README.md)
 
</div>
---
 ## 📸 Скриншоты

<p align="center">
  <img src="/docs/images/dashboard.png" width="45%" />
  <img src="/docs/images/transactions.png" width="45%" />
</p>

<p align="center">
  <img src="/docs/images/accounts.png" width="45%" />
  <img src="/docs/images/budgets.png" width="45%" />
</p>

<p align="center">
  <img src="/docs/images/debts.png" width="45%" />
  <img src="/docs/images/recurring.png" width="45%" />
</p>

<p align="center">
  <img src="/docs/images/dashboard_light.png" width="45%" />
  <img src="/docs/images/transactions_light.png" width="45%" />
</p>

<p align="center">
  <img src="/docs/images/mobile_dashboard.png" width="45%" />
  <img src="/docs/images/mobile_transactions.png" width="45%" />
</p>
---
 
## ✨ Возможности
 
### Основные функции
- **Учет доходов и расходов** — создавайте транзакции разных типов
- **Многосчетность** — управляйте несколькими счетами (наличные, банковские, крипто, сберегательные)
- **Категоризация** — создавайте и используйте категории для транзакций
- **Теги** — добавляйте дополнительные метки для гибкой фильтрации
- **Переводы между счетами** — удобный учет переводов
### Планирование и аналитика
- **Бюджеты** — устанавливайте лимиты по категориям и отслеживайте расходы
- **Цели накопления** — создавайте цели и отслеживайте прогресс
- **Долги** — учитывайте свои долги и получайте напоминания о сроках возврата
- **Регулярные транзакции** — автоматизируйте повторяющиеся платежи и подписки
- **Отчёты и графики** — визуализация расходов и доходов по категориям и периодам
### Уведомления и интеграции
- **Web Push уведомления** — получайте оповещения в браузере
- **Shoutrrr интеграция** — отправляйте уведомления в Telegram, Discord, Gotify и другие сервисы
- **Напоминания** — автоматические оповещения о приближении сроков долгов, превышении бюджетов и т.д.
- **Календарь подписок (iCal)** — подпишитесь на свои регулярные платежи в любом календаре
### Импорт и экспорт
- **Импорт из CSV** — переносите данные из других финансовых приложений
- **Экспорт в CSV** — сохраняйте данные для резервного копирования
### Безопасность и доступ
- **Мультипользовательность** — у каждого члена семьи свои личные финансы
- **Семейный доступ** — делитесь счетами, бюджетами, долгами и регулярными операциями со всей семьёй или отдельными пользователями, с правами просмотр/редактирование
- **Управление пользователями** — первый пользователь (администратор) создаёт аккаунты и сбрасывает пароли
- **Двухфакторная аутентификация** — TOTP-коды из любого приложения-аутентификатора
- **Персональные API-токены** — bearer-токены для внешних клиентов
- **Аутентификация JWT** — безопасная работа с приложением
- **Шифрование паролей** — защита учетных записей
### Локализация
- **Многоязычность** — поддержка русского и английского языков
- **Мультивалютность** — автоматическая синхронизация курсов валют включая крипту
---
 
## 🚀 Быстрый старт
 
### Требования
- Docker и Docker Compose
### 1. Клонировать репозиторий
```bash
git clone https://github.com/John710/finapp.git
cd finapp
```
 
### 2. Настроить окружение
```bash
cp .env.example .env
```
 
Заполните в `.env` три обязательных секрета — `docker compose` не запустится, пока любой из них пуст. Значения генерируются так:
```bash
openssl rand -hex 16   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

```env
POSTGRES_PASSWORD=<вывод openssl rand -hex 16>
JWT_SECRET=<вывод openssl rand -hex 32>
ENCRYPTION_KEY=<вывод openssl rand -hex 32>
```

`ENCRYPTION_KEY` должен состоять ровно из 64 hex-символов; без корректного ключа контейнер уходит в цикл перезапусков. Сохраните его в надёжном месте: после смены ключа уже сохранённые зашифрованные настройки (приватный VAPID-ключ, URL Shoutrrr, ключ CoinGecko) станут нечитаемыми.

Строка подключения к базе собирается автоматически из `POSTGRES_USER`, `POSTGRES_PASSWORD` и `POSTGRES_DB`. Чтобы использовать внешний Postgres, измените строку `DATABASE_URL` в разделе `finapp.environment` файла `docker-compose.yml` (она задана там явно, поэтому `DATABASE_URL` из `.env` не пробрасывается) и уберите сервис `db` вместе с `depends_on`.
 
### 3. Запустить
```bash
docker compose up -d
```
 
Откройте `http://localhost:6253` и пройдите первоначальную настройку.
 
### HTTPS / Reverse Proxy

Приложение **не** принудительно использует HTTPS и не отправляет заголовки HSTS. Для production-развёртываний разместите FinApp за reverse proxy (Traefik, Nginx, Caddy и т.п.) и настройте TLS и HSTS на его стороне. Это позволяет без проблем работать по HTTP при локальной разработке.

Пример — Caddy:

```
fin.example.com {
    reverse_proxy 127.0.0.1:6253
}
```

Пример — Nginx:

```nginx
server {
    listen 443 ssl;
    server_name fin.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:6253;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Если приложение за прокси, укажите в `TRUSTED_PROXIES` IP/подсеть прокси — тогда приложение будет брать реальный IP клиента из `X-Forwarded-For` (используется в rate-limit и охранных уведомлениях).

> ⚠️ **Смените дефолтный `POSTGRES_PASSWORD`** (и `POSTGRES_USER`/`POSTGRES_DB`), если порт PostgreSQL доступен с других машин или контейнер `db` общий. Значения по умолчанию — только для локального использования.

### Резервные копии

Все данные хранятся в базе — делайте бэкапы регулярно. Compose-файл хранит её в томе `finapp_db_data`.

```bash
# Бэкап (скорректируйте имя контейнера при необходимости)
docker exec finapp-db pg_dump -U finapp -d finapp > finapp_$(date +%F).sql

# Восстановление
cat finapp_2026-01-01.sql | docker exec -i finapp-db psql -U finapp -d finapp
```

Пример ежедневного cron: `0 3 * * * docker exec finapp-db pg_dump -U finapp -d finapp | gzip > /backups/finapp_$(date +\%F).sql.gz`

CSV-экспорт (`Настройки → Экспорт`) — удобный снимок транзакций, но не полноценный бэкап базы.

### Обновление

Подтяните новый образ и пересоздайте контейнер; миграции базы выполняются автоматически при старте:

```bash
docker compose pull && docker compose up -d
```

Эндпоинт `/health` возвращает HTTP 503 при потере соединения с базой — подходит для uptime-мониторинга.

---
 
## ⚙️ Переменные окружения
 
| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт сервера | `6253` |
| `POSTGRES_USER` | Пользователь PostgreSQL (сервис db) | `finapp` |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL (сервис db) — **обязательный**, используйте значение, безопасное для URL, например `openssl rand -hex 16` | — |
| `POSTGRES_DB` | База PostgreSQL (сервис db) | `finapp` |
| `DATABASE_URL` | Полная строка подключения — только для внешней базы. Compose собирает её из `POSTGRES_*` и задаёт явно в `docker-compose.yml`; меняйте её там (значение из `.env` не пробрасывается) | — |
| `JWT_SECRET` | Секрет для подписи JWT — **обязательный**, не короче 32 символов (`openssl rand -hex 32`) | — |
| `JWT_ACCESS_TTL` | Время жизни access токена | `15m` |
| `JWT_REFRESH_TTL` | Время жизни refresh токена | `30d` |
| `TZ` | Часовой пояс | `UTC` |
| `ALLOWED_ORIGINS` | Разрешённые CORS источники (через запятую) | — |
| `TRUSTED_PROXIES` | Доверенные reverse proxies (через запятую) | — |
| `SHOUTRRR_BLOCK_PRIVATE_TARGETS` | Запрещать Shoutrrr-вебхуки на приватные/loopback-адреса (защита от SSRF для multi-user хостов) | `false` |
| `DATABASE_SSL` | Включить SSL/TLS для подключения к PostgreSQL | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Отклонять самоподписанные SSL-сертификаты | `true` |
| `PUID` | ID пользователя для Docker контейнера | `1000` (используется `node` из базового образа) |
| `PGID` | ID группы для Docker контейнера | `1000` |
| `DEFAULT_LANG` | Язык по умолчанию для новых пользователей (`ru` или `en`) | `en` |
| `ENCRYPTION_KEY` | 64-символьный hex-ключ для шифрования чувствительных данных — **обязательный**, без него сервер не запускается (`openssl rand -hex 32`) | — |
| `COINGECKO_API_KEY` | Общий ключ CoinGecko API для всего сервера; используется, если пользователь не сохранил свой в настройках | — |
| `LOG_LEVEL` | Подробность логов: `fatal`, `error`, `warn`, `info`, `debug`, `trace` | `info` (вне production — `debug`) |
| `PUSH_SEND_TIMEOUT` | Таймаут отправки одного Web Push уведомления, в миллисекундах | `10000` |
 
---
 
## ⌨️ Горячие клавиши
 
| Сочетание | Действие |
|-----------|----------|
| `Ctrl+Shift+K` | Открыть командную палитру |
| `Shift+/` | Показать справку |
| `Ctrl+Shift+N` | Новая транзакция |
| `Esc` | Закрыть модалку |
| `Ctrl+Enter` | Сохранить форму |
 
---
 
## 🛠 Технологический стек
 
| Уровень | Технологии |
|---------|-----------|
| **Backend** | Node.js, Fastify, PostgreSQL, JWT, Web Push, Shoutrrr |
| **Frontend** | Vue 3, Pinia, Vue Router, Vue I18n, Tailwind CSS v4, ECharts, Vite |
| **Инфраструктура** | Docker, GitHub Actions, GHCR |
 
---

## 👪 Семейный доступ

По умолчанию у каждого пользователя **свои личные финансы**. Любую сущность можно сделать общей:

1. **Первый зарегистрированный пользователь** становится администратором. Он создаёт аккаунты для членов семьи в **Настройки → Доступ и API → Пользователи** (каждый входит под своими учётными данными). Открытая регистрация при этом закрыта.
2. Откройте счёт, бюджет, долг или регулярную операцию и нажмите **Поделиться**. Дайте доступ **всей семье** или **отдельным пользователям** с одним из прав:
   - **Просмотр** — сущность и её история появятся в списках, дашборде и отчётах получателя
   - **Редактирование** — дополнительно позволяет работать с данными: добавлять транзакции по общему счёту (включая переводы), вносить платежи по общему долгу
3. Общие сущности помечены значком **Общий** для владельца и именем владельца для получателя. Отменить доступ можно в том же диалоге в любой момент.

Примечания:
- **Категории и теги общие** — они одни на всех пользователей экземпляра.
- Редактировать саму сущность (переименовать счёт, изменить лимит бюджета) может только владелец; CRUD транзакций по общему счёту требует права *редактирование*.
- Транзакции хранят `created_by` — кто их фактически внёс.
- Счета с правом редактирования учитываются в отчётах и net worth получателя.

---

## 🔔 Уведомления

Уведомления настраиваются персонально для каждого пользователя в разделе **Настройки**:

- **Web Push** — сгенерируйте персональные VAPID-ключи, подпишите браузер и получайте push-уведомления.
- **Shoutrrr** — настройте один или несколько Shoutrrr URL для отправки уведомлений в Telegram, Discord, Gotify, email, generic webhook и другие сервисы.

> **Важно:** Web Push требует secure context (`https://` или `localhost`). На чистом `http://` по IP-адресу push-уведомления работать не будут.

> **Важно:** URL generic-вебхука Shoutrrr содержит токен в строке запроса. Направляйте его только на эндпоинты `https://`: при `http://` токен уходит из вашей сети открытым текстом и попадает в access-логи принимающего сервера. В базе FinApp URL хранится зашифрованным, но это не защищает его при передаче.

Приложение автоматически отправляет уведомления о:
- Создании регулярной транзакции
- Приближении срока возврата долга
- Почти исчерпанном бюджете
- Превышении бюджета
- Достижении цели накопления
- Полном погашении долга
- Минусе на счёте
- Неудачной попытке входа
---
 
## 📅 Календарь подписок (iCal)

**Настройки → Доступ → Календарь подписок** создаёт персональную iCal-ссылку, которую можно
подставить в любой календарь (Apple Календарь, Google Календарь, Thunderbird, DAVx⁵…). Фид доступен
только на чтение: в него попадают ближайшие 180 дней срабатываний активных регулярных правил —
оплаченные и пропущенные даты помечаются, а ваши транзакции и остатки по счетам не раскрываются.

Каждая ссылка — отдельный токен. Полный URL показывается один раз при создании, в базе хранится
только его хеш, поэтому старую ссылку проще отозвать и создать новую. Отзыв действует со следующего
обращения клиента.

> **Важно:** токен передаётся в строке запроса, а строку запроса пишет в лог большинство прокси.
> Поставьте на этот путь отдельный роутер с отключённым access-логом, иначе ссылка окажется в логе
> обратного прокси и у всех, кто читает этот лог. В Traefik 3.x достаточно второго роутера на том же
> контейнере — более длинное правило получает больший приоритет автоматически, TLS приходит с
> entrypoint `websecure`, а цепочку forward-auth нужно снять: клиент календаря не умеет отвечать на
> запрос Tinyauth.
>
> ```yaml
> labels:
>   - "traefik.http.routers.finapp-ics.rule=Host(`fin.example.com`) && PathPrefix(`/api/v1/recurring.ics`)"
>   - "traefik.http.routers.finapp-ics.entrypoints=websecure-internal,websecure-external"
>   - "traefik.http.routers.finapp-ics.middlewares=chain-no-auth@file"
>   - "traefik.http.routers.finapp-ics.service=finapp-svc"
>   - "traefik.http.routers.finapp-ics.observability.accesslogs=false"
> ```
>
> Проверить, что сработало: запросить фид снаружи LAN — должно вернуться `200`/`text/calendar`, а не
> страница входа, и `grep -c 'recurring.ics' /path/to/access.log` должно оставаться 0.
>
> Альтернатива — вычеркнуть строки запроса из всех логов
> (`--accesslog.fields.queryparameters.defaultmode=drop`), но тогда они пропадут и при разборе
> других обращений.

---
 
## 📁 Структура проекта
 
```
finapp/
├── backend/
│   ├── data/              # Статические данные (валюты)
│   ├── locales/           # Переводы i18n
│   ├── migrations/        # Миграции БД
│   ├── plugins/           # Плагины Fastify
│   ├── routes/            # API роуты
│   ├── services/          # Бизнес-логика
│   └── server.js
├── frontend/
│   └── src/
│       ├── components/    # Vue компоненты
│       ├── composables/   # Vue composables
│       ├── stores/        # Pinia сторы
│       ├── views/         # Страницы
│       └── router/
├── .github/workflows/     # CI/CD
├── .env.example
├── docker-compose.yml
└── Dockerfile
```
 
---
 
## 🔌 API
 
REST API доступен по адресу `/api/v1`:
 
`/auth` · `/users` (профиль, сессии, 2FA, персональные API-токены в `/users/tokens`) · `/admin` (управление пользователями, демо-данные) · `/accounts` · `/transactions` (+ `/transactions/:id/attachments`) · `/attachments` · `/categories` · `/tags` · `/budgets` · `/debts` · `/recurring` (+ календарная лента `/recurring.ics`, `/recurring/feed-tokens`, `/recurring/occurrences`) · `/shares` · `/reports` (`summary`, `by-category`, `trend`, `net-worth`, `savings-rate`, `recurring-plan`, `dashboard`) · `/currencies` · `/import` · `/export` · `/notifications` · `/config` · `/health`
 
---
 
## 🧑‍💻 Локальная разработка
 
```bash
# Backend
cd backend && npm install && npm run dev
 
# Frontend (отдельный терминал)
cd frontend && npm install && npm run dev
```
 
Требования: Node.js 24+, PostgreSQL 15+

Линтинг: `cd backend && npm run lint` / `cd frontend && npm run lint` (конфигурации ESLint и Prettier включены).

> ⚠️ **`npm run migrate:down` деструктивен.** Некоторые down-миграции удаляют колонки с данными пользователей (например, миграция 15 удаляет `user_id` из основных таблиц). Перед любым откатом обязательно делайте резервную копию через `pg_dump`.
 
---
 
## 📄 Лицензия
 
Этот проект лицензирован по лицензии GNU Affero General Public License v3.0 (AGPL v3) — подробности смотрите в файле [LICENSE](/LICENSE).