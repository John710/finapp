## [1.3.1-beta.4] - 2026-10-24

### Performance
- Unit tests, batched CSV import, dashboard aggregate, lint cleanup by @John710
  - vitest in both packages: currency conversion paths, split semantics,
  - CSV import: two-phase (parse rows in JS, then chunked multi-row INSERTs
  - GET /reports/dashboard: one aggregate (month summary, trend, net worth,
  - eslint --fix applied: frontend warnings 390 -> 24, backend 86 -> 89


**Full Changelog**: [v1.3.1-beta.3...v1.3.1-beta.4](https://github.com/John710/finapp/compare/v1.3.1-beta.3...v1.3.1-beta.4)

## [1.3.1-beta.3] - 2026-10-24

### Bug Fixes
- Adapt TOTP to otplib v13 class API by @John710


**Full Changelog**: [v1.3.1-beta.2...v1.3.1-beta.3](https://github.com/John710/finapp/compare/v1.3.1-beta.2...v1.3.1-beta.3)

## [1.3.1-beta.2] - 2026-10-24

### Features
- Splits UI, attachments, tag budgets, merge, 2FA, tokens, viewers, offline PWA by @John710
  - transaction modal: split-by-categories mode with live sum check;
  - attachments modal per transaction (upload/list/download/delete)
  - budgets: optional category + tag chips target, tags shown on cards
  - categories: merge dialog (same-type target only)
  - settings: new Access section — 2FA setup with QR, API tokens (plaintext
  - login: 2FA code field appears on totp_required; api() propagates
  - viewer mode: mutating buttons hidden across all views, read-only banner,
  - service worker: offline app shell (network-first navigation,
  - locale keys for all of the above (en/ru)
- Splits, attachments, tag budgets, merge, 2FA, API tokens, viewers by @John710
  - split transactions: parent row carries the full amount and balance
  - transaction attachments (images/PDF/text up to 5MB, stored as bytea,
  - budgets can target a category, tags, or both (budget_tags table);
  - POST /categories/:id/merge moves transactions, recurring rules and
  - TOTP two-factor auth (otplib + qrcode): setup/enable/disable, code
  - personal API tokens (sha256-stored, shown once, Authorization: Bearer)
  - shared read-only viewer accounts: viewer JWTs read the owner's data,
  - migrations 23-27; errors/auth locale keys (en/ru)


**Full Changelog**: [v1.3.1-beta.1...v1.3.1-beta.2](https://github.com/John710/finapp/compare/v1.3.1-beta.1...v1.3.1-beta.2)

## [1.3.1-beta.1] - 2026-10-24

### Bug Fixes
- Include avatar_set in the refresh payload by @John710


### CI/CD
- Fix stable changelog via explicit range from previous stable tag by @John710


**Full Changelog**: [v1.3.0...v1.3.1-beta.1](https://github.com/John710/finapp/compare/v1.3.0...v1.3.1-beta.1)

## [1.3.0] - 2026-10-24

### CI/CD
- Full changelog for stable releases after a beta series by @John710


### Chores
- Bump github actions to latest majors by @John710
- Bump docker/login-action from 3.4.0 to 4.6.0 (#1) by @dependabot[bot]
  - [Release notes](https://github.com/docker/login-action/releases)
  - [Commits](https://github.com/docker/login-action/compare/74a5d142397b4f367a81961eba4e8cd7edddf772...dbcb813823bdd20940b903addbd779551569679f)
  - dependency-name: docker/login-action


**Full Changelog**: [v1.3.0-beta.3...v1.3.0](https://github.com/John710/finapp/compare/v1.3.0-beta.3...v1.3.0)

## [1.3.0-beta.3] - 2026-10-24

### Bug Fixes
- Avatar UX polish and header dropdown cleanup by @John710
  - remove the theme switch from the avatar dropdown (dedicated header
  - settings avatar placeholder now shows two initials like the header
  - avatar upload: decode via createImageBitmap first (EXIF orientation
  - accepted formats: jpg, jpeg, png, webp, gif (incl. the image/jpg


**Full Changelog**: [v1.3.0-beta.2...v1.3.0-beta.3](https://github.com/John710/finapp/compare/v1.3.0-beta.2...v1.3.0-beta.3)

## [1.3.0-beta.2] - 2026-10-24

### Chores
- Major dependency upgrades by @John710
  - backend: @fastify/cors 11, @fastify/helmet 13, @fastify/rate-limit 11,
  - frontend: pinia 4 (+@vue/devtools-api peer), vue-router 5
  - sanitizeSvg adapted to isomorphic-dompurify v4 (instance is exported


### Features
- Avatar, header profile menu, settings split, skeletons by @John710
  - profile: avatar upload (client-side resize to 256px, webp/jpeg) and removal
  - header: avatar is now clickable — dropdown with theme, language and logout;
  - SettingsView (858 lines) split into section components:
  - skeleton loaders on every list screen (debts, budgets, categories,
- User avatar storage and serving by @John710
  - migration 22: users.avatar (data URL, raster formats only)
  - PATCH /users/settings accepts avatar (validated data URL or null)
  - GET /users/me/avatar serves the image with an ETag (no-cache revalidation)
  - avatar_set flag in the login/refresh/me user payloads
  - errors.avatar_invalid / avatar_not_found locale keys (en/ru)


**Full Changelog**: [v1.3.0-beta.1...v1.3.0-beta.2](https://github.com/John710/finapp/compare/v1.3.0-beta.1...v1.3.0-beta.2)

## [1.3.0-beta.1] - 2026-10-24

### Bug Fixes
- Error handling, i18n coverage and data isolation by @John710
  - global setErrorHandler: no more raw pg/driver error text leaked to clients
  - all route error messages translated via t() with user language (errors.* keys in en/ru)
  - add missing debts.title and session_required_for_password_change locale keys
  - scope crypto rate symbols query by user_id (multi-user isolation)
  - DELETE /budgets,/debts,/categories,/tags,/recurring now return 404 instead of silent 204
  - maxLength validation for account/category/tag names; change-password and
  - account deletion transfer compensation rewritten set-based (removes N+1,
  - exchange rates stored with one multi-row INSERT instead of ~160 round trips
  - compose: enable init (PID 1 zombie reaping for spawned shoutrrr processes)


### CI/CD
- ESLint/Prettier, lint+blackbox+trivy jobs, dependabot by @John710
  - ESLint (flat config) + Prettier + .editorconfig in both backend and frontend
  - CI: lint job (node 24, npm cache), test job building the image and running
  - dependabot for github-actions, npm (both dirs) and docker
  - engines >=24 and packageManager pinned; in-range dependency updates
- Mark suffixed tags as pre-releases on GitHub by @John710

### Documentation
- Backups, reverse proxy examples, upgrade and migration warnings by @John710
  - backup/restore via pg_dump with a cron example (EN + RU)
  - Caddy/Nginx reverse proxy snippets and TRUSTED_PROXIES note
  - warning that migrate:down is destructive; default POSTGRES_PASSWORD warning
  - DATABASE_URL documented in .env.example and the variables table


### Features
- Editable transactions, pagination, URL filters, UX polish by @John710
  - transactions: edit modal (updateTransaction was API-only before), pager
  - reports: single /by-category request (typed view is a client-side filter),
  - money inputs normalize comma decimal separator (parseAmount) across all forms
  - stores: loading reset in finally (no permanent spinner on API errors);
  - skeleton loaders for transactions/accounts; aria-labels on icon buttons;
  - refactor: shared composables useTransactionDisplay / useChartOptions,
  - wine category icon -> DrinkIcon (BottleWineIcon removed from free set in 4.3)


### Performance
- Decimal money math, SQL report aggregation, query indexes by @John710
  - currency conversions run through decimal.js (convertAmountDecimal) instead
  - reports aggregate in SQL (SUM/GROUP BY per currency x dimension) instead of
  - migration 21: composite indexes (user_id, date) and (user_id, category_id)


**Full Changelog**: [v1.2.8...v1.3.0-beta.1](https://github.com/John710/finapp/compare/v1.2.8...v1.3.0-beta.1)

## [1.2.8-beta.2] - 2026-10-24

### Bug Fixes
- Dark theme elevation and gradient cards by @John710
  - app frame darkened to slate-950 so slate-900 cards stand out
  - restore soft shadows in dark mode (shadow-card-dark) instead of none
  - darken gradient stat cards in dark theme
  - add dark variants for active pill navigation states


**Full Changelog**: [v1.2.8-beta.1...v1.2.8-beta.2](https://github.com/John710/finapp/compare/v1.2.8-beta.1...v1.2.8-beta.2)

## [1.2.8-beta.1] - 2026-10-24

### Features
- Lavender pastel UI redesign by @John710
  - violet primary palette (#7C6FDE) on soft lavender app background
  - Inter + Montserrat variable fonts, self-hosted via @fontsource
  - rounded app-frame shell, pill sidebar navigation, greeting header
  - gradient stat cards, borderless soft-shadow cards, pill buttons
  - pastel ECharts styling: rounded bars, gradient fills, soft axes


**Full Changelog**: [v1.2.7...v1.2.8-beta.1](https://github.com/John710/finapp/compare/v1.2.7...v1.2.8-beta.1)

## [1.2.7] - 2026-10-24

### Bug Fixes
- SPA index 500 after @fastify/static v10 upgrade by @John710


**Full Changelog**: [v1.2.6...v1.2.7](https://github.com/John710/finapp/compare/v1.2.6...v1.2.7)

## [1.2.6] - 2026-10-24

### Bug Fixes
- Audit fixes for error paths, auth flow and money display by @John710
  - deduplicate concurrent /auth/refresh calls (one-time-use cookie made
  - replace nonexistent $toast.showToast calls (TypeError in every push/error
  - import missing logger in stores/rates.js (ReferenceError on rate failures)
  - checkAuth no longer treats network errors as logout
  - bootstrap config fetch bounded with a 3s timeout
  - logout clears user-scoped localStorage keys; login returns to the original
  - push unsubscribe notifies the server before unsubscribing the browser
  - formatCurrency falls back to plain formatting for unknown currency codes
  - SafeSvg reuses utils/sanitizeSvg (single DOMPurify config); currency
  - hide delete action on incoming transfer legs (managed via source row)
- Security and data-integrity audit fixes by @John710
  - rate limit was dead code: Fastify 5 removed req.routerPath, so allowList()
  - transfers: bidirectional transfer_pair_id (migration 0020 with backfill);
  - account deletion no longer double-deducts other accounts' balances
  - net-worth anchored to current account balances; timezone-safe month grouping
  - secrets (shoutrrr_url, coingecko key) returned masked with *_set flags only;
  - atomic refresh-token rotation with replay detection; change-password
  - network I/O (push, shoutrrr, coingecko) moved out of open DB transactions;
  - cron recurring: one transaction per rule with SKIP LOCKED, bounded catch-up,
  - shoutrrr webhooks: 15s timeout, masked errors, optional private-address
  - validation: querystring/params JSON schemas across routes, ownership checks
  - /health also served at root so Docker/compose healthchecks verify the DB
  - blackbox-test.mjs: runnable verification suite (54 assertions)


**Full Changelog**: [v1.2.5...v1.2.6](https://github.com/John710/finapp/compare/v1.2.5...v1.2.6)

## [1.2.5-beta.5] - 2026-06-15

### Bug Fixes
- Sending push notifications by @John710

**Full Changelog**: [v1.2.5-beta.4...v1.2.5-beta.5](https://github.com/John710/finapp/compare/v1.2.5-beta.4...v1.2.5-beta.5)

## [1.2.5-beta.4] - 2026-06-15

### Bug Fixes
- Reset browser push subscription when VAPID keys change by @John710- Disable default request logging, exclude /health, require auth for vapid-public-key by @John710

**Full Changelog**: [v1.2.5-beta.2...v1.2.5-beta.4](https://github.com/John710/finapp/compare/v1.2.5-beta.2...v1.2.5-beta.4)

## [1.2.5-beta.2] - 2026-06-15

### Bug Fixes
- Enable info logging for auth and page access; optimistic VAPID state update by @John710

### CI/CD
- Update latest tag only on stable releases by @John710- Disable major.minor Docker tag for pre-release tags by @John710

**Full Changelog**: [v1.2.5-beta.1...v1.2.5-beta.2](https://github.com/John710/finapp/compare/v1.2.5-beta.1...v1.2.5-beta.2)

## [1.2.5-beta.1] - 2026-06-15

### Bug Fixes
- Implement remaining audit tasks (auth logs, encryption key validation, push permission, setup caching) by @John710- Update push state after VAPID generate/delete by @John710

**Full Changelog**: [v1.2.4...v1.2.5-beta.1](https://github.com/John710/finapp/compare/v1.2.4...v1.2.5-beta.1)

## [1.2.4] - 2026-06-15

### Bug Fixes
- Minor endpoint fixes in categories, currencies, health and import by @John710

### CI/CD
- Skip release/version-bump commits in changelog by @John710- Fix git-cliff sort_commits value and tag_pattern by @John710

### Chores
- Update frontend dependencies and version by @John710- Add migrations for indexes/constraints and Coingecko key length; update refresh tokens migration by @John710- Update backend dependencies and package metadata by @John710- Adjust issue templates andconfig by @John710- Update Docker build, compose, env example, entrypoint and docs by @John710

### Features
- Replace header/auth iconswith app logo image; add RegisterView, remove SetupView by @John710- Update main views (dashboard chart, accounts, settings, transactions, etc.) by @John710- Update stores, auth stateand translations by @John710- Encrypt shoutrrr/coingecko secrets, fix test request body, update notify service by @John710- Improve auth plugin and user routes (refresh tokens, encrypted fields) by @John710

### Refactor
- App bootstrap, router,i18n and vite config by @John710- Add utility modules and update composables, api and icons by @John710- Update shared UI components and add BaseModal/SafeSvg by @John710- Run migrations via entrypoint only, add config route and migrate script, updateserver bootstrap by @John710

**Full Changelog**: [v1.2.3...v1.2.4](https://github.com/John710/finapp/compare/v1.2.3...v1.2.4)

## [1.2.3] - 2026-06-14

### Bug Fixes
- Move sessions and password endpoints under /users to require auth by @John710- Build backend and frontend on native platform to avoid qemu arm64 crashes by @John710

### CI/CD
- Release workflow with git-cliff changelog generation by @John710

### Features
- Add eye toggle to change password fields by @John710- Settings improvements - statuses, validation, security, cards by @John710- Coingecko key test, change password and sessions endpoints by @John710- Hide CoinGecko save button until key changed by @John710- Per-user vapid keys and shoutrrr url by @John710- Per-user vapid and shoutrrr settings ui by @John710

**Full Changelog**: [v1.2.2...v1.2.3](https://github.com/John710/finapp/compare/v1.2.2...v1.2.3)

## [1.2.2] - 2026-06-14

### CI/CD
- Release workflow with git-cliff changelog generation by @John710

### Documentation
- Remove VAPID_* and SHOUTRRR_URL env vars, update setup docs by @John710

### Features
- Per-user vapid and shoutrrr settings ui by @John710- Per-user vapid keys and shoutrrr url by @John710- Add vapid and shoutrrr columns to users table by @John710

**Full Changelog**: [v1.2.1...v1.2.2](https://github.com/John710/finapp/compare/v1.2.1...v1.2.2)

## [1.2.1] - 2026-06-13

### Bug Fixes
- Styled confirm modals and translated toasts for demo/clear by @John710


**Full Changelog**: [v1.2.0...v1.2.1](https://github.com/John710/finapp/compare/v1.2.0...v1.2.1)

## [1.2.0] - 2026-06-13

### Bug Fixes
- Remove inaccurate total counter increments by @John710- Accounts store sort order matches backend by @John710- Remove global LIMIT 1 user lookups by @John710
- Login failure notification targets correct user by @John710
- Remove undefined isDragClick reference by @John710
- Add hover effect to github menu icons by @John710- Add some icons by @John710- Add update notifier by @John710- Update versions by @John710- Add some traslates by @John710

### Chores
- Add remaining v1.2.0 files by @John710- Remove console.log from production service by @John710- Update notification titles to FinApp by @John710- Update CSV export filename prefix to finapp by @John710- Update .env.example title to FinApp by @John710- Update app name in service worker notifications by @John710- Update User-Agent from FinanceApp to FinApp by @John710- Update app name in header and sidebar by @John710- Update app name in manifest and index.html by @John710- Update license to AGPL-3.0-or-later in package.json and package-lock.json by @John710- Update license to AGPL-3.0-or-later in package.json and package-lock.json by @John710- Add LICENSE file (AGPL-3.0-or-later) by @John710

### Documentation
- Sync Russian README with English version by @John710- Fix tech stack and version bump to 1.2.0 by @John710


### Features
- Add loading states to Login and Setup views by @John710- Process recurring and debt notifications per user by @John710
- Scope currencies and update health version by @John710- Scope demo data and admin endpoints to user by @John710- Scope import to user and update account balances by @John710- Scope export to user by @John710
- Scope reports to user by @John710
- Scope accounts to user by @John710
- Add refresh token storage and rotation by @John710- Add user_id columns for multi-tenancy by @John710- Add optional SSL via DATABASE_SSL env variable by @John710

### Refactor
- TagsView uses Pinia store with loading states by @John710

### Security
- Enable CSP without upgrade-insecure-requests, disable HSTS/COOP/COEP, and tighten rate limiting by @John710


**Full Changelog**: [v1.0.0...v1.2.0](https://github.com/John710/finapp/compare/v1.0.0...v1.2.0)

## [1.0.0] - 2026-06-11

