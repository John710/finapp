<div align="center">
<p align="center">
  <img src="docs/logo.png" width="180">
</p>

<h1 align="center">FinApp</h1>
 
**A self-hosted, open-source personal finance tracker**
 
[![Docker Image](https://ghcr-badge.egpl.dev/john710/finapp/size?color=%2344cc11&tag=latest&label=image+size)](https://github.com/John710/finapp/pkgs/container/finapp)
[![GitHub release](https://img.shields.io/github/v/release/John710/finapp?color=%2344cc11)](https://github.com/John710/finapp/releases)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/John710/finapp/docker.yml?label=build)](https://github.com/John710/finapp/actions)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL%20v3-blue.svg)](LICENSE)
 
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
- **Calendar Feed (iCal)** — subscribe to your upcoming subscription payments in any calendar app
### Import & Export
- **CSV Import** — import data from other finance apps
- **CSV Export** — save your data for backup purposes
### Security & Access
- **Multi-User Support** — every family member has their own private finances
- **Family Sharing** — share accounts, budgets, debts and recurring rules with the whole family or specific users, with view/edit permissions
- **Admin User Management** — the first user administers accounts: create members, reset passwords
- **Two-Factor Authentication** — TOTP codes from any authenticator app
- **Personal API Tokens** — bearer tokens for external clients
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
 
Fill in the three required secrets in `.env` — `docker compose` refuses to start while any of them is empty. Generate each value with:
```bash
openssl rand -hex 16   # POSTGRES_PASSWORD
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY
```

```env
POSTGRES_PASSWORD=<output of openssl rand -hex 16>
JWT_SECRET=<output of openssl rand -hex 32>
ENCRYPTION_KEY=<output of openssl rand -hex 32>
```

`ENCRYPTION_KEY` must be exactly 64 hex characters; without a valid one the container crash-loops at start. Back it up: changing it makes already-stored encrypted settings (VAPID private key, Shoutrrr URL, CoinGecko key) unreadable.

The database connection string is built automatically from `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`. To use an external Postgres server, edit the `DATABASE_URL` line under `finapp.environment` in `docker-compose.yml` (it is set there explicitly, so a `DATABASE_URL` in `.env` is not forwarded) and drop the `db` service and `depends_on`.
 
### 3. Start
```bash
docker compose up -d
```
 
Open `http://localhost:6253` and complete the initial setup.
 
### HTTPS / Reverse Proxy

The application does **not** enforce HTTPS or send HSTS headers itself. For production deployments, place FinApp behind a reverse proxy (Traefik, Nginx, Caddy, etc.) and configure TLS and HSTS there. This keeps plain HTTP access working for local development without breaking the app.

Example — Caddy:

```
fin.example.com {
    reverse_proxy 127.0.0.1:6253
}
```

Example — Nginx:

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

When running behind a proxy, set `TRUSTED_PROXIES` to the proxy IP/CIDR so the app reads the real client IP from `X-Forwarded-For` (used by rate limiting and security notifications).

> ⚠️ **Change the default `POSTGRES_PASSWORD`** (and `POSTGRES_USER`/`POSTGRES_DB`) if the PostgreSQL port is reachable from other machines, or if the `db` container is shared. The bundled defaults are for local use only.

### Backups

The database holds all your data — back it up regularly. The included compose file stores it in the `finapp_db_data` volume.

```bash
# Backup (adjust the container name if yours differs)
docker exec finapp-db pg_dump -U finapp -d finapp > finapp_$(date +%F).sql

# Restore
cat finapp_2026-01-01.sql | docker exec -i finapp-db psql -U finapp -d finapp
```

A daily cron example: `0 3 * * * docker exec finapp-db pg_dump -U finapp -d finapp | gzip > /backups/finapp_$(date +\%F).sql.gz`

CSV export (`Settings → Export`) is a convenience snapshot of transactions, not a full database backup.

### Upgrades

Pull the new image and recreate the container; database migrations run automatically on container start:

```bash
docker compose pull && docker compose up -d
```

The `/health` endpoint returns HTTP 503 when the database connection is lost — suitable for uptime monitoring.

---
 
## ⚙️ Environment Variables
 
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `6253` |
| `POSTGRES_USER` | PostgreSQL user (db service) | `finapp` |
| `POSTGRES_PASSWORD` | PostgreSQL password (db service) — **required**, use a URL-safe value such as `openssl rand -hex 16` | — |
| `POSTGRES_DB` | PostgreSQL database (db service) | `finapp` |
| `DATABASE_URL` | Full PostgreSQL URL — only for an external database instance. Compose builds it from `POSTGRES_*` and sets it explicitly in `docker-compose.yml`; edit it there (a value in `.env` is not forwarded) | — |
| `JWT_SECRET` | JWT signing secret — **required**, at least 32 characters (`openssl rand -hex 32`) | — |
| `JWT_ACCESS_TTL` | Access token lifetime | `15m` |
| `JWT_REFRESH_TTL` | Refresh token lifetime | `30d` |
| `TZ` | Timezone | `UTC` |
| `ALLOWED_ORIGINS` | Allowed CORS origins (comma-separated) | — |
| `TRUSTED_PROXIES` | Trusted reverse proxies (comma-separated) | — |
| `SHOUTRRR_BLOCK_PRIVATE_TARGETS` | Reject Shoutrrr/webhook targets on private/loopback addresses (SSRF protection). Set `false` to allow notifying services on your local network | `true` |
| `SHOUTRRR_ALLOWED_HOSTS` | Comma-separated hostnames exempt from the private-address check, e.g. a self-hosted Gotify that resolves to a LAN IP | — |
| `DATABASE_SSL` | Enable SSL/TLS for PostgreSQL connection | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Reject unauthorized SSL certificates | `true` |
| `PUID` | Docker container user ID | `1000` (reuses base image `node` user) |
| `PGID` | Docker container group ID | `1000` |
| `DEFAULT_LANG` | Default language for new users (`ru` or `en`) | `en` |
| `ENCRYPTION_KEY` | 64-char hex key for sensitive user data — **required**, the server does not start without it (`openssl rand -hex 32`) | — |
| `COINGECKO_API_KEY` | Server-wide CoinGecko API key, used when a user has not saved their own in Settings | — |
| `LOG_LEVEL` | Log verbosity: `fatal`, `error`, `warn`, `info`, `debug`, `trace` | `info` (`debug` outside production) |
| `PUSH_SEND_TIMEOUT` | Timeout for sending one Web Push notification, in milliseconds | `10000` |
 
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
| **Frontend** | Vue 3, Pinia, Vue Router, Vue I18n, Tailwind CSS v4, ECharts, Vite |
| **Infrastructure** | Docker, GitHub Actions, GHCR |
 
---

## 👪 Family Sharing

Every user keeps **private finances by default**. Anything can additionally be shared — per entity:

1. The **first registered user** becomes the administrator. They create accounts for family members in **Settings → Access & API → Users** (each member then logs in with their own credentials). Registration itself stays closed.
2. Open an account, budget, debt or recurring rule and press **Share**. Grant access to the **whole family** or to **specific users**, with either permission:
   - **Can view** — the entity and its history appear in the grantee's lists, dashboards and reports
   - **Can edit** — additionally lets the grantee work with the data: add transactions to a shared account (transfers included), record payments on a shared debt
3. Shared entities are badged **Shared** for the owner and show the owner's name for the grantee. Un-share at any time from the same dialog.

Notes:
- **Categories and tags are global** — shared by every user of the instance.
- Only the owner can edit the entity itself (rename an account, change a budget limit); CRUD of transactions on a shared account requires the *edit* permission.
- Transactions store `created_by` — who actually entered them.
- Accounts with edit permission count towards the grantee's reports and net worth.

---

## 🔔 Notifications

Notifications are configured per-user in **Settings**:

- **Web Push** — generate your personal VAPID keys, subscribe the browser, and receive push notifications.
- **Shoutrrr** — configure one or more Shoutrrr URLs to send notifications to Telegram, Discord, Gotify, email, generic webhooks, etc. Gotify 3.x app tokens (`gtfya.…`) are supported; the URL form is `gotify://host/<token>` (no extra path segments such as `/messages`).

> **Note:** Web Push requires a secure context (`https://` or `localhost`). It will not work on plain `http://` IP addresses.

> **Note:** A Shoutrrr `generic` webhook URL carries its token in the query string. Point it at an `https://` endpoint only: on plain `http://` the token leaves your network in clear text and lands in the receiving server's access logs. FinApp stores the URL encrypted at rest, but that does not protect it in transit.

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
 
## 📅 Calendar feed (iCal)

**Settings → Access → Calendar feed** creates a personal iCal link you can paste into any
calendar app (Apple Calendar, Google Calendar, Thunderbird, DAVx⁵…). The feed is read-only and
lists the projected occurrences of your active recurring rules for the next 180 days — paid and
skipped dates are marked, your transactions and balances are never exposed.

Each link is a separate token. The full URL is shown once when it is created and only its hash is
stored, so revoke and re-create instead of sharing an old link. Revoking takes effect on the next
refresh.

> **Warning:** the token travels in the query string, which is where most proxies log requests. Put the
> feed behind a router that disables access logging, otherwise the link ends up in your reverse proxy's
> log file and in anything that reads it. With Traefik 3.x, add a second router to the container —
> a longer rule wins over the `Host`-only one (priority defaults to rule length), TLS comes from the
> `websecure` entrypoint, and the router must drop the forward-auth middleware your app uses, because a
> calendar client cannot answer a Tinyauth/ForwardAuth challenge:
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
> Check it took effect by asking for the feed from outside your LAN — it must return
> `200`/`text/calendar` rather than the gate page — and then confirm the proxy logged nothing:
> `grep -c 'recurring.ics' /path/to/access.log` stays at 0.
>
> The alternative is dropping query strings from every logged request
> (`--accesslog.fields.queryparameters.defaultmode=drop`), which also hides them while debugging.
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
 
`/auth` · `/users` (profile, sessions, 2FA, personal API tokens at `/users/tokens`) · `/admin` (user management, demo data) · `/accounts` · `/transactions` (+ `/transactions/:id/attachments`) · `/attachments` · `/categories` · `/tags` · `/budgets` · `/debts` · `/recurring` (+ `/recurring.ics` calendar feed, `/recurring/feed-tokens`, `/recurring/occurrences`) · `/shares` · `/reports` (`summary`, `by-category`, `trend`, `net-worth`, `savings-rate`, `recurring-plan`, `dashboard`) · `/currencies` · `/import` · `/export` · `/notifications` · `/config` · `/health`
 
---
 
## 🧑‍💻 Local Development
 
```bash
# Backend
cd backend && npm install && npm run dev
 
# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```
 
Requirements: Node.js 24+, PostgreSQL 15+

Linting: `cd backend && npm run lint` / `cd frontend && npm run lint` (ESLint + Prettier configs are included).

> ⚠️ **`npm run migrate:down` is destructive.** Several down-migrations drop columns with user data (e.g. migration 15 removes `user_id` from core tables). Always take a `pg_dump` backup before rolling anything back.

---
 
## 📄 License
 
This project is licensed under the GNU Affero General Public License v3.0 (AGPL v3) - see the [LICENSE](LICENSE) file for details.