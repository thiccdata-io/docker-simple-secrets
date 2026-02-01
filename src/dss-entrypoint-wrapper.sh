#!/bin/sh

# Require service name as first argument
if [ -z "$1" ]; then
  echo "Error: Service name required"
  echo "Usage: dss-entrypoint-wrapper.sh <service-name> [command...]"
  exit 1
fi

DSS_SERVICE_NAME="$1"
shift

# Load secrets as environment variables
if [ -d "/var/secrets/$DSS_SERVICE_NAME" ]; then
  echo "Loading secrets for service: $DSS_SERVICE_NAME"
  secret_count=0
  for secret_file in /var/secrets/$DSS_SERVICE_NAME/*; do
    # Skip .md5 files and metadata files, check if file exists
    [ -e "$secret_file" ] || continue
    case "$secret_file" in
      *.md5|._*) continue ;;
    esac

    # Get the filename (e.g., DB_PASSWORD)
    key=$(basename "$secret_file")
    
    # Read the content into a variable
    value=$(cat "$secret_file")
    
    # Export it so the main application can see it
    export "$key"="$value"
    
    echo "  ✓ Loaded secret: $key"
    secret_count=$((secret_count + 1))
  done
  echo "Loaded $secret_count secret(s)"
else
  echo "Warning: No secrets found at /var/secrets/$DSS_SERVICE_NAME"
fi

# Determine what command to run (priority order):
# 1. DSS_SERVICE_CMD environment variable (manual override)
# 2. Arguments passed to this script ($@)
# 3. Query Docker API for original entrypoint/command
if [ -n "$DSS_SERVICE_CMD" ]; then
  echo "Using DSS_SERVICE_CMD: $DSS_SERVICE_CMD"
  exec sh -c "$DSS_SERVICE_CMD"
elif [ $# -gt 0 ]; then
  echo "Using provided command: $*"
  exec "$@"
else
  # Try to auto-detect original entrypoint from .container-info file
  echo "Auto-detecting original entrypoint..."
  
  CONTAINER_INFO_FILE="/var/secrets/$DSS_SERVICE_NAME/.container-info"
  
  # Wait for .container-info file to be generated (race condition with container watcher)
  MAX_WAIT=3
  WAITED=0
  while [ ! -f "$CONTAINER_INFO_FILE" ] && [ $WAITED -lt $MAX_WAIT ]; do
    if [ $WAITED -eq 0 ]; then
      echo "Waiting for container info file..."
    fi
    sleep 1
    WAITED=$((WAITED + 1))
  done
  
  if [ -f "$CONTAINER_INFO_FILE" ]; then
    echo "Reading container info from $CONTAINER_INFO_FILE"
    
    # Source the container info file to load variables
    . "$CONTAINER_INFO_FILE"
    
    # Combine entrypoint and cmd
    FULL_CMD="$ORIGINAL_ENTRYPOINT $ORIGINAL_CMD"
    
    if [ -n "$FULL_CMD" ]; then
      echo "Detected original command: $FULL_CMD"
      exec sh -c "$FULL_CMD"
    fi
  else
    echo "Container info file not found at $CONTAINER_INFO_FILE"
  fi
  
  # Fallback: if we couldn't detect the command
  echo ""
  echo "Error: Could not determine command to execute"
  echo "Options:"
  echo "  1. Set DSS_SERVICE_CMD environment variable"
  echo "  2. Pass command as arguments: dss-entrypoint-wrapper.sh <service> <command...>"
  echo "  3. Deploy secrets to generate .container-info file"
  exit 1
fi
