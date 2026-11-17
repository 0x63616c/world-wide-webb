//! HTTP API. Read-only over the library folder; progress is the only thing written.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::extract::{Path, Query, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower::ServiceExt;
use tower_http::services::ServeFile;
use utoipa::{OpenApi, ToSchema};

use crate::library::{self, ART, ART_SMALL, Entry, Library, VIDEO};
use crate::progress::{Progress, ProgressStore};

pub struct AppState {
    pub root: PathBuf,
    pub store: ProgressStore,
    library: RwLock<Option<Arc<Library>>>,
    last_error: RwLock<Option<String>>,
}

impl AppState {
    pub fn new(root: PathBuf, store: ProgressStore) -> Arc<Self> {
        Arc::new(Self {
            root,
            store,
            library: RwLock::new(None),
            last_error: RwLock::new(None),
        })
    }

    /// Rescans the folder. On failure the previous library stays, so a share that drops
    /// for a moment does not empty everyone's screens.
    pub fn rescan(&self) -> Result<usize, String> {
        match library::scan(&self.root) {
            Ok(found) => {
                for problem in &found.problems {
                    tracing::warn!(%problem, "skipped library item");
                }
                let count = found.len();
                *self.library.write().unwrap() = Some(Arc::new(found));
                *self.last_error.write().unwrap() = None;
                Ok(count)
            }
            Err(error) => {
                let message = format!("{error:#}");
                tracing::error!(%message, "library scan failed");
                *self.last_error.write().unwrap() = Some(message.clone());
                Err(message)
            }
        }
    }

    fn library(&self) -> Option<Arc<Library>> {
        self.library.read().unwrap().clone()
    }

    fn available(&self) -> bool {
        self.last_error.read().unwrap().is_none() && self.library().is_some()
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Tapes",
        version = "1",
        description = "Personal media library."
    ),
    paths(get_library, get_media, get_art, put_progress, rescan, health),
    components(schemas(
        LibraryResponse,
        Movie,
        Show,
        Episode,
        DjSet,
        Progress,
        Health,
        ApiError,
        RescanResult
    ))
)]
pub struct ApiDoc;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/library", get(get_library))
        .route("/media/{id}", get(get_media))
        .route("/art/{id}", get(get_art))
        .route("/progress/{id}", put(put_progress))
        .route("/rescan", post(rescan))
        .route("/health", get(health))
        .route("/openapi.json", get(|| async { Json(ApiDoc::openapi()) }))
        .with_state(state)
}

#[derive(Serialize, ToSchema)]
pub struct ApiError {
    pub error: String,
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(ApiError {
            error: message.into(),
        }),
    )
        .into_response()
}

#[derive(Serialize, Deserialize, ToSchema, Debug)]
pub struct LibraryResponse {
    /// False when the last scan failed; the lists are then the last good scan.
    pub available: bool,
    pub movies: Vec<Movie>,
    pub shows: Vec<Show>,
    pub sets: Vec<DjSet>,
}

#[derive(Serialize, Deserialize, ToSchema, Debug)]
pub struct Movie {
    pub id: String,
    pub title: String,
    pub year: Option<i32>,
    /// Running time in seconds.
    pub seconds: Option<f64>,
    pub badges: Vec<String>,
    pub has_art: bool,
    /// Size of the video file in bytes. Optional so apps built before it still decode.
    #[schema(nullable = false)]
    pub bytes: Option<u64>,
    /// Absent until first played or marked.
    #[schema(nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
}

#[derive(Serialize, Deserialize, ToSchema, Debug)]
pub struct Show {
    pub id: String,
    pub title: String,
    pub years: Option<String>,
    pub has_art: bool,
    pub episodes: Vec<Episode>,
}

#[derive(Serialize, Deserialize, ToSchema, Debug)]
pub struct Episode {
    pub id: String,
    pub season: u32,
    pub number: u32,
    pub title: String,
    pub seconds: Option<f64>,
    pub has_art: bool,
    /// Size of the video file in bytes. Optional so apps built before it still decode.
    #[schema(nullable = false)]
    pub bytes: Option<u64>,
    /// Absent until first played or marked.
    #[schema(nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
}

#[derive(Serialize, Deserialize, ToSchema, Debug)]
pub struct DjSet {
    pub id: String,
    pub djs: Vec<String>,
    pub title: String,
    /// ISO date (YYYY-MM-DD) when known.
    pub date: Option<String>,
    pub seconds: Option<f64>,
    pub has_art: bool,
    /// Size of the video file in bytes. Optional so apps built before it still decode.
    #[schema(nullable = false)]
    pub bytes: Option<u64>,
    /// Absent until first played or marked.
    #[schema(nullable = false)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<Progress>,
}

fn playable(e: &Entry) -> bool {
    e.has_video
}

/// Everything in the library with its progress.
#[utoipa::path(get, path = "/library", responses(
    (status = 200, body = LibraryResponse),
    (status = 503, description = "The library has never been read since start-up", body = ApiError)
))]
async fn get_library(State(state): State<Arc<AppState>>) -> Response {
    let Some(library) = state.library() else {
        return error(StatusCode::SERVICE_UNAVAILABLE, "library unavailable");
    };
    let progress: HashMap<String, Progress> = match state.store.all() {
        Ok(p) => p,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
    };
    let p = |id: &str| progress.get(id).cloned();
    Json(LibraryResponse {
        available: state.available(),
        movies: library
            .movies
            .iter()
            .filter(|e| playable(e))
            .map(|e| Movie {
                id: e.info.id.clone(),
                title: e.info.title.clone(),
                year: e.info.year,
                seconds: e.info.seconds,
                badges: e.info.badges.clone(),
                has_art: e.has_art,
                bytes: Some(e.bytes),
                progress: p(&e.info.id),
            })
            .collect(),
        shows: library
            .shows
            .iter()
            .filter(|(_, eps)| eps.iter().any(playable))
            .map(|(show, eps)| Show {
                id: show.info.id.clone(),
                title: show.info.title.clone(),
                years: show.info.years.clone(),
                has_art: show.has_art,
                episodes: eps
                    .iter()
                    .filter(|e| playable(e))
                    .map(|e| Episode {
                        id: e.info.id.clone(),
                        season: e.info.season.unwrap_or(1),
                        number: e.info.number.unwrap_or(0),
                        title: e.info.title.clone(),
                        seconds: e.info.seconds,
                        has_art: e.has_art,
                        bytes: Some(e.bytes),
                        progress: p(&e.info.id),
                    })
                    .collect(),
            })
            .collect(),
        sets: library
            .sets
            .iter()
            .filter(|e| playable(e))
            .map(|e| DjSet {
                id: e.info.id.clone(),
                djs: e.info.djs.clone(),
                title: e.info.title.clone(),
                date: e.info.date.clone(),
                seconds: e.info.seconds,
                has_art: e.has_art,
                bytes: Some(e.bytes),
                progress: p(&e.info.id),
            })
            .collect(),
    })
    .into_response()
}

#[allow(clippy::result_large_err)] // handlers return the error response directly
fn entry_dir(state: &AppState, id: &str) -> Result<PathBuf, Response> {
    let Some(library) = state.library() else {
        return Err(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "library unavailable",
        ));
    };
    library
        .find(id)
        .map(|e| e.dir.clone())
        .ok_or_else(|| error(StatusCode::NOT_FOUND, "no such item"))
}

async fn serve(path: PathBuf, content_type: &'static str, request: Request) -> Response {
    if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
        return error(StatusCode::NOT_FOUND, "file missing");
    }
    match ServeFile::new_with_mime(path, &content_type.parse().unwrap())
        .oneshot(request)
        .await
    {
        Ok(response) => response.into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// The item's MP4. Supports range requests.
#[utoipa::path(get, path = "/media/{id}", params(("id" = String, Path)), responses(
    (status = 200, content_type = "video/mp4", description = "The video file"),
    (status = 206, description = "Part of the video file"),
    (status = 404, body = ApiError)
))]
async fn get_media(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    request: Request,
) -> Response {
    match entry_dir(&state, &id) {
        Ok(dir) => serve(dir.join(VIDEO), "video/mp4", request).await,
        Err(response) => response,
    }
}

#[derive(Deserialize, utoipa::IntoParams)]
struct ArtQuery {
    /// `small` for the grid-sized image.
    size: Option<String>,
}

/// The item's artwork as JPEG.
#[utoipa::path(get, path = "/art/{id}", params(("id" = String, Path), ArtQuery), responses(
    (status = 200, content_type = "image/jpeg", description = "Artwork"),
    (status = 404, body = ApiError)
))]
async fn get_art(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(query): Query<ArtQuery>,
    request: Request,
) -> Response {
    let dir = match entry_dir(&state, &id) {
        Ok(dir) => dir,
        Err(response) => return response,
    };
    let small = dir.join(ART_SMALL);
    let path = if query.size.as_deref() == Some("small") && small.is_file() {
        small
    } else {
        dir.join(ART)
    };
    let mut response = serve(path, "image/jpeg", request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        "public, max-age=300".parse().unwrap(),
    );
    response
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Saves the shared position and watched mark for one playable item.
#[utoipa::path(put, path = "/progress/{id}", params(("id" = String, Path)), request_body = Progress, responses(
    (status = 204, description = "Saved"),
    (status = 400, body = ApiError)
))]
async fn put_progress(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(progress): Json<Progress>,
) -> Response {
    if !valid_id(&id) || !progress.seconds.is_finite() {
        return error(StatusCode::BAD_REQUEST, "invalid id or position");
    }
    match state.store.set(&id, progress) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
    }
}

#[derive(Serialize, ToSchema)]
pub struct RescanResult {
    pub items: usize,
}

/// Reads the library folder again.
#[utoipa::path(post, path = "/rescan", responses(
    (status = 200, body = RescanResult),
    (status = 503, body = ApiError)
))]
async fn rescan(State(state): State<Arc<AppState>>) -> Response {
    let result = tokio::task::spawn_blocking(move || state.rescan()).await;
    match result {
        Ok(Ok(items)) => Json(RescanResult { items }).into_response(),
        Ok(Err(message)) => error(StatusCode::SERVICE_UNAVAILABLE, message),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[derive(Serialize, ToSchema)]
pub struct Health {
    pub status: String,
    /// `available` or `unavailable`.
    pub library: String,
    pub items: usize,
    pub build: String,
    /// Why the library is unavailable, when it is.
    pub problem: Option<String>,
}

/// Server health. Stays 200 while the share is missing; `library` says so.
#[utoipa::path(get, path = "/health", responses((status = 200, body = Health), (status = 500, body = ApiError)))]
async fn health(State(state): State<Arc<AppState>>) -> Response {
    if let Err(e) = state.store.check() {
        return error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("progress database: {e:#}"),
        );
    }
    Json(Health {
        status: "ok".into(),
        library: if state.available() {
            "available"
        } else {
            "unavailable"
        }
        .into(),
        items: state.library().map_or(0, |l| l.len()),
        build: option_env!("BUILD_HASH").unwrap_or("local").into(),
        problem: state.last_error.read().unwrap().clone(),
    })
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{Info, Kind, write_info, write_marker};
    use axum::body::Body;
    use http_body_util::BodyExt;

    fn fixture() -> (tempfile::TempDir, Arc<AppState>, String) {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        write_marker(&root).unwrap();
        let mut movie = Info::new(Kind::Movie, "Heat");
        movie.year = Some(1995);
        let dir = root.join("movies/heat");
        write_info(&dir, &movie).unwrap();
        std::fs::write(dir.join(VIDEO), b"0123456789").unwrap();
        std::fs::write(dir.join(ART), b"big").unwrap();
        std::fs::write(dir.join(ART_SMALL), b"small").unwrap();
        // Listed only once it has a video.
        write_info(&root.join("movies/empty"), &Info::new(Kind::Movie, "Empty")).unwrap();
        let state = AppState::new(root, ProgressStore::in_memory().unwrap());
        (tmp, state, movie.id)
    }

    async fn call(
        state: &Arc<AppState>,
        request: axum::http::Request<Body>,
    ) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
        let response = router(state.clone()).oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        (
            status,
            headers,
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
    }

    fn get(uri: &str) -> axum::http::Request<Body> {
        axum::http::Request::get(uri).body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn library_lists_playable_items_with_progress() {
        let (_tmp, state, id) = fixture();
        assert_eq!(
            call(&state, get("/library")).await.0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        state.rescan().unwrap();

        let put = axum::http::Request::put(format!("/progress/{id}"))
            .header("content-type", "application/json")
            .body(Body::from(r#"{"seconds": 61.5, "watched": false}"#))
            .unwrap();
        assert_eq!(call(&state, put).await.0, StatusCode::NO_CONTENT);

        let (status, _, body) = call(&state, get("/library")).await;
        assert_eq!(status, StatusCode::OK);
        let library: LibraryResponse = serde_json::from_slice(&body).unwrap();
        assert!(library.available);
        assert_eq!(library.movies.len(), 1);
        assert_eq!(library.movies[0].bytes, Some(10));
        let saved = library.movies[0].progress.clone().unwrap();
        assert_eq!((saved.seconds, saved.watched), (61.5, false));
    }

    #[tokio::test]
    async fn media_supports_ranges_and_art_has_a_small_size() {
        let (_tmp, state, id) = fixture();
        state.rescan().unwrap();
        let ranged = axum::http::Request::get(format!("/media/{id}"))
            .header("range", "bytes=2-4")
            .body(Body::empty())
            .unwrap();
        let (status, headers, body) = call(&state, ranged).await;
        assert_eq!(status, StatusCode::PARTIAL_CONTENT);
        assert_eq!(body, b"234");
        assert_eq!(headers["content-type"], "video/mp4");
        assert_eq!(
            call(&state, get(&format!("/art/{id}?size=small"))).await.2,
            b"small"
        );
        assert_eq!(call(&state, get(&format!("/art/{id}"))).await.2, b"big");
        assert_eq!(
            call(&state, get("/media/nope")).await.0,
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn a_missing_share_keeps_the_last_library_and_says_so() {
        let (tmp, state, _) = fixture();
        state.rescan().unwrap();
        std::fs::remove_file(tmp.path().join(crate::library::MARKER)).unwrap();
        assert!(state.rescan().is_err());

        let library: LibraryResponse =
            serde_json::from_slice(&call(&state, get("/library")).await.2).unwrap();
        assert!(!library.available);
        assert_eq!(library.movies.len(), 1);
        let (status, _, body) = call(&state, get("/health")).await;
        assert_eq!(status, StatusCode::OK);
        assert!(
            String::from_utf8(body)
                .unwrap()
                .contains("\"library\":\"unavailable\"")
        );
    }

    #[tokio::test]
    async fn rejects_bad_progress() {
        let (_tmp, state, _) = fixture();
        let put = axum::http::Request::put("/progress/../x")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"seconds": 1, "watched": false}"#))
            .unwrap();
        assert_ne!(call(&state, put).await.0, StatusCode::NO_CONTENT);
        assert_eq!(call(&state, get("/openapi.json")).await.0, StatusCode::OK);
    }
}
