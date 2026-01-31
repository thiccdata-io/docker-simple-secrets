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
  for secret_file in /var/secrets/$DSS_SERVICE_NAME/*.txt; do
    # Check if any .txt files actually exist
    [ -e "$secret_file" ] || continue

    # 1. Get the filename (e.g., DB_PASSWORD.txt)
    filename=$(basename "$secret_file")
    
    # 2. Strip the .txt extension to get the key (e.g., DB_PASSWORD)
    key="${filename%.txt}"
    
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
