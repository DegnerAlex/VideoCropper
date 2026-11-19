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

import { Component } from "react";
import { TimelineTrack } from "./TimelineTrack";
import { StatusRow } from "./StatusRow";
import { SessionToggles } from "./SessionToggles";
import type { TimeRange } from "./TimeRange";

export type { TimeRange } from "./TimeRange";

export interface TimelineProps {
    duration: number;
    currentTime: number;
    range: TimeRange;
    /** Frame rate used for frame numbering; falls back to 25 inside. */
    fps: number;
    /** Currently keyboard-selected handle; `null` when none is selected. */
    activeHandle: "start" | "end" | "playhead" | null;
    onActiveHandleChange: (handle: "start" | "end" | "playhead" | null) => void;
    /** Apply current settings to newly opened videos. */
    keepSettings: boolean;
    onKeepSettingsChange: (value: boolean) => void;
    /** Reopen the last processed video on startup. */
    rememberVideo: boolean;
    onRememberVideoChange: (value: boolean) => void;
    /** Whether there is anything to clear (crop or a trimmed range). */
    hasSelections: boolean;
    onClearSelections: () => void;
    /** Opens the file chooser (defaults to the current file folder). */
    onOpenFile: () => void;
    /** Export job in progress. */
    exporting: boolean;
    exportProgress: number | null;
    onExport: () => void;
    onSeek: (time: number) => void;
    onRangeChange: (range: TimeRange) => void;
}

/** The timeline block: track, status readout and session toggles. */
export class Timeline extends Component<TimelineProps> {
    render() {
        const {
            duration,
            currentTime,
            range,
            fps,
            activeHandle,
            onActiveHandleChange,
            onSeek,
            onRangeChange,
        } = this.props;

        return (
            <section className="timeline-block">
                <div className="timeline-card">
                    <TimelineTrack
                        duration={duration}
                        currentTime={currentTime}
                        range={range}
                        activeHandle={activeHandle}
                        onActiveHandleChange={onActiveHandleChange}
                        onSeek={onSeek}
                        onRangeChange={onRangeChange}
                    />
                </div>

                <div className="controls-bar">
                    <StatusRow range={range} fps={fps} />

                    <SessionToggles
                        keepSettings={this.props.keepSettings}
                        onKeepSettingsChange={this.props.onKeepSettingsChange}
                        rememberVideo={this.props.rememberVideo}
                        onRememberVideoChange={this.props.onRememberVideoChange}
                        hasSelections={this.props.hasSelections}
                        onClearSelections={this.props.onClearSelections}
                        onOpenFile={this.props.onOpenFile}                        exporting={this.props.exporting}
                        exportProgress={this.props.exportProgress}
                        onExport={this.props.onExport}
                    />
                </div>
            </section>
        );
    }
}
