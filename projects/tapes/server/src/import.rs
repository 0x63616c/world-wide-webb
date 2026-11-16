//! Turns a source video into a library item: one MP4 the Apple TV 4K (2nd gen) plays
//! directly, artwork, and an `info.json` written last.
//!
//! Rules: H.264 and HEVC video are copied; anything else (AV1, VP9, MPEG-2…) is
//! re-encoded once to 10-bit HEVC with the Mac's hardware encoder. AAC, AC-3 and E-AC-3
//! audio are copied; other audio becomes E-AC-3 (surround) or AAC (stereo). Text
//! subtitles become MP4 text tracks; image subtitles are skipped with a warning.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use crate::library::{self, ART, ART_SMALL, INFO, Info, VIDEO};

#[derive(Debug, Deserialize, Default)]
pub struct Probe {
    #[serde(default)]
    pub streams: Vec<Stream>,
    #[serde(default)]
    pub format: Format,
}

#[derive(Debug, Deserialize, Default)]
pub struct Format {
    pub duration: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct Stream {
    pub index: usize,
    pub codec_type: String,
    #[serde(default)]
    pub codec_name: String,
    pub profile: Option<String>,
    pub height: Option<u32>,
    pub channels: Option<u32>,
    pub color_transfer: Option<String>,
    #[serde(default)]
    pub side_data_list: Vec<serde_json::Value>,
    #[serde(default)]
    pub tags: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub disposition: std::collections::HashMap<String, i64>,
}

impl Probe {
    pub fn seconds(&self) -> Option<f64> {
        self.format.duration.as_deref().and_then(|d| d.parse().ok())
    }
    fn video(&self) -> Option<&Stream> {
        self.streams.iter().find(|s| s.codec_type == "video" && s.disposition.get("attached_pic") != Some(&1))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Video {
    Copy { codec: String },
    Encode { from: String, height: u32, bitrate: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Audio {
    pub index: usize,
    pub codec: String,
    /// `copy`, `eac3` or `aac`.
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Plan {
    pub video_index: usize,
    pub video: Video,
    pub audio: Vec<Audio>,
    /// Embedded text subtitle stream indexes kept.
    pub subtitles: Vec<usize>,
    /// Text subtitle files found beside the source.
    pub sidecar_subtitles: Vec<PathBuf>,
    /// Image found beside the source, used as artwork.
    pub sidecar_art: Option<PathBuf>,
    pub badges: Vec<String>,
    pub warnings: Vec<String>,
}

const COPY_VIDEO: [&str; 2] = ["h264", "hevc"];
const COPY_AUDIO: [&str; 3] = ["aac", "ac3", "eac3"];
const TEXT_SUBS: [&str; 6] = ["subrip", "ass", "ssa", "mov_text", "webvtt", "text"];

/// Decides what to do with each stream. Pure, so the rules are testable without ffmpeg.
pub fn plan(probe: &Probe, max_height: Option<u32>) -> Result<Plan> {
    let Some(video) = probe.video() else { bail!("no video stream in source") };
    let height = video.height.unwrap_or(0);
    let mut warnings = Vec::new();
    let mut badges = Vec::new();

    let dovi = video.side_data_list.iter().find(|s| {
        s.get("side_data_type").and_then(|t| t.as_str()).is_some_and(|t| t.contains("DOVI"))
    });
    let too_tall = max_height.is_some_and(|m| height > m);
    let out_height = if too_tall { max_height.unwrap() } else { height };
    let video_plan = if COPY_VIDEO.contains(&video.codec_name.as_str()) && !too_tall {
        if let Some(profile) = dovi.and_then(|d| d.get("dv_profile")).and_then(|p| p.as_u64()) {
            if profile == 7 {
                warnings.push("Dolby Vision profile 7 is not playable as-is; the HDR10 base layer will show".into());
            } else {
                badges.push("Dolby Vision".into());
            }
        }
        Video::Copy { codec: video.codec_name.clone() }
    } else {
        let bitrate = match out_height {
            h if h > 1440 => "25M",
            h if h > 800 => "8M",
            _ => "5M",
        };
        if dovi.is_some() {
            warnings.push("Dolby Vision metadata is dropped when re-encoding".into());
        }
        Video::Encode { from: video.codec_name.clone(), height: out_height, bitrate: bitrate.into() }
    };
    if out_height >= 2000 {
        badges.insert(0, "4K".into());
    }
    if matches!(video.color_transfer.as_deref(), Some("smpte2084" | "arib-std-b67")) && !badges.iter().any(|b| b == "Dolby Vision") {
        badges.push("HDR".into());
    }

    let mut audio = Vec::new();
    for s in probe.streams.iter().filter(|s| s.codec_type == "audio") {
        let to = if COPY_AUDIO.contains(&s.codec_name.as_str()) {
            "copy"
        } else if s.channels.unwrap_or(2) > 2 {
            "eac3"
        } else {
            "aac"
        };
        if matches!(s.codec_name.as_str(), "dts" | "truehd") {
            warnings.push(format!("audio stream {} ({}) converted to E-AC-3; any Atmos layer is lost", s.index, s.codec_name));
        }
        if s.profile.as_deref().is_some_and(|p| p.contains("Atmos")) && to == "copy" && !badges.iter().any(|b| b == "Atmos") {
            badges.push("Atmos".into());
        }
        audio.push(Audio { index: s.index, codec: s.codec_name.clone(), to: to.into() });
    }
    if audio.is_empty() {
        warnings.push("source has no audio".into());
    }

    let mut subtitles = Vec::new();
    for s in probe.streams.iter().filter(|s| s.codec_type == "subtitle") {
        if TEXT_SUBS.contains(&s.codec_name.as_str()) {
            subtitles.push(s.index);
        } else {
            let lang = s.tags.get("language").map(String::as_str).unwrap_or("unknown language");
            warnings.push(format!("subtitle stream {} ({}, {lang}) is image-based and was skipped", s.index, s.codec_name));
        }
    }

    Ok(Plan {
        video_index: video.index,
        video: video_plan,
        audio,
        subtitles,
        sidecar_subtitles: Vec::new(),
        sidecar_art: None,
        badges,
        warnings,
    })
}

/// Finds subtitle and image files beside the source with the same name
/// (`film.srt`, `film.en.srt`, `film.jpg`).
pub fn sidecars(source: &Path) -> (Vec<PathBuf>, Option<PathBuf>) {
    let (Some(dir), Some(stem)) = (source.parent(), source.file_stem().and_then(|s| s.to_str())) else {
        return (Vec::new(), None);
    };
    let mut subs = Vec::new();
    let mut art = None;
    let Ok(read) = std::fs::read_dir(if dir.as_os_str().is_empty() { Path::new(".") } else { dir }) else {
        return (subs, art);
    };
    let mut names: Vec<_> = read.flatten().map(|e| e.path()).collect();
    names.sort();
    for path in names {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        let Some(rest) = name.strip_prefix(stem) else { continue };
        let ext = rest.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        let middle = rest.strip_suffix(&format!(".{}", rest.rsplit('.').next().unwrap_or(""))).unwrap_or("");
        if !(middle.is_empty() || (middle.starts_with('.') && !middle[1..].contains('.'))) {
            continue;
        }
        match ext.as_str() {
            "srt" | "vtt" | "ass" => subs.push(path),
            "jpg" | "jpeg" | "png" | "webp" if middle.is_empty() && art.is_none() => art = Some(path),
            _ => {}
        }
    }
    (subs, art)
}

fn language_of(sub: &Path) -> Option<String> {
    let stem = sub.file_stem()?.to_str()?;
    let lang = stem.rsplit_once('.')?.1;
    (lang.len() <= 3 && lang.chars().all(|c| c.is_ascii_alphabetic())).then(|| lang.to_ascii_lowercase())
}

/// The ffmpeg arguments for a plan. Pure, for tests and `--dry-run`.
pub fn ffmpeg_args(source: &Path, plan: &Plan, output: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "warning".into(), "-stats".into(), "-nostdin".into(), "-y".into(), "-i".into(), source.display().to_string()];
    for sub in &plan.sidecar_subtitles {
        a.extend(["-i".into(), sub.display().to_string()]);
    }
    a.extend(["-map".into(), format!("0:{}", plan.video_index)]);
    for audio in &plan.audio {
        a.extend(["-map".into(), format!("0:{}", audio.index)]);
    }
    for index in &plan.subtitles {
        a.extend(["-map".into(), format!("0:{index}")]);
    }
    for (n, _) in plan.sidecar_subtitles.iter().enumerate() {
        a.extend(["-map".into(), format!("{}:0", n + 1)]);
    }
    a.extend(["-map_metadata".into(), "0".into(), "-map_chapters".into(), "0".into()]);
    match &plan.video {
        Video::Copy { codec } => {
            a.extend(["-c:v".into(), "copy".into()]);
            if codec == "hevc" {
                a.extend(["-tag:v".into(), "hvc1".into()]);
            }
        }
        Video::Encode { height, bitrate, .. } => {
            a.extend([
                "-vf".into(),
                format!("scale=-2:{height}:flags=lanczos,format=p010le"),
                "-c:v".into(),
                "hevc_videotoolbox".into(),
                "-profile:v".into(),
                "main10".into(),
                "-b:v".into(),
                bitrate.clone(),
                "-tag:v".into(),
                "hvc1".into(),
            ]);
        }
    }
    for (n, audio) in plan.audio.iter().enumerate() {
        match audio.to.as_str() {
            "copy" => a.extend([format!("-c:a:{n}"), "copy".into()]),
            "eac3" => a.extend([format!("-c:a:{n}"), "eac3".into(), format!("-b:a:{n}"), "640k".into()]),
            _ => a.extend([format!("-c:a:{n}"), "aac".into(), format!("-b:a:{n}"), "256k".into()]),
        }
    }
    if !plan.subtitles.is_empty() || !plan.sidecar_subtitles.is_empty() {
        a.extend(["-c:s".into(), "mov_text".into()]);
        for (n, sub) in plan.sidecar_subtitles.iter().enumerate() {
            if let Some(lang) = language_of(sub) {
                a.extend([format!("-metadata:s:s:{}", plan.subtitles.len() + n), format!("language={lang}")]);
            }
        }
    }
    a.extend([
        "-strict".into(),
        "unofficial".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-f".into(),
        "mp4".into(),
        output.display().to_string(),
    ]);
    a
}

pub fn probe(source: &Path) -> Result<Probe> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_streams", "-show_format"])
        .arg(source)
        .output()
        .context("running ffprobe (install ffmpeg)")?;
    if !out.status.success() {
        bail!("ffprobe failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}

fn run(program: &str, args: &[String]) -> Result<()> {
    let status = Command::new(program).args(args).status().with_context(|| format!("running {program}"))?;
    if !status.success() {
        bail!("{program} failed ({status})");
    }
    Ok(())
}

/// Where the new item goes and what it will contain.
#[derive(Debug, Serialize)]
pub struct Outcome {
    pub id: String,
    pub dir: PathBuf,
    pub plan: Plan,
    pub ffmpeg: Vec<String>,
    pub dry_run: bool,
}

/// Plans an import of `source` into `dir` described by `info`, and unless `dry_run`,
/// writes the video and artwork under temporary names, renames them, then writes
/// `info.json` so the item appears only once it is complete.
pub fn import(source: &Path, dir: &Path, mut info: Info, max_height: Option<u32>, dry_run: bool) -> Result<Outcome> {
    if !source.is_file() {
        bail!("{} is not a file", source.display());
    }
    if dir.join(INFO).exists() {
        bail!("{} already holds an item", dir.display());
    }
    let probed = probe(source)?;
    let mut plan = plan(&probed, max_height)?;
    (plan.sidecar_subtitles, plan.sidecar_art) = sidecars(source);
    info.seconds = probed.seconds();
    info.badges = plan.badges.clone();
    let partial = dir.join(".video.mp4.partial");
    let args = ffmpeg_args(source, &plan, &partial);
    let outcome = Outcome { id: info.id.clone(), dir: dir.to_path_buf(), plan, ffmpeg: args.clone(), dry_run };
    if dry_run {
        return Ok(outcome);
    }
    std::fs::create_dir_all(dir)?;
    run("ffmpeg", &args)?;
    std::fs::rename(&partial, dir.join(VIDEO))?;
    make_art(&outcome.plan.sidecar_art, source, info.seconds, dir)?;
    library::write_info(dir, &info)?;
    Ok(outcome)
}

/// Writes `art.jpg` and `art-small.jpg`, from a sidecar image if given, else a frame
/// a tenth of the way in.
pub fn make_art(image: &Option<PathBuf>, video: &Path, seconds: Option<f64>, dir: &Path) -> Result<()> {
    let input: Vec<String> = match image {
        Some(path) => vec!["-i".into(), path.display().to_string()],
        None => vec![
            "-ss".into(),
            format!("{:.1}", seconds.unwrap_or(0.0) * 0.1),
            "-i".into(),
            video.display().to_string(),
        ],
    };
    for (name, width) in [(ART, 1920), (ART_SMALL, 480)] {
        let tmp = dir.join(format!(".{name}.partial"));
        let mut args: Vec<String> = vec!["-hide_banner".into(), "-loglevel".into(), "error".into(), "-nostdin".into(), "-y".into()];
        args.extend(input.clone());
        args.extend([
            "-frames:v".into(),
            "1".into(),
            "-vf".into(),
            format!("scale='min({width},iw)':-2"),
            "-q:v".into(),
            "3".into(),
            "-f".into(),
            "image2".into(),
            "-c:v".into(),
            "mjpeg".into(),
            tmp.display().to_string(),
        ]);
        run("ffmpeg", &args)?;
        std::fs::rename(&tmp, dir.join(name))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(index: usize, kind: &str, codec: &str) -> Stream {
        Stream { index, codec_type: kind.into(), codec_name: codec.into(), ..Default::default() }
    }

    fn probe_of(streams: Vec<Stream>) -> Probe {
        Probe { streams, format: Format { duration: Some("3600.5".into()) } }
    }

    #[test]
    fn youtube_av1_4k_is_encoded_to_hevc() {
        let mut v = stream(0, "video", "av1");
        v.height = Some(2160);
        let mut a = stream(1, "audio", "opus");
        a.channels = Some(2);
        let p = plan(&probe_of(vec![v, a]), None).unwrap();
        assert_eq!(p.video, Video::Encode { from: "av1".into(), height: 2160, bitrate: "25M".into() });
        assert_eq!(p.audio[0].to, "aac");
        assert_eq!(p.badges, ["4K"]);
    }

    #[test]
    fn max_height_forces_a_1080p_encode_even_for_hevc() {
        let mut v = stream(0, "video", "hevc");
        v.height = Some(2160);
        let p = plan(&probe_of(vec![v, stream(1, "audio", "aac")]), Some(1080)).unwrap();
        assert_eq!(p.video, Video::Encode { from: "hevc".into(), height: 1080, bitrate: "8M".into() });
        assert!(p.badges.is_empty());
    }

    #[test]
    fn bluray_rip_keeps_hevc_and_converts_lossless_audio() {
        let mut v = stream(0, "video", "hevc");
        v.height = Some(2160);
        v.color_transfer = Some("smpte2084".into());
        let mut truehd = stream(1, "audio", "truehd");
        truehd.channels = Some(8);
        let mut eac3 = stream(2, "audio", "eac3");
        eac3.profile = Some("Dolby Digital Plus + Dolby Atmos".into());
        let mut pgs = stream(3, "subtitle", "hdmv_pgs_subtitle");
        pgs.tags.insert("language".into(), "eng".into());
        let srt = stream(4, "subtitle", "subrip");
        let p = plan(&probe_of(vec![v, truehd, eac3, pgs, srt]), None).unwrap();
        assert_eq!(p.video, Video::Copy { codec: "hevc".into() });
        assert_eq!(p.audio.iter().map(|a| a.to.as_str()).collect::<Vec<_>>(), ["eac3", "copy"]);
        assert_eq!(p.subtitles, [4]);
        assert_eq!(p.badges, ["4K", "HDR", "Atmos"]);
        assert_eq!(p.warnings.len(), 2, "{:?}", p.warnings);

        let args = ffmpeg_args(Path::new("in.mkv"), &p, Path::new("out.partial")).join(" ");
        assert!(args.contains("-map 0:0 -map 0:1 -map 0:2 -map 0:4"), "{args}");
        assert!(args.contains("-c:v copy -tag:v hvc1"), "{args}");
        assert!(args.contains("-c:a:0 eac3 -b:a:0 640k -c:a:1 copy"), "{args}");
        assert!(args.contains("-c:s mov_text"), "{args}");
        assert!(args.ends_with("-f mp4 out.partial"), "{args}");
    }

    #[test]
    fn dolby_vision_profiles() {
        let mut v = stream(0, "video", "hevc");
        v.side_data_list = vec![serde_json::json!({"side_data_type": "DOVI configuration record", "dv_profile": 8})];
        assert_eq!(plan(&probe_of(vec![v.clone()]), None).unwrap().badges, ["Dolby Vision"]);
        v.side_data_list = vec![serde_json::json!({"side_data_type": "DOVI configuration record", "dv_profile": 7})];
        assert!(plan(&probe_of(vec![v]), None).unwrap().warnings[0].contains("profile 7"));
    }

    #[test]
    fn cover_art_stream_is_not_the_video() {
        let mut cover = stream(0, "video", "mjpeg");
        cover.disposition.insert("attached_pic".into(), 1);
        let p = plan(&probe_of(vec![cover, stream(1, "video", "h264")]), None).unwrap();
        assert_eq!(p.video_index, 1);
        assert!(plan(&probe_of(vec![stream(0, "audio", "aac")]), None).is_err());
    }

    #[test]
    fn finds_sidecars_with_the_same_name() {
        let tmp = tempfile::tempdir().unwrap();
        for name in ["Film.mkv", "Film.srt", "Film.fr.srt", "Film.jpg", "Film 2.srt", "Film.extra.cut.srt", "Other.jpg"] {
            std::fs::write(tmp.path().join(name), b"").unwrap();
        }
        let (subs, art) = sidecars(&tmp.path().join("Film.mkv"));
        let names: Vec<_> = subs.iter().map(|p| p.file_name().unwrap().to_str().unwrap()).collect();
        assert_eq!(names, ["Film.fr.srt", "Film.srt"]);
        assert_eq!(art.unwrap().file_name().unwrap(), "Film.jpg");
        assert_eq!(language_of(Path::new("Film.fr.srt")).as_deref(), Some("fr"));
        assert_eq!(language_of(Path::new("Film.srt")), None);
    }
}
