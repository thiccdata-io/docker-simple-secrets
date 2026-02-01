#!/bin/sh

# Require service name as first argument
if [ -z "$1" ]; then
  echo "Error: Service name required"
  echo "Usage: entrypoint.sh <service-name> [command...]"
  exit 1
fi

DSS_SERVICE_NAME="$1"
shift

# DSS_API_HOST will be injected during deployment, defaults to docker-simple-secrets
DSS_API_HOST="${DSS_API_HOST:-docker-simple-secrets}"
DSS_API_PORT="${DSS_API_PORT:-3000}"

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
  # Try to auto-detect original entrypoint from Docker API
  echo "Auto-detecting original entrypoint..."
  
  # Get the container hostname (usually matches container name/id)
  # Allow override via DSS_HOSTNAME environment variable
  CONTAINER_NAME="${DSS_HOSTNAME:-$(hostname)}"
  
  # Query the DSS API for container info
  API_URL="http://${DSS_API_HOST}:${DSS_API_PORT}/api/container/${CONTAINER_NAME}/info"
  echo "Querying: $API_URL"
  
  CONTAINER_INFO=$(curl -s "$API_URL" 2>/dev/null)
  
  if [ $? -eq 0 ] && [ -n "$CONTAINER_INFO" ]; then
    # Parse JSON response - extract entrypoint and cmd arrays
    # We'll use a simple approach that works in basic sh
    
    # Extract entrypoint array
    ENTRYPOINT=$(echo "$CONTAINER_INFO" | sed -n 's/.*"entrypoint":\[\([^]]*\)\].*/\1/p')
    # Extract cmd array  
    CMD=$(echo "$CONTAINER_INFO" | sed -n 's/.*"cmd":\[\([^]]*\)\].*/\1/p')
    
    # Combine them and clean up JSON formatting
    FULL_CMD="$ENTRYPOINT $CMD"
    # Remove quotes and commas
    FULL_CMD=$(echo "$FULL_CMD" | sed 's/"//g' | sed 's/,/ /g' | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')
    
    if [ -n "$FULL_CMD" ]; then
      echo "Detected original command: $FULL_CMD"
      exec sh -c "$FULL_CMD"
    fi
  else
    echo "Failed to query DSS API at $API_URL"
  fi
  
  # Fallback: if we couldn't detect the command
  echo ""
  echo "Error: Could not determine command to execute"
  echo "Options:"
  echo "  1. Set DSS_SERVICE_CMD environment variable"
  echo "  2. Pass command as arguments: entrypoint.sh <service> <command...>"
  echo "  3. Ensure DSS API is accessible at $DSS_API_HOST:$DSS_API_PORT"
  echo "  4. Mount Docker socket to DSS container: /var/run/docker.sock"
  exit 1
fi
