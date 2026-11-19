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
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { clamp, formatTick, formatTime } from "../format";
import type { TimeRange } from "./TimeRange";

type PointerLike = { clientX: number };

interface DragRect {
    left: number;
    width: number;
}

type DragState =
    | { kind: "seek"; rect: DragRect }
    | { kind: "playhead"; rect: DragRect; offsetPx: number }
    | { kind: "start"; rect: DragRect }
    | { kind: "end"; rect: DragRect }
    | {
          kind: "region";
          rect: DragRect;
          offset: number;
          length: number;
          startX: number;
          startTime: number;
          moved: boolean;
      };

/** Smallest allowed selection, in seconds. */
const MIN_RANGE = 0.05;

/** Pointer travel (px) that turns a click inside the selection into a drag. */
const DRAG_THRESHOLD = 3;

const TICK_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export interface TimelineTrackProps {
    duration: number;
    currentTime: number;
    range: TimeRange;
    /** Currently keyboard-selected handle; `null` when none is selected. */
    activeHandle: "start" | "end" | null;
    onActiveHandleChange: (handle: "start" | "end" | null) => void;
    onSeek: (time: number) => void;
    onRangeChange: (range: TimeRange) => void;
}

interface Tooltip {
    time: number;
    left: number;
}

interface TimelineTrackState {
    tooltips: Tooltip[];
    /** True while the playhead is being dragged (enlarged head). */
    playheadDragging: boolean;
}

/** The draggable track: ruler, selection region, handles, playhead and the
 * time tooltips shown while dragging. */
export class TimelineTrack extends Component<TimelineTrackProps, TimelineTrackState> {
    private trackRef = createRef<HTMLDivElement>();
    private drag: DragState | null = null;

    state: TimelineTrackState = {
        tooltips: [],
        playheadDragging: false,
    };

    render() {
        const { duration, currentTime, range, activeHandle } = this.props;
        const { step, ticks } = this.ticks;

        // A selected (not currently dragged) handle keeps its tooltip visible.
        const tooltips = this.state.tooltips.length > 0 ? this.state.tooltips : this.activeTooltips;

        return (
            <div
                className="timeline-track"
                ref={this.trackRef}
                role="slider"
                tabIndex={0}
                aria-label="Video timeline"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration * 1000) / 1000}
                aria-valuenow={Math.round(currentTime * 1000) / 1000}
                aria-valuetext={formatTime(currentTime)}
                onPointerDown={this.handlePointerDown}
                onPointerMove={this.handlePointerMove}
                onPointerUp={this.finishDrag}
                onPointerCancel={this.finishDrag}
                onKeyDown={this.handleKeyDown}
            >
                <div className="timeline-ruler">
                    {ticks.map((time, index) => (
                        <span
                            key={time}
                            className={
                                "timeline-tick" +
                                (index === 0 ? " is-first" : "") +
                                (index === ticks.length - 1 ? " is-last" : "")
                            }
                            style={{ left: `${this.percent(time)}%` }}
                        >
                            {formatTick(time, step)}
                        </span>
                    ))}
                </div>

                <div
                    className="timeline-dim"
                    style={{
                        left: -23,
                        width: `calc(23px + ${this.percent(range.start)}%)`,
                    }}
                />
                <div
                    className="timeline-dim"
                    style={{ left: `${this.percent(range.end)}%`, right: -23 }}
                />

                <div
                    className="timeline-region"
                    data-region
                    style={{
                        left: `${this.percent(range.start)}%`,
                        width: `${this.percent(Math.max(0, range.end - range.start))}%`,
                    }}
                >
                    <span
                        className={
                            "timeline-handle is-start" +
                            (activeHandle === "start" ? " is-active" : "")
                        }
                        data-handle="start"
                    />
                    <span
                        className={
                            "timeline-handle is-end" +
                            (activeHandle === "end" ? " is-active" : "")
                        }
                        data-handle="end"
                    />
                </div>

                <div
                    className={
                        "timeline-playhead" +
                        (this.state.playheadDragging ? " is-dragging" : "")
                    }
                    style={{ left: `${this.percent(currentTime)}%` }}
                />

                <div
                    className={
                        "timeline-playhead-handle" +
                        (this.state.playheadDragging ? " is-dragging" : "")
                    }
                    style={{ left: `${this.percent(currentTime)}%` }}
                    data-handle="playhead"
                />

                {tooltips.map((tip, index) => (
                    <span
                        key={`${tip.time}-${index}`}
                        className="timeline-tooltip"
                        style={{ left: `${tip.left}%` }}
                    >
                        {formatTime(tip.time)}
                    </span>
                ))}
            </div>
        );
    }

    private get percent(): (time: number) => number {
        const { duration } = this.props;
        return (time: number) => (duration > 0 ? clamp((time / duration) * 100, 0, 100) : 0);
    }

    private get activeTooltips(): Tooltip[] {
        const { activeHandle, range, currentTime } = this.props;

        if (activeHandle === "start") {
            return [{ time: range.start, left: clamp(this.percent(range.start), 3, 97) }];
        }
        if (activeHandle === "end") {
            return [{ time: range.end, left: clamp(this.percent(range.end), 3, 97) }];
        }
        if (activeHandle === "playhead") {
            return [{ time: currentTime, left: clamp(this.percent(currentTime), 3, 97) }];
        }
        return [];
    }

    private get ticks(): { step: number; ticks: number[] } {
        const { duration } = this.props;
        if (duration <= 0) {
            return { step: 1, ticks: [] };
        }

        const step = TICK_STEPS.find((candidate) => duration / candidate <= 10) ?? 3600;
        const ticks: number[] = [];
        for (let time = 0; time <= duration + step / 2; time += step) {
            ticks.push(Math.round(time * 1000) / 1000);
        }

        return { step, ticks };
    }

    /** Time under a pointer, clamped to the track. */
    private timeAt(clientX: number): number {
        const { duration } = this.props;
        const rect = this.trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
    }

    /** Pointer position along the track, in percent (for the tooltip). */
    private pointerAt(clientX: number): number {
        const rect = this.trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 50;
        return clamp(((clientX - rect.left) / rect.width) * 100, 3, 97);
    }

    private updateRange = (next: TimeRange): void => {
        this.props.onRangeChange({
            start: Math.round(next.start * 1000) / 1000,
            end: Math.round(next.end * 1000) / 1000,
        });
    };

    private handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        const { duration, range } = this.props;
        if (event.button !== 0 || duration <= 0) return;

        const target = event.target as HTMLElement;
        const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle;
        const trackRect = this.trackRef.current?.getBoundingClientRect();
        const rect: DragRect = {
            left: trackRect?.left ?? 0,
            width: trackRect?.width ?? 1,
        };
        const time = this.timeAt(event.clientX);

        if (handle === "playhead") {
            // Preserve the grab point: the head stays attached to the pointer
            // exactly where it was grabbed.
            const headCenterX = rect.left + (rect.width * this.percent(this.props.currentTime)) / 100;
            this.drag = { kind: "playhead", rect, offsetPx: event.clientX - headCenterX };
            this.setState({ playheadDragging: true });
            this.props.onActiveHandleChange(null);
        } else if (handle === "start") {
            this.drag = { kind: "start", rect };
            this.props.onActiveHandleChange("start");
        } else if (handle === "end") {
            this.drag = { kind: "end", rect };
            this.props.onActiveHandleChange("end");
        } else if (target.closest("[data-region]")) {
            this.drag = {
                kind: "region",
                rect,
                offset: time - range.start,
                length: range.end - range.start,
                startX: event.clientX,
                startTime: time,
                moved: false,
            };
            this.props.onActiveHandleChange(null);
        } else {
            this.drag = { kind: "seek", rect };
            this.props.onActiveHandleChange(null);
            this.props.onSeek(time);
        }

        // Drag listeners live on the document: WebKitGTK does not deliver
        // pointermove to React's delegated handler while the button is held.
        document.addEventListener("pointermove", this.handlePointerMove);
        document.addEventListener("pointerup", this.finishDrag);
        document.addEventListener("pointercancel", this.finishDrag);
        event.preventDefault();
    };

    private handlePointerMove = (event: PointerLike): void => {
        const drag = this.drag;
        if (!drag) return;

        const { duration, range } = this.props;
        const time = clamp(
            (event.clientX - drag.rect.left) / Math.max(1, drag.rect.width),
            0,
            1,
        ) * duration;

        switch (drag.kind) {
            case "seek":
                this.props.onSeek(time);
                break;
            case "playhead":
                this.props.onSeek(
                    clamp(
                        (event.clientX - drag.offsetPx - drag.rect.left) /
                            Math.max(1, drag.rect.width),
                        0,
                        1,
                    ) * duration,
                );
                break;
            case "start": {
                const value = clamp(time, 0, Math.max(0, range.end - MIN_RANGE));
                this.updateRange({ start: value, end: range.end });
                this.setState({ tooltips: [{ time: value, left: this.pointerAt(event.clientX) }] });
                break;
            }
            case "end": {
                const value = clamp(time, Math.min(duration, range.start + MIN_RANGE), duration);
                this.updateRange({ start: range.start, end: value });
                this.setState({ tooltips: [{ time: value, left: this.pointerAt(event.clientX) }] });
                break;
            }
            case "region": {
                if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD) {
                    return;
                }
                drag.moved = true;
                const start = clamp(time - drag.offset, 0, Math.max(0, duration - drag.length));
                this.updateRange({ start, end: start + drag.length });
                // Both edges of the moving selection show their time.
                this.setState({
                    tooltips: [
                        { time: start, left: clamp(this.percent(start), 3, 97) },
                        {
                            time: start + drag.length,
                            left: clamp(this.percent(start + drag.length), 3, 97),
                        },
                    ],
                });
                break;
            }
        }
    };

    private finishDrag = (_event: PointerLike): void => {
        document.removeEventListener("pointermove", this.handlePointerMove);
        document.removeEventListener("pointerup", this.finishDrag);
        document.removeEventListener("pointercancel", this.finishDrag);

        const drag = this.drag;
        this.drag = null;
        this.setState((state) => ({
            tooltips: [],
            playheadDragging: drag?.kind === "playhead" ? false : state.playheadDragging,
        }));

        // A click inside the selection (no pointer travel) seeks instead of
        // moving the selection.
        if (drag?.kind === "region" && !drag.moved) {
            this.props.onSeek(drag.startTime);
        }

    };

    private handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const { duration, currentTime, range } = this.props;
        if (duration <= 0) return;

        const stepSize = event.shiftKey ? 5 : 1;

        if (event.key === "ArrowLeft") {
            event.preventDefault();
            this.props.onSeek(clamp(currentTime - stepSize, 0, duration));
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            this.props.onSeek(clamp(currentTime + stepSize, 0, duration));
        } else if (event.key === "Home") {
            event.preventDefault();
            this.props.onSeek(range.start);
        } else if (event.key === "End") {
            event.preventDefault();
            this.props.onSeek(range.end);
        }
    };
}
