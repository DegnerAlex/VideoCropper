#!/usr/bin/env bash

# Copyright 2026 Alex Degner (alex@ergofox.me)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Downloads static FFmpeg/ffprobe builds and stores them where Tauri expects
# sidecar binaries:
#
#   src-tauri/binaries/ffmpeg-<target-triple>[.exe]
#   src-tauri/binaries/ffprobe-<target-triple>[.exe]
#
# See `bundle.externalBin` in `src-tauri/tauri.conf.json`.
#
# Usage:
#   scripts/prepare-sidecars.sh [TARGET_TRIPLE]
#
# TARGET_TRIPLE defaults to the host triple reported by rustc.
# Supported targets: x86_64/aarch64 Linux GNU, x86_64/aarch64 Windows MSVC.
#
# The downloaded builds are GPL (they include x264/x265). Review
# https://ffmpeg.org/legal.html before distributing the application.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/src-tauri/binaries"

TARGET="${1:-${TARGET_TRIPLE:-}}"
if [[ -z "$TARGET" ]]; then
    if ! command -v rustc >/dev/null 2>&1; then
        echo "error: rustc not found; pass the target triple explicitly" >&2
        exit 1
    fi
    TARGET="$(rustc -vV | sed -n 's/^host: //p')"
fi

case "$TARGET" in
    x86_64-unknown-linux-gnu)
        ASSET="ffmpeg-master-latest-linux64-gpl.tar.xz"
        ;;
    aarch64-unknown-linux-gnu)
        ASSET="ffmpeg-master-latest-linuxarm64-gpl.tar.xz"
        ;;
    x86_64-pc-windows-msvc)
        ASSET="ffmpeg-master-latest-win64-gpl.zip"
        ;;
    aarch64-pc-windows-msvc)
        ASSET="ffmpeg-master-latest-winarm64-gpl.zip"
        ;;
    *)
        echo "error: unsupported target triple: $TARGET" >&2
        echo "Supported: x86_64/aarch64 Linux GNU, x86_64/aarch64 Windows MSVC." >&2
        echo "For macOS, build or download static binaries manually and place them in:" >&2
        echo "  $OUT_DIR/ffmpeg-$TARGET" >&2
        echo "  $OUT_DIR/ffprobe-$TARGET" >&2
        exit 1
        ;;
esac

URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$ASSET"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading $URL"
curl -fL --retry 3 --retry-delay 2 -o "$TMP_DIR/archive" "$URL"

mkdir -p "$TMP_DIR/extract"
case "$ASSET" in
    *.tar.xz)
        tar -xJf "$TMP_DIR/archive" -C "$TMP_DIR/extract"
        ;;
    *.zip)
        if ! command -v unzip >/dev/null 2>&1; then
            echo "error: unzip is required to extract $ASSET" >&2
            exit 1
        fi
        unzip -q "$TMP_DIR/archive" -d "$TMP_DIR/extract"
        ;;
esac

find_binary() {
    local name="$1"
    find "$TMP_DIR/extract" -type f \( -name "$name" -o -name "$name.exe" \) -print -quit
}

FFMPEG_SRC="$(find_binary ffmpeg)"
FFPROBE_SRC="$(find_binary ffprobe)"
if [[ -z "$FFMPEG_SRC" || -z "$FFPROBE_SRC" ]]; then
    echo "error: ffmpeg/ffprobe not found in the downloaded archive" >&2
    exit 1
fi

SUFFIX=""
if [[ "$TARGET" == *windows* ]]; then
    SUFFIX=".exe"
fi

mkdir -p "$OUT_DIR"
install -m 0755 "$FFMPEG_SRC" "$OUT_DIR/ffmpeg-$TARGET$SUFFIX"
install -m 0755 "$FFPROBE_SRC" "$OUT_DIR/ffprobe-$TARGET$SUFFIX"

echo "Sidecar binaries prepared for $TARGET:"
echo "  $OUT_DIR/ffmpeg-$TARGET$SUFFIX"
echo "  $OUT_DIR/ffprobe-$TARGET$SUFFIX"
"$OUT_DIR/ffmpeg-$TARGET$SUFFIX" -version | head -1
"$OUT_DIR/ffprobe-$TARGET$SUFFIX" -version | head -1
