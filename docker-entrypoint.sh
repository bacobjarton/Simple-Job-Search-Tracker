#!/bin/sh
set -e

# A persistent volume mounted at /data arrives owned by root, which would leave
# the unprivileged user unable to write the SQLite file. Fix ownership while we
# still have the privileges to do it, then hand off to the app user.
#
# Starting as a non-root user already (some platforms do this) is fine: the
# chown is skipped and the command runs as-is.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"
