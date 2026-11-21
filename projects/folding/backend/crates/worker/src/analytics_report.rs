//! Admin usage analytics report. Figures are computed from fetched D1 rows and rendered as
//! server-side HTML with inline SVG because the admin CSP allows no scripts.
//!
//! A "fold" is one `fold_open` event (a session start). Unfolded time pairs each open with the
//! install's next fold event when that is a close, capped at 12 hours. Fold events listed by an
//! `entry_deleted` event, or earlier than the install's latest `reset`, are excluded.
use crate::analytics::{Malformed, local_time};
use chrono::{Duration, NaiveDate};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fmt::Write;

pub const MAX_SESSION_MS: i64 = 12 * 3_600_000;
pub const CHANNELS: &[&str] = &["app_store", "testflight", "debug", "all"];
const DEFAULT_DAYS: i64 = 28;
const MAX_DAYS: i64 = 366;
const SETUP_STEPS: &[&str] = &["started", "open_verified", "close_verified", "finished"];
const FEATURE_KINDS: &[&str] = &[
    "app_opened",
    "tab_viewed",
    "competition_sign_in",
    "leaderboard_viewed",
    "badges_viewed",
    "export",
    "daily_limit_set",
    "daily_limit_exceeded",
    "notification_opened",
];

#[derive(Clone, Debug, Deserialize)]
pub struct InstallRow {
    pub analytics_id: String,
    pub app_version: String,
    pub build: i64,
    pub channel: String,
    pub os_version: String,
    pub device_model: String,
    pub region: Option<String>,
    pub locale: String,
    pub competition: i64,
    pub first_seen_ms: i64,
    pub last_received_ms: i64,
}
#[derive(Clone, Debug, Deserialize)]
pub struct EventRow {
    pub analytics_id: String,
    pub event_id: String,
    pub kind: String,
    pub at_ms: i64,
    pub timezone_id: String,
    pub local_day: String,
    pub local_hour: i64,
    pub local_weekday: i64,
    pub backfill: i64,
    pub detail: Option<String>,
}

/// Fold events removed by the client, and each install's latest reset time.
#[derive(Default)]
pub struct Exclusions {
    pub removed: HashSet<(String, String)>,
    pub latest_reset: HashMap<String, i64>,
}
impl Exclusions {
    fn keeps(&self, event: &EventRow) -> bool {
        !is_fold(event)
            || (!self
                .removed
                .contains(&(event.analytics_id.clone(), event.event_id.clone()))
                && self
                    .latest_reset
                    .get(&event.analytics_id)
                    .is_none_or(|reset| event.at_ms >= *reset))
    }
}
fn is_fold(event: &EventRow) -> bool {
    event.kind == "fold_open" || event.kind == "fold_close"
}

#[derive(Debug, PartialEq, Eq)]
pub struct Filter {
    pub from: NaiveDate,
    pub to: NaiveDate,
    pub channel: String,
}
impl Filter {
    pub fn parse(pairs: &[(String, String)], today: NaiveDate) -> Result<Self, Malformed> {
        let mut filter = Filter {
            from: today - Duration::days(DEFAULT_DAYS - 1),
            to: today,
            channel: "app_store".into(),
        };
        for (key, value) in pairs {
            let date = || NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| Malformed);
            match key.as_str() {
                "from" if !value.is_empty() => filter.from = date()?,
                "to" if !value.is_empty() => filter.to = date()?,
                "from" | "to" => {}
                "channel" if CHANNELS.contains(&value.as_str()) => filter.channel = value.clone(),
                _ => return Err(Malformed),
            }
        }
        if filter.from > filter.to || (filter.to - filter.from).num_days() >= MAX_DAYS {
            return Err(Malformed);
        }
        Ok(filter)
    }
    pub fn days(&self) -> Vec<String> {
        self.from
            .iter_days()
            .take_while(|day| *day <= self.to)
            .map(|day| day.format("%Y-%m-%d").to_string())
            .collect()
    }
    fn includes(&self, day: &str) -> bool {
        NaiveDate::parse_from_str(day, "%Y-%m-%d").is_ok_and(|d| d >= self.from && d <= self.to)
    }
    fn channel_matches(&self, channel: &str) -> bool {
        self.channel == "all" || self.channel == channel
    }
}

pub struct Session<'a> {
    pub open: &'a EventRow,
    pub duration_ms: i64,
}
/// Pairs each open with the install's next fold event when that is a close.
pub fn sessions<'a>(events: impl Iterator<Item = &'a EventRow>) -> Vec<Session<'a>> {
    let mut by_install: BTreeMap<&str, Vec<&EventRow>> = BTreeMap::new();
    for event in events.filter(|e| is_fold(e)) {
        by_install
            .entry(event.analytics_id.as_str())
            .or_default()
            .push(event);
    }
    let mut out = vec![];
    for folds in by_install.values_mut() {
        folds.sort_by(|a, b| {
            (a.at_ms, a.kind != "fold_open", &a.event_id).cmp(&(
                b.at_ms,
                b.kind != "fold_open",
                &b.event_id,
            ))
        });
        for pair in folds.windows(2) {
            if pair[0].kind == "fold_open" && pair[1].kind == "fold_close" {
                out.push(Session {
                    open: pair[0],
                    duration_ms: (pair[1].at_ms - pair[0].at_ms).clamp(0, MAX_SESSION_MS),
                });
            }
        }
    }
    out
}

pub struct Daily {
    pub day: String,
    pub people_folding: usize,
    pub folds: usize,
    pub unfolded_ms: i64,
    pub new_installs: usize,
}
pub struct Count {
    pub label: String,
    pub events: usize,
    pub installs: usize,
}
pub struct Report {
    pub latest_received_ms: Option<i64>,
    pub newest_event_ms: Option<i64>,
    pub active_installs: usize,
    pub folds: usize,
    pub folding_person_days: usize,
    pub unfolded_ms: i64,
    pub new_installs: usize,
    pub daily: Vec<Daily>,
    /// `[weekday][hour]` fold counts, Monday first.
    pub heatmap: [[usize; 24]; 7],
    /// Reason → counts aligned with `daily`.
    pub interruptions: Vec<(String, Vec<usize>)>,
    pub setup: Vec<(&'static str, usize)>,
    pub features: Vec<Count>,
    pub errors: Vec<Count>,
    pub by_version: Vec<(String, usize)>,
    pub by_region: Vec<(String, usize)>,
    pub by_competition: Vec<(String, usize)>,
    pub recent_installs: Vec<InstallRow>,
}

fn utc_day(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|t| t.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}
fn counts(groups: BTreeMap<String, (usize, BTreeSet<&str>)>) -> Vec<Count> {
    let mut out: Vec<_> = groups
        .into_iter()
        .map(|(label, (events, installs))| Count {
            label,
            events,
            installs: installs.len(),
        })
        .collect();
    out.sort_by(|a, b| b.events.cmp(&a.events).then(a.label.cmp(&b.label)));
    out
}
fn ranked(groups: BTreeMap<String, usize>) -> Vec<(String, usize)> {
    let mut out: Vec<_> = groups.into_iter().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    out
}

pub fn compute(
    filter: &Filter,
    installs: &[InstallRow],
    events: &[EventRow],
    exclusions: &Exclusions,
    newest_event_ms: Option<i64>,
) -> Report {
    let selected: HashMap<&str, &InstallRow> = installs
        .iter()
        .filter(|i| filter.channel_matches(&i.channel))
        .map(|i| (i.analytics_id.as_str(), i))
        .collect();
    let kept: Vec<&EventRow> = events
        .iter()
        .filter(|e| selected.contains_key(e.analytics_id.as_str()) && exclusions.keeps(e))
        .collect();
    let in_range: Vec<&EventRow> = kept
        .iter()
        .copied()
        .filter(|e| filter.includes(&e.local_day))
        .collect();
    let days = filter.days();
    let index: HashMap<&str, usize> = days
        .iter()
        .enumerate()
        .map(|(i, d)| (d.as_str(), i))
        .collect();
    let mut daily: Vec<Daily> = days
        .iter()
        .map(|day| Daily {
            day: day.clone(),
            people_folding: 0,
            folds: 0,
            unfolded_ms: 0,
            new_installs: 0,
        })
        .collect();
    let mut folders: Vec<BTreeSet<&str>> = vec![BTreeSet::new(); days.len()];
    let mut heatmap = [[0; 24]; 7];
    let mut active = BTreeSet::new();
    let mut interruptions: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut setup: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    let mut features: BTreeMap<String, (usize, BTreeSet<&str>)> = BTreeMap::new();
    let mut errors: BTreeMap<String, (usize, BTreeSet<&str>)> = BTreeMap::new();
    for event in &in_range {
        let id = event.analytics_id.as_str();
        let day = index[event.local_day.as_str()];
        active.insert(id);
        let detail = event.detail.clone().unwrap_or_else(|| "unknown".into());
        match event.kind.as_str() {
            "fold_open" => {
                daily[day].folds += 1;
                folders[day].insert(id);
                if let (Ok(w), Ok(h)) = (
                    usize::try_from(event.local_weekday),
                    usize::try_from(event.local_hour),
                ) && w < 7
                    && h < 24
                {
                    heatmap[w][h] += 1;
                }
            }
            "interruption" => {
                interruptions
                    .entry(detail)
                    .or_insert_with(|| vec![0; days.len()])[day] += 1
            }
            "setup" => {
                if let Some(step) = SETUP_STEPS
                    .iter()
                    .find(|s| Some(**s) == event.detail.as_deref())
                {
                    setup.entry(step).or_default().insert(id);
                }
            }
            "error" => {
                let entry = errors.entry(detail).or_default();
                entry.0 += 1;
                entry.1.insert(id);
            }
            kind if FEATURE_KINDS.contains(&kind) => {
                let label = match (kind, &event.detail) {
                    ("tab_viewed" | "notification_opened" | "competition_sign_in", Some(d)) => {
                        format!("{kind} · {d}")
                    }
                    _ => kind.to_owned(),
                };
                let entry = features.entry(label).or_default();
                entry.0 += 1;
                entry.1.insert(id);
            }
            _ => {}
        }
    }
    let mut unfolded_ms = 0;
    for session in sessions(kept.iter().copied()) {
        if let Some(&day) = index.get(session.open.local_day.as_str()) {
            daily[day].unfolded_ms += session.duration_ms;
            unfolded_ms += session.duration_ms;
        }
    }
    let mut new_installs = 0;
    for install in selected.values() {
        if let Some(&day) = index.get(utc_day(install.first_seen_ms).as_str()) {
            daily[day].new_installs += 1;
            new_installs += 1;
        }
    }
    for (day, people) in daily.iter_mut().zip(&folders) {
        day.people_folding = people.len();
    }
    let mut by_version = BTreeMap::new();
    let mut by_region = BTreeMap::new();
    let mut by_competition = BTreeMap::new();
    for install in active.iter().filter_map(|id| selected.get(id)) {
        *by_version.entry(install.app_version.clone()).or_default() += 1;
        *by_region
            .entry(install.region.clone().unwrap_or_else(|| "unknown".into()))
            .or_default() += 1;
        *by_competition
            .entry(
                if install.competition != 0 {
                    "joined"
                } else {
                    "not joined"
                }
                .into(),
            )
            .or_default() += 1;
    }
    let mut recent_installs: Vec<InstallRow> = selected.values().map(|i| (*i).clone()).collect();
    recent_installs.sort_by(|a, b| {
        b.last_received_ms
            .cmp(&a.last_received_ms)
            .then(a.analytics_id.cmp(&b.analytics_id))
    });
    recent_installs.truncate(50);
    Report {
        latest_received_ms: installs.iter().map(|i| i.last_received_ms).max(),
        newest_event_ms,
        active_installs: active.len(),
        folds: daily.iter().map(|d| d.folds).sum(),
        folding_person_days: daily.iter().map(|d| d.people_folding).sum(),
        unfolded_ms,
        new_installs,
        daily,
        heatmap,
        interruptions: interruptions.into_iter().collect(),
        setup: SETUP_STEPS
            .iter()
            .map(|s| (*s, setup.get(s).map_or(0, BTreeSet::len)))
            .collect(),
        features: counts(features),
        errors: counts(errors),
        by_version: ranked(by_version),
        by_region: ranked(by_region),
        by_competition: ranked(by_competition),
        recent_installs,
    }
}

// ---- Rendering -------------------------------------------------------------------------

pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}
fn time(ms: Option<i64>) -> String {
    ms.and_then(chrono::DateTime::from_timestamp_millis)
        .map(|t| t.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_else(|| "never".into())
}
fn duration(ms: f64) -> String {
    let minutes = (ms / 60_000.0).round() as i64;
    if minutes >= 60 {
        format!("{}h {:02}m", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}m")
    }
}
fn number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.1}")
    }
}
fn ratio(a: f64, b: usize) -> f64 {
    if b == 0 { 0.0 } else { a / b as f64 }
}

/// A daily bar chart with native hover titles.
fn bars(values: &[(String, f64)], format: fn(f64) -> String, color: &str) -> String {
    let (width, height) = (720.0, 140.0);
    let max = values.iter().map(|v| v.1).fold(0.0, f64::max).max(1e-9);
    let step = width / values.len().max(1) as f64;
    let mut svg = format!(
        r#"<svg viewBox="0 0 {width} {}" width="100%" style="max-width:{width}px;display:block" role="img">"#,
        height + 34.0
    );
    let _ = write!(
        svg,
        r##"<line x1="0" y1="{height}" x2="{width}" y2="{height}" stroke="#444"/><text x="2" y="12" fill="#aaa" font-size="11">max {}</text>"##,
        format(if max < 1e-6 { 0.0 } else { max })
    );
    for (i, (label, value)) in values.iter().enumerate() {
        let h = value / max * (height - 18.0);
        let _ = write!(
            svg,
            r#"<rect x="{:.1}" y="{:.1}" width="{:.1}" height="{h:.1}" fill="{color}"><title>{}: {}</title></rect>"#,
            i as f64 * step + 1.0,
            height - h,
            (step - 2.0).max(1.0),
            escape(label),
            format(*value)
        );
    }
    if let (Some(first), Some(last)) = (values.first(), values.last()) {
        let _ = write!(
            svg,
            r##"<text x="0" y="{}" fill="#aaa" font-size="11">{}</text><text x="{width}" y="{}" fill="#aaa" font-size="11" text-anchor="end">{}</text>"##,
            height + 16.0,
            escape(&first.0),
            height + 16.0,
            escape(&last.0)
        );
    }
    svg.push_str("</svg>");
    svg
}
fn heatmap(cells: &[[usize; 24]; 7]) -> String {
    let max = cells.iter().flatten().copied().max().unwrap_or(0).max(1) as f64;
    let mut svg = String::from(
        r#"<svg viewBox="0 0 760 190" width="100%" style="max-width:760px;display:block" role="img">"#,
    );
    for (w, name) in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        .iter()
        .enumerate()
    {
        let _ = write!(
            svg,
            r##"<text x="0" y="{}" fill="#aaa" font-size="11">{name}</text>"##,
            w * 24 + 16
        );
        for (h, count) in cells[w].iter().enumerate() {
            let _ = write!(
                svg,
                r##"<rect x="{}" y="{}" width="28" height="22" fill="#4f9cff" fill-opacity="{:.2}" stroke="#1a1a1a"><title>{name} {h:02}:00 · {count} folds</title></rect>"##,
                36 + h * 30,
                w * 24,
                0.05 + 0.95 * *count as f64 / max
            );
        }
    }
    for h in (0..24).step_by(3) {
        let _ = write!(
            svg,
            r##"<text x="{}" y="184" fill="#aaa" font-size="11">{h:02}</text>"##,
            40 + h * 30
        );
    }
    svg.push_str("</svg>");
    svg
}
fn table(headers: &[&str], rows: impl Iterator<Item = Vec<String>>) -> String {
    let mut html = String::from("<table><thead><tr>");
    for h in headers {
        let _ = write!(html, "<th>{}</th>", escape(h));
    }
    html.push_str("</tr></thead><tbody>");
    let mut any = false;
    for row in rows {
        any = true;
        html.push_str("<tr>");
        for cell in row {
            let _ = write!(html, "<td>{cell}</td>");
        }
        html.push_str("</tr>");
    }
    if !any {
        let _ = write!(
            html,
            r#"<tr><td colspan="{}"><small>No data</small></td></tr>"#,
            headers.len()
        );
    }
    html.push_str("</tbody></table>");
    html
}
fn counts_table(first: &str, rows: &[Count]) -> String {
    table(
        &[first, "Events", "Installs"],
        rows.iter().map(|c| {
            vec![
                escape(&c.label),
                c.events.to_string(),
                c.installs.to_string(),
            ]
        }),
    )
}
fn breakdown(first: &str, rows: &[(String, usize)]) -> String {
    table(
        &[first, "Active installs"],
        rows.iter().map(|(k, v)| vec![escape(k), v.to_string()]),
    )
}

const STYLE: &str = "<style>.kpis{display:flex;flex-wrap:wrap;gap:.8rem;margin:1rem 0}.kpi{background:#0b0b0b;border:1px solid #303030;border-radius:.5rem;padding:.7rem 1rem;min-width:9rem}.kpi b{display:block;font-size:1.5rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem}h2{font-size:1.2rem;margin:2rem 0 .6rem}</style>";

pub fn render(filter: &Filter, report: &Report) -> String {
    let mut html = String::from(STYLE);
    html.push_str("<h1>Usage analytics</h1>");
    let _ = write!(
        html,
        "<p>Data received through {} · newest event {}. Anonymous installs, not people.</p>",
        time(report.latest_received_ms),
        time(report.newest_event_ms)
    );
    let _ = write!(
        html,
        r#"<form method="get" action="/admin/analytics"><label style="display:inline">From <input type="date" name="from" value="{}"></label> <label style="display:inline">To <input type="date" name="to" value="{}"></label> <select name="channel" aria-label="Channel">"#,
        filter.from, filter.to
    );
    for channel in CHANNELS {
        let _ = write!(
            html,
            r#"<option value="{channel}"{}>{}</option>"#,
            if *channel == filter.channel {
                " selected"
            } else {
                ""
            },
            channel.replace('_', " ")
        );
    }
    html.push_str("</select> <button>Apply</button></form>");
    let kpis = [
        ("Active installs", report.active_installs.to_string()),
        ("Folds", report.folds.to_string()),
        (
            "Folds per folder-day",
            number(ratio(report.folds as f64, report.folding_person_days)),
        ),
        (
            "Unfolded per folder-day",
            duration(ratio(report.unfolded_ms as f64, report.folding_person_days)),
        ),
        ("New installs", report.new_installs.to_string()),
    ];
    html.push_str(r#"<div class="kpis">"#);
    for (label, value) in kpis {
        let _ = write!(
            html,
            r#"<div class="kpi"><small>{label}</small><b>{value}</b></div>"#
        );
    }
    html.push_str("</div><p><small>A fold is one unfold (fold_open). Folder-day = an install with at least one fold that local day. Unfolded time pairs an open with the next close, capped at 12 hours.</small></p>");
    let series = |f: &dyn Fn(&Daily) -> f64| -> Vec<(String, f64)> {
        report.daily.iter().map(|d| (d.day.clone(), f(d))).collect()
    };
    type Chart<'a> = (&'a str, Vec<(String, f64)>, fn(f64) -> String, &'a str);
    let charts: [Chart; 4] = [
        (
            "Installs folding per day",
            series(&|d| d.people_folding as f64),
            number,
            "#4f9cff",
        ),
        (
            "Folds per day",
            series(&|d| d.folds as f64),
            number,
            "#7bd88f",
        ),
        (
            "Time unfolded per folding install per day",
            series(&|d| ratio(d.unfolded_ms as f64, d.people_folding)),
            duration,
            "#f3b950",
        ),
        (
            "New installs per day (UTC, first non-backfill event)",
            series(&|d| d.new_installs as f64),
            number,
            "#c792ea",
        ),
    ];
    for (title, values, format, color) in charts {
        let _ = write!(html, "<h2>{title}</h2>{}", bars(&values, format, color));
    }
    let _ = write!(
        html,
        "<h2>When people unfold (local weekday × hour)</h2>{}",
        heatmap(&report.heatmap)
    );
    html.push_str("<h2>Tracking health: interruptions per day</h2>");
    let mut headers = vec!["Day"];
    headers.extend(report.interruptions.iter().map(|(r, _)| r.as_str()));
    html.push_str(&table(
        &headers,
        report.daily.iter().enumerate().filter_map(|(i, d)| {
            let row: Vec<usize> = report.interruptions.iter().map(|(_, c)| c[i]).collect();
            (row.iter().any(|c| *c > 0)).then(|| {
                std::iter::once(d.day.clone())
                    .chain(row.iter().map(usize::to_string))
                    .collect()
            })
        }),
    ));
    html.push_str(r#"<div class="grid"><div><h2>Setup funnel</h2>"#);
    html.push_str(&table(
        &["Step", "Installs"],
        report
            .setup
            .iter()
            .map(|(s, n)| vec![s.replace('_', " "), n.to_string()]),
    ));
    let _ = write!(
        html,
        "</div><div><h2>Errors</h2>{}</div></div><h2>Feature use</h2>{}",
        counts_table("Error", &report.errors),
        counts_table("Feature", &report.features)
    );
    let _ = write!(
        html,
        r#"<div class="grid"><div><h2>App version</h2>{}</div><div><h2>Region</h2>{}</div><div><h2>Competition</h2>{}</div></div>"#,
        breakdown("Version", &report.by_version),
        breakdown("Region", &report.by_region),
        breakdown("Competition", &report.by_competition)
    );
    html.push_str("<h2>Recent installs</h2>");
    html.push_str(&table(
        &[
            "Install",
            "Version",
            "Device",
            "Region",
            "First seen",
            "Last batch",
        ],
        report.recent_installs.iter().map(|i| {
            vec![
                format!(
                    r#"<a href="/admin/analytics/installs/{0}">{0}</a>"#,
                    escape(&i.analytics_id)
                ),
                format!("{} ({})", escape(&i.app_version), i.build),
                format!(
                    "{} · iOS {}",
                    escape(&i.device_model),
                    escape(&i.os_version)
                ),
                escape(i.region.as_deref().unwrap_or("unknown")),
                time(Some(i.first_seen_ms)),
                time(Some(i.last_received_ms)),
            ]
        }),
    ));
    html
}

/// One install's last 14 local days: open→close bars per day, an hour histogram and raw events.
pub fn render_install(
    install: &InstallRow,
    events: &[EventRow],
    exclusions: &Exclusions,
    end_day: NaiveDate,
) -> String {
    let start = end_day - Duration::days(13);
    let days: Vec<NaiveDate> = start.iter_days().take(14).collect();
    let kept: Vec<&EventRow> = events.iter().filter(|e| exclusions.keeps(e)).collect();
    let mut html = String::from(STYLE);
    let _ = write!(
        html,
        r#"<p><a href="/admin/analytics?channel=all">← Usage analytics</a></p><h1>Install {}</h1>"#,
        escape(&install.analytics_id)
    );
    html.push_str(&table(
        &[
            "Version",
            "Channel",
            "Device",
            "Locale",
            "Competition",
            "First seen",
            "Last batch",
        ],
        std::iter::once(vec![
            format!("{} ({})", escape(&install.app_version), install.build),
            escape(&install.channel),
            format!(
                "{} · iOS {}",
                escape(&install.device_model),
                escape(&install.os_version)
            ),
            format!(
                "{} · {}",
                escape(&install.locale),
                escape(install.region.as_deref().unwrap_or("unknown"))
            ),
            if install.competition != 0 {
                "joined"
            } else {
                "not joined"
            }
            .into(),
            time(Some(install.first_seen_ms)),
            time(Some(install.last_received_ms)),
        ]),
    ));
    let (label_w, width, row_h) = (90.0, 720.0, 22.0);
    let mut svg = format!(
        r#"<svg viewBox="0 0 {} {}" width="100%" style="max-width:{}px;display:block" role="img">"#,
        label_w + width,
        row_h * 14.0 + 20.0,
        label_w + width
    );
    for (row, day) in days.iter().enumerate() {
        let y = row as f64 * row_h;
        let _ = write!(
            svg,
            r##"<text x="0" y="{:.0}" fill="#aaa" font-size="11">{}</text><rect x="{label_w}" y="{y}" width="{width}" height="{}" fill="#111"/>"##,
            y + 15.0,
            day.format("%a %d %b"),
            row_h - 4.0
        );
    }
    let mut hours = [0usize; 24];
    for session in sessions(kept.iter().copied()) {
        let Some(local) = local_time(session.open.at_ms, &session.open.timezone_id) else {
            continue;
        };
        let Some(row) = days
            .iter()
            .position(|d| d.format("%Y-%m-%d").to_string() == local.day)
        else {
            continue;
        };
        let x = label_w + local.minute_of_day as f64 / 1440.0 * width;
        let w = (session.duration_ms as f64 / 86_400_000.0 * width)
            .min(label_w + width - x)
            .max(1.5);
        let _ = write!(
            svg,
            r##"<rect x="{x:.1}" y="{:.1}" width="{w:.1}" height="{}" fill="#4f9cff"><title>{:02}:{:02} for {}</title></rect>"##,
            row as f64 * row_h,
            row_h - 4.0,
            local.minute_of_day / 60,
            local.minute_of_day % 60,
            duration(session.duration_ms as f64)
        );
    }
    for event in &kept {
        if event.kind == "fold_open"
            && let Ok(h) = usize::try_from(event.local_hour)
            && h < 24
            && days
                .iter()
                .any(|d| d.format("%Y-%m-%d").to_string() == event.local_day)
        {
            hours[h] += 1;
        }
    }
    for h in (0..=24).step_by(6) {
        let _ = write!(
            svg,
            r##"<text x="{:.0}" y="{}" fill="#aaa" font-size="11" text-anchor="middle">{h:02}</text>"##,
            label_w + h as f64 / 24.0 * width,
            row_h * 14.0 + 14.0
        );
    }
    svg.push_str("</svg>");
    let _ = write!(
        html,
        "<h2>Last 14 days (local time, unfolded sessions)</h2>{svg}<h2>Unfolds by local hour (same 14 days)</h2>{}",
        bars(
            &hours
                .iter()
                .enumerate()
                .map(|(h, c)| (format!("{h:02}:00"), *c as f64))
                .collect::<Vec<_>>(),
            number,
            "#7bd88f"
        )
    );
    let mut recent: Vec<&EventRow> = events.iter().collect();
    recent.sort_by(|a, b| b.at_ms.cmp(&a.at_ms).then(a.event_id.cmp(&b.event_id)));
    html.push_str("<h2>Recent events</h2>");
    html.push_str(&table(
        &["Local time", "Kind", "Detail", "Notes"],
        recent.into_iter().take(200).map(|e| {
            let notes = [
                (e.backfill != 0).then_some("backfill"),
                (!exclusions.keeps(e)).then_some("excluded"),
            ];
            vec![
                format!(
                    "{} {:02}h · {}",
                    escape(&e.local_day),
                    e.local_hour,
                    escape(&e.timezone_id)
                ),
                escape(&e.kind),
                escape(e.detail.as_deref().unwrap_or("")),
                notes.into_iter().flatten().collect::<Vec<_>>().join(", "),
            ]
        }),
    ));
    html
}

#[cfg(test)]
mod tests {
    use super::*;

    fn install(id: &str, channel: &str, first_seen_ms: i64) -> InstallRow {
        InstallRow {
            analytics_id: id.into(),
            app_version: "1.2.0".into(),
            build: 123,
            channel: channel.into(),
            os_version: "26.1".into(),
            device_model: "iPhone17,1".into(),
            region: Some("GB".into()),
            locale: "en_GB".into(),
            competition: 0,
            first_seen_ms,
            last_received_ms: first_seen_ms + 1,
        }
    }
    const DAY: i64 = 86_400_000;
    // 2026-11-02T00:00:00Z, a Monday.
    const MONDAY: i64 = 1_793_577_600_000;
    fn event(id: &str, event: &str, kind: &str, at_ms: i64) -> EventRow {
        let local = local_time(at_ms, "UTC").unwrap();
        EventRow {
            analytics_id: id.into(),
            event_id: event.into(),
            kind: kind.into(),
            at_ms,
            timezone_id: "UTC".into(),
            local_day: local.day,
            local_hour: local.hour.into(),
            local_weekday: local.weekday.into(),
            backfill: 0,
            detail: None,
        }
    }
    fn filter(channel: &str) -> Filter {
        Filter {
            from: NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
            to: NaiveDate::from_ymd_opt(2026, 11, 3).unwrap(),
            channel: channel.into(),
        }
    }

    #[test]
    fn filter_defaults_and_rejections() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 21).unwrap();
        let parsed = Filter::parse(&[], today).unwrap();
        assert_eq!(parsed.days().len(), 28);
        assert_eq!((parsed.to, parsed.channel.as_str()), (today, "app_store"));
        let pair = |k: &str, v: &str| (k.to_owned(), v.to_owned());
        assert!(Filter::parse(&[pair("channel", "all"), pair("from", "")], today).is_ok());
        for bad in [
            vec![pair("channel", "beta")],
            vec![pair("from", "2026-11-22")],
            vec![pair("from", "2025-01-01")],
            vec![pair("from", "21/11/2026")],
            vec![pair("other", "1")],
        ] {
            assert!(Filter::parse(&bad, today).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn sessions_pair_open_with_next_close_and_cap() {
        let events = [
            event("a", "1", "fold_open", MONDAY),
            event("a", "2", "fold_close", MONDAY + 600_000),
            event("a", "3", "fold_open", MONDAY + DAY / 2),
            event("a", "4", "fold_open", MONDAY + DAY / 2 + 1),
            event("a", "5", "fold_close", MONDAY + DAY * 2),
        ];
        let durations: Vec<i64> = sessions(events.iter())
            .iter()
            .map(|s| s.duration_ms)
            .collect();
        assert_eq!(durations, vec![600_000, MAX_SESSION_MS]);
    }

    #[test]
    fn report_counts_folds_and_applies_exclusions() {
        let installs = [
            install("a", "app_store", MONDAY + 1000),
            install("b", "app_store", MONDAY - DAY * 30),
            install("t", "testflight", MONDAY),
        ];
        let mut tab = event("b", "9", "tab_viewed", MONDAY + DAY + 5);
        tab.detail = Some("leaderboard".into());
        let mut gap = event("a", "8", "interruption", MONDAY + DAY);
        gap.detail = Some("device_restart".into());
        let events = vec![
            // Removed by entry_deleted.
            event("a", "0", "fold_open", MONDAY + 10),
            // Before b's reset.
            event("b", "r0", "fold_open", MONDAY + 20),
            event("a", "1", "fold_open", MONDAY + 3_600_000),
            event("a", "2", "fold_close", MONDAY + 3_600_000 + 900_000),
            event("b", "3", "fold_open", MONDAY + 7_200_000),
            event("b", "4", "fold_close", MONDAY + 7_200_000 + 300_000),
            event("a", "5", "fold_open", MONDAY + DAY + 3_600_000),
            event("t", "6", "fold_open", MONDAY + DAY),
            tab,
            gap,
        ];
        let exclusions = Exclusions {
            removed: [("a".to_owned(), "0".to_owned())].into(),
            latest_reset: [("b".to_owned(), MONDAY + 100)].into(),
        };
        let report = compute(
            &filter("app_store"),
            &installs,
            &events,
            &exclusions,
            Some(MONDAY),
        );
        assert_eq!(report.folds, 3);
        assert_eq!(report.active_installs, 2);
        assert_eq!(
            report
                .daily
                .iter()
                .map(|d| (d.folds, d.people_folding))
                .collect::<Vec<_>>(),
            vec![(2, 2), (1, 1)]
        );
        assert_eq!(report.unfolded_ms, 1_200_000);
        assert_eq!(report.new_installs, 1);
        assert_eq!(report.heatmap[0][1], 1);
        assert_eq!(
            report.interruptions,
            vec![("device_restart".into(), vec![0, 1])]
        );
        assert_eq!(report.features[0].label, "tab_viewed · leaderboard");
        assert_eq!(report.recent_installs.len(), 2);
        let all = compute(&filter("all"), &installs, &events, &exclusions, None);
        assert_eq!(all.folds, 4);
        let html = render(&filter("app_store"), &report);
        assert!(html.contains("/admin/analytics/installs/a"));
        assert!(html.contains("<svg"));
        let page = render_install(
            &installs[0],
            &events[..4],
            &exclusions,
            NaiveDate::from_ymd_opt(2026, 11, 3).unwrap(),
        );
        assert!(page.contains("for 15m"));
        assert!(page.contains("excluded"));
    }

    #[test]
    fn escapes_markup() {
        assert_eq!(
            escape(r#"<a href="x">&'"#),
            "&lt;a href=&quot;x&quot;&gt;&amp;&#39;"
        );
    }
}
