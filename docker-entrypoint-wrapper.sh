#!/bin/sh

# Conditional entrypoint wrapper
# If DSS_SERVICE_NAME is set and entrypoint script exists, use it to load secrets
# Otherwise, execute the command directly

if [ -n "$DSS_SERVICE_NAME" ] && [ -f "/var/secrets/entrypoint.sh" ]; then
  exec /bin/sh /var/secrets/entrypoint.sh "$DSS_SERVICE_NAME" "$@"
else
  exec "$@"
fi
