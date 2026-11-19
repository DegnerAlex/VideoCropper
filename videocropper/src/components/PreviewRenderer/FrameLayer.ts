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

import { Container, Sprite, Texture } from "pixi.js";

/** Rectangle in CSS pixels relative to the preview stage. */
export interface PixelRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Frame image and its letterboxed position on the stage. */
export interface PreviewFrame {
    image: HTMLImageElement | null;
    rect: PixelRect | null;
}

/**
 * The video frame itself: a sprite showing the extracted frame image,
 * letterboxed to the stage. Owns its texture lifecycle — a new texture is
 * created only when the image actually changes, stale ones are destroyed.
 */
export class FrameLayer {
    readonly sprite = new Sprite();
    private texture: Texture | null = null;
    private image: HTMLImageElement | null = null;

    constructor(stage: Container) {
        this.sprite.visible = false;
        stage.addChild(this.sprite);
    }

    update(frame: PreviewFrame): void {
        if (frame.image && frame.rect) {
            if (this.image !== frame.image) {
                this.texture?.destroy(true);
                this.texture = Texture.from(frame.image);
                this.image = frame.image;
                this.sprite.texture = this.texture;
            }
            this.sprite.visible = true;
            this.sprite.position.set(frame.rect.x, frame.rect.y);
            this.sprite.width = frame.rect.w;
            this.sprite.height = frame.rect.h;
        } else {
            this.sprite.visible = false;
        }
    }

    destroy(): void {
        this.texture?.destroy(true);
        this.texture = null;
        this.image = null;
    }
}

/** Shared geometry helper: rect in normalized frame coordinates to pixels. */
export function cropToPixels(
    videoRect: PixelRect,
    crop: { x: number; y: number; width: number; height: number },
): PixelRect {
    return {
        x: videoRect.x + crop.x * videoRect.w,
        y: videoRect.y + crop.y * videoRect.h,
        w: crop.width * videoRect.w,
        h: crop.height * videoRect.h,
    };
}
