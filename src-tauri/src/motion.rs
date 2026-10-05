//! Animated ("motion") album artwork from the Apple Music catalog.
//!
//! Finds the catalog album matching a Navidrome album and returns the HLS URL of
//! its `editorialVideo`, if Apple exposes one to the token in use. Tokens come from:
//!
//! - a MusicKit key (Team ID + Key ID + .p8), signed here as a developer token;
//! - a pasted token (a developer token, or one copied from music.apple.com); or
//! - automatic mode: the token embedded in Apple's web player (music.apple.com) is
//!   fetched, saved to the app data folder, and fetched again when it expires or is
//!   rejected.
//!
//! Web-player tokens only work against the web player's API host and with its origin.

use crate::proxy::client;
use base64::Engine;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DEVELOPER_API: &str = "https://api.music.apple.com/v1";
const WEB_PLAYER_API: &str = "https://amp-api.music.apple.com/v1";
const WEB_PLAYER_ORIGIN: &str = "https://music.apple.com";
const WEB_PLAYER_PAGE: &str = "https://music.apple.com/us/browse";
const WEB_PLAYER_ISSUER: &str = "AMPWebPlay";
const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TOKEN_FILE: &str = "apple-web-token.txt";
/// Refresh a saved web token this long before it expires.
const REFRESH_MARGIN: u64 = 24 * 60 * 60;
const VIDEO_KEYS: &[&str] = &[
    "motionDetailSquare",
    "motionSquareVideo1x1",
    "motionDetailTall",
    "motionTallVideo3x4",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionConfig {
    #[serde(default)]
    team_id: String,
    #[serde(default)]
    key_id: String,
    #[serde(default)]
    private_key: String,
    /// A ready-made token; takes precedence over the key fields.
    #[serde(default)]
    token: String,
    #[serde(default)]
    storefront: String,
    /// Use (and keep refreshing) the music.apple.com web-player token.
    #[serde(default)]
    auto_refresh: bool,
}

impl MotionConfig {
    fn storefront(&self) -> &str {
        let s = self.storefront.trim();
        if s.is_empty() {
            "us"
        } else {
            s
        }
    }
}

#[derive(Default)]
pub struct MotionState {
    /// Signed developer token: (cache key, token, expiry unix secs).
    signed: Mutex<Option<(String, String, u64)>>,
    /// Automatically fetched web-player token. Async lock so concurrent lookups
    /// wait for one refresh instead of each scraping the site.
    web: tokio::sync::Mutex<Option<String>>,
}

enum ApiError {
    /// Apple refused the token (401/403).
    Auth(String),
    Other(String),
}

impl From<ApiError> for String {
    fn from(e: ApiError) -> Self {
        match e {
            ApiError::Auth(m) | ApiError::Other(m) => m,
        }
    }
}

#[derive(Serialize)]
struct Claims<'a> {
    iss: &'a str,
    iat: u64,
    exp: u64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn normalize_pem(key: &str) -> String {
    let key = key.trim();
    if key.contains("-----BEGIN") {
        return key.to_string();
    }
    let body: String = key.chars().filter(|c| !c.is_whitespace()).collect();
    let wrapped: Vec<String> = body
        .as_bytes()
        .chunks(64)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect();
    format!(
        "-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\n",
        wrapped.join("\n")
    )
}

/// Decodes a JWT's claims without verifying it (we only need to read them).
fn claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn expires_at(token: &str) -> Option<u64> {
    claims(token)?["exp"].as_u64()
}

/// Apple's web-player tokens are issued by "AMPWebPlay" and pinned to apple.com origins.
fn is_web_player_token(token: &str) -> bool {
    claims(token).is_some_and(|c| {
        c["iss"].as_str() == Some(WEB_PLAYER_ISSUER) || c.get("root_https_origin").is_some()
    })
}

/// Where and how to send catalog requests for a given token.
struct Api {
    token: String,
    base: &'static str,
    origin: Option<&'static str>,
    /// The token is managed automatically and can be refreshed on rejection.
    auto: bool,
}

impl Api {
    fn for_token(token: String, auto: bool) -> Self {
        if is_web_player_token(&token) {
            Api { token, base: WEB_PLAYER_API, origin: Some(WEB_PLAYER_ORIGIN), auto }
        } else {
            Api { token, base: DEVELOPER_API, origin: None, auto }
        }
    }

    fn is_web_player(&self) -> bool {
        self.origin.is_some()
    }
}

// ---- web-player token: storage and scraping ----------------------------------

fn token_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(TOKEN_FILE))
}

fn load_saved_token(app: &AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(token_path(app)?).ok()?;
    let token = text.trim();
    is_web_player_token(token).then(|| token.to_string())
}

fn save_token(app: &AppHandle, token: &str) {
    if let Some(path) = token_path(app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, token);
    }
}

async fn fetch_text(url: &str) -> Result<String, String> {
    client()
        .get(url)
        .header(reqwest::header::USER_AGENT, BROWSER_UA)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't load music.apple.com: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Couldn't load music.apple.com: {e}"))
}

/// Script URLs referenced by the page, entry ("index") modules first.
fn script_sources(html: &str) -> Vec<String> {
    let mut out: Vec<String> = html
        .split("src=\"")
        .skip(1)
        .filter_map(|part| part.split('"').next())
        .filter(|src| src.contains("/assets/") && src.ends_with(".js"))
        .map(str::to_string)
        .collect();
    out.sort_by_key(|s| (s.contains("legacy"), !s.contains("index")));
    out.dedup();
    out
}

/// Finds the web-player JWT in a script, preferring the one issued by "AMPWebPlay".
fn find_web_token(text: &str) -> Option<String> {
    let mut fallback = None;
    let mut i = 0;
    while let Some(pos) = text[i..].find("eyJ") {
        let start = i + pos;
        let end = text[start..]
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
            .map_or(text.len(), |e| start + e);
        i = end.max(start + 3);
        let candidate = &text[start..end];
        if candidate.split('.').count() != 3 {
            continue;
        }
        let Some(c) = claims(candidate) else { continue };
        if c["iss"].as_str() == Some(WEB_PLAYER_ISSUER) {
            return Some(candidate.to_string());
        }
        if fallback.is_none() && c.get("root_https_origin").is_some() {
            fallback = Some(candidate.to_string());
        }
    }
    fallback
}

async fn scrape_web_token() -> Result<String, String> {
    let html = fetch_text(WEB_PLAYER_PAGE).await?;
    for src in script_sources(&html).iter().take(6) {
        let url = if src.starts_with("http") {
            src.clone()
        } else {
            format!("{WEB_PLAYER_ORIGIN}{src}")
        };
        if let Ok(js) = fetch_text(&url).await {
            if let Some(token) = find_web_token(&js) {
                return Ok(token);
            }
        }
    }
    Err("Couldn't find a token on music.apple.com — Apple may have changed their site. \
         Paste one manually for now."
        .into())
}

impl MotionState {
    async fn api(&self, app: &AppHandle, cfg: &MotionConfig) -> Result<Api, String> {
        if cfg.auto_refresh {
            Ok(Api::for_token(self.web_token(app, None).await?, true))
        } else {
            self.manual_token(cfg).map(|t| Api::for_token(t, false))
        }
    }

    /// Replaces an automatic token Apple just refused.
    async fn refreshed(&self, app: &AppHandle, rejected: &Api) -> Result<Api, String> {
        Ok(Api::for_token(self.web_token(app, Some(&rejected.token)).await?, true))
    }

    /// The automatic web-player token: the saved one while it's valid, otherwise a
    /// freshly scraped one. `rejected` forces a refresh unless another request has
    /// already replaced that token.
    async fn web_token(&self, app: &AppHandle, rejected: Option<&str>) -> Result<String, String> {
        let mut slot = self.web.lock().await;
        if slot.is_none() {
            *slot = load_saved_token(app);
        }
        if let Some(current) = slot.as_deref() {
            let fresh = expires_at(current).is_some_and(|exp| exp > now() + REFRESH_MARGIN);
            if fresh && rejected != Some(current) {
                return Ok(current.to_string());
            }
        }
        let token = scrape_web_token().await?;
        save_token(app, &token);
        *slot = Some(token.clone());
        Ok(token)
    }

    /// A pasted token, or a developer token signed from the MusicKit key.
    fn manual_token(&self, cfg: &MotionConfig) -> Result<String, String> {
        // Accept the token with or without a copied "Bearer " prefix or quotes.
        let pasted = cfg.token.trim().trim_matches('"');
        let pasted = pasted.strip_prefix("Bearer ").unwrap_or(pasted).trim();
        if !pasted.is_empty() {
            return Ok(pasted.to_string());
        }
        if cfg.team_id.trim().is_empty() || cfg.key_id.trim().is_empty() || cfg.private_key.trim().is_empty() {
            return Err("Add your Team ID, Key ID and MusicKit private key, paste a token, or turn on automatic tokens.".into());
        }

        let cache_key = format!("{}:{}:{}", cfg.team_id.trim(), cfg.key_id.trim(), cfg.private_key.len());
        let mut cached = self.signed.lock().unwrap();
        if let Some((key, token, exp)) = cached.as_ref() {
            if *key == cache_key && *exp > now() + 3600 {
                return Ok(token.clone());
            }
        }

        let iat = now();
        let exp = iat + 60 * 60 * 24 * 30;
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(cfg.key_id.trim().to_string());
        let key = EncodingKey::from_ec_pem(normalize_pem(&cfg.private_key).as_bytes())
            .map_err(|e| format!("Couldn't read the private key (.p8): {e}"))?;
        let token = encode(
            &header,
            &Claims {
                iss: cfg.team_id.trim(),
                iat,
                exp,
            },
            &key,
        )
        .map_err(|e| format!("Couldn't sign the developer token: {e}"))?;
        *cached = Some((cache_key, token.clone(), exp));
        Ok(token)
    }
}

// ---- catalog requests ------------------------------------------------------------

async fn send(api: &Api, url: reqwest::Url) -> Result<reqwest::Response, ApiError> {
    let mut req = client().get(url).bearer_auth(&api.token);
    if let Some(origin) = api.origin {
        req = req.header(reqwest::header::ORIGIN, origin);
    }
    let res = req
        .send()
        .await
        .map_err(|e| ApiError::Other(format!("Couldn't reach Apple Music: {e}")))?;
    let status = res.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        let hint = if api.auto {
            " Even a freshly fetched token was refused."
        } else if api.is_web_player() {
            " It has probably expired — copy a fresh one, or turn on automatic tokens."
        } else {
            ""
        };
        return Err(ApiError::Auth(format!("Apple Music rejected the token ({status}).{hint}")));
    }
    if !status.is_success() {
        return Err(ApiError::Other(format!("Apple Music API error ({status}).")));
    }
    Ok(res)
}

async fn get_json(api: &Api, url: reqwest::Url) -> Result<Value, ApiError> {
    let body = send(api, url)
        .await?
        .text()
        .await
        .map_err(|e| ApiError::Other(format!("Couldn't read Apple Music's response: {e}")))?;
    serde_json::from_str(&body).map_err(|_| {
        let snippet: String = body.chars().take(120).collect();
        ApiError::Other(format!("Unexpected response from Apple Music: {snippet:?}"))
    })
}

/// Qualifier words that mean a *different recording*, not just another edition.
const DIFFERENT_RECORDING: &[&str] = &[
    "remix", "remixes", "remixed", "mix", "live", "acoustic", "instrumental", "instrumentals",
    "karaoke", "sped", "slowed", "reverb", "demo", "demos", "commentary", "acapella", "cappella",
    "unplugged", "orchestral", "reimagined", "rework", "reworks", "edit", "edits",
];

fn words(s: &str) -> Vec<String> {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_lowercase().next().unwrap_or(c) } else { ' ' })
        .collect();
    cleaned.split_whitespace().map(str::to_string).collect()
}

/// Splits a release title into its base and its qualifier words:
/// "to hell with it (Remixes)" -> ("to hell with it", ["remixes"]),
/// "Album - EP" -> ("album", ["ep"]), "Abbey Road [Remastered]" -> ("abbey road", ["remastered"]).
fn split_title(s: &str) -> (String, Vec<String>) {
    let mut base = String::new();
    let mut extra = String::new();
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' => {
                depth += 1;
                extra.push(' ');
            }
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => extra.push(c),
            _ => base.push(c),
        }
    }
    // A trailing " - Something" is a qualifier too ("Album - EP", "Song - Remixes").
    if let Some((head, tail)) = base.rsplit_once(" - ") {
        extra.push(' ');
        extra.push_str(tail);
        base = head.to_string();
    }
    (words(&base).join(" "), words(&extra))
}

/// How well a catalog album title matches ours: 4 = identical, 3 = same release in
/// another edition (deluxe, remastered, EP…), 0 = a different recording (remixes,
/// live…) or unrelated.
fn album_match(candidate: &str, wanted: &str) -> i32 {
    let (cb, cx) = split_title(candidate);
    let (wb, wx) = split_title(wanted);
    if cb.is_empty() || cb != wb {
        return 0;
    }
    let added: Vec<&String> = cx.iter().filter(|w| !wx.contains(w)).collect();
    let removed: Vec<&String> = wx.iter().filter(|w| !cx.contains(w)).collect();
    if added.is_empty() && removed.is_empty() {
        return 4;
    }
    let differs = added
        .iter()
        .chain(removed.iter())
        .any(|w| DIFFERENT_RECORDING.contains(&w.as_str()));
    if differs {
        0
    } else {
        3
    }
}

/// 3 = same artist, 2 = one contains the other (features, "A & B"), 0 = different.
fn artist_match(candidate: &str, wanted: &str) -> i32 {
    let (c, w) = (words(candidate).join(" "), words(wanted).join(" "));
    if c.is_empty() || w.is_empty() {
        0
    } else if c == w {
        3
    } else if c.contains(&w) || w.contains(&c) {
        2
    } else {
        0
    }
}

/// How many matching catalog albums to check for motion artwork.
const MAX_CANDIDATES: usize = 5;

struct Candidate {
    id: String,
    name: String,
    artist: String,
    clean: bool,
    score: i32,
}

/// Catalog albums matching a Navidrome album, best first. Apple often lists an
/// album more than once (explicit and clean editions, regional copies) and only
/// some copies carry motion artwork, so callers check several.
async fn find_candidates(
    api: &Api,
    storefront: &str,
    artist: &str,
    album: &str,
) -> Result<Vec<Candidate>, ApiError> {
    // Search by the base title so every edition comes back, then rank them precisely.
    let term = format!("{} {}", words(artist).join(" "), split_title(album).0);
    let url = reqwest::Url::parse_with_params(
        &format!("{}/catalog/{storefront}/search", api.base),
        &[("term", term.as_str()), ("types", "albums"), ("limit", "15")],
    )
    .map_err(|e| ApiError::Other(e.to_string()))?;
    let json = get_json(api, url).await?;
    let empty = vec![];
    let results = json["results"]["albums"]["data"].as_array().unwrap_or(&empty);
    let mut candidates: Vec<Candidate> = results
        .iter()
        .filter_map(|a| {
            let attrs = &a["attributes"];
            let name = attrs["name"].as_str().unwrap_or_default().to_string();
            let candidate_artist = attrs["artistName"].as_str().unwrap_or_default().to_string();
            let (title, by) = (album_match(&name, album), artist_match(&candidate_artist, artist));
            let id = a["id"].as_str()?.to_string();
            // Same release (any edition) by the same artist; never a remix/live album
            // standing in for the original.
            (title >= 3 && by >= 2).then(|| Candidate {
                id,
                clean: attrs["contentRating"].as_str() == Some("clean"),
                name,
                artist: candidate_artist,
                score: title + by,
            })
        })
        .collect();
    // Best score first; among equals, non-clean editions first, then Apple's own ranking
    // (the sort is stable, so the search order is preserved for ties).
    candidates.sort_by_key(|c| (-c.score, c.clean));
    candidates.truncate(MAX_CANDIDATES);
    Ok(candidates)
}

fn video_url(album: &Value) -> Option<String> {
    let video = &album["attributes"]["editorialVideo"];
    VIDEO_KEYS
        .iter()
        .find_map(|k| video[*k]["video"].as_str().map(str::to_string))
}

/// Motion artwork for several albums in one request, keyed by album id.
async fn album_videos(
    api: &Api,
    storefront: &str,
    ids: &[&str],
) -> Result<Vec<(String, Option<String>)>, ApiError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let url = reqwest::Url::parse_with_params(
        &format!("{}/catalog/{storefront}/albums", api.base),
        &[("ids", ids.join(",").as_str()), ("extend", "editorialVideo")],
    )
    .map_err(|e| ApiError::Other(e.to_string()))?;
    let json = get_json(api, url).await?;
    let empty = vec![];
    Ok(json["data"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .filter_map(|a| Some((a["id"].as_str()?.to_string(), video_url(a))))
        .collect())
}

struct Match {
    /// Catalog albums that matched by name and artist.
    candidates: usize,
    url: Option<String>,
}

async fn lookup(api: &Api, storefront: &str, artist: &str, album: &str) -> Result<Match, ApiError> {
    let candidates = find_candidates(api, storefront, artist, album).await?;
    let ids: Vec<&str> = candidates.iter().map(|c| c.id.as_str()).collect();
    let videos = album_videos(api, storefront, &ids).await?;
    // First candidate (in ranked order) that has motion artwork.
    let chosen = candidates.iter().find_map(|c| {
        videos
            .iter()
            .find(|(id, url)| *id == c.id && url.is_some())
            .map(|(_, url)| (c, url.clone()))
    });

    #[cfg(debug_assertions)]
    {
        let list: Vec<String> = candidates
            .iter()
            .map(|c| {
                let has = videos.iter().any(|(id, url)| *id == c.id && url.is_some());
                format!(
                    "{} {:?} by {:?}{} score={} video={}",
                    c.id, c.name, c.artist, if c.clean { " [clean]" } else { "" }, c.score, has
                )
            })
            .collect();
        eprintln!(
            "[motion] {artist:?} — {album:?} ({storefront}): {} candidate(s){}{}",
            candidates.len(),
            if list.is_empty() { String::new() } else { format!("\n  {}", list.join("\n  ")) },
            match &chosen {
                Some((c, _)) => format!("\n  -> using {}", c.id),
                None => "\n  -> no motion artwork".into(),
            }
        );
    }

    Ok(Match {
        candidates: candidates.len(),
        url: chosen.and_then(|(_, url)| url),
    })
}

/// Returns the HLS (.m3u8) URL of the album's motion artwork, or None.
#[tauri::command]
pub async fn motion_artwork(
    app: AppHandle,
    state: tauri::State<'_, MotionState>,
    artist: String,
    album: String,
    config: MotionConfig,
) -> Result<Option<String>, String> {
    let result = async {
        let api = state.api(&app, &config).await?;
        let storefront = config.storefront();
        let found = match lookup(&api, storefront, &artist, &album).await {
            Err(ApiError::Auth(_)) if api.auto => {
                let api = state.refreshed(&app, &api).await?;
                lookup(&api, storefront, &artist, &album).await?
            }
            result => result?,
        };
        Ok::<_, String>(found.url)
    }
    .await;
    #[cfg(debug_assertions)]
    if let Err(e) = &result {
        eprintln!("[motion] {artist:?} — {album:?}: error: {e}");
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionTest {
    token_ok: bool,
    motion_available: bool,
    message: String,
}

impl MotionTest {
    fn failed(message: String) -> Self {
        MotionTest { token_ok: false, motion_available: false, message }
    }
}

async fn check_token(api: &Api, storefront: &str) -> Result<(), ApiError> {
    // The developer API has /v1/test (200 for a valid token, non-JSON body). The
    // web-player API doesn't, so a tiny catalog search stands in for it there.
    let url = if api.is_web_player() {
        reqwest::Url::parse_with_params(
            &format!("{}/catalog/{storefront}/search", api.base),
            &[("term", "a"), ("types", "albums"), ("limit", "1")],
        )
        .unwrap()
    } else {
        reqwest::Url::parse(&format!("{}/test", api.base)).unwrap()
    };
    send(api, url).await.map(|_| ())
}

/// Checks the token, then probes a few albums that are known to ship motion
/// artwork to see whether Apple returns `editorialVideo` for this token.
#[tauri::command]
pub async fn motion_test(
    app: AppHandle,
    state: tauri::State<'_, MotionState>,
    config: MotionConfig,
) -> Result<MotionTest, String> {
    let storefront = config.storefront();
    let mut api = match state.api(&app, &config).await {
        Ok(api) => api,
        Err(e) => return Ok(MotionTest::failed(e)),
    };
    if let Err(e) = check_token(&api, storefront).await {
        let retried = match e {
            ApiError::Auth(_) if api.auto => match state.refreshed(&app, &api).await {
                Ok(fresh) => {
                    api = fresh;
                    check_token(&api, storefront).await.map_err(String::from)
                }
                Err(e) => Err(e),
            },
            e => Err(String::from(e)),
        };
        if let Err(e) = retried {
            return Ok(MotionTest::failed(e));
        }
    }

    let probes = [
        ("Billie Eilish", "Hit Me Hard and Soft"),
        ("Taylor Swift", "Midnights"),
        ("The Weeknd", "After Hours"),
        ("Olivia Rodrigo", "GUTS"),
    ];
    let mut found = 0;
    let mut last_error = None;
    let mut available = false;
    for (artist, album) in probes {
        match lookup(&api, storefront, artist, album).await {
            Ok(m) => {
                if m.candidates > 0 {
                    found += 1;
                }
                if m.url.is_some() {
                    available = true;
                    break;
                }
            }
            Err(e) => last_error = Some(String::from(e)),
        }
    }

    let source = if api.auto {
        let days = expires_at(&api.token).map(|exp| exp.saturating_sub(now()) / 86_400);
        match days {
            Some(d) => format!("Using the music.apple.com token (renews automatically; current one is valid for {d} more days). "),
            None => "Using the music.apple.com token (renews automatically). ".into(),
        }
    } else {
        String::new()
    };
    let result = match (available, found, last_error) {
        (true, ..) => "Apple is returning motion artwork.".to_string(),
        (false, 0, Some(e)) => format!("The token works, but the catalog lookup failed: {e}"),
        (false, 0, None) => format!("The token works, but none of the test albums were found in the “{storefront}” storefront."),
        (false, ..) if api.is_web_player() => {
            format!("The token works, but Apple didn't return motion artwork for the test albums in the “{storefront}” storefront.")
        }
        (false, ..) => "The token works, but Apple didn't return motion artwork for the test albums. \
                        Apple limits editorialVideo for third-party developer tokens."
            .into(),
    };
    Ok(MotionTest {
        token_ok: true,
        motion_available: available,
        message: format!("{source}{result}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jwt(claims: &str) -> String {
        let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        format!("{}.{}.sig", enc(r#"{"typ":"JWT","alg":"ES256","kid":"X"}"#), enc(claims))
    }

    fn cfg(token: &str) -> MotionConfig {
        MotionConfig {
            team_id: String::new(),
            key_id: String::new(),
            private_key: String::new(),
            token: token.into(),
            storefront: String::new(),
            auto_refresh: false,
        }
    }

    #[test]
    fn detects_web_player_tokens() {
        assert!(is_web_player_token(&jwt(r#"{"iss":"AMPWebPlay","iat":1,"exp":2,"root_https_origin":["apple.com"]}"#)));
        assert!(!is_web_player_token(&jwt(r#"{"iss":"ABCDE12345","iat":1,"exp":2}"#)));
        assert!(!is_web_player_token("not-a-jwt"));
    }

    #[test]
    fn strips_bearer_prefix_and_quotes() {
        let state = MotionState::default();
        assert_eq!(state.manual_token(&cfg("Bearer abc.def.ghi")).unwrap(), "abc.def.ghi");
        assert_eq!(state.manual_token(&cfg("  \"abc.def.ghi\" ")).unwrap(), "abc.def.ghi");
    }

    #[test]
    fn finds_the_web_player_token_among_others() {
        let other = jwt(r#"{"iss":"5IKPP2IECQ","exp":9,"root_https_origin":["apple.com"]}"#);
        let web = jwt(r#"{"iss":"AMPWebPlay","exp":9,"root_https_origin":["apple.com"]}"#);
        let js = format!(r#"var a="eyJnotajwt";const t="{other}",u='{web}';"#);
        assert_eq!(find_web_token(&js), Some(web));
        assert_eq!(find_web_token("no tokens here"), None);
    }

    #[test]
    fn remix_albums_never_stand_in_for_the_original() {
        assert_eq!(album_match("to hell with it", "to hell with it"), 4);
        assert_eq!(album_match("to hell with it (Remixes)", "to hell with it"), 0);
        assert_eq!(album_match("to hell with it - Remixes", "to hell with it"), 0);
        assert_eq!(album_match("Folklore (Live from the Long Pond Studio Sessions)", "folklore"), 0);
        // …but if your album *is* the remix album, it matches that one.
        assert_eq!(album_match("to hell with it (Remixes)", "to hell with it (Remixes)"), 4);
        assert_eq!(album_match("to hell with it", "to hell with it (Remixes)"), 0);
    }

    #[test]
    fn other_editions_still_match() {
        assert_eq!(album_match("Abbey Road (Remastered)", "Abbey Road"), 3);
        assert_eq!(album_match("GUTS (spilled)", "GUTS"), 3);
        assert_eq!(album_match("Heaven knows - EP", "Heaven knows"), 3);
        assert_eq!(album_match("Midnights (3am Edition)", "Midnights (3am Edition)"), 4);
        assert_eq!(album_match("Different Album", "to hell with it"), 0);
    }

    #[test]
    fn artist_matching() {
        assert_eq!(artist_match("PinkPantheress", "PinkPantheress"), 3);
        assert_eq!(artist_match("PinkPantheress & Ice Spice", "PinkPantheress"), 2);
        assert_eq!(artist_match("Someone Else", "PinkPantheress"), 0);
    }

    #[test]
    fn orders_entry_scripts_first() {
        let html = r#"<script nomodule data-src="/assets/index-legacy~1.js"></script>
            <script src="/assets/polyfills~2.js"></script>
            <script type="module" crossorigin src="/assets/index~3.js"></script>"#;
        let srcs = script_sources(html);
        assert_eq!(srcs[0], "/assets/index~3.js");
        assert_eq!(srcs.last().unwrap(), "/assets/index-legacy~1.js");
    }

    /// Hits the real site; run with `cargo test -- --ignored live_scrape`.
    #[test]
    #[ignore]
    fn live_scrape() {
        let token = tauri::async_runtime::block_on(scrape_web_token()).expect("scrape");
        let c = claims(&token).unwrap();
        assert_eq!(c["iss"], WEB_PLAYER_ISSUER);
        assert!(expires_at(&token).unwrap() > now());
    }
}
