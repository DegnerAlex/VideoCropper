# Sidecar binaries

This directory holds the FFmpeg/ffprobe executables that Tauri bundles with
the application (`bundle.externalBin` in `src-tauri/tauri.conf.json`).

The binaries are **not** committed to the repository. Prepare them before a
release build:

```bash
pnpm run sidecars
# or
scripts/prepare-sidecars.sh
```

The script names the files after the Rust target triple, for example:

```
ffmpeg-x86_64-unknown-linux-gnu
ffprobe-x86_64-unknown-linux-gnu
ffmpeg-x86_64-pc-windows-msvc.exe
ffprobe-x86_64-pc-windows-msvc.exe
```

Pass a target triple explicitly to prepare binaries for another platform:

```bash
scripts/prepare-sidecars.sh aarch64-unknown-linux-gnu
```

Development builds do not use these files: `cargo tauri dev` runs inside the
dev container, which provides FFmpeg/ffprobe via `PATH`
(see `docker/videocutter/Dockerfile`).

The downloaded builds are GPL (they include x264/x265). Review
<https://ffmpeg.org/legal.html> before distributing the application.
