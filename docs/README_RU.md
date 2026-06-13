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
### Импорт и экспорт
- **Импорт из CSV** — переносите данные из других финансовых приложений
- **Экспорт в CSV** — сохраняйте данные для резервного копирования
### Безопасность и доступ
- **Мультипользовательность** — отдельные аккаунты для членов семьи с изоляцией данных по пользователю
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
 
Отредактируйте `.env` — минимально нужно задать:
```env
DATABASE_URL=postgres://finapp:yourpassword@postgres:5432/finapp
JWT_SECRET=ваш_случайный_секрет
```
 
### 3. Сгенерировать VAPID ключи (для Push-уведомлений)
```bash
npx web-push generate-vapid-keys
```
 
### 4. Запустить
```bash
docker compose up -d
```
 
Откройте `http://localhost:6253` и пройдите первоначальную настройку.
 
### HTTPS / Reverse Proxy

Приложение **не** принудительно использует HTTPS и не отправляет заголовки HSTS. Для production-развёртываний разместите FinApp за reverse proxy (Traefik, Nginx, Caddy и т.п.) и настройте TLS и HSTS на его стороне. Это позволяет без проблем работать по HTTP при локальной разработке.
 
---
 
## ⚙️ Переменные окружения
 
| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт сервера | `6253` |
| `DATABASE_URL` | Строка подключения к PostgreSQL | — |
| `JWT_SECRET` | Секрет для подписи JWT | — |
| `JWT_ACCESS_TTL` | Время жизни access токена | `15m` |
| `JWT_REFRESH_TTL` | Время жизни refresh токена | `30d` |
| `TZ` | Часовой пояс | `UTC` |
| `VAPID_PUBLIC_KEY` | Публичный ключ для Web Push | — |
| `VAPID_PRIVATE_KEY` | Приватный ключ для Web Push | — |
| `VAPID_SUBJECT` | Контакт для Web Push | `mailto:admin@localhost` |
| `SHOUTRRR_URL` | URL для Shoutrrr интеграции | — |
| `ALLOWED_ORIGINS` | Разрешённые CORS источники (через запятую) | — |
| `DATABASE_SSL` | Включить SSL/TLS для подключения к PostgreSQL | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Отклонять самоподписанные SSL-сертификаты | `true` |
| `PUID` | ID пользователя для Docker контейнера | `1000` |
| `PGID` | ID группы для Docker контейнера | `1000` |
 
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
 
## 🔔 Уведомления
 
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
 
`/auth` · `/accounts` · `/transactions` · `/categories` · `/tags` · `/budgets` · `/debts` · `/recurring` · `/reports` · `/currencies` · `/import` · `/export` · `/notifications`
 
---
 
## 🧑‍💻 Локальная разработка
 
```bash
# Backend
cd backend && npm install && npm run dev
 
# Frontend (отдельный терминал)
cd frontend && npm install && npm run dev
```
 
Требования: Node.js 22+, PostgreSQL 15+
 
---
 
## 📄 Лицензия
 
Этот проект лицензирован по лицензии GNU Affero General Public License v3.0 (AGPL v3) — подробности смотрите в файле [LICENSE](/LICENSE).