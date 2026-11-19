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

import { Container, Graphics, Text } from "pixi.js";

/** Look of a pill (rounded box with a single line of text). */
export interface PillOptions {
    fontSize: number;
    /** CSS font-weight value ("500", "600", ...). */
    fontWeight: "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";
    radius: number;
    /** Horizontal padding around the text. */
    paddingX: number;
    height: number;
    background: { color: number; alpha: number };
    /** Opacity of the text itself. */
    textAlpha?: number;
}

/**
 * A rounded box with a single line of text — used for the drag hint and the
 * crop size badge. The caller positions the pill; the layer measures the text
 * and draws the box around it.
 */
export class PillLayer {
    readonly pill = new Graphics();
    readonly label: Text;
    private options: PillOptions;

    constructor(stage: Container, options: PillOptions) {
        this.options = options;
        this.label = new Text({
            text: "",
            style: {
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: options.fontSize,
                fontWeight: options.fontWeight,
                fill: 0xffffff,
            },
        });
        this.label.anchor.set(0, 0.5);
        if (options.textAlpha !== undefined) {
            this.label.alpha = options.textAlpha;
        }
        this.label.visible = false;
        stage.addChild(this.pill, this.label);
    }

    /** Full width of the pill for `text` (text metrics + padding). */
    measure(text: string): number {
        this.label.text = text;
        return this.label.width + this.options.paddingX * 2;
    }

    /** Draws the pill with its left edge at (`x`, `y`) top-left corner. */
    draw(text: string, x: number, y: number): void {
        this.label.text = text;
        this.pill.clear();
        this.pill
            .roundRect(x, y, this.label.width + this.options.paddingX * 2, this.options.height, this.options.radius)
            .fill(this.options.background);
        this.pill.visible = true;
        this.label.position.set(x + this.options.paddingX, y + this.options.height / 2 + 0.5);
        this.label.visible = true;
    }

    hide(): void {
        this.pill.clear();
        this.pill.visible = false;
        this.label.visible = false;
    }

    destroy(): void {
        this.hide();
        this.label.destroy();
        this.pill.destroy();
    }
}
