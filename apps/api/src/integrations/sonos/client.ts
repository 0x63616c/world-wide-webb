/**
 * SonosClient — raw UPnP/SOAP transport for a single Sonos device at :1400.
 *
 * One instance per device IP. No auth, no discovery — callers supply the IP
 * directly (from the verified device table in INTEGRATION-NOTES.md).
 *
 * Every method THROWS SonosError on any failure: network, HTTP >=4xx, or SOAP
 * fault. Callers must never receive fabricated data.
 */

import { SonosError } from "./errors";
import type { PositionInfo, SonosFavorite, TransportInfo, ZoneGroup, ZoneMember } from "./types";

// Sonos UPnP service control paths (verified against hardware, CC-c2pc).
const PATH_RENDERING_CONTROL = "/MediaRenderer/RenderingControl/Control";
const PATH_AV_TRANSPORT = "/MediaRenderer/AVTransport/Control";
const PATH_ZONE_GROUP_TOPOLOGY = "/ZoneGroupTopology/Control";
const PATH_CONTENT_DIRECTORY = "/MediaServer/ContentDirectory/Control";

// UPnP service type namespaces used in SOAPACTION headers.
const SVC_RENDERING_CONTROL = "urn:schemas-upnp-org:service:RenderingControl:1";
const SVC_AV_TRANSPORT = "urn:schemas-upnp-org:service:AVTransport:1";
const SVC_ZONE_GROUP_TOPOLOGY = "urn:schemas-upnp-org:service:ZoneGroupTopology:1";
const SVC_CONTENT_DIRECTORY = "urn:schemas-upnp-org:service:ContentDirectory:1";

const SOAP_TIMEOUT_MS = 5_000;

export class SonosClient {
  private readonly baseUrl: string;

  constructor(ip: string) {
    this.baseUrl = `http://${ip}:1400`;
  }

  // --------------------------------------------------------------------------
  // RenderingControl — volume/mute (per-device)
  // --------------------------------------------------------------------------

  /** Returns master volume 0–100. THROWS on any failure. */
  async getVolume(): Promise<number> {
    const xml = await this.soapRequest(
      PATH_RENDERING_CONTROL,
      SVC_RENDERING_CONTROL,
      "GetVolume",
      `<InstanceID>0</InstanceID><Channel>Master</Channel>`,
    );
    const raw = extractText(xml, "CurrentVolume");
    if (raw === null) throw new SonosError("GetVolume: missing CurrentVolume in response");
    return Number.parseInt(raw, 10);
  }

  /** Sets master volume 0–100. THROWS if vol is out of range or on any failure. */
  async setVolume(vol: number): Promise<void> {
    if (vol < 0 || vol > 100) {
      throw new SonosError(`SetVolume: volume ${vol} out of range 0-100`);
    }
    await this.soapRequest(
      PATH_RENDERING_CONTROL,
      SVC_RENDERING_CONTROL,
      "SetVolume",
      `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${vol}</DesiredVolume>`,
    );
  }

  /** Returns true if the device is muted. THROWS on any failure. */
  async getMute(): Promise<boolean> {
    const xml = await this.soapRequest(
      PATH_RENDERING_CONTROL,
      SVC_RENDERING_CONTROL,
      "GetMute",
      `<InstanceID>0</InstanceID><Channel>Master</Channel>`,
    );
    const raw = extractText(xml, "CurrentMute");
    if (raw === null) throw new SonosError("GetMute: missing CurrentMute in response");
    return raw === "1";
  }

  /** Sets mute state. THROWS on any failure. */
  async setMute(muted: boolean): Promise<void> {
    await this.soapRequest(
      PATH_RENDERING_CONTROL,
      SVC_RENDERING_CONTROL,
      "SetMute",
      `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${muted ? "1" : "0"}</DesiredMute>`,
    );
  }

  // --------------------------------------------------------------------------
  // AVTransport — transport state + now-playing (coordinator only for group state)
  // --------------------------------------------------------------------------

  /** Returns transport state. THROWS on any failure. */
  async getTransportInfo(): Promise<TransportInfo> {
    const xml = await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "GetTransportInfo",
      `<InstanceID>0</InstanceID>`,
    );
    const state = extractText(xml, "CurrentTransportState");
    if (state === null) {
      throw new SonosError("GetTransportInfo: missing CurrentTransportState in response");
    }
    return { state };
  }

  /** Returns track position/metadata. Nulls mean NOT_IMPLEMENTED (line-in/TV). THROWS on error. */
  async getPositionInfo(): Promise<PositionInfo> {
    const xml = await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "GetPositionInfo",
      `<InstanceID>0</InstanceID>`,
    );

    const rawDuration = extractText(xml, "TrackDuration");
    const rawRelTime = extractText(xml, "RelTime");
    const rawMetadata = extractText(xml, "TrackMetaData");

    const durationSeconds =
      rawDuration && rawDuration !== "NOT_IMPLEMENTED" ? parseSonosTime(rawDuration) : null;
    const positionSeconds =
      rawRelTime && rawRelTime !== "NOT_IMPLEMENTED" ? parseSonosTime(rawRelTime) : null;

    let trackTitle: string | null = null;
    let trackArtist: string | null = null;
    let albumArtUri: string | null = null;

    if (rawMetadata && rawMetadata.trim().length > 0) {
      // TrackMetaData contains a DIDL-Lite XML fragment (CDATA-wrapped in the envelope).
      trackTitle = extractText(rawMetadata, "dc:title");
      trackArtist = extractText(rawMetadata, "dc:creator");
      albumArtUri = extractText(rawMetadata, "upnp:albumArtURI");
    }

    return { trackTitle, trackArtist, albumArtUri, durationSeconds, positionSeconds };
  }

  /** Starts playback. THROWS on any failure. */
  async play(): Promise<void> {
    await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "Play",
      `<InstanceID>0</InstanceID><Speed>1</Speed>`,
    );
  }

  /** Pauses playback. THROWS on any failure. */
  async pause(): Promise<void> {
    await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "Pause",
      `<InstanceID>0</InstanceID>`,
    );
  }

  /** Skips to next track. THROWS on any failure. */
  async next(): Promise<void> {
    await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "Next",
      `<InstanceID>0</InstanceID>`,
    );
  }

  /** Skips to previous track. THROWS on any failure. */
  async previous(): Promise<void> {
    await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "Previous",
      `<InstanceID>0</InstanceID>`,
    );
  }

  /**
   * Sets the AV transport URI. Used for:
   *  - Group join:    uri = "x-rincon:<COORDINATOR_UUID>"
   *  - Line-in:       uri = "x-rincon-stream:<DEVICE_UUID>:0"
   *  - TV audio grab: uri = "x-sonos-htastream:<BEAM_UUID>:spdif"
   * Call play() after this to start the new source.
   */
  async setAVTransportURI(uri: string, metadata: string): Promise<void> {
    await this.soapRequest(
      PATH_AV_TRANSPORT,
      SVC_AV_TRANSPORT,
      "SetAVTransportURI",
      `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(uri)}</CurrentURI><CurrentURIMetaData>${escapeXml(metadata)}</CurrentURIMetaData>`,
    );
  }

  // --------------------------------------------------------------------------
  // ZoneGroupTopology — whole-house grouping topology
  // --------------------------------------------------------------------------

  /**
   * Returns the current zone group topology. Always read fresh — grouping is
   * volatile (TV power reshapes it live). THROWS on any failure.
   */
  async getZoneGroupState(): Promise<ZoneGroup[]> {
    const xml = await this.soapRequest(
      PATH_ZONE_GROUP_TOPOLOGY,
      SVC_ZONE_GROUP_TOPOLOGY,
      "GetZoneGroupState",
      "",
    );

    // The ZoneGroupState element carries an embedded XML document. Real firmware
    // ENTITY-encodes it (&lt;ZoneGroup&gt; ...); extractText only strips CDATA, so
    // decode entities back to literal XML before structural parsing (CC-51hf.56).
    const stateXml = extractText(xml, "ZoneGroupState");
    if (stateXml === null) {
      throw new SonosError("GetZoneGroupState: missing ZoneGroupState element");
    }

    return parseZoneGroups(decodeXmlEntities(stateXml));
  }

  // --------------------------------------------------------------------------
  // ContentDirectory — favorites (FV:2)
  // --------------------------------------------------------------------------

  /**
   * Browses the Sonos Favorites container (FV:2). Returns all items up to 50.
   * THROWS on any failure.
   */
  async browseFavorites(): Promise<SonosFavorite[]> {
    const xml = await this.soapRequest(
      PATH_CONTENT_DIRECTORY,
      SVC_CONTENT_DIRECTORY,
      "Browse",
      `<ObjectID>FV:2</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>0</StartingIndex><RequestedCount>50</RequestedCount><SortCriteria></SortCriteria>`,
    );

    // The Result element carries an embedded DIDL-Lite document, entity-encoded
    // by real firmware (not CDATA) — decode before parsing (CC-51hf.56).
    const resultXml = extractText(xml, "Result");
    if (resultXml === null) {
      throw new SonosError("Browse FV:2: missing Result element");
    }

    return parseFavorites(decodeXmlEntities(resultXml));
  }

  // --------------------------------------------------------------------------
  // Low-level SOAP transport
  // --------------------------------------------------------------------------

  private async soapRequest(
    controlPath: string,
    serviceType: string,
    action: string,
    bodyArgs: string,
  ): Promise<string> {
    const soapBody = buildSoapEnvelope(serviceType, action, bodyArgs);
    const url = `${this.baseUrl}${controlPath}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPACTION: `"${serviceType}#${action}"`,
        },
        body: soapBody,
        signal: AbortSignal.timeout(SOAP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SonosError(`${action}: network error — ${(err as Error).message}`);
    }

    const text = await res.text();

    if (!res.ok) {
      throw new SonosError(`${action}: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }

    // A SOAP fault arrives as HTTP 500 OR sometimes 200 with a <s:Fault> body.
    if (text.includes("<s:Fault") || text.includes("<S:Fault")) {
      const errCode = extractText(text, "errorCode") ?? "?";
      const errDesc =
        extractText(text, "errorDescription") ?? extractText(text, "faultstring") ?? "SOAP fault";
      throw new SonosError(`${action}: SOAP fault ${errCode} — ${errDesc}`);
    }

    return text;
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Builds a minimal SOAP envelope with the given action and body arguments. */
function buildSoapEnvelope(serviceType: string, action: string, bodyArgs: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${serviceType}">
      ${bodyArgs}
    </u:${action}>
  </s:Body>
</s:Envelope>`;
}

/**
 * Extracts the text content of the first occurrence of <tagName>...</tagName>.
 * Handles CDATA, self-closing, and namespaced tags. Returns null if not found.
 *
 * LIMITATION: The non-greedy regex stops at the FIRST closing tag of the given
 * name, not the matching closing tag for the opening tag. Nested tags with the
 * same name will be silently truncated (e.g. <item><item>x</item></item>
 * returns "<item>x" not the full outer content). This is intentional: Sonos
 * devices are trusted LAN hardware whose UPnP responses follow fixed, flat
 * schemas. The fields we extract (CurrentVolume, TrackDuration, dc:title, etc.)
 * are always leaf nodes — they never nest under a tag of the same name. Do NOT
 * use this helper on XML where nesting of like-named elements is possible.
 */
function extractText(xml: string, tagName: string): string | null {
  // Match both <tag>content</tag> and <ns:tag>content</ns:tag>.
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<(?:[^:>]+:)?${escapedTag}[^>]*>([\\s\\S]*?)</(?:[^:>]+:)?${escapedTag}>`,
    "i",
  );
  const m = xml.match(pattern);
  if (!m || m[1] === undefined) return null;
  // Strip CDATA wrapper if present.
  const content = m[1].trim();
  const cdataMatch = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdataMatch && cdataMatch[1] !== undefined) return cdataMatch[1].trim();
  return content;
}

/**
 * Converts a Sonos HH:MM:SS time string to seconds. Returns null if the value
 * is empty or "NOT_IMPLEMENTED".
 */
function parseSonosTime(time: string): number | null {
  if (!time || time === "NOT_IMPLEMENTED") return null;
  const parts = time.split(":").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [h, m, s] = parts as [number, number, number];
  return h * 3600 + m * 60 + s;
}

/** Minimal XML attribute value extractor for a named attribute. */
function extractAttr(xml: string, attr: string): string | null {
  const pattern = new RegExp(`${attr}="([^"]*)"`, "i");
  const m = xml.match(pattern);
  return m && m[1] !== undefined ? m[1] : null;
}

/** Escapes XML special characters for use inside element content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Decodes the XML entities Sonos uses to embed one XML document inside another
 * (GetZoneGroupState's ZoneGroupState, Browse's Result). `&amp;` is decoded LAST
 * so a double-encoded `&amp;lt;` resolves to `&lt;`, not `<`. Identity on already
 * literal XML (e.g. CDATA-stripped content), so it is safe to always apply.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Parses the ZoneGroups XML fragment returned inside GetZoneGroupState.
 * Each <ZoneGroup> element carries Coordinator + ID attributes and contains
 * <ZoneGroupMember> children.
 */
function parseZoneGroups(xml: string): ZoneGroup[] {
  const groups: ZoneGroup[] = [];

  // Use matchAll to avoid assign-in-expression lint violations.
  const groupMatches = xml.matchAll(/<ZoneGroup\s([^>]*)>([\s\S]*?)<\/ZoneGroup>/gi);

  for (const gm of groupMatches) {
    const attrs = gm[1] ?? "";
    const inner = gm[2] ?? "";
    const coordinatorUuid = extractAttr(attrs, "Coordinator");
    if (!coordinatorUuid) continue;

    const members: ZoneMember[] = [];
    const memberMatches = inner.matchAll(/<ZoneGroupMember\s([^>]*)\/?>/gi);

    for (const mm of memberMatches) {
      const mAttrs = mm[1] ?? "";
      const uuid = extractAttr(mAttrs, "UUID");
      const zoneName = extractAttr(mAttrs, "ZoneName");
      const location = extractAttr(mAttrs, "Location");
      if (!uuid || !zoneName || !location) continue;

      // Extract IP from the Location URL: "http://192.168.0.193:1400/..."
      const ipMatch = location.match(/http:\/\/([\d.]+):\d+/);
      const ip = ipMatch?.[1] ?? "";
      members.push({ uuid, zoneName, ip });
    }

    groups.push({ coordinatorUuid, members });
  }

  return groups;
}

/**
 * Parses a DIDL-Lite XML fragment (the Result element from Browse FV:2) into
 * a list of SonosFavorite items.
 */
function parseFavorites(didl: string): SonosFavorite[] {
  const favorites: SonosFavorite[] = [];

  const itemMatches = didl.matchAll(/<item\s[^>]*>([\s\S]*?)<\/item>/gi);

  for (const m of itemMatches) {
    const inner = m[1] ?? "";
    const title = extractText(inner, "dc:title") ?? extractText(inner, "title");
    const uri = extractText(inner, "res");
    const albumArtUri = extractText(inner, "upnp:albumArtURI");

    if (!title || !uri) continue;
    favorites.push({ title, uri, albumArtUri });
  }

  return favorites;
}
