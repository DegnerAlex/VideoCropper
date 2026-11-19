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
import type { PointerEvent as ReactPointerEvent } from "react";
import { Loader } from "react-bulma-components";
import { clamp } from "./format";

/** Crop rectangle in normalized coordinates (0..1) relative to the frame. */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Frame dimensions in pixels, used to display the crop size. */
export interface FrameSize {
    width: number;
    height: number;
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Point = { x: number; y: number };

type DragState =
    | { kind: "draw"; anchor: Point; previous: CropRect | null; moved: boolean }
    | { kind: "move"; origin: CropRect; offset: Point; start: Point }
    | { kind: "resize"; origin: CropRect; handle: Handle; start: Point };

/** Smallest crop side, relative to the frame. */
const MIN_SIZE = 0.02;

/** Pointer travel (px) before a click on the preview starts a new crop. */
const DRAG_THRESHOLD = 3;

/** Hit radius around a crop handle, in CSS pixels. */
const HANDLE_HIT_RADIUS = 8;

const HANDLE_CURSOR: Record<Handle, string> = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
};

export interface VideoPreviewProps {
    /** URL of the currently displayed frame (asset protocol). */
    frameUrl: string | null;
    frameLoading: boolean;
    /** Text for the placeholder; `undefined` hides it. */
    placeholder?: string;
    frameSize: FrameSize;
    crop: CropRect | null;
    /** Locked crop aspect (w/h in frame pixels); `null` = free. */
    cropAspect: number | null;
    onCropChange: (crop: CropRect | null) => void;
    onFrameLoad: (size: { width: number; height: number }) => void;
    /** Opens the file chooser (double click on the canvas). */
    onOpenFileDialog: () => void;
}

interface PixelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface VideoPreviewState {
    image: HTMLImageElement | null;
    stageSize: FrameSize;
}

function roundRectValues(rect: CropRect): CropRect {
    return {
        x: Math.round(rect.x * 10_000) / 10_000,
        y: Math.round(rect.y * 10_000) / 10_000,
        width: Math.round(rect.width * 10_000) / 10_000,
        height: Math.round(rect.height * 10_000) / 10_000,
    };
}

function resizeRect(origin: CropRect, handle: Handle, point: Point): CropRect {
    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.width;
    let bottom = origin.y + origin.height;

    if (handle.includes("w")) {
        left = clamp(point.x, 0, right - MIN_SIZE);
    }
    if (handle.includes("e")) {
        right = clamp(point.x, left + MIN_SIZE, 1);
    }
    if (handle.includes("n")) {
        top = clamp(point.y, 0, bottom - MIN_SIZE);
    }
    if (handle.includes("s")) {
        bottom = clamp(point.y, top + MIN_SIZE, 1);
    }

    return { x: left, y: top, width: right - left, height: bottom - top };
}

function handlePoints(rect: PixelRect): Array<{ handle: Handle; x: number; y: number }> {
    return [
        { handle: "nw", x: rect.x, y: rect.y },
        { handle: "n", x: rect.x + rect.w / 2, y: rect.y },
        { handle: "ne", x: rect.x + rect.w, y: rect.y },
        { handle: "e", x: rect.x + rect.w, y: rect.y + rect.h / 2 },
        { handle: "se", x: rect.x + rect.w, y: rect.y + rect.h },
        { handle: "s", x: rect.x + rect.w / 2, y: rect.y + rect.h },
        { handle: "sw", x: rect.x, y: rect.y + rect.h },
        { handle: "w", x: rect.x, y: rect.y + rect.h / 2 },
    ];
}

function drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

export class VideoPreview extends Component<VideoPreviewProps, VideoPreviewState> {
    private stageRef = createRef<HTMLDivElement>();
    private canvasRef = createRef<HTMLCanvasElement>();
    private drag: DragState | null = null;
    private latestCrop: CropRect | null = null;
    private lastClick: { time: number; x: number; y: number } | null = null;
    private resizeObserver: ResizeObserver | undefined;

    state: VideoPreviewState = {
        image: null,
        stageSize: { width: 0, height: 0 },
    };

    componentDidMount(): void {
        this.latestCrop = this.props.crop;
        this.loadImage();

        const measure = () => {
            const stage = this.stageRef.current;
            if (!stage) return;
            this.setState({
                stageSize: { width: stage.clientWidth, height: stage.clientHeight },
            });
        };

        measure();
        this.resizeObserver = new ResizeObserver(measure);
        if (this.stageRef.current) {
            this.resizeObserver.observe(this.stageRef.current);
        }

        this.draw();
    }

    componentDidUpdate(previous: VideoPreviewProps): void {
        this.latestCrop = this.props.crop;

        if (previous.frameUrl !== this.props.frameUrl) {
            this.loadImage();
        }

        this.draw();
    }

    componentWillUnmount(): void {
        this.resizeObserver?.disconnect();
    }

    render() {
        const { frameLoading, placeholder } = this.props;
        const videoRect = this.videoRect;

        const note = !videoRect
            ? (placeholder ?? "Preview unavailable")
            : !this.props.frameUrl
              ? "Extracting frame…"
              : null;

        return (
            <div className="preview-stage" ref={this.stageRef}>
                <canvas
                    ref={this.canvasRef}
                    className="preview-canvas"
                    onPointerDown={this.handlePointerDown}
                    onPointerMove={this.handlePointerMove}
                    onPointerUp={this.finishDrag}
                    onPointerCancel={this.cancelDrag}
                />

                {note && (
                    <div className="preview-note">
                        {note === "Extracting frame…" && <Loader className="frame-spinner" />}
                        <span>{note}</span>
                    </div>
                )}

                {/* Full-stage loader only when an existing frame is being
                    refreshed; while there is no frame yet the note above
                    already shows a spinner. */}
                {frameLoading && this.props.frameUrl && (
                    <div className="preview-loading" aria-hidden="true">
                        <Loader className="frame-spinner" />
                    </div>
                )}
            </div>
        );
    }

    /** Letterboxed video area inside the canvas. */
    private get videoRect(): PixelRect | null {
        const { frameSize } = this.props;
        const { stageSize } = this.state;

        if (
            frameSize.width <= 0 ||
            frameSize.height <= 0 ||
            stageSize.width <= 0 ||
            stageSize.height <= 0
        ) {
            return null;
        }

        const scale = Math.min(
            stageSize.width / frameSize.width,
            stageSize.height / frameSize.height,
        );
        const width = Math.max(1, Math.floor(frameSize.width * scale));
        const height = Math.max(1, Math.floor(frameSize.height * scale));

        return {
            x: Math.floor((stageSize.width - width) / 2),
            y: Math.floor((stageSize.height - height) / 2),
            w: width,
            h: height,
        };
    }

    private get cropPixels(): { x: number; y: number; width: number; height: number } | null {
        const { crop, frameSize } = this.props;
        if (!crop) return null;

        // Encoders expect even dimensions; round the crop size to multiples
        // of two everywhere it is displayed or exported.
        const even = (value: number, max: number): number =>
            Math.max(2, Math.min(max, Math.round(value)) & ~1);

        return {
            x: Math.round(crop.x * frameSize.width),
            y: Math.round(crop.y * frameSize.height),
            width: even(crop.width * frameSize.width, frameSize.width),
            height: even(crop.height * frameSize.height, frameSize.height),
        };
    }

    /** Decodes the next frame while the previous one stays on screen. */
    private loadImage(): void {
        const { frameUrl } = this.props;
        if (!frameUrl) {
            this.setState({ image: null });
            return;
        }

        const image = new Image();
        image.onload = () => {
            this.setState({ image });
            this.props.onFrameLoad({
                width: image.naturalWidth,
                height: image.naturalHeight,
            });
        };
        image.src = frameUrl;
    }

    /** Paints the frame and the crop overlay into the canvas. */
    private draw(): void {
        const canvas = this.canvasRef.current;
        const { stageSize } = this.state;
        if (!canvas || stageSize.width < 1 || stageSize.height < 1) {
            return;
        }

        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const backingWidth = Math.round(stageSize.width * dpr);
        const backingHeight = Math.round(stageSize.height * dpr);

        if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
            canvas.width = backingWidth;
            canvas.height = backingHeight;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, stageSize.width, stageSize.height);

        const { crop } = this.props;
        const videoRect = this.videoRect;
        const image = this.state.image;
        if (!image || !videoRect) {
            return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, videoRect.x, videoRect.y, videoRect.w, videoRect.h);

        if (!crop || crop.width <= 0 || crop.height <= 0) {
            // Hint pill for an untouched frame.
            const text = "Drag with the mouse to select the area that stays in frame";
            ctx.font = "500 12px Inter, system-ui, sans-serif";
            const textWidth = ctx.measureText(text).width;
            const boxWidth = textWidth + 24;
            const boxHeight = 30;
            const boxX = videoRect.x + (videoRect.w - boxWidth) / 2;
            const boxY = videoRect.y + (videoRect.h - boxHeight) / 2;

            ctx.fillStyle = "rgba(6, 8, 12, 0.66)";
            drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 8);
            ctx.fill();
            ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
            ctx.textBaseline = "middle";
            ctx.fillText(text, boxX + 12, boxY + boxHeight / 2 + 0.5);
            return;
        }

        const rect: PixelRect = {
            x: videoRect.x + crop.x * videoRect.w,
            y: videoRect.y + crop.y * videoRect.h,
            w: crop.width * videoRect.w,
            h: crop.height * videoRect.h,
        };

        // Dim the frame outside of the selection (letterbox stays black).
        ctx.save();
        ctx.beginPath();
        ctx.rect(videoRect.x, videoRect.y, videoRect.w, videoRect.h);
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.fillStyle = "rgba(5, 7, 11, 0.62)";
        ctx.fill("evenodd");
        ctx.restore();

        // Rule-of-thirds grid.
        ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const fraction of [1 / 3, 2 / 3]) {
            ctx.moveTo(rect.x + rect.w * fraction, rect.y);
            ctx.lineTo(rect.x + rect.w * fraction, rect.y + rect.h);
            ctx.moveTo(rect.x, rect.y + rect.h * fraction);
            ctx.lineTo(rect.x + rect.w, rect.y + rect.h * fraction);
        }
        ctx.stroke();

        // Selection border.
        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

        // Handles.
        for (const point of handlePoints(rect)) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(point.x - 5.5, point.y - 5.5, 11, 11);
            ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
            ctx.lineWidth = 1;
            ctx.strokeRect(point.x - 5.5, point.y - 5.5, 11, 11);
        }

        // Size badge.
        const cropPixels = this.cropPixels;
        if (cropPixels) {
            const text = `${cropPixels.width} × ${cropPixels.height}`;
            ctx.font = "600 11px Inter, system-ui, sans-serif";
            const textWidth = ctx.measureText(text).width;
            const boxWidth = textWidth + 12;
            const boxHeight = 20;
            const boxX = rect.x + 6;
            const boxY = rect.y + 6;

            ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
            drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 4);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(text, boxX + 6, boxY + boxHeight / 2 + 0.5);
        }
    }

    /** Maps a pointer position to normalized frame coordinates. */
    private pointFromEvent(clientX: number, clientY: number): Point {
        const videoRect = this.videoRect;
        if (!videoRect) {
            return { x: 0, y: 0 };
        }

        const rect = this.canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return { x: 0, y: 0 };
        }

        return {
            x: clamp((clientX - rect.left - videoRect.x) / videoRect.w, 0, 1),
            y: clamp((clientY - rect.top - videoRect.y) / videoRect.h, 0, 1),
        };
    }

    /** Whether the point falls inside the current crop rectangle. */
    private isInsideCrop(point: Point): boolean {
        const { crop } = this.props;
        return Boolean(
            crop &&
                point.x >= crop.x &&
                point.x <= crop.x + crop.width &&
                point.y >= crop.y &&
                point.y <= crop.y + crop.height,
        );
    }

    private hitTestHandle(point: Point): Handle | null {
        const { crop } = this.props;
        const videoRect = this.videoRect;
        if (!crop || crop.width <= 0 || crop.height <= 0 || !videoRect) {
            return null;
        }

        const rect: PixelRect = {
            x: videoRect.x + crop.x * videoRect.w,
            y: videoRect.y + crop.y * videoRect.h,
            w: crop.width * videoRect.w,
            h: crop.height * videoRect.h,
        };

        for (const item of handlePoints(rect)) {
            if (
                Math.abs(item.x - videoRect.x - point.x * videoRect.w) <= HANDLE_HIT_RADIUS &&
                Math.abs(item.y - videoRect.y - point.y * videoRect.h) <= HANDLE_HIT_RADIUS
            ) {
                return item.handle;
            }
        }

        return null;
    }

    private updateCursor(point: Point): void {
        const canvas = this.canvasRef.current;
        if (!canvas) return;

        const handle = this.hitTestHandle(point);
        if (handle) {
            canvas.style.cursor = HANDLE_CURSOR[handle];
            return;
        }

        canvas.style.cursor =
            this.props.crop && this.isInsideCrop(point) ? "move" : "crosshair";
    }

    /** Aspect-locked resize with the opposite corner kept in place. */
    private resizeAspectAnchored(
        origin: CropRect,
        handle: Handle,
        point: Point,
        aspect: number,
    ): CropRect {
        const videoRect = this.videoRect;
        if (!videoRect) {
            return origin;
        }

        const originLeft = origin.x * videoRect.w;
        const originTop = origin.y * videoRect.h;
        const originRight = originLeft + origin.width * videoRect.w;
        const originBottom = originTop + origin.height * videoRect.h;

        const fixedX = handle.includes("w") ? originRight : originLeft;
        const fixedY = handle.includes("n") ? originBottom : originTop;

        let w = Math.abs(point.x * videoRect.w - fixedX);
        let h = Math.abs(point.y * videoRect.h - fixedY);

        if (w / Math.max(1, h) > aspect) {
            h = w / aspect;
        } else {
            w = h * aspect;
        }

        const maxW = handle.includes("w") ? fixedX : videoRect.w - fixedX;
        const maxH = handle.includes("n") ? fixedY : videoRect.h - fixedY;

        w = clamp(w, MIN_SIZE * videoRect.w, Math.max(MIN_SIZE * videoRect.w, maxW));
        h = clamp(h, MIN_SIZE * videoRect.h, Math.max(MIN_SIZE * videoRect.h, maxH));

        if (w / Math.max(1, h) > aspect) {
            h = Math.min(w / aspect, maxH);
            w = Math.min(h * aspect, maxW);
        } else {
            w = Math.min(h * aspect, maxW);
            h = Math.min(w / aspect, maxH);
        }

        const left = handle.includes("w") ? fixedX - w : fixedX;
        const top = handle.includes("n") ? fixedY - h : fixedY;

        return roundRectValues({
            x: clamp(left / videoRect.w, 0, 1),
            y: clamp(top / videoRect.h, 0, 1),
            width: clamp(w / videoRect.w, 0, 1),
            height: clamp(h / videoRect.h, 0, 1),
        });
    }

    /** Shift-resize: keeps the crop proportions and grows symmetrically in
     * all directions from the center of the selection, whatever handle is
     * dragged. */
    private resizeProportional(
        origin: CropRect,
        _handle: Handle,
        point: Point,
    ): CropRect {
        const videoRect = this.videoRect;
        if (!videoRect) {
            return origin;
        }

        const originLeft = origin.x * videoRect.w;
        const originTop = origin.y * videoRect.h;
        const originW = origin.width * videoRect.w;
        const originH = origin.height * videoRect.h;

        const centerX = originLeft + originW / 2;
        const centerY = originTop + originH / 2;

        const minW = MIN_SIZE * videoRect.w;
        const minH = MIN_SIZE * videoRect.h;

        // Maximum size that still fits the frame when centered.
        const maxW = 2 * Math.min(centerX, videoRect.w - centerX);
        const maxH = 2 * Math.min(centerY, videoRect.h - centerY);

        let scale: number;
        if (_handle === "e" || _handle === "w") {
            scale = (2 * Math.abs(point.x * videoRect.w - centerX)) / originW;
        } else if (_handle === "n" || _handle === "s") {
            scale = (2 * Math.abs(point.y * videoRect.h - centerY)) / originH;
        } else {
            scale = Math.max(
                (2 * Math.abs(point.x * videoRect.w - centerX)) / originW,
                (2 * Math.abs(point.y * videoRect.h - centerY)) / originH,
            );
        }

        scale = clamp(scale, Math.max(minW / originW, minH / originH), Math.min(maxW / originW, maxH / originH));

        const newW = originW * scale;
        const newH = originH * scale;

        return roundRectValues({
            x: clamp((centerX - newW / 2) / videoRect.w, 0, 1),
            y: clamp((centerY - newH / 2) / videoRect.h, 0, 1),
            width: clamp(newW / videoRect.w, 0, 1),
            height: clamp(newH / videoRect.h, 0, 1),
        });
    }

    private handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || !this.videoRect) return;

        const point = this.pointFromEvent(event.clientX, event.clientY);
        const { crop } = this.props;
        const handle = this.hitTestHandle(point);

        if (crop && handle) {
            this.drag = { kind: "resize", origin: crop, handle, start: point };
        } else if (crop && this.isInsideCrop(point)) {
            this.drag = {
                kind: "move",
                origin: crop,
                offset: { x: point.x - crop.x, y: point.y - crop.y },
                start: point,
            };
        } else {
            this.drag = {
                kind: "draw",
                anchor: point,
                previous: crop,
                moved: false,
            };
        }

        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Pointer capture is unavailable for synthetic events.
        }
        event.preventDefault();
    };

    private handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const drag = this.drag;
        const point = this.pointFromEvent(event.clientX, event.clientY);

        if (!drag) {
            this.updateCursor(point);
            return;
        }

        const videoRect = this.videoRect;

        if (drag.kind === "draw") {
            if (!videoRect) return;
            if (!drag.moved) {
                const thresholdX = DRAG_THRESHOLD / Math.max(1, videoRect?.w ?? 1);
                const thresholdY = DRAG_THRESHOLD / Math.max(1, videoRect?.h ?? 1);

                if (
                    Math.abs(point.x - drag.anchor.x) < thresholdX &&
                    Math.abs(point.y - drag.anchor.y) < thresholdY
                ) {
                    return;
                }

                drag.moved = true;
            }

            // Pixel-space rect from the anchor toward the pointer.
            const anchorX = drag.anchor.x * videoRect.w;
            const anchorY = drag.anchor.y * videoRect.h;
            let w = Math.abs(point.x * videoRect.w - anchorX);
            let h = Math.abs(point.y * videoRect.h - anchorY);
            const signX = point.x >= drag.anchor.x ? 1 : -1;
            const signY = point.y >= drag.anchor.y ? 1 : -1;

            const aspect = this.props.cropAspect;
            if (aspect) {
                if (w / Math.max(1, h) > aspect) {
                    h = w / aspect;
                } else {
                    w = h * aspect;
                }
                w = clamp(w, 8, videoRect.w);
                h = clamp(h, 8, videoRect.h);
                if (w / h > aspect) {
                    h = w / aspect;
                } else {
                    w = h * aspect;
                }
            }

            const left = clamp(signX > 0 ? anchorX : anchorX - w, 0, videoRect.w - w);
            const top = clamp(signY > 0 ? anchorY : anchorY - h, 0, videoRect.h - h);

            const next = roundRectValues({
                x: left / videoRect.w,
                y: top / videoRect.h,
                width: w / videoRect.w,
                height: h / videoRect.h,
            });
            this.latestCrop = next;
            this.props.onCropChange(next);
            return;
        }

        if (drag.kind === "move") {
            const videoRect = this.videoRect;
            if (!videoRect) return;

            // Pixel deltas from the drag start point.
            let deltaX = (point.x - drag.start.x) * videoRect.w;
            let deltaY = (point.y - drag.start.y) * videoRect.h;

            // With Shift the movement is constrained to horizontal or vertical.
            if (event.shiftKey) {
                const absX = Math.abs(deltaX);
                const absY = Math.abs(deltaY);

                if (absX > absY) {
                    deltaY = 0;
                } else {
                    deltaX = 0;
                }
            }

            const x = clamp(drag.origin.x + deltaX / videoRect.w, 0, 1 - drag.origin.width);
            const y = clamp(drag.origin.y + deltaY / videoRect.h, 0, 1 - drag.origin.height);
            const next = roundRectValues({ ...drag.origin, x, y });
            this.latestCrop = next;
            this.props.onCropChange(next);
            return;
        }

        const aspect = this.props.cropAspect;
        const fromCenter = event.shiftKey || (aspect !== null && drag.handle.length === 1);

        let next: CropRect;
        if (fromCenter) {
            next = this.resizeProportional(drag.origin, drag.handle, point);
        } else if (aspect !== null) {
            next = this.resizeAspectAnchored(drag.origin, drag.handle, point, aspect);
        } else {
            next = roundRectValues(resizeRect(drag.origin, drag.handle, point));
        }
        this.latestCrop = next;
        this.props.onCropChange(next);
    };

    private finishDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const drag = this.drag;
        this.drag = null;

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        // Manual double-click detection: canceling pointerdown suppresses the
        // native dblclick event, so it never reaches the canvas.
        const now = performance.now();
        const last = this.lastClick;
        const isDoubleClick =
            last !== null &&
            now - last.time < 400 &&
            Math.hypot(event.clientX - last.x, event.clientY - last.y) < 10;
        this.lastClick = isDoubleClick
            ? null
            : { time: now, x: event.clientX, y: event.clientY };

        if (isDoubleClick) {
            this.props.onOpenFileDialog();
            return;
        }

        if (drag?.kind === "draw") {
            if (!drag.moved) {
                // A plain click outside of the selection clears the crop.
                this.props.onCropChange(null);
                return;
            }

            const rect = this.latestCrop;
            if (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
                this.props.onCropChange(drag.previous);
            }
        }

        this.updateCursor(this.pointFromEvent(event.clientX, event.clientY));
    };

    private cancelDrag = () => {
        const drag = this.drag;
        this.drag = null;

        if (drag?.kind === "draw" && drag.moved) {
            const rect = this.latestCrop;
            if (!rect || rect.width < MIN_SIZE || rect.height < MIN_SIZE) {
                this.props.onCropChange(drag.previous);
            }
        }
    };
}
