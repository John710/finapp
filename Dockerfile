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

# tini: PID 1 init that forwards signals and reaps zombies (the shoutrrr plugin
# spawns child processes; the entrypoint ends in `exec node`)
RUN apk add --no-cache su-exec tzdata curl tini

# Maintained fork of containrrr/shoutrrr (0.8.0 rejects Gotify 3.x tokens).
# Checksums are pinned here (not fetched from the release) so a tampered
# release asset is detected, not only a corrupted download.
ARG SHOUTRRR_VERSION=0.22.1
RUN apk add --no-cache --virtual .build-deps wget \
    && ARCH=$(uname -m) \
    && case "$ARCH" in \
         x86_64)  SHOUTRRR_ARCH=amd64;   EXPECTED=c6621f7a34b631705e5e94d33056d6368901495835ad07166034b644a1d46d86 ;; \
         aarch64) SHOUTRRR_ARCH=arm64v8; EXPECTED=f5198eacbc481552e169bb5d67cc9652d19c5494f06720832b0d85fc5eb368b4 ;; \
         armv7l)  SHOUTRRR_ARCH=armhf;   EXPECTED=1e99f7bcd8b60e3bc952381875f8766cba9ac8013144005ebe503587018954ee ;; \
         *) echo "Unsupported arch: $ARCH" && exit 1 ;; \
       esac \
    && wget -qO /tmp/shoutrrr.tar.gz \
         "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${SHOUTRRR_VERSION}/shoutrrr_linux_${SHOUTRRR_ARCH}_${SHOUTRRR_VERSION}.tar.gz" \
    && ACTUAL=$(sha256sum /tmp/shoutrrr.tar.gz | awk '{print $1}') \
    && if [ "$EXPECTED" != "$ACTUAL" ]; then echo "Shoutrrr checksum mismatch" && exit 1; fi \
    && tar -xzf /tmp/shoutrrr.tar.gz -C /usr/local/bin shoutrrr \
    && rm /tmp/shoutrrr.tar.gz \
    && chmod +x /usr/local/bin/shoutrrr \
    && shoutrrr --help >/dev/null \
    && apk del .build-deps

# --chown for the default PUID/PGID (1000) so the runtime entrypoint usually
# skips its recursive chown of /app (which costs ~45s on every container start)
COPY --from=backend-builder --chown=1000:1000 /app ./
COPY --from=frontend-builder --chown=1000:1000 /app/frontend/dist ./public

COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 6253

# start-period: migrations run before the server starts listening
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -sf http://localhost:${PORT:-6253}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--", "entrypoint.sh"]
CMD ["node", "server.js"]
