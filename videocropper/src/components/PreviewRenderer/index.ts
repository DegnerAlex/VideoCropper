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

import { Application } from "pixi.js";
import { CropOverlayLayer } from "./CropOverlayLayer";
import { FrameLayer } from "./FrameLayer";
import { PillLayer, type PillOptions } from "./PillLayer";
// Keep the public surface stable for existing imports.
export type { PixelRect, PreviewFrame } from "./FrameLayer";
export type { PreviewOverlay } from "./CropOverlayLayer";
import type { PixelRect, PreviewFrame } from "./FrameLayer";
import type { PreviewOverlay } from "./CropOverlayLayer";

/** Look of the drag hint and the crop size badge. */
const HINT_PILL: PillOptions = {
    fontSize: 12,
    fontWeight: "500",
    radius: 8,
    paddingX: 12,
    height: 30,
    background: { color: 0x06080c, alpha: 0.66 },
    textAlpha: 0.92,
};

const BADGE_PILL: PillOptions = {
    fontSize: 11,
    fontWeight: "600",
    radius: 4,
    paddingX: 6,
    height: 20,
    background: { color: 0x000000, alpha: 0.68 },
};

/**
 * Owns the pixi.js scene for the video preview. Composes the logical layers
 * (frame sprite, crop overlay, hint and badge pills) and owns the renderer
 * lifecycle — mounting, resizing and destruction.
 */
export class PreviewRenderer {
    private app: Application | null = null;
    private started = false;
    private disposed = false;

    private frameLayer: FrameLayer | null = null;
    private cropLayer: CropOverlayLayer | null = null;
    private hintPill: PillLayer | null = null;
    private badgePill: PillLayer | null = null;
    private renderedSize = { width: 0, height: 0 };

    /** The canvas pixi renders into, available after mounting. */
    get canvas(): HTMLCanvasElement | null {
        return (this.app?.canvas as HTMLCanvasElement) ?? null;
    }

    /** Creates the application and the scene layers inside `container`. */
    mount(container: HTMLElement, onReady?: () => void): void {
        if (this.started) return;
        this.started = true;
        this.disposed = false;

        void (async () => {
            const app = new Application();
            await app.init({
                width: 1,
                height: 1,
                // Opaque black background: the letterbox is black anyway, and
                // an alpha canvas produces blending artifacts on WebKitGTK.
                backgroundColor: 0x000000,
                backgroundAlpha: 1,
                antialias: true,
                resolution: Math.max(1, window.devicePixelRatio || 1),
                autoDensity: true,
                preference: "webgl",
            });
            if (this.disposed) {
                app.destroy(true, { children: true });
                return;
            }

            const canvas = app.canvas as HTMLCanvasElement;
            canvas.className = "preview-canvas";
            container.appendChild(canvas);

            this.app = app;

            this.frameLayer = new FrameLayer(app.stage);
            this.cropLayer = new CropOverlayLayer(app.stage);
            this.hintPill = new PillLayer(app.stage, HINT_PILL);
            this.badgePill = new PillLayer(app.stage, BADGE_PILL);

            onReady?.();
        })().catch((error) => {
            console.warn("pixi preview is unavailable", error);
        });
    }

    /** Syncs the renderer size with the stage element. */
    resize(width: number, height: number): void {
        if (!this.app) return;
        const w = Math.max(1, width);
        const h = Math.max(1, height);
        if (this.renderedSize.width === w && this.renderedSize.height === h) {
            return;
        }
        this.app.renderer.resize(w, h);
        this.renderedSize = { width: w, height: h };
    }

    /** Redraws the frame and the crop overlay. */

    render(frame: PreviewFrame, overlayState: PreviewOverlay): void {
        if (!this.app || !this.frameLayer || !this.cropLayer) {
            return;
        }

        this.frameLayer.update(frame);

        const videoRect = frame.rect;
        if (!videoRect || !frame.image) {
            this.cropLayer.update(videoRect ?? { x: 0, y: 0, w: 0, h: 0 }, null);
            this.hintPill?.hide();
            this.badgePill?.hide();
            return;
        }

        // No selection yet: show the drag hint instead of the overlay.
        if (!overlayState.crop && overlayState.hint) {
            this.cropLayer.update(videoRect, null);
            this.badgePill?.hide();
            this.drawHintPill(videoRect, overlayState.hint);
            return;
        }

        this.hintPill?.hide();
        this.cropLayer.update(videoRect, overlayState.crop);

        // Size badge at the top-left corner of the selection.
        if (overlayState.crop && overlayState.cropPixels) {
            const text = `${overlayState.cropPixels.width} × ${overlayState.cropPixels.height}`;
            const width = this.badgePill?.measure(text) ?? 0;
            this.badgePill?.draw(
                text,
                overlayState.crop.x + 6,
                overlayState.crop.y + 6,
            );
            void width;
        } else {
            this.badgePill?.hide();
        }
    }

    /** Hint pill centered above the middle of the video rect. */
    private drawHintPill(videoRect: PixelRect, text: string): void {
        if (!this.hintPill) return;
        // It sits above the middle so a loading spinner (drawn at the center)
        // appears right below the text instead of covering it.
        const width = this.hintPill.measure(text);
        const boxX = videoRect.x + (videoRect.w - width) / 2;
        const boxY = videoRect.y + (videoRect.h - HINT_PILL.height) / 2 - 44;
        this.hintPill.draw(text, boxX, boxY);
    }

    /** Tears the renderer down and releases GPU resources. */
    destroy(): void {
        this.disposed = true;
        this.frameLayer?.destroy();
        this.cropLayer?.destroy();
        this.hintPill?.destroy();
        this.badgePill?.destroy();
        this.frameLayer = null;
        this.cropLayer = null;
        this.hintPill = null;
        this.badgePill = null;
        this.app?.destroy(true, { children: true });
        this.app = null;
        this.renderedSize = { width: 0, height: 0 };
    }
}
