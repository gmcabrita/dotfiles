#!/usr/bin/env bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Captain it's
# @raycast.mode silent

# Optional parameters:
# @raycast.icon 📆
# @raycast.packageName Captain it's

# Arguments:
# @raycast.argument1 { "type": "dropdown", "placeholder": "Time Scale", "optional": false, "data": [{"title": "Day", "value": "day"}, {"title": "Week", "value": "week"}, {"title": "Month", "value": "month"}, {"title": "Year", "value": "year"}] }

set -e

PERIOD="${1:-day}"
BASE_URL="https://captain-its-api.val.run"

# Build URL with period parameter if provided
if [ -n "$PERIOD" ]; then
    API_URL="${BASE_URL}?${PERIOD}"
else
    API_URL="$BASE_URL"
fi

TEMP_FILE=$(mktemp /tmp/captain_image_XXXXXX)

# Download the image
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$TEMP_FILE" "$API_URL")

if [ "$HTTP_CODE" -ne 200 ]; then
    rm -f "$TEMP_FILE"
    echo "Failed to fetch image (HTTP $HTTP_CODE)"
    exit 1
fi

# Detect the image type
FILE_TYPE=$(file --mime-type -b "$TEMP_FILE")

# Copy to clipboard based on image type
case "$FILE_TYPE" in
    image/png)
        osascript -e "set the clipboard to (read (POSIX file \"$TEMP_FILE\") as «class PNGf»)"
        ;;
    image/jpeg)
        osascript -e "set the clipboard to (read (POSIX file \"$TEMP_FILE\") as JPEG picture)"
        ;;
    image/gif)
        osascript -e "set the clipboard to (read (POSIX file \"$TEMP_FILE\") as GIF picture)"
        ;;
    image/tiff)
        osascript -e "set the clipboard to (read (POSIX file \"$TEMP_FILE\") as TIFF picture)"
        ;;
    *)
        rm -f "$TEMP_FILE"
        echo "Unsupported image type: $FILE_TYPE"
        exit 1
esac

# Cleanup
rm -f "$TEMP_FILE"

echo "Image copied to clipboard!"
