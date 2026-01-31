#!/bin/sh

# Require service name as first argument
if [ -z "$1" ]; then
  echo "Error: Service name required"
  echo "Usage: entrypoint.sh <service-name> [command...]"
  exit 1
fi

DSS_SERVICE_NAME="$1"
shift

# Check if the service secrets directory exists
if [ -d "/var/secrets/$DSS_SERVICE_NAME" ]; then
  for secret_file in /var/secrets/$DSS_SERVICE_NAME/*; do
    # Skip .md5 files and check if file exists
    [ -e "$secret_file" ] || continue
    case "$secret_file" in
      *.md5) continue ;;
    esac

    # Get the filename (e.g., DB_PASSWORD)
    key=$(basename "$secret_file")
    
    # 3. Read the content into a variable
    value=$(cat "$secret_file")
    
    # 4. Export it so the main application can see it
    export "$key"="$value"
    
    echo "Loaded secret: $key"
  done
else
  echo "Warning: No secrets found at /var/secrets/$DSS_SERVICE_NAME"
fi

# Execute the container's original command
# If DSS_SERVICE_CMD is set, use it; otherwise use the passed arguments
if [ -n "$DSS_SERVICE_CMD" ]; then
  exec sh -c "$DSS_SERVICE_CMD"
else
  exec "$@"
fi
