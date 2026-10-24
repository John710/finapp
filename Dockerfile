# ─────────────────────────────────────────────────────────────────────────────
# FinApp multi-stage Dockerfile
# ─────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=24.22.1
ARG ALPINE_VERSION=3.23
ARG NODE_IMAGE=node:${NODE_VERSION}-alpine${ALPINE_VERSION}@sha256:47019ffab12a48f49795a8279603f87e91a64de017fb9aa874e64f489b686079

# ─── Stage 1: Backend dependencies (built on native build platform) ────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS backend-builder
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ ./

# ─── Stage 2: Frontend (built on native build platform) ────────────────
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 3: Runtime (target platform) ────────────────────────────────
FROM ${NODE_IMAGE}

WORKDIR /app

RUN apk add --no-cache su-exec tzdata curl

ARG SHOUTRRR_VERSION=0.8.0
RUN apk add --no-cache --virtual .build-deps wget \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
         x86_64)  SHOUTRRR_ARCH=amd64  ;; \
         aarch64) SHOUTRRR_ARCH=arm64  ;; \
         armv7l)  SHOUTRRR_ARCH=armv6  ;; \
         *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
       esac \
    && wget -qO /tmp/shoutrrr.tar.gz \
         "https://github.com/containrrr/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_${SHOUTRRR_ARCH}.tar.gz" \
    && wget -qO /tmp/shoutrrr_checksums.txt \
         "https://github.com/containrrr/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_${SHOUTRRR_VERSION}_checksums.txt" \
    && EXPECTED=$(grep -E "shoutrrr_linux_${SHOUTRRR_ARCH}\.tar\.gz$" /tmp/shoutrrr_checksums.txt | awk '{print $1}') \
    && ACTUAL=$(sha256sum /tmp/shoutrrr.tar.gz | awk '{print $1}') \
    && if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then echo "Shoutrrr checksum mismatch" && exit 1; fi \
    && tar -xzf /tmp/shoutrrr.tar.gz -C /usr/local/bin shoutrrr \
    && rm /tmp/shoutrrr.tar.gz /tmp/shoutrrr_checksums.txt \
    && chmod +x /usr/local/bin/shoutrrr \
    && shoutrrr --version \
    && apk del .build-deps

# --chown for the default PUID/PGID (1000) so the runtime entrypoint usually
# skips its recursive chown of /app (which costs ~45s on every container start)
COPY --from=backend-builder --chown=1000:1000 /app ./
COPY --from=frontend-builder --chown=1000:1000 /app/frontend/dist ./public

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 6253

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-6253}/health || exit 1

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
