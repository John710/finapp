<div align="center">
<p align="center">
  <img src="docs/logo.png" width="180">
</p>

<h1 align="center">FinApp</h1>
 
**A self-hosted, open-source personal finance tracker**
 
[![Docker Image](https://ghcr-badge.egpl.dev/john710/finapp/size?color=%2344cc11&tag=latest&label=image+size)](https://github.com/John710/finapp/pkgs/container/finapp)
[![GitHub release](https://img.shields.io/github/v/release/John710/finapp?color=%2344cc11)](https://github.com/John710/finapp/releases)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/John710/finapp/docker.yml?label=build)](https://github.com/John710/finapp/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
 
[🇷🇺 Русская версия](/docs/README_RU.md)
 
</div>
---
 ## 📸 Screenshots

<p align="center">
  <img src="docs/images/dashboard.png" width="45%" />
  <img src="docs/images/transactions.png" width="45%" />
</p>

<p align="center">
  <img src="docs/images/accounts.png" width="45%" />
  <img src="docs/images/budgets.png" width="45%" />
</p>

<p align="center">
  <img src="docs/images/debts.png" width="45%" />
  <img src="docs/images/recurring.png" width="45%" />
</p>

<p align="center">
  <img src="docs/images/dashboard_light.png" width="45%" />
  <img src="docs/images/transactions_light.png" width="45%" />
</p>

<p align="center">
  <img src="docs/images/mobile_dashboard.png" width="45%" />
  <img src="docs/images/mobile_transactions.png" width="45%" />
</p>
---

## ✨ Features
 
### Core Functionality
- **Income and Expense Tracking** — create transactions of different types
- **Multi-Account Support** — manage multiple accounts (cash, bank, crypto, savings)
- **Categorization** — create and use categories for transactions
- **Tags** — add additional labels for flexible filtering
- **Inter-Account Transfers** — convenient transfer tracking
### Planning & Analytics
- **Budgets** — set category limits and track spending
- **Savings Goals** — create goals and monitor progress
- **Debts** — track your debts and get due date reminders
- **Recurring Transactions** — automate recurring payments and subscriptions
- **Reports & Charts** — visualize expenses and income by category and period
### Notifications & Integrations
- **Web Push Notifications** — get browser notifications
- **Shoutrrr Integration** — send notifications to Telegram, Discord, Gotify and more
- **Smart Reminders** — automatic notifications about upcoming due dates, budget limits exceeded, etc.
### Import & Export
- **CSV Import** — import data from other finance apps
- **CSV Export** — save your data for backup purposes
### Security & Access
- **Multi-User Support** — create separate accounts for family members
- **JWT Authentication** — secure app access
- **Password Encryption** — account protection
### Localization
- **Multi-Language** — English and Russian support
- **Multi-Currency** — auto-synced exchange rates including crypto
---
 
## 🚀 Quick Start
 
### Requirements
- Docker & Docker Compose
### 1. Clone the repository
```bash
git clone https://github.com/John710/finapp.git
cd finapp
```
 
### 2. Configure environment
```bash
cp .env.example .env
```
 
Edit `.env` — at minimum set:
```env
DATABASE_URL=postgres://finapp:yourpassword@postgres:5432/finapp
JWT_SECRET=your_random_secret_here
```
 
### 3. Generate VAPID keys (for Push notifications)
```bash
npx web-push generate-vapid-keys
```
 
### 4. Start
```bash
docker compose up -d
```
 
Open `http://localhost:6253` and complete the initial setup.
 
---
 
## ⚙️ Environment Variables
 
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `6253` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `JWT_SECRET` | JWT signing secret | — |
| `JWT_ACCESS_TTL` | Access token lifetime | `15m` |
| `JWT_REFRESH_TTL` | Refresh token lifetime | `30d` |
| `TZ` | Timezone | `UTC` |
| `VAPID_PUBLIC_KEY` | Web Push public key | — |
| `VAPID_PRIVATE_KEY` | Web Push private key | — |
| `VAPID_SUBJECT` | Web Push subject | `mailto:admin@localhost` |
| `SHOUTRRR_URL` | Shoutrrr notification URL | — |
| `ALLOWED_ORIGINS` | Allowed CORS origins (comma-separated) | — |
| `PUID` | Docker container user ID | `1000` |
| `PGID` | Docker container group ID | `1000` |
 
---
 
## ⌨️ Keyboard Shortcuts
 
| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+K` | Open Command Palette |
| `Shift+/` | Show help |
| `Ctrl+Shift+N` | New transaction |
| `Esc` | Close modal |
| `Ctrl+Enter` | Save form |
 
---
 
## 🛠 Tech Stack
 
| Layer | Technologies |
|-------|-------------|
| **Backend** | Node.js, Fastify, PostgreSQL, JWT, Web Push, Shoutrrr |
| **Frontend** | Vue 3, Pinia, Vue Router, Vue I18n, Tailwind CSS v4, Chart.js, Vite |
| **Infrastructure** | Docker, GitHub Actions, GHCR |
 
---
 
## 🔔 Notifications
 
The app sends automatic notifications for:
- Recurring transaction created
- Upcoming debt due date
- Budget almost exhausted
- Budget exceeded
- Savings goal reached
- Debt fully paid
- Account overdrawn
- Failed login attempt
---
 
## 📁 Project Structure
 
```
finapp/
├── backend/
│   ├── data/              # Static data (currencies)
│   ├── locales/           # i18n translations
│   ├── migrations/        # Database migrations
│   ├── plugins/           # Fastify plugins
│   ├── routes/            # API routes
│   ├── services/          # Business logic
│   └── server.js
├── frontend/
│   └── src/
│       ├── components/    # Vue components
│       ├── composables/   # Vue composables
│       ├── stores/        # Pinia stores
│       ├── views/         # Pages
│       └── router/
├── .github/workflows/     # CI/CD
├── .env.example
├── docker-compose.yml
└── Dockerfile
```
 
---
 
## 🔌 API
 
REST API available at `/api/v1`:
 
`/auth` · `/accounts` · `/transactions` · `/categories` · `/tags` · `/budgets` · `/debts` · `/recurring` · `/reports` · `/currencies` · `/import` · `/export` · `/notifications`
 
---
 
## 🧑‍💻 Local Development
 
```bash
# Backend
cd backend && npm install && npm run dev
 
# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```
 
Requirements: Node.js 22+, PostgreSQL 14+
 
---
 
## 📄 License
 
MIT License — see [LICENSE](LICENSE) for details.