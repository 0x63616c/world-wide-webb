/**
 * Sonos-specific error class. Always thrown on network/SOAP failures — never
 * swallowed or replaced with fallback data.
 */
export class SonosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SonosError";
  }
}
