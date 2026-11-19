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

interface SwitchProps {
    /** Current switch state. */
    checked: boolean;
    /** Text shown next to the switch. */
    label: string;
    /** Optional tooltip. */
    title?: string;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}

/**
 * Breeze-style on/off switch (KDE Plasma checkbox switch) with a text label.
 */
export class Switch extends Component<SwitchProps> {
    render() {
        const { checked, label, title, disabled, onChange } = this.props;

        return (
            <label
                className={
                    "plasma-switch" +
                    (checked ? " is-checked" : "") +
                    (disabled ? " is-disabled" : "")
                }
                title={title}
            >
                <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={(event) => onChange(event.currentTarget.checked)}
                />
                <span className="plasma-switch-track">
                    <span className="plasma-switch-knob" />
                </span>
                <span className="plasma-switch-label">{label}</span>
            </label>
        );
    }
}
