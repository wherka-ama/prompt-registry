#!/bin/bash
# Analyze GitHub release download counts to identify actually used platforms
# Filters out internal checks (baseline of 2 downloads)

REPO="AmadeusITGroup/gh-app-auth"
MIN_DOWNLOADS=3

echo "Fetching releases for $REPO..."
echo ""

# Create temp files for processing
TMP_PLATFORMS=$(mktemp)
TMP_COUNTS=$(mktemp)
trap "rm -f $TMP_PLATFORMS $TMP_COUNTS" EXIT

# Get all releases
releases=$(gh api "repos/$REPO/releases" --jq '.[].tag_name' 2>/dev/null)

if [ -z "$releases" ]; then
    echo "No releases found"
    exit 1
fi

for release in $releases; do
    echo "Analyzing $release..."
    
    # Get assets and extract name + download_count
    gh api "repos/$REPO/releases/tags/$release" \
        --jq '.assets[] | select(.name | test("^(darwin|linux|windows|freebsd|openbsd)")) | "\(.name) \(.download_count)"' \
        2>/dev/null >> "$TMP_PLATFORMS" || true
done

echo ""
echo "=========================================="
echo "Platform Usage Summary (min $MIN_DOWNLOADS downloads)"
echo "=========================================="
echo ""

# Aggregate counts per platform
cat "$TMP_PLATFORMS" | sort | uniq | while read -r line; do
    platform=$(echo "$line" | cut -d' ' -f1)
    count=$(echo "$line" | cut -d' ' -f2)
    
    # Sum up counts for same platform across releases
    if grep -q "^${platform}:" "$TMP_COUNTS" 2>/dev/null; then
        sed -i "s/^${platform}:.*/${platform}:$(($(grep "^${platform}:" "$TMP_COUNTS" | cut -d: -f2) + count))/" "$TMP_COUNTS"
    else
        echo "${platform}:${count}" >> "$TMP_COUNTS"
    fi
done

# Display results
if [ -f "$TMP_COUNTS" ]; then
    # Platforms with meaningful downloads
    echo "MEANINGFUL DOWNLOADS (>= $MIN_DOWNLOADS):"
    echo "---"
    while IFS=: read -r platform count; do
        if [ "$count" -ge "$MIN_DOWNLOADS" ]; then
            printf "  %-25s %8d\n" "$platform" "$count"
        fi
    done < "$TMP_COUNTS" | sort -k2 -nr
    
    echo ""
    echo "LIKELY INTERNAL CHECKS (< $MIN_DOWNLOADS):"
    echo "---"
    while IFS=: read -r platform count; do
        if [ "$count" -lt "$MIN_DOWNLOADS" ]; then
            printf "  %-25s %8d\n" "$platform" "$count"
        fi
    done < "$TMP_COUNTS" | sort -k2 -nr
else
    echo "No platform data found"
fi
