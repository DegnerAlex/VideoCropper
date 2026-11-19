# Video Cutter

A desktop video trimming and cropping tool built with Tauri 2, React 19 and
TypeScript. Everything runs locally — no uploads, no external services.

## Features

### Preview

- The canvas preview renders frames extracted with **FFmpeg** (a bundled
  sidecar binary), so playback works for any codec — no system player codecs
  are required.
- The preview follows the timeline: scrubbing the playhead, dragging a trim
  handle or stepping frames immediately shows the corresponding frame.
- When a selected handle is active, the preview tracks that handle; when the
  selection is dropped, it returns to the playhead position.
- Resolution-aware rendering with letterboxing; the crop size badge shows
  the exact pixel dimensions of the selection.
- Loading is debounced, so fast scrubbing does not spawn a burst of FFmpeg
  processes.

### Timeline and trimming

- Select the in/out range by dragging the **start/end handles**, or move the
  whole selection as a block (the drag threshold distinguishes a click-to-seek
  from a move).
- The **playhead** is draggable by its head; the head enlarges while dragged
  and stays attached to the pointer at the grab point.
- The status row shows the in/out timecodes with **frame numbers** (derived
  from the file's real frame rate) and the length of the selection in frames.
- Keyboard editing of the selected handle: all movement shortcuts apply to
  the active handle — press `Escape` or click elsewhere to deselect.
- Both selection edges are pushed away from the window-edge resize zones, so
  they stay grabbable even at the very edges of the screen.

### Cropping

- Draw the crop area on the preview with the mouse; click outside the
  selection clears it, double click opens a file dialog.
- Move the selection by dragging inside it; resize it from 8 handles.
- **Aspect lock** — pick a common ratio (16:9, 9:16, 4:3, 3:4, 1:1, 21:9) and
  the frame is maximized inside the video; further drawing and resizing keeps
  the proportion (corner-anchored, or symmetric from the center for edge
  handles and `Shift`).
- `Shift` constrains movement to horizontal/vertical and `Shift` + resize
  keeps proportions growing from the center.
- Crop dimensions are always rounded to even numbers, as encoders require.

### Keyboard control

- `←/→` step one frame, `Alt+←/→` jump 5 frames, `Ctrl+←/→` half a second,
  `Shift+←/→` one second.
- `I`/`O` set the in/out points at the playhead.
- Shortcuts apply to the selected timeline handle when one is active.

### Export

- Applies the range and crop selections via FFmpeg: fast seek + H.264
  (libx264, CRF 18) + AAC, `+faststart` for the MP4 family.
- A save dialog suggests a file name that already contains the applied
  selections (trim range and crop rectangle) and opens in the folder of the
  source video.
- Live progress (percentage) is streamed from FFmpeg to the button; success
  and failure are reported as notifications.

### Session persistence

- The opened video, trim range, playhead position, crop, aspect lock and both
  "remember" toggles are saved to local storage and restored on the next
  launch — the last video is reopened automatically if the file is still
  available.

### File handling

- **Drag and drop** — drop a video file anywhere in the window to open it.
- The file chooser opens in the folder of the currently processed video.
- Any codec works: metadata, preview frames and export all go through the
  bundled FFmpeg.
- When opening a new video, the current selections can be carried over
  (toggled by the "Remember selections" switch).

## Development

Requirements: Docker (the project ships a dev container) or a system
installation of Node.js 22+, pnpm, Rust and the Tauri prerequisites.

```bash
# Start the dev services (vite dev server + cargo tauri dev)
docker compose up
```

The frontend dev server runs on `http://localhost:1420`. The dev container
provides FFmpeg/ffprobe for local development.


## Production builds

Release builds bundle FFmpeg as Tauri sidecar binaries. Prepare them first:

```bash
pnpm run sidecars              # or: scripts/prepare-sidecars.sh [target-triple]
```

Then build the desktop application:

```bash
pnpm tauri build
```

Artifacts are written to `videocropper/src-tauri/target/release/bundle/`. The
downloaded sidecar binaries are GPL-licensed (they include x264/x265) — review
<https://ffmpeg.org/legal.html> before distributing.

## Download

No releases are published yet. Build the app yourself (see *Production
builds*). When binaries are released, they will be attached to the project's
releases page and will require no additional installation — FFmpeg ships
inside the bundle.

## Libraries

- [Tauri 2](https://tauri.app) — desktop shell, plugins: dialog, fs, opener,
  shell (sidecar processes)
- [React 19](https://react.dev) + TypeScript — UI
- [Bulma](https://bulma.io) via [react-bulma-components](https://github.com/couds/react-bulma-components) — styled with the KDE
  Plasma "Breeze" palette
- Canvas preview — the preview and crop overlay are drawn with the 2D
  canvas API
- [react-icons](https://react-icons.github.io/react-icons/) (Feather icons)
- [FFmpeg](https://ffmpeg.org) — frame extraction, metadata probing and
  export (sidecar binaries prepared by `scripts/prepare-sidecars.sh`)
- [interactjs](https://interactjs.io), [mobx](https://mobx.js.org) and other
  utilities pinned by the starter template
