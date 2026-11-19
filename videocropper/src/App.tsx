// Copyright 2026 Alex Degner (alex@ergofox.me)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, createRef } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Box, Button, Heading, Notification, Section } from "react-bulma-components";
import { FiX } from "react-icons/fi";
import { Timeline } from "./components/Timeline";
import type { TimeRange } from "./components/Timeline";
import { FileDropZone } from "./components/FileDropZone";
import type { FileDropPayload } from "./components/FileDropZone";
import { VideoPreview } from "./components/VideoPreview";
import type { CropRect, FrameSize } from "./components/VideoPreview";
import { clamp, formatTime } from "./components/format";
import "./App.scss";

const VIDEO_EXTENSIONS = [
    "mp4",
    "m4v",
    "mov",
    "mkv",
    "webm",
    "avi",
    "ogv",
    "ogg",
    "mpg",
    "mpeg",
    "m2ts",
    "mts",
    "ts",
    "wmv",
    "flv",
    "3gp",
];

/** Smallest allowed selection, in seconds (mirrors the timeline). */
const MIN_RANGE = 0.05;

/** Fallback frame step when ffprobe could not report the frame rate. */
const FALLBACK_FPS = 25;

const RESET_RANGE: TimeRange = { start: 0, end: 0 };

/** Persisted editor session (localStorage). */
const SESSION_KEY = "videocropper.session";

/** Metadata returned by the `open_video` Tauri command. */
export interface VideoMeta {
    /** Absolute path on disk. */
    path: string;
    /** File name including the extension. */
    name: string;
    /** Duration in milliseconds (0 when unknown). */
    durationMs: number;
    /** Display width in pixels. */
    width: number;
    /** Display height in pixels. */
    height: number;
    videoCodec: string | null;
    audioCodec: string | null;
    /** Frame rate of the first video stream, when known. */
    fps: number | null;
    formatName: string | null;
    sizeBytes: number;
    /** ffprobe failure, if the metadata is incomplete. */
    probeError: string | null;
}

interface SessionState {
    videoPath: string | null;
    range: TimeRange;
    currentTime: number;
    crop: CropRect | null;
    keepSettings?: boolean;
    rememberVideo?: boolean;
    cropAspect?: number | null;
}

interface AttachSettings {
    range: TimeRange;
    currentTime: number;
    crop: CropRect | null;
}

/**
 * Dev-only demo frame (`/?demo` in the browser). Lets the canvas preview,
 * crop overlay and timeline be exercised without a Tauri backend.
 */
const DEMO_META: VideoMeta = {
    path: "demo://pattern",
    name: "demo-pattern.svg",
    durationMs: 8000,
    width: 1280,
    height: 720,
    videoCodec: "demo",
    audioCodec: null,
    fps: 25,
    formatName: "demo",
    sizeBytes: 0,
    probeError: null,
};

const DEMO_FRAME_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'>` +
        `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
        `<stop offset='0' stop-color='#396cd8'/><stop offset='1' stop-color='#61dafb'/>` +
        `</linearGradient></defs>` +
        `<rect width='1280' height='720' fill='url(#g)'/>` +
        `<rect x='0' y='0' width='160' height='720' fill='#e2e23a'/>` +
        `<rect x='160' y='0' width='160' height='720' fill='#3ae27a'/>` +
        `<rect x='320' y='0' width='160' height='720' fill='#e23a5f'/>` +
        `<rect x='480' y='0' width='160' height='720' fill='#ffffff'/>` +
        `<circle cx='1040' cy='360' r='180' fill='#101418'/>` +
        `<text x='1040' y='380' font-size='80' fill='#ffffff' text-anchor='middle'>DEMO</text>` +
        `</svg>`,
)}`;

const isDemoMode = () =>
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");

function describeError(error: unknown): string {
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error) {
        return error.message;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

type NotificationKind = "danger" | "warning" | "success";

interface NotificationItem {
    id: number;
    kind: NotificationKind;
    text: string;
}

interface AppState {
    video: VideoMeta | null;
    duration: number;
    range: TimeRange;
    currentTime: number;
    frameSize: FrameSize;
    crop: CropRect | null;
    frameUrl: string | null;
    frameLoading: boolean;
    /** Transient messages; the newest one is rendered first. */
    notifications: NotificationItem[];
    /** Timeline handle grabbed by the pointer and driven from the keyboard. */
    activeHandle: "start" | "end" | null;
    /** Apply current settings to every newly opened video. */
    keepSettings: boolean;
    /** Reopen the last processed video on startup. */
    rememberVideo: boolean;
    /** Locked crop aspect; `null` = free selection. */
    cropAspect: number | null;
    isDragging: boolean;
    /** Export job state. */
    exporting: boolean;
    exportProgress: number | null;
    success: string | null;
}

class App extends Component<Record<string, never>, AppState> {
    state: AppState = {
        video: null,
        duration: 0,
        range: RESET_RANGE,
        currentTime: 0,
        frameSize: { width: 0, height: 0 },
        crop: null,
        frameUrl: null,
        frameLoading: false,
        notifications: [],
        activeHandle: null,
        keepSettings: true,
        rememberVideo: true,
        cropAspect: null,
        isDragging: false,
        exporting: false,
        exportProgress: null,
        success: null,
    };

    private fileInputRef = createRef<HTMLInputElement>();
    /** Blocks saving until the previous session (if any) is restored. */
    private sessionReady = { current: false };
    private saveTimer: number | undefined;
    private snapshotTimer: number | undefined;
    private snapshotToken = { cancelled: false };
    private progressUnlisten: UnlistenFn | undefined;
    private notificationId = 0;
    private notificationTimers = new Set<number>();

    componentDidMount(): void {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("pointerdown", this.handleGlobalPointerDown);

        void listen<{ percent: number }>("export-progress", (event) => {
            const percent = Number(event.payload?.percent);
            if (Number.isFinite(percent)) {
                this.setState({ exportProgress: percent });
            }
        })
            .then((stop) => {
                this.progressUnlisten = stop;
            })
            .catch((error) => {
                console.warn("export progress listener is unavailable", error);
            });

        // Dev-only: `/?demo` opens a synthetic pattern to exercise the editor.
        if (!isTauri() && isDemoMode()) {
            this.attachVideo(DEMO_META);
        }

        this.restoreSession();
    }

    componentDidUpdate(_previousProps: unknown, previousState: AppState): void {
        const state = this.state;

        if (
            previousState.video !== state.video ||
            previousState.range !== state.range ||
            previousState.currentTime !== state.currentTime ||
            previousState.crop !== state.crop ||
            previousState.cropAspect !== state.cropAspect ||
            previousState.keepSettings !== state.keepSettings ||
            previousState.rememberVideo !== state.rememberVideo
        ) {
            this.scheduleSessionSave();
        }

        const previewTime = this.previewTime;
        const previousPreviewTime =
            previousState.activeHandle === "start"
                ? previousState.range.start
                : previousState.activeHandle === "end"
                  ? previousState.range.end
                  : previousState.currentTime;

        if (
            previousState.video !== state.video ||
            previousPreviewTime !== previewTime ||
            previousState.duration !== state.duration
        ) {
            this.scheduleSnapshot();
        }
    }

    componentWillUnmount(): void {
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("pointerdown", this.handleGlobalPointerDown);
        window.clearTimeout(this.saveTimer);
        window.clearTimeout(this.snapshotTimer);
        this.snapshotToken.cancelled = true;
        this.progressUnlisten?.();
        this.notificationTimers.forEach((timer) => window.clearTimeout(timer));
        this.notificationTimers.clear();
    }

    render() {
        const { video, isDragging } = this.state;

        return (
            <div className="app">
                <FileDropZone
                    onDrop={this.handleFileDrop}
                    onDragStateChange={this.handleDragStateChange}
                />

                <input
                    ref={this.fileInputRef}
                    type="file"
                    accept="video/*"
                    hidden
                    onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) {
                            this.notify(
                                "warning",
                                "Opening files works in the Video Cutter app — run it via `cargo tauri dev`.",
                            );
                        }
                        event.currentTarget.value = "";
                    }}
                />

                {!video ? (
                    <Section className="empty-state">
                        <Box className="empty-card">
                            <div className="empty-icon" aria-hidden="true">
                                ⬇
                            </div>
                            <Heading className="empty-title">
                                Drop a video into the window
                            </Heading>
                            <p className="empty-text">
                                MP4, MOV, MKV, WebM, AVI and more. The preview is built
                                frame by frame with FFmpeg — no system player codecs required.
                            </p>
                            <Button
                                color="primary"
                                size="medium"
                                onClick={() => void this.chooseFile()}
                            >
                                Choose file
                            </Button>
                        </Box>
                    </Section>
                ) : (
                    <main className="editor">
                        <Box className="preview-card">
                            <VideoPreview
                                frameUrl={this.state.frameUrl}
                                frameLoading={this.state.frameLoading}
                                frameSize={this.state.frameSize}
                                crop={this.state.crop}
                                cropAspect={this.state.cropAspect}
                                onCropChange={(crop) => this.setState({ crop })}
                                onFrameLoad={this.handleFrameLoad}
                                onOpenFileDialog={() =>
                                    void this.chooseFile(this.currentFileDir(video.path))
                                }
                                placeholder={isTauri() ? "Extracting frame…" : undefined}
                            />

                            <Timeline
                                duration={this.state.duration}
                                currentTime={this.state.currentTime}
                                range={this.state.range}
                                fps={video.fps && video.fps > 0 ? video.fps : 25}
                                activeHandle={this.state.activeHandle}
                                onActiveHandleChange={(activeHandle) =>
                                    this.setState({ activeHandle })
                                }
                                keepSettings={this.state.keepSettings}
                                onKeepSettingsChange={(keepSettings) =>
                                    this.setState({ keepSettings })
                                }
                                cropAspect={this.state.cropAspect}
                                onCropAspectChange={this.handleCropAspectChange}
                                rememberVideo={this.state.rememberVideo}
                                onRememberVideoChange={(rememberVideo) =>
                                    this.setState({ rememberVideo })
                                }
                                hasSelections={this.hasSelections}
                                onClearSelections={this.clearSelections}
                                exporting={this.state.exporting}
                                exportProgress={this.state.exportProgress}
                                onOpenFile={() => void this.chooseFile(this.currentFileDir(video.path))}
                                onExport={() => void this.handleExport()}
                                onSeek={this.seek}
                                onRangeChange={(range) => this.setState({ range })}
                            />
                        </Box>
                    </main>
                )}

            <div className="notification-stack">
                {this.state.notifications.map((item) => (
                    <Notification
                        key={item.id}
                        className="app-notification"
                        color={item.kind}
                        light
                    >
                        <span className="app-notification-text">{item.text}</span>
                        <Button
                            className="app-notification-close"
                            size="small"
                            color="light"
                            aria-label="Close"
                            onClick={() => this.dismissNotification(item.id)}
                        >
                            <FiX />
                        </Button>
                    </Notification>
                ))}
            </div>

                {isDragging && (
                    <div className="drop-overlay" aria-hidden="true">
                        <div className="drop-overlay-inner">
                            <span className="drop-overlay-icon">⬇</span>
                            <p>Release to open the video</p>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    /** While a timeline handle is selected, the preview follows that handle;
     * otherwise it follows the main playhead. */
    private get previewTime(): number {
        const { activeHandle, range, currentTime } = this.state;
        if (activeHandle === "start") return range.start;
        if (activeHandle === "end") return range.end;
        return currentTime;
    }

    /** Whether a crop selection or a trimmed range is currently set. */
    private get hasSelections(): boolean {
        const { crop, range, duration } = this.state;
        return (
            crop !== null ||
            range.start > 0.05 ||
            (duration > 0 && range.end < duration - 0.05)
        );
    }

    private get frameStep(): number {
        const fps = this.state.video?.fps;
        return fps && fps > 0 ? 1 / fps : 1 / FALLBACK_FPS;
    }

    /** Adds a transient message; the newest one appears on top and is
     * removed automatically after 5 seconds. */
    private notify(kind: NotificationKind, text: string): void {
        this.notificationId += 1;
        const id = this.notificationId;

        this.setState((state) => ({
            notifications: [{ id, kind, text }, ...state.notifications],
        }));

        const timer = window.setTimeout(() => this.dismissNotification(id), 5000);
        this.notificationTimers.add(timer);
    }

    private dismissNotification = (id: number): void => {
        this.setState((state) => ({
            notifications: state.notifications.filter((item) => item.id !== id),
        }));
    };

    private attachVideo = (next: VideoMeta, settings?: AttachSettings): void => {
        const { video, keepSettings, range, currentTime, crop } = this.state;
        const seconds = Math.max(0, next.durationMs / 1000);

        // Opening a new video keeps the current editor settings (clamped to
        // the new duration); the very first open starts from defaults.
        const resolved: AttachSettings = settings ?? {
            range: video && keepSettings ? range : { start: 0, end: seconds },
            currentTime: video && keepSettings ? currentTime : 0,
            crop: video && keepSettings ? crop : null,
        };

        const start = clamp(resolved.range.start, 0, Math.max(0, seconds - MIN_RANGE));
        const end = clamp(
            resolved.range.end,
            Math.min(seconds, start + MIN_RANGE),
            seconds,
        );

        this.setState({
            video: next,
            duration: seconds,
            range: { start, end },
            currentTime: clamp(resolved.currentTime, 0, seconds),
            crop: resolved.crop,
            frameSize: { width: next.width, height: next.height },
            frameUrl: null,
            activeHandle: null,
            notifications: [],
        });
    };

    private openPath = async (path: string): Promise<void> => {
        try {
            const meta = await invoke<VideoMeta>("open_video", { path });
            this.attachVideo(meta);

            if (meta.probeError) {
                this.notify("warning", `ffprobe: ${meta.probeError}`);
            }
        } catch (cause) {
            this.notify("danger", describeError(cause));
        }
    };

    private handleFileDrop = ({ paths, files }: FileDropPayload): void => {
        void invoke("dnd_debug", {
            msg: `handleFileDrop paths=${paths.length} files=${files.length}`,
        }).catch(() => undefined);
        if (paths.length > 0) {
            void this.openPath(paths[0]);
            return;
        }

        if (files.length > 0) {
            this.notify(
                "warning",
                "Opening files works in the Video Cutter app — run it via `cargo tauri dev`.",
            );
        }
    };

    private handleDragStateChange = (isDragging: boolean): void => {
        this.setState({ isDragging });
    };

    /** Directory of the currently open file, for the file chooser. */
    private currentFileDir(path: string): string {
        const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        return index > 0 ? path.slice(0, index) : path;
    }

    private chooseFile = async (defaultDir?: string): Promise<void> => {
        if (!isTauri()) {
            this.fileInputRef.current?.click();
            return;
        }

        try {
            const selected = await open({
                multiple: false,
                directory: false,
                title: "Open video",
                filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
                defaultPath: defaultDir,
            });

            if (typeof selected === "string") {
                await this.openPath(selected);
            }
        } catch (cause) {
            this.notify("danger", describeError(cause));
        }
    };

    private seek = (time: number): void => {
        this.setState({ currentTime: clamp(time, 0, this.state.duration) });
    };

    private handleFrameLoad = (size: { width: number; height: number }): void => {
        if (size.width > 0 && size.height > 0) {
            this.setState({ frameSize: size });
        }
    };

    private setStartHere = (): void => {
        this.setState((state) => ({
            range: {
                start: clamp(
                    state.currentTime,
                    0,
                    Math.max(0, state.range.end - MIN_RANGE),
                ),
                end: state.range.end,
            },
        }));
    };

    /** Suggested export file name: the source name with the applied
     * selections appended (trim range and crop rectangle). */
    private buildExportName(): string {
        const { video, range, crop, frameSize, duration } = this.state;
        if (!video) return "export.mp4";

        const dot = video.name.lastIndexOf(".");
        const base = dot > 0 ? video.name.slice(0, dot) : video.name;
        const extension = dot > 0 ? video.name.slice(dot) : ".mp4";

        const parts: string[] = [];
        const isFullRange = range.start <= 0.05 && range.end >= duration - 0.05;
        if (!isFullRange) {
            // Format times without colons: they are not allowed in file names
            // on all platforms.
            parts.push(`t${formatTime(range.start, false).replace(/:/g, ".")}-${formatTime(range.end, false).replace(/:/g, ".")}`);
        }

        if (crop && frameSize.width > 0 && frameSize.height > 0) {
            // Even dimensions, matching the size badge on the canvas.
            const width = Math.max(
                2,
                Math.min(frameSize.width, Math.round(crop.width * frameSize.width)) & ~1,
            );
            const height = Math.max(
                2,
                Math.min(frameSize.height, Math.round(crop.height * frameSize.height)) & ~1,
            );
            const x = Math.round(crop.x * frameSize.width);
            const y = Math.round(crop.y * frameSize.height);
            parts.push(`c${width}x${height}_${x}.${y}`);
        }

        return `${base}${parts.length > 0 ? `_${parts.join("_")}` : "_export"}${extension}`;
    }

    /** Creates the largest crop frame of the given aspect, centered in the
     * video frame (maximizing the captured picture). */
    private handleCropAspectChange = (aspect: number | null): void => {
        const { frameSize } = this.state;
        this.setState({ cropAspect: aspect });

        if (aspect === null || frameSize.width <= 0 || frameSize.height <= 0) {
            return;
        }

        let w: number;
        let h: number;
        if (frameSize.width / frameSize.height > aspect) {
            // The frame is wider: the crop height fills the frame.
            h = frameSize.height;
            w = h * aspect;
        } else {
            // The frame is taller: the crop width fills the frame.
            w = frameSize.width;
            h = w / aspect;
        }

        // Even dimensions.
        w = Math.max(2, Math.round(w) & ~1);
        h = Math.max(2, Math.round(h) & ~1);

        const x = Math.round((frameSize.width - w) / 2);
        const y = Math.round((frameSize.height - h) / 2);

        this.setState({
            crop: {
                x: x / frameSize.width,
                y: y / frameSize.height,
                width: w / frameSize.width,
                height: h / frameSize.height,
            },
        });
    };

    /** Clears the crop selection and resets the timeline range. */
    private clearSelections = (): void => {
        this.setState({
            crop: null,
            range: { start: 0, end: this.state.duration },
        });
    };

    /** Applies the selections to the current video and saves the result. */
    private handleExport = async (): Promise<void> => {
        const { video, range, crop, frameSize, exporting } = this.state;
        if (!video || exporting) return;

        if (!isTauri()) {
            this.notify(
                "warning",
                "Exporting works in the Video Cutter app — run it via `cargo tauri dev`.",
            );
            return;
        }

        try {
            const separator = video.path.includes("\\") ? "\\" : "/";
            const output = await save({
                title: "Export video",
                defaultPath: `${this.currentFileDir(video.path)}${separator}${this.buildExportName()}`,
                filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
            });
            if (!output) return;

            this.setState({ exporting: true, exportProgress: 0 });

            const result = await invoke<{ outputPath: string }>("export_video", {
                options: {
                    path: video.path,
                    output,
                    crop,
                    start: range.start,
                    end: range.end,
                    frameWidth: frameSize.width,
                    frameHeight: frameSize.height,
                },
            });

            this.setState({ exporting: false, exportProgress: null });
            this.notify("success", `Exported to ${result.outputPath}`);
        } catch (cause) {
            this.setState({ exporting: false, exportProgress: null });
            this.notify("danger", describeError(cause));
        }
    };

    private setEndHere = (): void => {
        this.setState((state) => ({
            range: {
                start: state.range.start,
                end: clamp(
                    state.currentTime,
                    Math.min(state.duration, state.range.start + MIN_RANGE),
                    state.duration,
                ),
            },
        }));
    };

    /** Persist the session (opened video, range, playhead, crop) to localStorage. */
    private scheduleSessionSave(): void {
        if (!this.sessionReady.current) return;

        window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            const { video, range, currentTime, crop, keepSettings, rememberVideo } =
                this.state;
            const payload: SessionState = {
                videoPath: video?.path ?? null,
                range,
                currentTime,
                crop,
                keepSettings,
                rememberVideo,
            };

            try {
                localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
            } catch {
                // Storage may be unavailable; the session is simply not saved.
            }
        }, 300);
    }

    /** Restore the previous session on startup. */
    private restoreSession(): void {
        if (!isTauri()) {
            this.sessionReady.current = true;
            return;
        }

        let raw: string | null = null;
        try {
            raw = localStorage.getItem(SESSION_KEY);
        } catch {
            raw = null;
        }

        if (!raw) {
            this.sessionReady.current = true;
            return;
        }

        try {
            const saved = JSON.parse(raw) as Partial<SessionState>;

            if (typeof saved.keepSettings === "boolean") {
                this.setState({ keepSettings: saved.keepSettings });
            }
            if (typeof saved.rememberVideo === "boolean") {
                this.setState({ rememberVideo: saved.rememberVideo });
            }

            if (saved.rememberVideo === false) {
                this.sessionReady.current = true;
                return;
            }

            if (!saved.videoPath || typeof saved.videoPath !== "string") {
                this.sessionReady.current = true;
                return;
            }

            void (async () => {
                try {
                    const meta = await invoke<VideoMeta>("open_video", {
                        path: saved.videoPath,
                    });

                    const seconds = Math.max(0, meta.durationMs / 1000);
                    const savedRange =
                        saved.range &&
                        typeof saved.range.start === "number" &&
                        typeof saved.range.end === "number"
                            ? saved.range
                            : { start: 0, end: seconds };

                    const savedCrop =
                        saved.crop &&
                        typeof saved.crop.x === "number" &&
                        typeof saved.crop.y === "number" &&
                        typeof saved.crop.width === "number" &&
                        typeof saved.crop.height === "number" &&
                        saved.crop.width > 0 &&
                        saved.crop.height > 0
                            ? saved.crop
                            : null;

                    this.attachVideo(meta, {
                        range: savedRange,
                        currentTime:
                            typeof saved.currentTime === "number" ? saved.currentTime : 0,
                        crop: savedCrop,
                    });
                } catch (cause) {
                    this.notify(
                        "warning",
                        `Failed to restore the previous session: ${describeError(cause)}`,
                    );
                } finally {
                    this.sessionReady.current = true;
                }
            })();
        } catch {
            this.sessionReady.current = true;
        }
    }

    /** The preview is an ffmpeg snapshot of the preview time; refresh it debounced. */
    private scheduleSnapshot(): void {
        const { video } = this.state;

        window.clearTimeout(this.snapshotTimer);
        this.snapshotToken.cancelled = true;
        const token = { cancelled: false };
        this.snapshotToken = token;

        if (!video) return;

        if (!isTauri()) {
            this.setState({
                frameUrl: isDemoMode() ? DEMO_FRAME_URL : null,
                frameLoading: false,
            });
            return;
        }

        this.snapshotTimer = window.setTimeout(async () => {
            this.setState({ frameLoading: true });

            const { duration } = this.state;
            const time = Math.min(
                Math.max(this.previewTime, 0),
                Math.max(0, duration - 0.05),
            );

            try {
                const imagePath = await invoke<string>("snapshot_video", {
                    path: video.path,
                    time,
                });
                if (!token.cancelled) {
                    this.setState({
                        frameUrl: convertFileSrc(imagePath),
                        frameLoading: false,
                    });
                }
            } catch (cause) {
                if (!token.cancelled) {
                    this.setState({ frameLoading: false });
                    this.notify("danger", describeError(cause));
                }
            }
        }, 120);
    }

    // Keyboard shortcuts: arrows step frames/seconds, I/O set in/out points.
    private handleKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        if (
            target &&
            (target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" ||
                target.isContentEditable)
        ) {
            return;
        }

        // ←/→ — one frame, Alt+←/→ — five frames, Ctrl+←/→ — half a second,
        // Shift+←/→ — one second.
        let step = this.frameStep;
        if (event.ctrlKey) {
            step = 0.5;
        } else if (event.altKey) {
            step = this.frameStep * 5;
        } else if (event.shiftKey) {
            step = 1;
        }

        switch (event.code) {
            case "ArrowLeft":
            case "ArrowRight": {
                event.preventDefault();
                const direction = event.code === "ArrowRight" ? 1 : -1;

                // A selected timeline handle follows the arrows instead of
                // the playhead.
                if (this.state.activeHandle) {
                    const delta = direction * step;
                    this.setState((state) =>
                        state.activeHandle === "start"
                            ? {
                                  range: {
                                      start: clamp(
                                          state.range.start + delta,
                                          0,
                                          Math.max(0, state.range.end - MIN_RANGE),
                                      ),
                                      end: state.range.end,
                                  },
                              }
                            : {
                                  range: {
                                      start: state.range.start,
                                      end: clamp(
                                          state.range.end + delta,
                                          Math.min(state.duration, state.range.start + MIN_RANGE),
                                          state.duration,
                                      ),
                                  },
                              },
                    );
                    return;
                }

                this.seek(this.state.currentTime + direction * step);
                break;
            }
            case "Escape":
                this.setState({ activeHandle: null });
                break;
            case "KeyI":
                event.preventDefault();
                this.setStartHere();
                break;
            case "KeyO":
                event.preventDefault();
                this.setEndHere();
                break;
            default:
                break;
        }
    };

    // Any pointer press outside of the timeline handles clears the selection.
    private handleGlobalPointerDown = (event: PointerEvent): void => {
        if (!this.state.activeHandle) return;

        const target = event.target as HTMLElement | null;
        if (!target?.closest("[data-handle]")) {
            this.setState({ activeHandle: null });
        }
    };
}

export default App;
