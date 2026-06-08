/**
 * Barrel of everything the media-worker image needs from the api domain (www-kp4k).
 * Mirrors worker-deps.ts: a single explicit import surface so the media-worker
 * does not reach into internal paths. Extend here as the pipeline adds services.
 */
/** @public — table references consumed by the media-worker image and future media tRPC routes */
export { mediaItem, mediaSource } from "./db/schema";
/** @public — primary config entry-point for the media-worker image; consumed externally */
export { env } from "./env";
