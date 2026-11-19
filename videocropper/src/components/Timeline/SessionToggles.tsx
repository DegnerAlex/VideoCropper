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
import { Button } from "react-bulma-components";
import { FiDownload, FiFolder, FiTrash2 } from "react-icons/fi";
import { Switch } from "../Switch";

/** Common crop aspect presets (w/h in frame pixels). */
export const ASPECT_PRESETS: Array<{ label: string; value: number | null }> = [
    { label: "Free", value: null },
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
    { label: "1:1", value: 1 },
    { label: "21:9", value: 21 / 9 },
];

export interface SessionTogglesProps {
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
    /** Locked crop aspect; `null` = free selection. */
    cropAspect: number | null;
    onCropAspectChange: (value: number | null) => void;
    /** Export job in progress. */
    exporting: boolean;
    exportProgress: number | null;
    onExport: () => void;
}

/** Session switches, crop aspect presets and the clear/export actions. */
export class SessionToggles extends Component<SessionTogglesProps> {
    render() {
        const { keepSettings, rememberVideo, exporting, exportProgress } = this.props;

        return (
            <div className="session-toggles">
                <span className="pin-label">Pin</span>
                <Switch
                    checked={keepSettings}
                    label="Selections"
                    title="Apply the current selections (range and crop) to the next opened video"
                    onChange={(value) => this.props.onKeepSettingsChange(value)}
                />

                <Switch
                    checked={rememberVideo}
                    label="Video"
                    title="Reopen the last processed video on startup (if the file is still in place)"
                    onChange={(value) => this.props.onRememberVideoChange(value)}
                />

                <div className="aspect-presets">
                    {ASPECT_PRESETS.map((preset) => (
                        <Button
                            key={preset.label}
                            className="aspect-preset"
                            size="small"
                            color={
                                this.props.cropAspect === preset.value ? "primary" : "light"
                            }
                            title={
                                preset.value === null
                                    ? "Free selection without an aspect lock"
                                    : `Lock the crop selection to ${preset.label}`
                            }
                            onClick={() =>
                                this.props.onCropAspectChange(preset.value)
                            }
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>


                <Button
                    className="clear-button"
                    size="small"
                    color="light"
                    disabled={!this.props.hasSelections}
                    title="Remove the crop selection and reset the timeline range"
                    onClick={() => this.props.onClearSelections()}
                >
                    <span className="session-toggle-label">
                        <FiTrash2 />
                        Clear
                    </span>
                </Button>

                <Button
                    className="open-button"
                    size="small"
                    color="light"
                    title="Open another video file"
                    onClick={() => this.props.onOpenFile()}
                >
                    <span className="session-toggle-label">
                        <FiFolder />
                        Open
                    </span>
                </Button>

                <Button
                    className="export-button"
                    size="small"
                    color="success"
                    disabled={exporting}
                    title="Apply the selections and save the result as a new file"
                    onClick={() => this.props.onExport()}
                >
                    <span className="session-toggle-label">
                        <FiDownload />
                        {exporting
                            ? exportProgress !== null
                                ? `Exporting ${Math.round(exportProgress)}%`
                                : "Exporting…"
                            : "Export"}
                    </span>
                </Button>
            </div>
        );
    }
}
