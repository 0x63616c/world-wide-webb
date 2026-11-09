//! GitHub REST boundary. Errors deliberately exclude response bodies, URLs and credentials.
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    collections::BTreeMap,
    fmt,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use zeroize::Zeroizing;

pub const API_VERSION: &str = "2026-03-10";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const ACTIVE_STATUSES: [&str; 5] = ["queued", "in_progress", "requested", "waiting", "pending"];
#[cfg(test)]
const LABELS: [&str; 4] = ["self-hosted", "macOS", "ARM64", "homelab-tart"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Repository {
    pub owner: String,
    pub name: String,
    pub repository_id: u64,
    pub installation_id: u64,
}
impl Repository {
    fn validate(&self) -> Result<(), ApiError> {
        let valid = |s: &str| {
            !s.is_empty()
                && s.len() <= 100
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
                && s != "."
                && s != ".."
        };
        if valid(&self.owner)
            && valid(&self.name)
            && self.repository_id > 0
            && self.installation_id > 0
        {
            Ok(())
        } else {
            Err(ApiError::new(
                "validate_repository",
                ErrorCategory::Configuration,
            ))
        }
    }
    fn path(&self) -> String {
        format!("repos/{}/{}", self.owner, self.name)
    }
}

pub struct AppCredentials {
    pub app_id: String,
    pub private_key_path: PathBuf,
}
impl fmt::Debug for AppCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AppCredentials([REDACTED])")
    }
}
/// Credential material intentionally has neither Serialize nor an unredacted Debug implementation.
pub struct JitConfig(Zeroizing<String>);
impl JitConfig {
    pub fn as_bytes(&self) -> &[u8] {
        self.0.as_bytes()
    }
}
impl fmt::Debug for JitConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("JitConfig([REDACTED])")
    }
}
#[derive(Debug)]
pub struct JitRegistration {
    pub runner: Runner,
    pub config: JitConfig,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct Runner {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub busy: bool,
}
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct GithubJob {
    pub id: u64,
    pub run_id: u64,
    #[serde(default)]
    pub run_attempt: u64,
    pub status: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub head_sha: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    // GitHub JSON cannot grant this capability; the API adapter derives it.
    #[serde(skip)]
    operations_authorized: bool,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub runner_id: Option<u64>,
    #[serde(default)]
    pub runner_name: Option<String>,
    #[serde(default)]
    pub runner_group_id: Option<u64>,
    #[serde(default)]
    pub runner_group_name: Option<String>,
    pub created_at: String,
}
impl GithubJob {
    /// Requests may omit default labels, but must include our routing label and request only this approved profile.
    pub fn supported_profile(&self) -> bool {
        crate::config::Platform::resolve(&self.labels).is_some()
            && (crate::config::Platform::resolve(&self.labels)
                != Some(crate::config::Platform::LinuxOperationsArm64)
                || self.operations_authorized)
            && self.runner_group_id.unwrap_or(0) == 0
            && self.runner_group_name.as_deref().unwrap_or("").is_empty()
    }
}

/// Settings from GET /repos/{owner}/{repo}; optional policy fields fail closed for public repositories.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct RepositorySettings {
    pub id: u64,
    pub private: bool,
    pub has_pull_requests: Option<bool>,
    pub pull_request_creation_policy: Option<String>,
}
impl RepositorySettings {
    pub fn allows_admission(&self, repository_id: u64) -> bool {
        self.id == repository_id
            && (self.private
                || self.has_pull_requests == Some(false)
                || (self.has_pull_requests == Some(true)
                    && self.pull_request_creation_policy.as_deref() == Some("collaborators_only")))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCategory {
    Configuration,
    Authentication,
    Transport,
    InvalidResponse,
    RateLimited,
    NotFound,
    Rejected,
    Uncertain,
    PaginationSaturated,
}
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApiError {
    pub operation: &'static str,
    pub category: ErrorCategory,
    pub status: Option<u16>,
    pub retry_after_seconds: Option<u64>,
}
impl ApiError {
    fn new(operation: &'static str, category: ErrorCategory) -> Self {
        Self {
            operation,
            category,
            status: None,
            retry_after_seconds: None,
        }
    }
}
impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "GitHub {}: {:?}", self.operation, self.category)
    }
}
impl std::error::Error for ApiError {}

struct CachedToken {
    value: Zeroizing<String>,
    expires_at: u64,
}
pub struct GithubApi {
    client: Client,
    base_url: String,
    credentials: AppCredentials,
    tokens: BTreeMap<(u64, u64), CachedToken>,
    not_before: u64,
    poll_interval_seconds: u64,
}
impl fmt::Debug for GithubApi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("GithubApi([REDACTED])")
    }
}

impl GithubApi {
    pub fn new(credentials: AppCredentials) -> Result<Self, ApiError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("homelab-runner-controller")
            .build()
            .map_err(|_| ApiError::new("build_client", ErrorCategory::Configuration))?;
        Ok(Self {
            client,
            base_url: "https://api.github.com".into(),
            credentials,
            tokens: BTreeMap::new(),
            not_before: 0,
            poll_interval_seconds: 30,
        })
    }
    pub fn poll_interval_seconds(&self) -> u64 {
        self.poll_interval_seconds
    }
    pub fn retry_not_before(&self) -> u64 {
        self.not_before
    }

    async fn token(&mut self, repo: &Repository) -> Result<String, ApiError> {
        repo.validate()?;
        let now = now();
        self.check_backoff("installation_token", now)?;
        if let Some(token) = self.tokens.get(&(repo.installation_id, repo.repository_id))
            && token.expires_at > now + 60
        {
            return Ok(token.value.to_string());
        }
        // Read only the configured runtime PEM; never copy it to state, argv, environment or logs.
        let pem = Zeroizing::new(
            tokio::fs::read(&self.credentials.private_key_path)
                .await
                .map_err(|_| ApiError::new("read_app_key", ErrorCategory::Authentication))?,
        );
        let key = EncodingKey::from_rsa_pem(&pem)
            .map_err(|_| ApiError::new("parse_app_key", ErrorCategory::Authentication))?;
        #[derive(Serialize)]
        struct Claims<'a> {
            iat: u64,
            exp: u64,
            iss: &'a str,
        }
        let jwt = Zeroizing::new(
            jsonwebtoken::encode(
                &Header::new(Algorithm::RS256),
                &Claims {
                    iat: now.saturating_sub(60),
                    exp: now + 540,
                    iss: &self.credentials.app_id,
                },
                &key,
            )
            .map_err(|_| ApiError::new("sign_app_jwt", ErrorCategory::Authentication))?,
        );
        #[derive(Deserialize)]
        struct TokenResponse {
            token: String,
            expires_at: String,
        }
        let body = serde_json::json!({"repository_ids": [repo.repository_id], "permissions": {"actions": "read", "administration": "write"}});
        let response: TokenResponse = self
            .request(
                Method::POST,
                &format!("app/installations/{}/access_tokens", repo.installation_id),
                &jwt,
                Some(body),
                "installation_token",
                false,
            )
            .await?;
        let expires_at = chrono::DateTime::parse_from_rfc3339(&response.expires_at)
            .ok()
            .and_then(|v| u64::try_from(v.timestamp()).ok())
            .filter(|v| *v > now + 60 && *v <= now + 3660)
            .ok_or_else(|| ApiError::new("installation_token", ErrorCategory::InvalidResponse))?;
        if response.token.is_empty() {
            return Err(ApiError::new(
                "installation_token",
                ErrorCategory::InvalidResponse,
            ));
        }
        let value = response.token.clone();
        self.tokens.insert(
            (repo.installation_id, repo.repository_id),
            CachedToken {
                value: Zeroizing::new(response.token),
                expires_at,
            },
        );
        Ok(value)
    }

    fn check_backoff(&self, op: &'static str, now: u64) -> Result<(), ApiError> {
        if now < self.not_before {
            let mut error = ApiError::new(op, ErrorCategory::RateLimited);
            error.retry_after_seconds = Some(self.not_before - now);
            Err(error)
        } else {
            Ok(())
        }
    }
    async fn request<T: DeserializeOwned>(
        &mut self,
        method: Method,
        path: &str,
        token: &str,
        body: Option<serde_json::Value>,
        operation: &'static str,
        mutation: bool,
    ) -> Result<T, ApiError> {
        self.check_backoff(operation, now())?;
        let mut request = self
            .client
            .request(method, format!("{}/{path}", self.base_url))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|_| {
            ApiError::new(
                operation,
                if mutation {
                    ErrorCategory::Uncertain
                } else {
                    ErrorCategory::Transport
                },
            )
        })?;
        self.decode(response, operation, mutation).await
    }
    async fn decode<T: DeserializeOwned>(
        &mut self,
        mut response: reqwest::Response,
        operation: &'static str,
        mutation: bool,
    ) -> Result<T, ApiError> {
        let status = response.status();
        let header_u64 = |name| {
            response
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
        };
        let rate_limited = status == StatusCode::TOO_MANY_REQUESTS
            || (status == StatusCode::FORBIDDEN
                && (header_u64("x-ratelimit-remaining") == Some(0)
                    || header_u64("retry-after").is_some()));
        let retry = header_u64("retry-after")
            .or_else(|| header_u64("x-ratelimit-reset").map(|v| v.saturating_sub(now())));
        if let Some(poll) = header_u64("x-poll-interval") {
            self.poll_interval_seconds = poll.max(30);
        }
        if rate_limited {
            self.not_before = now().saturating_add(retry.unwrap_or(60).max(1));
        }

        if !status.is_success() {
            let category = if rate_limited {
                ErrorCategory::RateLimited
            } else if status == StatusCode::NOT_FOUND {
                ErrorCategory::NotFound
            } else if status == StatusCode::UNAUTHORIZED {
                self.tokens.clear();
                ErrorCategory::Authentication
            } else if (status.is_server_error() || status == StatusCode::REQUEST_TIMEOUT)
                && mutation
            {
                ErrorCategory::Uncertain
            } else if status.is_server_error() {
                ErrorCategory::Transport
            } else {
                ErrorCategory::Rejected
            };
            return Err(ApiError {
                operation,
                category,
                status: Some(status.as_u16()),
                retry_after_seconds: retry,
            });
        }
        let mut bytes = Zeroizing::new(Vec::new());
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            ApiError::new(
                operation,
                if mutation {
                    ErrorCategory::Uncertain
                } else {
                    ErrorCategory::Transport
                },
            )
        })? {
            if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(ApiError::new(
                    operation,
                    if mutation {
                        ErrorCategory::Uncertain
                    } else {
                        ErrorCategory::InvalidResponse
                    },
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        if status == StatusCode::NO_CONTENT {
            bytes.extend_from_slice(b"null");
        }
        serde_json::from_slice(&bytes).map_err(|_| {
            ApiError::new(
                operation,
                if mutation {
                    ErrorCategory::Uncertain
                } else {
                    ErrorCategory::InvalidResponse
                },
            )
        })
    }

    /// All nonterminal runs and their current attempt. A capped search fails closed, including exactly 1000 results.
    pub async fn discover_jobs(&mut self, repo: &Repository) -> Result<Vec<GithubJob>, ApiError> {
        #[derive(Deserialize)]
        struct Run {
            id: u64,
            run_attempt: u64,
        }
        #[derive(Deserialize)]
        struct Runs {
            total_count: usize,
            workflow_runs: Vec<Run>,
        }
        let token = Zeroizing::new(self.token(repo).await?);
        let mut runs = BTreeMap::new();
        for status in ACTIVE_STATUSES {
            for page in 1..=10 {
                let response: Runs = self
                    .request(
                        Method::GET,
                        &format!(
                            "{}/actions/runs?status={status}&per_page={PAGE_SIZE}&page={page}",
                            repo.path()
                        ),
                        &token,
                        None,
                        "list_runs",
                        false,
                    )
                    .await?;
                if response.total_count >= 1000 {
                    return Err(ApiError::new(
                        "list_runs",
                        ErrorCategory::PaginationSaturated,
                    ));
                }
                let count = response.workflow_runs.len();
                for run in response.workflow_runs {
                    runs.entry(run.id)
                        .and_modify(|attempt: &mut u64| *attempt = (*attempt).max(run.run_attempt))
                        .or_insert(run.run_attempt);
                }
                if count < PAGE_SIZE {
                    break;
                }
                if page == 10 {
                    return Err(ApiError::new(
                        "list_runs",
                        ErrorCategory::PaginationSaturated,
                    ));
                }
            }
        }
        let mut jobs = BTreeMap::new();
        for (run_id, attempt) in runs {
            #[derive(Deserialize)]
            struct Jobs {
                jobs: Vec<GithubJob>,
            }
            if attempt == 0 {
                return Err(ApiError::new("list_jobs", ErrorCategory::InvalidResponse));
            }
            for page in 1..=MAX_PAGES {
                let response: Jobs = self.request(Method::GET, &format!("{}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page={PAGE_SIZE}&page={page}", repo.path()), &token, None, "list_jobs", false).await?;
                let count = response.jobs.len();
                for mut job in response.jobs {
                    if job.run_id != run_id || (job.run_attempt != 0 && job.run_attempt != attempt)
                    {
                        return Err(ApiError::new("list_jobs", ErrorCategory::InvalidResponse));
                    }
                    job.run_attempt = attempt;
                    jobs.insert(job.id, job);
                }
                if count < PAGE_SIZE {
                    break;
                }
                if page == MAX_PAGES {
                    return Err(ApiError::new(
                        "list_jobs",
                        ErrorCategory::PaginationSaturated,
                    ));
                }
            }
        }
        let mut jobs: Vec<_> = jobs.into_values().collect();
        for job in &mut jobs {
            if crate::config::Platform::resolve(&job.labels)
                == Some(crate::config::Platform::LinuxOperationsArm64)
            {
                job.operations_authorized = self.authorize_operations(repo, job).await?;
            }
        }
        Ok(jobs)
    }
    /// This checks setting drift; it does not replace the explicit workflow and existing-run trust audit.
    pub async fn settings_preflight(
        &mut self,
        repo: &Repository,
    ) -> Result<RepositorySettings, ApiError> {
        let token = Zeroizing::new(self.token(repo).await?);
        let settings: RepositorySettings = self
            .request(
                Method::GET,
                &repo.path(),
                &token,
                None,
                "repository_settings",
                false,
            )
            .await?;
        if !settings.allows_admission(repo.repository_id) {
            return Err(ApiError::new(
                "repository_settings",
                ErrorCategory::Rejected,
            ));
        }
        Ok(settings)
    }
    pub async fn get_job(&mut self, repo: &Repository, job_id: u64) -> Result<GithubJob, ApiError> {
        let token = Zeroizing::new(self.token(repo).await?);
        let mut job: GithubJob = self
            .request(
                Method::GET,
                &format!("{}/actions/jobs/{job_id}", repo.path()),
                &token,
                None,
                "get_job",
                false,
            )
            .await?;
        if job.id != job_id || job.run_id == 0 || job.run_attempt == 0 {
            return Err(ApiError::new("get_job", ErrorCategory::InvalidResponse));
        }
        if crate::config::Platform::resolve(&job.labels)
            == Some(crate::config::Platform::LinuxOperationsArm64)
        {
            job.operations_authorized = self.authorize_operations(repo, &job).await?;
        }
        Ok(job)
    }

    async fn authorize_operations(
        &mut self,
        repo: &Repository,
        job: &GithubJob,
    ) -> Result<bool, ApiError> {
        let token = Zeroizing::new(self.token(repo).await?);
        let prefix = format!(
            "{}/actions/runs/{}/attempts/{}",
            repo.path(),
            job.run_id,
            job.run_attempt
        );
        let run: serde_json::Value = self
            .request(Method::GET, &prefix, &token, None, "operations_run", false)
            .await?;
        #[derive(Deserialize)]
        struct Jobs {
            jobs: Vec<GithubJob>,
        }
        let mut jobs = Vec::new();
        for page in 1..=MAX_PAGES {
            let batch: Jobs = self
                .request(
                    Method::GET,
                    &format!("{prefix}/jobs?per_page={PAGE_SIZE}&page={page}"),
                    &token,
                    None,
                    "operations_source",
                    false,
                )
                .await?;
            let count = batch.jobs.len();
            jobs.extend(batch.jobs);
            if count < PAGE_SIZE {
                return Ok(crate::operations::authorized(
                    &format!("{}/{}", repo.owner, repo.name),
                    &run,
                    job,
                    &jobs,
                ));
            }
        }
        Err(ApiError::new(
            "operations_source",
            ErrorCategory::PaginationSaturated,
        ))
    }
    /// Never automatically retry this mutation: an uncertain response must be reconciled by exact unique name.
    pub async fn create_jit(
        &mut self,
        repo: &Repository,
        name: &str,
        runner_group_id: u64,
    ) -> Result<JitRegistration, ApiError> {
        self.create_jit_for_profile(
            repo,
            name,
            runner_group_id,
            crate::config::Platform::MacosArm64,
        )
        .await
    }
    pub async fn create_jit_for_profile(
        &mut self,
        repo: &Repository,
        name: &str,
        runner_group_id: u64,
        platform: crate::config::Platform,
    ) -> Result<JitRegistration, ApiError> {
        if name.is_empty()
            || name.len() > 64
            || !name.bytes().all(|v| v.is_ascii_alphanumeric() || v == b'-')
            || runner_group_id == 0
        {
            return Err(ApiError::new("create_jit", ErrorCategory::Configuration));
        }
        #[derive(Deserialize)]
        struct JitResponse {
            runner: Runner,
            encoded_jit_config: String,
        }
        let token = Zeroizing::new(self.token(repo).await?);
        let response: JitResponse = self.request(Method::POST, &format!("{}/actions/runners/generate-jitconfig", repo.path()), &token, Some(serde_json::json!({"name": name, "runner_group_id": runner_group_id, "labels": platform.labels(), "work_folder": "_work"})), "create_jit", true).await?;
        if response.runner.name != name
            || response.runner.id == 0
            || response.encoded_jit_config.is_empty()
            || response.encoded_jit_config.len() > crate::guest::MAX_JIT_BYTES
        {
            return Err(ApiError::new("create_jit", ErrorCategory::Uncertain));
        }
        Ok(JitRegistration {
            runner: response.runner,
            config: JitConfig(Zeroizing::new(response.encoded_jit_config)),
        })
    }
    pub async fn list_runners(&mut self, repo: &Repository) -> Result<Vec<Runner>, ApiError> {
        #[derive(Deserialize)]
        struct Runners {
            runners: Vec<Runner>,
        }
        let token = Zeroizing::new(self.token(repo).await?);
        let mut runners = Vec::new();
        for page in 1..=MAX_PAGES {
            let response: Runners = self
                .request(
                    Method::GET,
                    &format!(
                        "{}/actions/runners?per_page={PAGE_SIZE}&page={page}",
                        repo.path()
                    ),
                    &token,
                    None,
                    "list_runners",
                    false,
                )
                .await?;
            let count = response.runners.len();
            runners.extend(response.runners);
            if count < PAGE_SIZE {
                return Ok(runners);
            }
        }
        Err(ApiError::new(
            "list_runners",
            ErrorCategory::PaginationSaturated,
        ))
    }
    /// Reconcile a lost JIT response without creating a second registration.
    pub async fn find_runner_by_name(
        &mut self,
        repo: &Repository,
        name: &str,
    ) -> Result<Option<Runner>, ApiError> {
        let mut matches = self
            .list_runners(repo)
            .await?
            .into_iter()
            .filter(|runner| runner.name == name);
        let result = matches.next();
        if matches.next().is_some() {
            return Err(ApiError::new("find_runner", ErrorCategory::Uncertain));
        }
        Ok(result)
    }
    /// The caller must establish ownership using the durable exact name/ID before calling this method.
    pub async fn delete_runner(&mut self, repo: &Repository, id: u64) -> Result<(), ApiError> {
        let token = Zeroizing::new(self.token(repo).await?);
        let result: Result<serde_json::Value, _> = self
            .request(
                Method::DELETE,
                &format!("{}/actions/runners/{id}", repo.path()),
                &token,
                None,
                "delete_runner",
                true,
            )
            .await;
        match result {
            Ok(_) => Ok(()),
            Err(error) if error.category == ErrorCategory::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    struct Reply {
        path: String,
        status: u16,
        headers: &'static str,
        body: serde_json::Value,
    }
    fn reply(path: &str, body: serde_json::Value) -> Reply {
        Reply {
            path: path.into(),
            status: 200,
            headers: "",
            body,
        }
    }
    fn repo() -> Repository {
        Repository {
            owner: "allowed".into(),
            name: "repo".into(),
            repository_id: 20,
            installation_id: 10,
        }
    }
    fn job(id: u64) -> serde_json::Value {
        serde_json::json!({"id":id,"run_id":7,"run_attempt":3,"status":"queued","labels":["SELF-HOSTED","macOS","ARM64","homelab-tart"],"created_at":"2026-11-01T00:00:00Z","runner_id":null,"runner_name":null})
    }
    fn fixture(replies: Vec<Reply>) -> (GithubApi, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for reply in replies {
                let deadline = std::time::Instant::now() + Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                && std::time::Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(2))
                        }
                        Err(e) => panic!("fixture accept failed: {e}"),
                    }
                };
                // Darwin may inherit O_NONBLOCK from the listening socket. The
                // fixture's body reader uses blocking reads with a real timeout.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut data = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let n = stream.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    data.extend_from_slice(&buffer[..n]);
                    if let Some(end) = data.windows(4).position(|v| v == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        let length = headers
                            .lines()
                            .find_map(|v| {
                                v.strip_prefix("content-length:")
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if data.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8(data).unwrap();
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains(&format!("x-github-api-version: {API_VERSION}"))
                );
                assert!(
                    request.lines().next().unwrap().contains(&reply.path),
                    "unexpected fixture request path"
                );
                requests.push(request);
                let body = reply.body.to_string();
                write!(stream, "HTTP/1.1 {} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}", reply.status, body.len(), reply.headers, body).unwrap();
            }
            requests
        });
        let mut api = GithubApi::new(AppCredentials {
            app_id: "test-app".into(),
            private_key_path: "/must-not-be-read".into(),
        })
        .unwrap();
        api.base_url = format!("http://{address}");
        api.client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        api.tokens.insert(
            (10, 20),
            CachedToken {
                value: Zeroizing::new("fixture-only-token".into()),
                expires_at: now() + 3600,
            },
        );
        (api, handle)
    }
    #[test]
    fn labels_are_case_insensitive_and_never_create_arbitrary_profiles() {
        let mut candidate: GithubJob = serde_json::from_value(job(9)).unwrap();
        assert!(candidate.supported_profile());
        candidate.labels = vec!["homelab-tart".into()];
        assert!(candidate.supported_profile());
        candidate.labels.push("Xcode-999".into());
        assert!(!candidate.supported_profile());
        candidate.labels = vec!["macOS".into(), "ARM64".into()];
        assert!(!candidate.supported_profile());
        candidate.labels.push("homelab-tart".into());
        candidate.runner_group_name = Some("privileged".into());
        assert!(!candidate.supported_profile());
    }
    #[tokio::test]
    async fn discovers_all_active_states_and_current_attempt_with_job_pagination() {
        let mut replies = Vec::new();
        for state in ACTIVE_STATUSES {
            replies.push(reply(
                &format!("status={state}&per_page=100&page=1"),
                if state == "in_progress" {
                    serde_json::json!({"total_count":1,"workflow_runs":[{"id":7,"run_attempt":3}]})
                } else {
                    serde_json::json!({"total_count":0,"workflow_runs":[]})
                },
            ));
        }
        replies.push(reply(
            "/runs/7/attempts/3/jobs?per_page=100&page=1",
            serde_json::json!({"jobs": (1..=100).map(job).collect::<Vec<_>>()}),
        ));
        let mut assigned = job(101);
        assigned["status"] = "in_progress".into();
        assigned["runner_id"] = 555.into();
        replies.push(reply(
            "/runs/7/attempts/3/jobs?per_page=100&page=2",
            serde_json::json!({"jobs":[assigned]}),
        ));
        let (mut api, handle) = fixture(replies);
        let jobs = api.discover_jobs(&repo()).await.unwrap();
        assert_eq!(jobs.len(), 101);
        assert_eq!(jobs[100].runner_id, Some(555));
        assert_eq!(jobs[0].run_attempt, 3);
        assert_eq!(handle.join().unwrap().len(), 7);
    }
    #[tokio::test]
    async fn refuses_saturated_run_search_and_never_returns_partial_demand() {
        let (mut api, handle) = fixture(vec![reply(
            "status=queued",
            serde_json::json!({"total_count":1000,"workflow_runs":[]}),
        )]);
        assert_eq!(
            api.discover_jobs(&repo()).await.unwrap_err().category,
            ErrorCategory::PaginationSaturated
        );
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn paginates_runs_and_deduplicates_overlapping_status_observations() {
        let runs = (1..=100)
            .map(|_| serde_json::json!({"id":7,"run_attempt":2}))
            .collect::<Vec<_>>();
        let mut replies = vec![
            reply(
                "status=queued&per_page=100&page=1",
                serde_json::json!({"total_count":101,"workflow_runs":runs}),
            ),
            reply(
                "status=queued&per_page=100&page=2",
                serde_json::json!({"total_count":101,"workflow_runs":[{"id":7,"run_attempt":3}]}),
            ),
        ];
        for state in &ACTIVE_STATUSES[1..] {
            replies.push(reply(
                &format!("status={state}"),
                serde_json::json!({"total_count":0,"workflow_runs":[]}),
            ));
        }
        replies.push(reply(
            "/attempts/3/jobs",
            serde_json::json!({"jobs":[job(1)]}),
        ));
        let (mut api, handle) = fixture(replies);
        assert_eq!(api.discover_jobs(&repo()).await.unwrap().len(), 1);
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn jit_uses_only_approved_labels_and_redacts_credential() {
        let runner =
            serde_json::json!({"id":30,"name":"owned-attempt","status":"offline","busy":false});
        let (mut api, handle) = fixture(vec![reply(
            "/generate-jitconfig",
            serde_json::json!({"runner":runner,"encoded_jit_config":"SECRET_JIT_FIXTURE"}),
        )]);
        let registration = api.create_jit(&repo(), "owned-attempt", 42).await.unwrap();
        assert_eq!(registration.config.as_bytes(), b"SECRET_JIT_FIXTURE");
        assert!(!format!("{registration:?}").contains("SECRET_JIT_FIXTURE"));
        let request = handle.join().unwrap().pop().unwrap();
        let body: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body["runner_group_id"], 42);
        assert_eq!(body["labels"], serde_json::json!(LABELS));
    }
    #[tokio::test]
    async fn linux_jit_never_advertises_macos_or_the_legacy_routing_label() {
        let runner =
            serde_json::json!({"id":31,"name":"linux-attempt","status":"offline","busy":false});
        let (mut api, handle) = fixture(vec![reply(
            "/generate-jitconfig",
            serde_json::json!({"runner":runner,"encoded_jit_config":"SECRET_JIT_FIXTURE"}),
        )]);
        api.create_jit_for_profile(
            &repo(),
            "linux-attempt",
            42,
            crate::config::Platform::LinuxArm64,
        )
        .await
        .unwrap();
        let request = handle.join().unwrap().pop().unwrap();
        let body: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            body["labels"],
            serde_json::json!(["self-hosted", "Linux", "ARM64", "homelab-linux"])
        );
    }

    #[tokio::test]
    async fn operations_get_job_derives_trust_from_its_exact_run_and_source_check() {
        let source = "a".repeat(40);
        let mut candidate = job(9);
        candidate["name"] = serde_json::json!("Cloudflare apply");
        candidate["head_sha"] = serde_json::json!(source);
        candidate["labels"] =
            serde_json::json!(["self-hosted", "Linux", "ARM64", "homelab-operations"]);
        let mut prerequisite = job(8);
        prerequisite["name"] = serde_json::json!("Cloudflare source");
        prerequisite["head_sha"] = serde_json::json!(source);
        prerequisite["status"] = serde_json::json!("completed");
        prerequisite["conclusion"] = serde_json::json!("success");
        prerequisite["labels"] =
            serde_json::json!(["self-hosted", "Linux", "ARM64", "homelab-linux"]);
        let run = serde_json::json!({"id":7,"run_attempt":3,"head_sha":source,"head_branch":"main",
            "head_repository":{"full_name":"allowed/repo"},"event":"workflow_run",
            "path":".github/workflows/cloudflare.yml"});
        let (mut api, handle) = fixture(vec![
            reply("GET /repos/allowed/repo/actions/jobs/9 HTTP", candidate),
            reply(
                "GET /repos/allowed/repo/actions/runs/7/attempts/3 HTTP",
                run,
            ),
            reply(
                "GET /repos/allowed/repo/actions/runs/7/attempts/3/jobs?",
                serde_json::json!({"jobs":[prerequisite]}),
            ),
        ]);
        let observed = api.get_job(&repo(), 9).await.unwrap();
        assert!(observed.supported_profile());
        assert_eq!(
            crate::config::Platform::resolve(&observed.labels),
            Some(crate::config::Platform::LinuxOperationsArm64)
        );
        assert_eq!(handle.join().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn operations_registration_has_no_build_or_macos_routing_label() {
        let runner = serde_json::json!({"id":31,"name":"operations-attempt","status":"offline","busy":false});
        let (mut api, handle) = fixture(vec![reply(
            "/generate-jitconfig",
            serde_json::json!({"runner":runner,"encoded_jit_config":"SECRET_JIT_FIXTURE"}),
        )]);
        api.create_jit_for_profile(
            &repo(),
            "operations-attempt",
            42,
            crate::config::Platform::LinuxOperationsArm64,
        )
        .await
        .unwrap();
        let request = handle.join().unwrap().pop().unwrap();
        let body: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            body["labels"],
            serde_json::json!(["self-hosted", "Linux", "ARM64", "homelab-operations"])
        );
    }
    #[tokio::test]
    async fn lost_or_invalid_successful_jit_response_requires_reconciliation() {
        let (mut api, handle) = fixture(vec![reply(
            "/generate-jitconfig",
            serde_json::json!({"raw":"SECRET"}),
        )]);
        let error = api
            .create_jit(&repo(), "owned-attempt", 42)
            .await
            .unwrap_err();
        assert_eq!(error.category, ErrorCategory::Uncertain);
        assert!(!format!("{error:?}").contains("SECRET"));
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn jit_larger_than_guest_input_limit_requires_cleanup() {
        let (mut api, handle) = fixture(vec![reply(
            "/generate-jitconfig",
            serde_json::json!({"runner":{"id":30,"name":"owned-attempt","status":"offline","busy":false},"encoded_jit_config":"a".repeat(crate::guest::MAX_JIT_BYTES+1)}),
        )]);
        assert_eq!(
            api.create_jit(&repo(), "owned-attempt", 42)
                .await
                .unwrap_err()
                .category,
            ErrorCategory::Uncertain
        );
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn rate_limit_headers_block_followup_without_parsing_secret_body() {
        let (mut api, handle) = fixture(vec![Reply {
            path: "/jobs/1".into(),
            status: 429,
            headers: "Retry-After: 90\r\n",
            body: serde_json::json!({"message":"SECRET_RESPONSE"}),
        }]);
        let error = api.get_job(&repo(), 1).await.unwrap_err();
        assert_eq!(error.category, ErrorCategory::RateLimited);
        assert_eq!(error.retry_after_seconds, Some(90));
        assert!(!format!("{error:?}").contains("SECRET_RESPONSE"));
        assert_eq!(
            api.get_job(&repo(), 2).await.unwrap_err().category,
            ErrorCategory::RateLimited
        );
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn busy_runner_delete_rejection_is_not_absence_and_can_be_retried() {
        let (mut api, handle) = fixture(vec![
            Reply {
                path: "DELETE /repos/allowed/repo/actions/runners/30".into(),
                status: 422,
                headers: "",
                body: serde_json::json!({"message":"Runner is currently running a job."}),
            },
            Reply {
                path: "DELETE /repos/allowed/repo/actions/runners/30".into(),
                status: 204,
                headers: "",
                body: serde_json::Value::Null,
            },
        ]);
        assert_eq!(
            api.delete_runner(&repo(), 30).await.unwrap_err().category,
            ErrorCategory::Rejected
        );
        api.delete_runner(&repo(), 30).await.unwrap();
        assert_eq!(handle.join().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn delete_is_idempotent_on_not_found() {
        let (mut api, handle) = fixture(vec![Reply {
            path: "DELETE /repos/allowed/repo/actions/runners/30".into(),
            status: 404,
            headers: "",
            body: serde_json::json!({"message":"Not Found"}),
        }]);
        api.delete_runner(&repo(), 30).await.unwrap();
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn lists_every_runner_page_and_reconciles_only_exact_names() {
        let runners=(1..=100).map(|id|serde_json::json!({"id":id,"name":format!("unrelated-{id}"),"status":"online","busy":false})).collect::<Vec<_>>();
        let (mut api, handle) = fixture(vec![
            reply(
                "/runners?per_page=100&page=1",
                serde_json::json!({"runners":runners}),
            ),
            reply(
                "/runners?per_page=100&page=2",
                serde_json::json!({"runners":[{"id":101,"name":"owned-attempt","status":"offline","busy":false}]}),
            ),
        ]);
        let runner = api
            .find_runner_by_name(&repo(), "owned-attempt")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(runner.id, 101);
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn duplicate_names_are_uncertain_instead_of_selecting_arbitrary_runner() {
        let (mut api, handle) = fixture(vec![reply(
            "/runners?",
            serde_json::json!({"runners":[{"id":1,"name":"owned","status":"offline","busy":false},{"id":2,"name":"owned","status":"offline","busy":false}]}),
        )]);
        assert_eq!(
            api.find_runner_by_name(&repo(), "owned")
                .await
                .unwrap_err()
                .category,
            ErrorCategory::Uncertain
        );
        handle.join().unwrap();
    }
    #[tokio::test]
    async fn settings_preflight_accepts_collaborators_private_or_disabled_pull_requests() {
        for body in [
            serde_json::json!({"id":20,"private":false,"has_pull_requests":true,"pull_request_creation_policy":"collaborators_only"}),
            serde_json::json!({"id":20,"private":true}),
            serde_json::json!({"id":20,"private":false,"has_pull_requests":false}),
        ] {
            let (mut api, handle) = fixture(vec![reply("GET /repos/allowed/repo HTTP/1.1", body)]);
            assert!(api.settings_preflight(&repo()).await.is_ok());
            handle.join().unwrap();
        }
    }
    #[tokio::test]
    async fn settings_preflight_rejects_identity_mismatch_open_unknown_or_missing_policy() {
        for body in [
            serde_json::json!({"id":21,"private":true}),
            serde_json::json!({"id":20,"private":false,"has_pull_requests":true,"pull_request_creation_policy":"all"}),
            serde_json::json!({"id":20,"private":false,"has_pull_requests":true,"pull_request_creation_policy":"future-policy"}),
            serde_json::json!({"id":20,"private":false,"has_pull_requests":true}),
            serde_json::json!({"id":20,"private":false,"pull_request_creation_policy":"collaborators_only"}),
            serde_json::json!({"id":20}),
        ] {
            let (mut api, handle) = fixture(vec![reply("GET /repos/allowed/repo HTTP/1.1", body)]);
            let category = api.settings_preflight(&repo()).await.unwrap_err().category;
            assert!(matches!(
                category,
                ErrorCategory::Rejected | ErrorCategory::InvalidResponse
            ));
            handle.join().unwrap();
        }
    }
    #[tokio::test]
    async fn settings_read_failure_is_sanitized_and_never_allows_admission() {
        let (mut api, handle) = fixture(vec![Reply {
            path: "GET /repos/allowed/repo HTTP/1.1".into(),
            status: 403,
            headers: "",
            body: serde_json::json!({"message":"PRIVATE_SETTINGS_SENTINEL"}),
        }]);
        let error = api.settings_preflight(&repo()).await.unwrap_err();
        assert_eq!(error.operation, "repository_settings");
        assert!(!format!("{error:?}").contains("PRIVATE_SETTINGS_SENTINEL"));
        handle.join().unwrap();
    }
    #[test]
    fn invalid_repository_and_sensitive_debug_are_safe() {
        let mut repo = repo();
        repo.owner = "../outside".into();
        assert!(repo.validate().is_err());
        assert_eq!(
            format!(
                "{:?}",
                AppCredentials {
                    app_id: "private".into(),
                    private_key_path: "secret-location".into()
                }
            ),
            "AppCredentials([REDACTED])"
        );
    }
}

#[cfg(test)]
mod authentication_tests {
    use super::*;
    // Public fixture key, used only for local tests. Never an account credential.
    const TEST_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCsStHpSoP5REUN
QbOYxs42H5/raxOLJQDI9PIFb8eEz8i9YKkRKGUyMwaIiSLFKiAkcwfARY/5N6bJ
aDUqgzLRz1rvT/E559mOu+OSh6H6BF9Q5/mdzchEjgXZmwGQrbL2/Ul9DohwZpVV
JhIQalOTnjl+OI6p+2m7BuKhVwpoAx/j89Le36KnT/5dvBW9DOxK1XWbzbaNKmg1
K6AqjUwZHArrd4Zmhby3k117HL4iEHdy+U0o+gQQFaSvwH2W7Yt+N+Wfawjd86pD
+cWvSJe1iJ9ex+9DJMs04snBZNsWo04WiA5yyk63jDRy/iHzCNFN/aiRvzVIYccO
/o+rxduNAgMBAAECggEACGB6kcZGIeUO8Bd7xl0TfXVZVr57R1vlIfV/h0JOzVc2
mkyRk8xmv9jUGRMv2K2/vSicSHMpY54wKAvpb9fMAqr7WnYvfe0BpStfTnUf6+fG
rvNEbfF+1U8hcNnU6uZNygKjziaE0uWN86347rQ4vDfocYm0QrFUYUadrLyuZxhR
XjMvIhIzersqyaoGw+HkKKRYo6+P4aJMVc/B2ilBomKYcNAi68ULZKhOUv7nO0Hs
wA5aOlxwo1JjreHYZvx6Eng3J72Fn8JJJc42YpWJX24tF5jlXoYDTtOwY8X4fWtW
gAogywwVPiHfuzs5rkmRFC/QfWH96DEMYiqrukRqWQKBgQDXMgx2VrfDG16BwZDW
hxa9MIZzqEnLYpJJxwzpJ5+lQBlgqFiqgsVwJulXX/t1I6y2JDXoq8bE0e65s8No
ZR5Tq9l3FUpfEvuK8fVZOqdOk8rRGvFuRziP2jLTosQgVJTvNz8rcGwjMSvTXA35
g4QTt3Fnxe9YPm6hy4PEWVBjxQKBgQDM9i0SGifJ8LuVRl95aWvAyreP8CNgdIpX
xX14fho8xB3eKcRKAuLW3o1bYkKrLXhoqNnMWlUCq+AmmHv409+rfYhMresuL4li
7T2eK2fMZfeVHtylW7ZPThnQOn2Zbpoyfl6nDCA3mVPdG4w9qHQnei7DG1nfa8TB
h5rAbW9tKQKBgQCU3gmi/+CF93QMfXSOA8vmOyB3+C58pYcfxLSYwpF9RveHV05n
PqoJKNH5YOvaoEBFjI1ClTqfQ79K9iGzIWi2Z0a8S500YjRjbXjWLm45PKJsv5/P
MzPcyAyrPYlB+GFDj0uC6HXWbpir0Z3VQ3bmENxB9rrZp+7uvJQ+C69CJQKBgQCv
SEztMT8b3Wue0qst2vFS1Eq9pyGqCKCTRYrzM+zeUN42M8Pxg5xZI8UCBPt9Bwr1
fomc0Rfoi/LLLxa+ivu63kVlRktdmTvGRZuvm/FOBVoBxn3uUIuOMP20bYEiaUsn
qZjrBVy8D71/12JNDLYhWMWLB+YJQ1HmLEE1FaH4WQKBgEI79DgWxS3P/BSmBFGO
rDdL+Lg5yV68Mxr0yqcIKG1wZfZcAPoNdUCsfzmVq1lrkMB3HERcaL/QMsLUnLtQ
MWZRDfO8EXpp/XI87ckc9Rcf0SSeRbdM6XZE7qdz3WW1YcF9FZlgIAHuecFxsDbf
cDGiuouJQ+EGeqlLO9yK8pHf
-----END PRIVATE KEY-----
"#;
    const TEST_PUBLIC_KEY: &str = r#"-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArErR6UqD+URFDUGzmMbO
Nh+f62sTiyUAyPTyBW/HhM/IvWCpEShlMjMGiIkixSogJHMHwEWP+TemyWg1KoMy
0c9a70/xOefZjrvjkoeh+gRfUOf5nc3IRI4F2ZsBkK2y9v1JfQ6IcGaVVSYSEGpT
k545fjiOqftpuwbioVcKaAMf4/PS3t+ip0/+XbwVvQzsStV1m822jSpoNSugKo1M
GRwK63eGZoW8t5Ndexy+IhB3cvlNKPoEEBWkr8B9lu2Lfjfln2sI3fOqQ/nFr0iX
tYifXsfvQyTLNOLJwWTbFqNOFogOcspOt4w0cv4h8wjRTf2okb81SGHHDv6Pq8Xb
jQIDAQAB
-----END PUBLIC KEY-----
"#;
    #[tokio::test]
    async fn signs_app_jwt_and_mints_repository_restricted_short_lived_token_once() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let expires = chrono::DateTime::from_timestamp((now() + 3500) as i64, 0)
            .unwrap()
            .to_rfc3339();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut data = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = stream.read(&mut buffer).unwrap();
                assert!(n > 0);
                data.extend_from_slice(&buffer[..n]);
                if let Some(end) = data.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&data[..end]).to_lowercase();
                    let length = headers
                        .lines()
                        .find_map(|v| {
                            v.strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if data.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8(data).unwrap();
            let body =
                serde_json::json!({"token":"fixture-installation-token","expires_at":expires})
                    .to_string();
            write!(stream,"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",body.len(),body).unwrap();
            request
        });
        let directory = tempfile::tempdir().unwrap();
        let key_path = directory.path().join("fixture.pem");
        std::fs::write(&key_path, TEST_KEY).unwrap();
        let mut api = GithubApi::new(AppCredentials {
            app_id: "1234".into(),
            private_key_path: key_path,
        })
        .unwrap();
        api.base_url = format!("http://{address}");
        api.client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let repo = Repository {
            owner: "allowed".into(),
            name: "repo".into(),
            repository_id: 20,
            installation_id: 10,
        };
        assert_eq!(
            api.token(&repo).await.unwrap(),
            "fixture-installation-token"
        );
        // Removing the key proves a fresh PEM read / mint is not performed for every request.
        std::fs::remove_file(&api.credentials.private_key_path).unwrap();
        assert_eq!(
            api.token(&repo).await.unwrap(),
            "fixture-installation-token"
        );
        let request = handle.join().unwrap();
        assert!(request.starts_with("POST /app/installations/10/access_tokens "));
        assert!(
            request
                .to_ascii_lowercase()
                .contains(&format!("x-github-api-version: {API_VERSION}"))
        );
        let body: serde_json::Value =
            serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"repository_ids":[20],"permissions":{"actions":"read","administration":"write"}})
        );
        let jwt = request
            .lines()
            .find_map(|line| line.strip_prefix("authorization: Bearer "))
            .unwrap();
        let header = jsonwebtoken::decode_header(jwt).unwrap();
        assert_eq!(header.alg, Algorithm::RS256);
        let key = jsonwebtoken::DecodingKey::from_rsa_pem(TEST_PUBLIC_KEY.as_bytes()).unwrap();
        let validation = jsonwebtoken::Validation::new(Algorithm::RS256);
        let claims = jsonwebtoken::decode::<serde_json::Value>(jwt, &key, &validation)
            .unwrap()
            .claims;
        assert_eq!(claims["iss"], "1234");
        assert!(claims["exp"].as_u64().unwrap() <= now() + 540);
        assert!(claims["iat"].as_u64().unwrap() <= now());
    }
}
