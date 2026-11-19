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
import { Button } from "react-bulma-components";
import { FiDownload, FiFolder, FiTrash2 } from "react-icons/fi";
import { Switch } from "../Switch";

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
    /** Export job in progress. */
    exporting: boolean;
    exportProgress: number | null;
    onExport: () => void;
}

/** Session switches and the clear/export actions. */
export class SessionToggles extends Component<SessionTogglesProps> {
    render() {
        const { keepSettings, rememberVideo, exporting, exportProgress } = this.props;

        return (
            <div className="session-toggles">
                <Switch
                    checked={keepSettings}
                    label="Remember selections"
                    title="Apply the current selections (range and crop) to the next opened video"
                    onChange={(value) => this.props.onKeepSettingsChange(value)}
                />

                <Switch
                    checked={rememberVideo}
                    label="Remember video"
                    title="Reopen the last processed video on startup (if the file is still in place)"
                    onChange={(value) => this.props.onRememberVideoChange(value)}
                />

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
                        Clear selections
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
