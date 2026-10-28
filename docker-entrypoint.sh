#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Validate numeric IDs and fall back to defaults to avoid shell arithmetic errors
case "$PUID" in ''|*[!0-9]*) PUID=1000;; esac
case "$PGID" in ''|*[!0-9]*) PGID=1000;; esac

run_migrations() {
  echo "Running database migrations..."
  node scripts/migrate.js
}

# If already running as a non-root user, run migrations and execute the command directly.
if [ "$(id -u)" -ne 0 ]; then
    run_migrations
    exec "$@"
fi

# Running as root: ensure the requested group/user exist, then drop privileges.
# If the UID/GID already belong to an existing user (e.g. the base image's `node` user), reuse it.
if ! getent group "$PGID" >/dev/null 2>&1; then
    addgroup -g "$PGID" finapp
fi
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)

if ! getent passwd "$PUID" >/dev/null 2>&1; then
    adduser -u "$PUID" -G "$GROUP_NAME" -D -s /sbin/nologin "finapp$PUID"
fi

# Fix ownership of the application files to match the runtime user.
CURRENT_OWNER=$(stat -c '%u' /app)
if [ "$CURRENT_OWNER" != "$PUID" ]; then
    chown -R "$PUID":"$PGID" /app
fi

# Run migrations as the target user so any generated files share ownership.
# Use the numeric "uid:gid" form: a bare user name would take that user's primary
# group from /etc/passwd and silently ignore PGID when PUID is an existing user.
su-exec "$PUID:$PGID" node scripts/migrate.js
exec su-exec "$PUID:$PGID" "$@"
