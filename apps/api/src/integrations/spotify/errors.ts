/**
 * Spotify-specific error class. Always thrown on auth failures, unconfigured
 * credentials, or upstream API errors , never swallowed or replaced with
 * fallback data.
 */
export class SpotifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotifyError";
  }
}
