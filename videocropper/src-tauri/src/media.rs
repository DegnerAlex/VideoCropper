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

//! FFmpeg/ffprobe process helpers and video metadata probing.
//!
//! In development the binaries are provided by the dev container (see
//! `docker/videocropper/Dockerfile`) and resolved from `PATH`. Release builds
//! use the sidecar binaries bundled via `bundle.externalBin`
//! (see `src-tauri/tauri.conf.json` and `scripts/prepare-sidecars.sh`).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{Command, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Metadata about an opened video file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMeta {
    /// Absolute path to the file on disk.
    pub path: String,
    /// File name including the extension.
    pub name: String,
    /// Duration in milliseconds, when known.
    pub duration_ms: f64,
    /// Display width in pixels (rotation applied).
    pub width: u32,
    /// Display height in pixels (rotation applied).
    pub height: u32,
    /// Name of the first video codec, e.g. `h264`.
    pub video_codec: Option<String>,
    /// Name of the first audio codec, e.g. `aac`.
    pub audio_codec: Option<String>,
    /// Frame rate of the first video stream, when known.
    pub fps: Option<f64>,
    /// Container format as reported by ffprobe, e.g. `mov,mp4,m4a,3gp,3g2,mj2`.
    pub format_name: Option<String>,
    /// File size in bytes.
    pub size_bytes: u64,
    /// Set when ffprobe could not inspect the file. The frontend then falls
    /// back to whatever the video element reports.
    pub probe_error: Option<String>,
}

/// Returns a command for the bundled `ffmpeg` sidecar (release) or the
/// `ffmpeg` available in `PATH` (development).
pub fn ffmpeg(app: &AppHandle) -> Result<Command, String> {
    binary(app, "ffmpeg")
}

/// Returns a command for the bundled `ffprobe` sidecar (release) or the
/// `ffprobe` available in `PATH` (development).
pub fn ffprobe(app: &AppHandle) -> Result<Command, String> {
    binary(app, "ffprobe")
}

fn binary(app: &AppHandle, name: &str) -> Result<Command, String> {
    if cfg!(debug_assertions) {
        return Ok(app.shell().command(name));
    }

    app.shell()
        .sidecar(name)
        .map_err(|error| format!("failed to locate the {name} sidecar: {error}"))
}

/// Opens a video file: grants the webview access to it through the asset
/// protocol and returns its metadata.
///
/// The frontend turns `path` into a playable URL with `convertFileSrc`.
#[tauri::command]
pub async fn open_video(app: AppHandle, path: String) -> Result<VideoMeta, String> {
    let path = PathBuf::from(&path);
    let path = std::fs::canonicalize(&path)
        .map_err(|error| format!("cannot open {}: {error}", path.display()))?;

    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    // The asset protocol only serves files that are explicitly allowed here.
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| format!("cannot grant access to {}: {error}", path.display()))?;

    // Frames cached for the previous video are no longer needed.
    if let Ok(cache_dir) = frames_dir(&app) {
        let _ = std::fs::remove_dir_all(&cache_dir);
    }

    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let size_bytes = std::fs::metadata(&path)
        .map(|meta| meta.len())
        .unwrap_or_default();

    match probe(&app, &path).await {
        Ok(meta) => Ok(meta),
        // Keep the file usable: the video element can still report duration
        // and dimensions even when ffprobe fails (e.g. a codec mismatch).
        Err(error) => Ok(VideoMeta {
            path: path.display().to_string(),
            name,
            duration_ms: 0.0,
            width: 0,
            height: 0,
            video_codec: None,
            audio_codec: None,
            fps: None,
            format_name: None,
            size_bytes,
            probe_error: Some(error),
        }),
    }
}

async fn probe(app: &AppHandle, path: &Path) -> Result<VideoMeta, String> {
    let output = ffprobe(app)?
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .await
        .map_err(|error| format!("failed to run ffprobe: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = stderr.trim();
        return Err(if message.is_empty() {
            "ffprobe failed to read the file".to_string()
        } else {
            message.to_string()
        });
    }

    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("failed to parse ffprobe output: {error}"))?;

    let video = parsed
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| "the file does not contain a video stream".to_string())?;

    let audio = parsed
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("audio"));

    let duration_ms = parsed
        .format
        .as_ref()
        .and_then(|format| format.duration.as_deref())
        .and_then(parse_seconds)
        .or_else(|| video.duration.as_deref().and_then(parse_seconds))
        .unwrap_or(0.0)
        * 1000.0;

    let rotation = video
        .tags
        .as_ref()
        .and_then(|tags| tags.rotate.as_deref())
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(0);

    let mut width = video.width.unwrap_or(0);
    let mut height = video.height.unwrap_or(0);
    if rotation.rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }

    let size_bytes = parsed
        .format
        .as_ref()
        .and_then(|format| format.size.as_deref())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| std::fs::metadata(path).ok().map(|meta| meta.len()))
        .unwrap_or(0);

    Ok(VideoMeta {
        path: path.display().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        duration_ms,
        width,
        height,
        video_codec: video.codec_name.clone(),
        audio_codec: audio.and_then(|stream| stream.codec_name.clone()),
        fps: video.avg_frame_rate.as_deref().and_then(parse_rate),
        format_name: parsed.format.and_then(|format| format.format_name),
        size_bytes,
        probe_error: None,
    })
}

fn parse_seconds(value: &str) -> Option<f64> {
    value.parse::<f64>().ok().filter(|seconds| seconds.is_finite())
}

fn parse_rate(value: &str) -> Option<f64> {
    let (numerator, denominator) = value.split_once('/')?;
    let numerator = numerator.trim().parse::<f64>().ok()?;
    let denominator = denominator.trim().parse::<f64>().ok()?;

    if denominator == 0.0 {
        return None;
    }

    let rate = numerator / denominator;
    (rate.is_finite() && rate > 0.0).then_some((rate * 1000.0).round() / 1000.0)
}

/// Directory where extracted preview frames are cached.
fn frames_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("frames"))
        .map_err(|error| format!("cannot resolve the cache directory: {error}"))
}

/// Extracts a single frame as a JPEG into the app cache and returns its path.
///
/// Used as the preview backend when the webview cannot decode the source
/// codec (WebKitGTK without GStreamer libav, for example).
#[tauri::command]
pub async fn snapshot_video(app: AppHandle, path: String, time: f64) -> Result<String, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(format!("{} is not a file", source.display()));
    }

    let time = time.max(0.0);
    let cache_dir = frames_dir(&app)?;
    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("cannot create the frame cache: {error}"))?;

    // Cache key: source path + modification time + time rounded to 1 ms.
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    std::fs::metadata(&source)
        .and_then(|meta| meta.modified())
        .ok()
        .hash(&mut hasher);
    ((time * 1000.0).round() as i64).hash(&mut hasher);

    let output_path = cache_dir.join(format!("{:016x}.jpg", hasher.finish()));

    if !output_path.exists() {
        let output = ffmpeg(&app)?
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{time:.3}"),
                "-i",
            ])
            .arg(&source)
            .args(["-frames:v", "1", "-q:v", "3", "-y"])
            .arg(&output_path)
            .output()
            .await
            .map_err(|error| format!("failed to run ffmpeg: {error}"))?;

        if !output.status.success() || !output_path.exists() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let _ = std::fs::remove_file(&output_path);

            return Err(if stderr.is_empty() {
                format!("failed to extract a frame at {time:.3}s")
            } else {
                stderr
            });
        }
    }

    app.asset_protocol_scope()
        .allow_file(&output_path)
        .map_err(|error| format!("cannot grant access to the frame: {error}"))?;

    Ok(output_path.display().to_string())
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    duration: Option<String>,
    avg_frame_rate: Option<String>,
    tags: Option<ProbeTags>,
}

#[derive(Debug, Deserialize)]
struct ProbeTags {
    rotate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    format_name: Option<String>,
    size: Option<String>,
}

/// Crop rectangle in normalized coordinates (0..1), as reported by the editor.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCrop {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Parameters of a single export job.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    /// Source file path.
    path: String,
    /// Destination file path chosen by the user.
    output: String,
    /// Crop rectangle; `None` keeps the full frame.
    crop: Option<ExportCrop>,
    /// Range start in seconds.
    start: f64,
    /// Range end in seconds.
    end: f64,
    /// Source frame size in pixels.
    frame_width: u32,
    frame_height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    output_path: String,
}

/// Rounds and clamps a normalized crop rectangle to even pixel values that
/// video encoders accept.
fn crop_pixels(crop: &ExportCrop, frame_width: u32, frame_height: u32) -> (u32, u32, u32, u32) {
    let width = ((crop.width * frame_width as f64).round() as u32).clamp(2, frame_width) & !1;
    let height = ((crop.height * frame_height as f64).round() as u32).clamp(2, frame_height) & !1;
    let x = ((crop.x * frame_width as f64).round() as u32)
        .min(frame_width.saturating_sub(width))
        & !1;
    let y = ((crop.y * frame_height as f64).round() as u32)
        .min(frame_height.saturating_sub(height))
        & !1;
    (width, height, x, y)
}

/// Applies the range and crop selections to the video and writes the result.
///
/// Runs the bundled ffmpeg sidecar: the range is cut with a fast seek, the
/// video stream is re-encoded with libx264 (a crop requires re-encoding) and
/// audio is transcoded to AAC for container compatibility. Progress is emitted
/// as `export-progress` events.
#[tauri::command]
pub async fn export_video(app: AppHandle, options: ExportOptions) -> Result<ExportResult, String> {
    let source = PathBuf::from(&options.path);
    if !source.is_file() {
        return Err(format!(
            "cannot export {}: the file does not exist",
            source.display()
        ));
    }

    let start = options.start.max(0.0);
    let end = options.end.max(start + 0.05);
    let duration = end - start;

    let mut args: Vec<String> = [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        &format!("{start:.3}"),
        "-i",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect();
    args.push(source.to_string_lossy().into_owned());
    args.push("-t".to_string());
    args.push(format!("{duration:.3}"));

    if let Some(crop) = &options.crop {
        let (width, height, x, y) = crop_pixels(crop, options.frame_width, options.frame_height);
        args.push("-vf".to_string());
        args.push(format!("crop={width}:{height}:{x}:{y}"));
    }

    for value in [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
    ] {
        args.push(value.to_string());
    }

    let output_lower = options.output.to_lowercase();
    if ["mp4", "m4v", "mov"].iter().any(|ext| output_lower.ends_with(ext)) {
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
    }

    for value in ["-progress", "pipe:1", "-nostats", "-y"] {
        args.push(value.to_string());
    }
    args.push(options.output.clone());

    let (mut events, _child) = ffmpeg(&app)?
        .args(args)
        .spawn()
        .map_err(|error| format!("failed to run ffmpeg: {error}"))?;

    let mut progress_buffer = String::new();
    let mut last_percent = -1.0_f64;
    let mut succeeded = false;

    while let Some(event) = events.recv().await {
        match event {
            CommandEvent::Stdout(chunk) => {
                progress_buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(index) = progress_buffer.find('\n') {
                    let line = progress_buffer[..index].trim().to_string();
                    progress_buffer.drain(..index + 1);

                    if let Some(value) = line.strip_prefix("out_time_ms=") {
                        if let Ok(micros) = value.trim().parse::<f64>() {
                            let percent =
                                ((micros / 1_000_000.0) / duration * 100.0).clamp(0.0, 100.0);
                            if (percent - last_percent).abs() >= 1.0 {
                                last_percent = percent;
                                let _ = app.emit(
                                    "export-progress",
                                    serde_json::json!({ "percent": percent }),
                                );
                            }
                        }
                    } else if line == "progress=end" {
                        let _ =
                            app.emit("export-progress", serde_json::json!({ "percent": 100.0 }));
                    }
                }
            }
            CommandEvent::Terminated(payload) => {
                succeeded = payload.code == Some(0);
            }
            CommandEvent::Error(message) => {
                return Err(message);
            }
            _ => {}
        }
    }

    if !succeeded {
        return Err("ffmpeg failed to export the video".to_string());
    }

    if !Path::new(&options.output).is_file() {
        return Err("ffmpeg did not produce the output file".to_string());
    }

    let _ = app.emit("export-progress", serde_json::json!({ "percent": 100.0 }));
    Ok(ExportResult {
        output_path: options.output,
    })
}
