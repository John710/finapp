#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

if ! getent group "$PGID" >/dev/null 2>&1; then
    addgroup -g "$PGID" finapp
fi

GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

if ! getent passwd "$PUID" >/dev/null 2>&1; then
    adduser -u "$PUID" -G "$GROUP_NAME" -D -s /sbin/nologin finapp
fi

USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)

CURRENT_OWNER=$(stat -c '%u' /app)
if [ "$CURRENT_OWNER" != "$PUID" ]; then
    chown -R "$PUID":"$PGID" /app
fi

exec su-exec "$USER_NAME" "$@"
