# ─── Stage 1: Frontend ───────────────────────────────────────────────
FROM node:22.16.0-alpine3.22 AS frontend-builder
WORKDIR /app/frontend

# Аргумент для инвалидации кэша
ARG CACHE_BUST=0

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN chmod +x node_modules/.bin/vite && npm run build

# ─── Stage 2: Runtime ────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Аргумент для инвалидации кэша
ARG CACHE_BUST=0

RUN apk add --no-cache su-exec tzdata

ARG SHOUTRRR_VERSION=0.8.0
RUN apk add --no-cache wget \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
         x86_64)  SHOUTRRR_ARCH=amd64  ;; \
         aarch64) SHOUTRRR_ARCH=arm64  ;; \
         armv7l)  SHOUTRRR_ARCH=armv6  ;; \
         *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
       esac \
    && wget -qO /tmp/shoutrrr.tar.gz \
         "https://github.com/containrrr/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_${SHOUTRRR_ARCH}.tar.gz" \
    && tar -xzf /tmp/shoutrrr.tar.gz -C /usr/local/bin shoutrrr \
    && rm /tmp/shoutrrr.tar.gz \
    && chmod +x /usr/local/bin/shoutrrr \
    && shoutrrr --version \
    && apk del wget  # ← удаляем wget в том же слое

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY --from=frontend-builder /app/frontend/dist ./public

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

RUN apk add --no-cache curl

ENV NODE_ENV=production
EXPOSE 6253

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-6253}/health || exit 1

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
