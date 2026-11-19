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

import { Container, Graphics } from "pixi.js";
import type { PixelRect } from "./FrameLayer";

/** Crop overlay state. */
export interface PreviewOverlay {
    /** Selection rectangle in CSS pixels, `null` hides the overlay. */
    crop: PixelRect | null;
    /** Rounded crop size in frame pixels, shown in the badge. */
    cropPixels: { width: number; height: number } | null;
    /** Hint pill text; `null` hides it. */
    hint: string | null;
}

/** Colors used by the selection overlay. */
const OVERLAY = {
    dim: { color: 0x05070b, alpha: 0.62 },
    grid: { color: 0xffffff, alpha: 0.28, width: 1 },
    border: { color: 0xffffff, alpha: 0.95, width: 1.5 },
    handleFill: 0xffffff,
    handleStroke: { color: 0x000000, alpha: 0.4, width: 1 },
};

/** Handles of the crop rectangle, in CSS pixel coordinates. */
function handlePoints(rect: PixelRect): Array<{ x: number; y: number }> {
    return [
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.w / 2, y: rect.y },
        { x: rect.x + rect.w, y: rect.y },
        { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
        { x: rect.x + rect.w, y: rect.y + rect.h },
        { x: rect.x + rect.w / 2, y: rect.y + rect.h },
        { x: rect.x, y: rect.y + rect.h },
        { x: rect.x, y: rect.y + rect.h / 2 },
    ];
}

/**
 * The selection overlay: dims the frame outside the crop rectangle and draws
 * the rule-of-thirds grid, the border and the resize handles on top of it.
 */
export class CropOverlayLayer {
    readonly graphics = new Graphics();

    constructor(stage: Container) {
        stage.addChild(this.graphics);
    }

    /** `crop` is `null` when nothing is selected — the overlay clears. */
    update(videoRect: PixelRect, crop: PixelRect | null): void {
        const g = this.graphics;
        g.clear();
        if (!crop) {
            return;
        }

        // Dim the frame outside of the selection (letterbox stays black).
        const left = Math.max(0, crop.x - videoRect.x);
        const top = Math.max(0, crop.y - videoRect.y);
        const right = Math.max(0, videoRect.x + videoRect.w - (crop.x + crop.w));
        const bottom = Math.max(0, videoRect.y + videoRect.h - (crop.y + crop.h));
        g.rect(videoRect.x, videoRect.y, videoRect.w, top).fill(OVERLAY.dim);
        g.rect(videoRect.x, crop.y + crop.h, videoRect.w, bottom).fill(OVERLAY.dim);
        g.rect(videoRect.x, crop.y, left, crop.h).fill(OVERLAY.dim);
        g.rect(crop.x + crop.w, crop.y, right, crop.h).fill(OVERLAY.dim);

        // Rule-of-thirds grid.
        for (const fraction of [1 / 3, 2 / 3]) {
            g.moveTo(crop.x + crop.w * fraction, crop.y)
                .lineTo(crop.x + crop.w * fraction, crop.y + crop.h);
            g.moveTo(crop.x, crop.y + crop.h * fraction)
                .lineTo(crop.x + crop.w, crop.y + crop.h * fraction);
        }
        g.stroke(OVERLAY.grid);

        // Selection border.
        g.rect(crop.x, crop.y, crop.w, crop.h).stroke(OVERLAY.border);

        // Handles.
        for (const point of handlePoints(crop)) {
            g.rect(point.x - 5.5, point.y - 5.5, 11, 11)
                .fill(OVERLAY.handleFill)
                .stroke(OVERLAY.handleStroke);
        }
    }

    destroy(): void {
        this.graphics.clear();
    }
}
