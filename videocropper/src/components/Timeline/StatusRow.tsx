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
import { formatTime } from "../format";
import type { TimeRange } from "./TimeRange";

export interface StatusRowProps {
    range: TimeRange;
    /** Frame rate used for frame numbering; falls back to 25 inside. */
    fps: number;
}

/** Time/frame readout under the track: range edges and the selection length. */
export class StatusRow extends Component<StatusRowProps> {
    render() {
        const { range } = this.props;
        const fps = this.props.fps > 0 ? this.props.fps : 25;

        // Frame numbering: the in-point is the first frame of the selection,
        // the out-point is the last included frame (both 1-based).
        const startFrame = Math.floor(range.start * fps + 1e-6) + 1;
        const endFrame = Math.ceil(range.end * fps - 1e-6);
        const framesCount = Math.max(0, endFrame - startFrame + 1);
        const selectionLength = Math.max(0, range.end - range.start);

        return (
            <div className="timeline-status">
                <span className="timeline-status-side is-left">
                    {formatTime(range.start)} / {startFrame}
                </span>
                <span className="timeline-status-center">
                    {formatTime(selectionLength)} / {framesCount}
                </span>
                <span className="timeline-status-side is-right">
                    {formatTime(range.end)} / {endFrame}
                </span>
            </div>
        );
    }
}
