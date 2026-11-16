//! `tapes`: the Tapes server and the tool that adds media to its library.

mod api;
mod import;
mod library;
mod progress;

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::{Args, Parser, Subcommand};
use serde_json::json;
use utoipa::OpenApi;

use library::{Info, Kind};

#[derive(Parser)]
#[command(name = "tapes", version, about = "Personal media library server and import tool")]
struct Cli {
    /// Print machine-readable JSON.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Args)]
struct LibraryArg {
    /// The library folder (the NAS share, or any local folder).
    #[arg(long, env = "TAPES_LIBRARY")]
    library: PathBuf,
}

#[derive(Subcommand)]
enum Cmd {
    /// Serve the library over HTTP.
    Serve {
        #[command(flatten)]
        lib: LibraryArg,
        #[arg(long, env = "TAPES_LISTEN", default_value = "0.0.0.0:4300")]
        listen: String,
        /// Progress database on local disk (never on the NAS).
        #[arg(long, env = "TAPES_DATABASE", default_value = "data/progress.sqlite")]
        database: PathBuf,
        /// Seconds between automatic rescans.
        #[arg(long, env = "TAPES_RESCAN_SECONDS", default_value_t = 300)]
        rescan_seconds: u64,
    },
    /// Check a running server's health (used by the container health check).
    Healthcheck {
        #[arg(long, env = "TAPES_LISTEN", default_value = "127.0.0.1:4300")]
        listen: String,
    },
    /// Add a video to the library.
    Import {
        #[command(subcommand)]
        what: ImportCmd,
    },
    /// List the library.
    List {
        #[command(flatten)]
        lib: LibraryArg,
    },
    /// Change an item's details.
    Edit {
        #[command(flatten)]
        lib: LibraryArg,
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        year: Option<i32>,
        #[arg(long)]
        years: Option<String>,
        #[arg(long)]
        date: Option<String>,
        /// Replaces the DJ list; repeat for back-to-back sets.
        #[arg(long = "dj")]
        djs: Vec<String>,
        #[arg(long)]
        season: Option<u32>,
        #[arg(long)]
        number: Option<u32>,
    },
    /// Delete an item and its files from the library. A show takes its episodes with it.
    Remove {
        #[command(flatten)]
        lib: LibraryArg,
        id: String,
        /// Required: confirms the files are deleted.
        #[arg(long)]
        yes: bool,
    },
    /// Write a library marker so an empty folder can be served.
    Init {
        #[command(flatten)]
        lib: LibraryArg,
    },
    /// Print the OpenAPI document.
    Openapi,
}

#[derive(Args)]
struct ImportCommon {
    /// The source video.
    source: PathBuf,
    #[command(flatten)]
    lib: LibraryArg,
    /// Show what would happen without writing anything.
    #[arg(long)]
    dry_run: bool,
    /// Re-encode to at most this height (for example 1080).
    #[arg(long)]
    max_height: Option<u32>,
    /// Server to ask for a rescan afterwards.
    #[arg(long, env = "TAPES_SERVER", default_value = "http://homelab-mac-mini.local:4300")]
    server: String,
}

#[derive(Subcommand)]
enum ImportCmd {
    Movie {
        #[command(flatten)]
        common: ImportCommon,
        #[arg(long)]
        title: String,
        #[arg(long)]
        year: Option<i32>,
    },
    Episode {
        #[command(flatten)]
        common: ImportCommon,
        /// Show title; the show is created if it is new.
        #[arg(long)]
        show: String,
        #[arg(long)]
        season: u32,
        #[arg(long)]
        number: u32,
        #[arg(long)]
        title: String,
        /// Show's years, for example "2005–2013", used when the show is new.
        #[arg(long)]
        years: Option<String>,
    },
    Set {
        #[command(flatten)]
        common: ImportCommon,
        /// DJ name; repeat for back-to-back sets.
        #[arg(long = "dj", required = true)]
        djs: Vec<String>,
        #[arg(long)]
        title: String,
        /// YYYY-MM-DD.
        #[arg(long)]
        date: Option<String>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Cmd::Serve { lib, listen, database, rescan_seconds } => serve(lib.library, listen, database, rescan_seconds),
        Cmd::Healthcheck { listen } => healthcheck(&listen),
        Cmd::Import { what } => run_import(what, cli.json),
        Cmd::List { lib } => list(&lib.library, cli.json),
        Cmd::Edit { lib, id, title, year, years, date, djs, season, number } => {
            let (dir, mut info) = find(&lib.library, &id)?;
            if let Some(v) = title { info.title = v }
            if year.is_some() { info.year = year }
            if years.is_some() { info.years = years }
            if let Some(v) = date { info.date = Some(check_date(&v)?) }
            if !djs.is_empty() { info.djs = djs }
            if season.is_some() { info.season = season }
            if number.is_some() { info.number = number }
            library::write_info(&dir, &info)?;
            print(cli.json, &json!({"edited": info}), || format!("Saved {}", info.title));
            Ok(())
        }
        Cmd::Remove { lib, id, yes } => {
            let (dir, info) = find(&lib.library, &id)?;
            if !yes {
                bail!("this deletes {} and its video; run again with --yes", dir.display());
            }
            std::fs::remove_dir_all(&dir)?;
            print(cli.json, &json!({"removed": info.id, "dir": dir}), || format!("Removed {}", info.title));
            Ok(())
        }
        Cmd::Init { lib } => {
            library::write_marker(&lib.library)?;
            print(cli.json, &json!({"library": lib.library}), || format!("Library ready at {}", lib.library.display()));
            Ok(())
        }
        Cmd::Openapi => {
            println!("{}", api::ApiDoc::openapi().to_pretty_json()?);
            Ok(())
        }
    }
}

fn print(json: bool, value: &serde_json::Value, text: impl FnOnce() -> String) {
    if json {
        println!("{value}");
    } else {
        println!("{}", text());
    }
}

fn check_date(date: &str) -> Result<String> {
    let ok = date.len() == 10
        && date.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if !ok {
        bail!("date must be YYYY-MM-DD");
    }
    Ok(date.into())
}

fn find(root: &Path, id: &str) -> Result<(PathBuf, Info)> {
    let lib = library::scan(root)?;
    let entry = lib.find(id).with_context(|| format!("no item with id {id}"))?;
    Ok((entry.dir.clone(), entry.info.clone()))
}

fn run_import(what: ImportCmd, json: bool) -> Result<()> {
    let (common, info, dir) = match what {
        ImportCmd::Movie { common, title, year } => {
            let root = ready(&common.lib.library)?;
            let mut info = Info::new(Kind::Movie, &title);
            info.year = year;
            let name = year.map_or(title.clone(), |y| format!("{title} {y}"));
            let dir = library::free_dir(&root.join("movies"), &name);
            (common, info, dir)
        }
        ImportCmd::Episode { common, show, season, number, title, years } => {
            let root = ready(&common.lib.library)?;
            let lib = library::scan(&root)?;
            let show_dir = match lib.shows.iter().find(|(s, _)| s.info.title.eq_ignore_ascii_case(&show)) {
                Some((existing, episodes)) => {
                    if episodes.iter().any(|e| e.info.season == Some(season) && e.info.number == Some(number)) {
                        bail!("{show} S{season}E{number} is already in the library");
                    }
                    existing.dir.clone()
                }
                None => {
                    let dir = library::free_dir(&root.join("shows"), &show);
                    if !common.dry_run {
                        let mut info = Info::new(Kind::Show, &show);
                        info.years = years;
                        library::write_info(&dir, &info)?;
                    }
                    dir
                }
            };
            let mut info = Info::new(Kind::Episode, &title);
            (info.season, info.number) = (Some(season), Some(number));
            let dir = library::free_dir(&show_dir, &format!("s{season:02}e{number:02}"));
            (common, info, dir)
        }
        ImportCmd::Set { common, djs, title, date } => {
            let root = ready(&common.lib.library)?;
            let mut info = Info::new(Kind::Set, &title);
            let name = format!("{} {}", djs.join(" b2b "), title);
            info.djs = djs;
            info.date = date.as_deref().map(check_date).transpose()?;
            let dir = library::free_dir(&root.join("sets"), &name);
            (common, info, dir)
        }
    };
    let title = info.title.clone();
    let outcome = import::import(&common.source, &dir, info, common.max_height, common.dry_run)?;
    // A new show takes its artwork from its first episode until a poster is added beside it.
    if !outcome.dry_run && let Some(show_dir) = dir.parent().filter(|p| p.join(library::INFO).is_file() && p != &dir) {
        for name in [library::ART, library::ART_SMALL] {
            if !show_dir.join(name).exists() {
                std::fs::copy(dir.join(name), show_dir.join(name))?;
            }
        }
    }
    if json {
        println!("{}", serde_json::to_string(&outcome)?);
    } else {
        for warning in &outcome.plan.warnings {
            eprintln!("warning: {warning}");
        }
        let verb = if outcome.dry_run { "Would import" } else { "Imported" };
        println!("{verb} {title} ({}) into {}", outcome.id, outcome.dir.display());
        if outcome.dry_run {
            println!("ffmpeg {}", outcome.ffmpeg.join(" "));
        }
    }
    if !outcome.dry_run {
        let rescan = std::process::Command::new("curl")
            .args(["-fsS", "-m", "10", "-X", "POST", &format!("{}/rescan", common.server.trim_end_matches('/'))])
            .output();
        if !rescan.is_ok_and(|o| o.status.success()) {
            eprintln!("warning: could not ask {} to rescan; it will notice within five minutes", common.server);
        }
    }
    Ok(())
}

/// Accepts a folder only if it is a library (has the marker), so a mistyped path or an
/// unmounted share does not get a new, separate library.
fn ready(root: &Path) -> Result<PathBuf> {
    if !root.join(library::MARKER).is_file() {
        bail!("{} is not a Tapes library (no {}); run `tapes init` once for a new one", root.display(), library::MARKER);
    }
    Ok(root.to_path_buf())
}

fn list(root: &Path, json: bool) -> Result<()> {
    let lib = library::scan(root)?;
    if json {
        let infos: Vec<_> = lib.entries().map(|e| &e.info).collect();
        println!("{}", json!({"items": infos, "problems": lib.problems}));
        return Ok(());
    }
    let minutes = |i: &Info| i.seconds.map_or(String::new(), |s| format!(" {}m", (s / 60.0).round()));
    println!("Movies ({})", lib.movies.len());
    for m in &lib.movies {
        println!("  {}  {}{}{}", m.info.id, m.info.title, m.info.year.map_or(String::new(), |y| format!(" ({y})")), minutes(&m.info));
    }
    println!("Shows ({})", lib.shows.len());
    for (s, eps) in &lib.shows {
        println!("  {}  {} — {} episodes", s.info.id, s.info.title, eps.len());
        for e in eps {
            println!("    {}  S{}E{} {}{}", e.info.id, e.info.season.unwrap_or(0), e.info.number.unwrap_or(0), e.info.title, minutes(&e.info));
        }
    }
    println!("DJ sets ({}, {} DJs)", lib.sets.len(), library::sets_by_dj(&lib).len());
    for s in &lib.sets {
        println!("  {}  {} — {}{}", s.info.id, s.info.djs.join(" b2b "), s.info.title, minutes(&s.info));
    }
    for p in &lib.problems {
        eprintln!("problem: {p}");
    }
    Ok(())
}

fn healthcheck(listen: &str) -> Result<()> {
    use std::io::{Read, Write};
    let addr = listen.replace("0.0.0.0", "127.0.0.1");
    let mut stream = std::net::TcpStream::connect(&addr)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    if !response.starts_with("HTTP/1.0 200") && !response.starts_with("HTTP/1.1 200") {
        bail!("unhealthy: {}", response.lines().next().unwrap_or(""));
    }
    Ok(())
}

#[tokio::main]
async fn serve(root: PathBuf, listen: String, database: PathBuf, rescan_seconds: u64) -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let store = progress::ProgressStore::open(&database).with_context(|| format!("opening {}", database.display()))?;
    let state = api::AppState::new(root, store);
    let scanner = state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(rescan_seconds.max(10)));
        loop {
            tick.tick().await;
            let s = scanner.clone();
            if let Ok(Ok(n)) = tokio::task::spawn_blocking(move || s.rescan()).await {
                tracing::info!(items = n, "library scanned");
            }
        }
    });
    let app = api::router(state).layer(tower_http::trace::TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!(%listen, "serving");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
        })
        .await?;
    Ok(())
}
