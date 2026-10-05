//! `proxy://` protocol: fetches a small allow-list of third-party hosts (Apple's
//! artwork/video CDNs, LRCLIB) from Rust and hands the bytes back to the webview
//! with permissive CORS headers. hls.js and the lyrics fetcher go through this.

use std::sync::OnceLock;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder};

const ALLOWED_HOST_SUFFIXES: &[&str] = &["apple.com", "mzstatic.com", "lrclib.net"];

pub fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Cadence/", env!("CARGO_PKG_VERSION"), " (Navidrome client)"))
            .build()
            .expect("http client")
    })
}

pub fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let query = request.uri().query().unwrap_or_default().to_string();
    let range = request.headers().get(header::RANGE).cloned();
    tauri::async_runtime::spawn(async move {
        let response = match forward(&query, range).await {
            Ok(r) => r,
            Err(msg) => {
                #[cfg(debug_assertions)]
                eprintln!("[proxy] {msg}");
                Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(header::CONTENT_TYPE, "text/plain")
                    .body(msg.into_bytes())
                    .unwrap()
            }
        };
        responder.respond(response);
    });
}

async fn forward(
    query: &str,
    range: Option<header::HeaderValue>,
) -> Result<Response<Vec<u8>>, String> {
    let params = reqwest::Url::parse(&format!("http://localhost/?{query}"))
        .map_err(|e| e.to_string())?;
    let target = params
        .query_pairs()
        .find(|(k, _)| k == "u")
        .map(|(_, v)| v.into_owned())
        .ok_or("missing ?u=")?;
    let mut url = reqwest::Url::parse(&target).map_err(|e| format!("bad url {target:?}: {e}"))?;

    let host = url.host_str().unwrap_or_default().to_string();
    let allowed = matches!(url.scheme(), "https" | "http")
        && ALLOWED_HOST_SUFFIXES
            .iter()
            .any(|s| host == *s || host.ends_with(&format!(".{s}")));
    if !allowed {
        return Err(format!("not allowed: {url}"));
    }
    // Playlists sometimes reference plain-http segment URLs; the CDNs all serve https.
    if url.scheme() == "http" {
        let _ = url.set_scheme("https");
    }

    let mut req = client().get(url.clone());
    if let Some(range) = range {
        req = req.header(header::RANGE, range);
    }
    let res = req.send().await.map_err(|e| format!("{url}: {e}"))?;
    let status = res.status().as_u16();
    let final_url = res.url().clone();
    let content_type = res.headers().get(header::CONTENT_TYPE).cloned();
    let content_range = res.headers().get(header::CONTENT_RANGE).cloned();
    let body = res.bytes().await.map_err(|e| format!("{url}: reading body: {e}"))?;

    // The player resolves relative playlist entries against the address it fetched
    // the playlist from — this proxy — so make every entry absolute first.
    let is_playlist = final_url.path().ends_with(".m3u8")
        || content_type
            .as_ref()
            .and_then(|v| v.to_str().ok())
            .is_some_and(|ct| ct.to_ascii_lowercase().contains("mpegurl"));
    let body = match (is_playlist, std::str::from_utf8(&body)) {
        (true, Ok(text)) => absolutize_playlist(text, &final_url).into_bytes().into(),
        _ => body,
    };

    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "max-age=86400");
    if let Some(ct) = content_type {
        builder = builder.header(header::CONTENT_TYPE, ct);
    }
    if let Some(cr) = content_range {
        builder = builder.header(header::CONTENT_RANGE, cr);
    }
    builder.body(body.to_vec()).map_err(|e| e.to_string())
}

/// Rewrites an HLS playlist so every URI (segment lines and `URI="…"` attributes
/// such as EXT-X-MAP) is absolute, resolved against the playlist's real address.
fn absolutize_playlist(text: &str, base: &reqwest::Url) -> String {
    let resolve = |uri: &str| base.join(uri).map(|u| u.to_string()).unwrap_or_else(|_| uri.to_string());
    let mut out = String::with_capacity(text.len() + 1024);
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            out.push_str(line);
        } else if !trimmed.starts_with('#') {
            out.push_str(&resolve(trimmed));
        } else if let Some(start) = line.find("URI=\"") {
            let value_start = start + "URI=\"".len();
            match line[value_start..].find('"') {
                Some(len) => {
                    out.push_str(&line[..value_start]);
                    out.push_str(&resolve(&line[value_start..value_start + len]));
                    out.push_str(&line[value_start + len..]);
                }
                None => out.push_str(line),
            }
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::absolutize_playlist;

    #[test]
    fn makes_relative_playlist_entries_absolute() {
        let base = reqwest::Url::parse("https://mvod.itunes.apple.com/assets/abc/P1_768.m3u8").unwrap();
        let input = "#EXTM3U\n\
            #EXT-X-MAP:URI=\"P1_768-.mp4\",BYTERANGE=\"877@0\"\n\
            #EXTINF:3.73,\t\n\
            #EXT-X-BYTERANGE:1058750@877\n\
            P1_768-.mp4\n\
            #EXT-X-STREAM-INF:BANDWIDTH=1\n\
            https://other.apple.com/x/abs.m3u8\n";
        let out = absolutize_playlist(input, &base);
        assert!(out.contains("#EXT-X-MAP:URI=\"https://mvod.itunes.apple.com/assets/abc/P1_768-.mp4\",BYTERANGE=\"877@0\""));
        assert!(out.contains("\nhttps://mvod.itunes.apple.com/assets/abc/P1_768-.mp4\n"));
        assert!(out.contains("\nhttps://other.apple.com/x/abs.m3u8\n"));
        assert!(out.contains("#EXT-X-BYTERANGE:1058750@877"));
    }
}
