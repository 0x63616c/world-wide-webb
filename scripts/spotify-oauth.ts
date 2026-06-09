/**
 * One-time Spotify OAuth (Authorization Code flow) to mint a long-lived refresh
 * token for the control-center api/worker to drive playback via the Web API.
 *
 * Confidential client (we have a client secret), so no PKCE needed. Spins a
 * loopback listener on the redirect URI, opens the consent page, exchanges the
 * returned code for tokens, confirms the account is Premium (Web API playback
 * control requires it), then prints two machine-readable lines on stdout:
 *
 *   PRODUCT=<premium|free|...>
 *   REFRESH_TOKEN=<token>
 *
 * The wrapping save-spotify-credentials.sh parses those and stores everything in
 * 1Password. Run via bun: `bun scripts/spotify-oauth.ts`.
 *
 * Env in:  SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI
 */

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:8888/callback";

if (!clientId || !clientSecret) {
  console.error("FATAL: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set");
  process.exit(1);
}

// Everything the dashboard could plausibly need: read+control playback, browse
// playlists + liked songs, read profile (for the Premium check). `streaming`
// future-proofs an in-dashboard Web Playback SDK player.
const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  // browse hits GET /v1/me/player/recently-played, which needs this scope —
  // without it the Quick-Play Spotify browse 403s "Insufficient client scope"
  // (CC-51hf.57). It was omitted from the original mint.
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-read-private",
  "user-top-read",
  "streaming",
].join(" ");

const redirect = new URL(redirectUri);
const port = Number(redirect.port || "8888");
const callbackPath = redirect.pathname || "/callback";

// A short random state; not security-critical for a one-shot local flow, but we
// validate it round-trips. (No Math.random restriction here — plain bun script.)
const state = crypto.randomUUID();

const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
authorizeUrl.searchParams.set("client_id", clientId);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("scope", SCOPES);
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("show_dialog", "true");

async function exchangeCode(code: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`token exchange failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { access_token: string; refresh_token: string };
}

async function getProduct(accessToken: string): Promise<string> {
  const res = await fetch("https://api.spotify.com/v1/me", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`/me failed ${res.status}: ${await res.text()}`);
  const me = (await res.json()) as { product?: string };
  return me.product ?? "unknown";
}

const done = Promise.withResolvers<{ product: string; refreshToken: string }>();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== callbackPath) return new Response("not found", { status: 404 });

    const err = url.searchParams.get("error");
    if (err) {
      done.reject(new Error(`Spotify returned error: ${err}`));
      return new Response(`Authorization failed: ${err}. You can close this tab.`, { status: 400 });
    }

    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    if (!code) return new Response("missing code", { status: 400 });
    if (returnedState !== state) {
      done.reject(new Error("state mismatch — aborting"));
      return new Response("state mismatch", { status: 400 });
    }

    try {
      const tokens = await exchangeCode(code);
      const product = await getProduct(tokens.access_token);
      done.resolve({ product, refreshToken: tokens.refresh_token });
      return new Response(
        "Spotify connected. Refresh token captured. You can close this tab and return to the terminal.",
        { headers: { "content-type": "text/plain" } },
      );
    } catch (e) {
      done.reject(e as Error);
      return new Response(`Token exchange failed: ${(e as Error).message}`, { status: 500 });
    }
  },
});

console.error(`\nListening on ${redirectUri}`);
console.error("Opening the Spotify consent page in your browser...");
console.error("If it does not open, paste this URL manually:\n");
console.error(authorizeUrl.toString());
console.error("");

// Best-effort browser open (macOS).
try {
  Bun.spawn(["open", authorizeUrl.toString()]);
} catch {
  // ignore — the URL is printed above for manual use
}

try {
  const { product, refreshToken } = await done.promise;
  // Machine-readable lines for the wrapping shell script (stdout only).
  console.log(`PRODUCT=${product}`);
  console.log(`REFRESH_TOKEN=${refreshToken}`);
  server.stop(true);
  process.exit(0);
} catch (e) {
  console.error(`\nFAILED: ${(e as Error).message}`);
  server.stop(true);
  process.exit(1);
}
