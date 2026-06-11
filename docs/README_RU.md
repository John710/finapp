<div align="center">
<p align="center">
  <img src="/docs/logo.png" width="180">
</p>

<h1 align="center">FinApp</h1>
 
**Трекер личных финансов с открытым исходным кодом **
 
[![Docker Image](https://ghcr-badge.egpl.dev/john710/finapp/size?color=%2344cc11&tag=latest&label=образ)](https://github.com/John710/finapp/pkgs/container/finapp)
[![GitHub release](https://img.shields.io/github/v/release/John710/finapp?color=%2344cc11)](https://github.com/John710/finapp/releases)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/John710/finapp/docker.yml?label=сборка)](https://github.com/John710/finapp/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
 
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
- **Мультипользовательность** — создавайте отдельные аккаунты для членов семьи
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
| **Frontend** | Vue 3, Pinia, Vue Router, Vue I18n, Tailwind CSS v4, Chart.js, Vite |
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
 
Требования: Node.js 22+, PostgreSQL 14+
 
---
 
## 📄 Лицензия
 
MIT License — подробности в файле [LICENSE](LICENSE).
