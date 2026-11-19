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

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Formats seconds as `mm:ss.mmm` (or `h:mm:ss.mmm` for long videos). */
export function formatTime(seconds: number, withMilliseconds = true): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        seconds = 0;
    }

    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const secs = Math.floor((totalMs % 60_000) / 1000);
    const millis = totalMs % 1000;

    const minutesText = String(minutes).padStart(2, "0");
    const secondsText = String(secs).padStart(2, "0");

    const base = hours > 0
        ? `${hours}:${minutesText}:${secondsText}`
        : `${minutesText}:${secondsText}`;

    return withMilliseconds
        ? `${base}.${String(millis).padStart(3, "0")}`
        : base;
}

/** Formats bytes as a human readable size. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1,
    );
    const value = bytes / Math.pow(1024, exponent);

    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Formats a tick label on the timeline; short spans keep sub-second precision. */
export function formatTick(seconds: number, step: number): string {
    if (step < 1) {
        return `${seconds.toFixed(step < 0.1 ? 2 : 1)}s`;
    }

    return formatTime(seconds, false);
}
