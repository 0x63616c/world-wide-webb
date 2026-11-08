use std::{env, path::PathBuf};
use www_server::{AppState, http, storage};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if env::args().nth(1).as_deref() == Some("version") {
        println!("{}", option_env!("BUILD_HASH").unwrap_or("local"));
        return Ok(());
    }
    if env::args().nth(1).as_deref() == Some("capabilities") {
        println!("{{\"databaseCheck\":true}}");
        return Ok(());
    }
    if env::args().nth(1).as_deref() == Some("healthcheck") {
        healthcheck().await?;
        return Ok(());
    }
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let data = PathBuf::from(env::var("WWW_DATA_DIR").unwrap_or_else(|_| "data".into()));
    tokio::fs::create_dir_all(&data).await?;
    let media = env::var("MEDIA_STORAGE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data.join("media"));
    tokio::fs::create_dir_all(&media).await?;
    let database = env::var("WWW_DATABASE_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data.join("control-center.sqlite"));
    if env::args().nth(1).as_deref() == Some("database-check") {
        storage::validate(&database).await?;
        println!("Existing database integrity and schema verified");
        return Ok(());
    }
    if env::var("WWW_REQUIRE_DATABASE").as_deref() == Ok("on") && !database.is_file() {
        return Err(std::io::Error::other(
            "Restore the existing production database before starting",
        )
        .into());
    }
    let db = storage::open(&database).await?;
    if env::args().nth(1).as_deref() == Some("migrate") {
        db.close().await;
        return Ok(());
    }
    let mut state = AppState::new(db.clone(), media);
    state.config = std::sync::Arc::new(www_server::config::Config::load()?);
    let listen = env::var("WWW_LISTEN").unwrap_or_else(|_| "127.0.0.1:4201".into());
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!(address = %listen, "server ready");
    let runtime = www_server::runtime::Runtime::start(state.clone())?;
    let stopping = state.shutdown.clone();
    axum::serve(listener, http::router(state))
        .with_graceful_shutdown(async move {
            shutdown().await;
            let _ = stopping.send(true);
        })
        .await?;
    runtime.stop().await;
    db.close().await;
    Ok(())
}
async fn shutdown() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
}

async fn healthcheck() -> Result<(), Box<dyn std::error::Error>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let address = env::var("WWW_HEALTH_ADDRESS").unwrap_or_else(|_| "127.0.0.1:4201".into());
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let mut stream = tokio::net::TcpStream::connect(address).await?;
        stream
            .write_all(b"GET /healthz HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await?;
        let mut response = Vec::new();
        stream.take(65536).read_to_end(&mut response).await?;
        let split = response
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or_else(|| std::io::Error::other("invalid health response"))?;
        if !(response.starts_with(b"HTTP/1.0 200") || response.starts_with(b"HTTP/1.1 200")) {
            return Err(std::io::Error::other("server is not ready"));
        }
        let body: serde_json::Value =
            serde_json::from_slice(&response[split + 4..]).map_err(std::io::Error::other)?;
        if let Ok(mode) = env::var("WORKER_CYCLES") {
            if body["cycles"]["enabled"].as_bool() != Some(mode == "on") {
                return Err(std::io::Error::other("unexpected worker ownership"));
            }
        }
        if body["database"] != "ok" {
            return Err(std::io::Error::other("database is not ready"));
        }
        if let Ok(expected) = env::var("EXPECTED_REVISION") {
            if body["build"].as_str() != Some(expected.as_str()) {
                return Err(std::io::Error::other("unexpected server revision"));
            }
        }
        Ok::<_, std::io::Error>(())
    })
    .await??;
    Ok(())
}
