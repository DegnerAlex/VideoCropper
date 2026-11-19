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

import { Component } from "preact/compat";
import { isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface FileDropPayload {
    /** Absolute paths reported by Tauri's native drag and drop. */
    paths: string[];
    /** Files reported by the HTML5 drag and drop API (browser preview). */
    files: File[];
}

interface FileDropZoneProps {
    onDrop: (payload: FileDropPayload) => void;
    onDragStateChange: (isDragging: boolean) => void;
}

type NativeDragDropHandler = Parameters<
    ReturnType<typeof getCurrentWebview>["onDragDropEvent"]
>[0];

/**
 * Invisible helper that listens for files dragged onto the window.
 *
 * Inside Tauri this uses the native drag and drop event (HTML5 drag events are
 * intercepted by the webview), which provides absolute paths. In a regular
 * browser it falls back to the HTML5 API, which only exposes `File` objects.
 *
 * The Rust side additionally pushes drag state and dropped paths into the
 * webview through evaluated scripts (see src-tauri/src/lib.rs) because the
 * `tauri://drag-drop` event delivery can be lost under XWayland.
 */
export class FileDropZone extends Component<FileDropZoneProps> {
    private unlisten: UnlistenFn | undefined;
    private disposed = false;
    private depth = 0;
    private lastDropAt = 0;

    componentDidMount(): void {
        if (isTauri()) {
            getCurrentWebview()
                .onDragDropEvent(this.handleNativeEvent)
                .then((stop) => {
                    if (this.disposed) {
                        stop();
                    } else {
                        this.unlisten = stop;
                    }
                })
                .catch((error) => {
                    console.warn("native drag and drop is unavailable", error);
                });
        }

        // HTML5 fallback. In Tauri the native handler above receives the drop
        // and these events never fire, so there is no double handling.
        window.addEventListener("dragenter", this.handleEnter);
        window.addEventListener("dragover", this.handleOver);
        window.addEventListener("dragleave", this.handleLeave);
        window.addEventListener("drop", this.handleDrop);

        // Direct bridge from the Rust side (see src-tauri/src/lib.rs).
        (window as unknown as { __onNativeDragState?: (active: boolean) => void })
            .__onNativeDragState = (active) => {
            this.props.onDragStateChange(active);
        };
        (window as unknown as { __onNativeDrop?: (paths: string[]) => void })
            .__onNativeDrop = (paths) => {
            this.props.onDragStateChange(false);
            this.acceptDrop(paths);
        };
    }

    componentWillUnmount(): void {
        this.disposed = true;
        this.unlisten?.();
        const bridge = window as unknown as {
            __onNativeDrop?: unknown;
            __onNativeDragState?: unknown;
        };
        delete bridge.__onNativeDrop;
        delete bridge.__onNativeDragState;
        window.removeEventListener("dragenter", this.handleEnter);
        window.removeEventListener("dragover", this.handleOver);
        window.removeEventListener("dragleave", this.handleLeave);
        window.removeEventListener("drop", this.handleDrop);
    }

    private handleNativeEvent: NativeDragDropHandler = (event) => {
        const payload = event.payload;

        if (payload.type === "enter" || payload.type === "over") {
            this.props.onDragStateChange(true);
        } else if (payload.type === "leave") {
            this.props.onDragStateChange(false);
        } else if (payload.type === "drop") {
            this.props.onDragStateChange(false);
            this.acceptDrop(payload.paths);
        }
    };

    /** Opens the dropped file, ignoring duplicate deliveries (native event +
     *  eval bridge can both fire for the same drop). */
    private acceptDrop(paths: string[]): void {
        const now = Date.now();
        if (paths.length === 0) return;
        if (now - this.lastDropAt < 500) return;
        this.lastDropAt = now;
        this.props.onDrop({ paths, files: [] });
    }

    private hasFiles(event: DragEvent): boolean {
        return Array.from(event.dataTransfer?.types ?? []).includes("Files");
    }

    private handleEnter = (event: DragEvent) => {
        if (!this.hasFiles(event)) return;
        event.preventDefault();
        this.depth += 1;
        this.props.onDragStateChange(true);
    };

    private handleOver = (event: DragEvent) => {
        if (!this.hasFiles(event)) return;
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
        }
        this.props.onDragStateChange(true);
    };

    private handleLeave = (event: DragEvent) => {
        if (!this.hasFiles(event)) return;
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth === 0) {
            this.props.onDragStateChange(false);
        }
    };

    private handleDrop = (event: DragEvent) => {
        if (!this.hasFiles(event)) return;
        event.preventDefault();
        this.depth = 0;
        this.props.onDragStateChange(false);

        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) {
            this.props.onDrop({ paths: [], files });
        }
    };

    render(): null {
        return null;
    }
}
