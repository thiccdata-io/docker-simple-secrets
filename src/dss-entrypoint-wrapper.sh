#!/bin/sh
set -e

# --- Configuration ---
CONFIG_SERVICE="http://my-config-service:8080"
RETRIES=10
WAIT_SECONDS=5

# --- 0. Debug Check ---
if [ -n "$DSS_DEBUG" ]; then
    echo "🐞 DSS_DEBUG is set: Verbose output enabled."
fi

# --- 1. Dependency Detection & Selection ---
USE_TOOL=""
# Check for GNU Wget
if command -v wget > /dev/null; then
    if ! wget --version 2>&1 | grep -q "BusyBox"; then
        USE_TOOL="wget"
    fi
fi
# If no GNU wget, check for curl
if [ -z "$USE_TOOL" ] && command -v curl > /dev/null; then
    USE_TOOL="curl"
fi
# If neither, attempt to install wget
if [ -z "$USE_TOOL" ]; then
    echo "⚠️  Neither 'curl' nor GNU 'wget' found. Attempting to install wget..."
    if [ "$(id -u)" -ne 0 ]; then
        echo "❌ CRITICAL ERROR: Missing download tool and cannot install automatically (non-root user)."
        exit 1
    fi
    if [ -f /etc/alpine-release ]; then
        apk add --no-cache wget
    elif [ -f /etc/debian_version ]; then
        apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*
    else
        echo "❌ Error: Unknown OS. Please use an image with wget/curl pre-installed."
        exit 1
    fi
    echo "✅ GNU wget installed."
    USE_TOOL="wget"
fi
[ -n "$DSS_DEBUG" ] && echo "🔍 Using download tool: $USE_TOOL"

# --- 2. Helper Functions ---
get_status_code() {
    URL="$1"
    if [ "$USE_TOOL" = "curl" ]; then
        if [ -n "$DSS_DEBUG" ]; then
            curl -v -o /dev/null -w "%{http_code}" "$URL"
        else
            curl -s -o /dev/null -w "%{http_code}" "$URL"
        fi
    else
        OUTPUT=$(wget --server-response --spider "$URL" 2>&1)
        if [ -n "$DSS_DEBUG" ]; then echo "$OUTPUT" >&2; fi
        echo "$OUTPUT" | awk '/^  HTTP/{print $2}' | tail -1
    fi
}

download_file() {
    URL="$1"
    DEST="$2"
    if [ "$USE_TOOL" = "curl" ]; then
        if [ -n "$DSS_DEBUG" ]; then
            curl -v -o "$DEST" "$URL"
        else
            curl -s -o "$DEST" "$URL"
        fi
    else
        if [ -n "$DSS_DEBUG" ]; then
            wget -O "$DEST" "$URL"
        else
            wget -qO "$DEST" "$URL"
        fi
    fi
}

# --- 3. Fetch Secret Manifest ---
echo "🔄 Connecting to Config Service: $CONFIG_SERVICE/api/services"
MANIFEST_TEMP="/tmp/secrets_manifest.txt"

for i in $(seq 1 $RETRIES); do
    HTTP_CODE=$(get_status_code "$CONFIG_SERVICE/api/services")
    [ -z "$HTTP_CODE" ] && HTTP_CODE=0

    if [ "$HTTP_CODE" -eq 200 ]; then
        echo "✅ Config service ready. Downloading manifest..."
        download_file "$CONFIG_SERVICE/api/services" "$MANIFEST_TEMP"
        break
    elif [ "$HTTP_CODE" -eq 423 ]; then
        echo "⏳ Service Locked (423). Retrying in $WAIT_SECONDS s... ($i/$RETRIES)"
        sleep $WAIT_SECONDS
    elif [ "$HTTP_CODE" -eq 401 ] || [ "$HTTP_CODE" -eq 403 ]; then
        echo "❌ CRITICAL ERROR: Access Denied ($HTTP_CODE)."
        echo "   This indicates a misconfiguration with the Docker labels or a bug that needs to be reported."
        exit 1
    else
        echo "⚠️  Connection failed or unexpected status ($HTTP_CODE). Retrying..."
        sleep $WAIT_SECONDS
    fi
    if [ "$i" -eq "$RETRIES" ]; then
        echo "❌ Error: Timed out waiting for Config Service."
        exit 1
    fi
done

# Process Manifest
echo "📂 Processing manifest..."
while IFS='|' read -r TARGET_PATH SOURCE_URL || [ -n "$TARGET_PATH" ]; do
    if [ -z "$TARGET_PATH" ] || [ -z "$SOURCE_URL" ]; then continue; fi
    DIR=$(dirname "$TARGET_PATH")
    mkdir -p "$DIR"
    echo "⬇️  Downloading: $TARGET_PATH"
    if ! download_file "$SOURCE_URL" "$TARGET_PATH"; then
        echo "❌ Failed to download file from $SOURCE_URL"
        exit 1
    fi
done < "$MANIFEST_TEMP"

# --- 4. Fetch & Parse Container Info (The "Happy Path" Fix) ---
echo "🔍 Fetching original start command..."
INFO_TEMP="/tmp/container_info.env"

# Download the info file (It's formatted as KEY="VALUE")
if ! download_file "$CONFIG_SERVICE/api/services/.container-info" "$INFO_TEMP"; then
    echo "⚠️  Could not fetch .container-info. Falling back to manual CMD..."
else
    # Load the variables from the file
    . "$INFO_TEMP"
    
    # Helper to parse Docker JSON arrays (e.g. ["npm", "start"]) into Shell strings ("npm" "start")
    # This ensures arguments with spaces are preserved correctly.
    parse_docker_array() {
        input="$1"
        # 1. Remove leading [ and trailing ]
        # 2. Replace "," with " " (quote-comma-quote -> quote-space-quote)
        # 3. Result is effectively a space-separated list of quoted strings
        echo "$input" | sed -e 's/^\[//' -e 's/\]$//' -e 's/","/" "/g'
    }

    FINAL_CMD=""

    # Process Entrypoint
    if [ -n "$ORIGINAL_ENTRYPOINT" ] && [ "$ORIGINAL_ENTRYPOINT" != "null" ]; then
        CLEAN_EP=$(parse_docker_array "$ORIGINAL_ENTRYPOINT")
        FINAL_CMD="$CLEAN_EP"
    fi

    # Process Cmd (Append to Entrypoint if it exists, or treat as main command)
    if [ -n "$ORIGINAL_CMD" ] && [ "$ORIGINAL_CMD" != "null" ]; then
        CLEAN_CMD=$(parse_docker_array "$ORIGINAL_CMD")
        if [ -n "$FINAL_CMD" ]; then
            FINAL_CMD="$FINAL_CMD $CLEAN_CMD"
        else
            FINAL_CMD="$CLEAN_CMD"
        fi
    fi
fi

echo "✅ Configuration loaded."

# --- 5. Launch ---

# If we successfully built a command from the API, use it.
if [ -n "$FINAL_CMD" ]; then
    echo "🚀 Launching Original Container Command: $FINAL_CMD"
    # We use 'eval' here because FINAL_CMD contains quotes (e.g. "node" "server.js")
    # eval processes those quotes correctly so the shell sees distinct arguments.
    eval exec "$FINAL_CMD"
fi

# Fallback: If API failed or returned nothing, check if user passed args manually
if [ -z "$1" ]; then
    echo "❌ CRITICAL ERROR: No command found!"
    echo "   1. The .container-info API returned no ENTRYPOINT/CMD."
    echo "   2. No arguments were passed to this script manually."
    exit 1
fi

echo "🚀 Starting with manual arguments: $@"
exec "$@"