/**
 * Unit tests for the raw Sonos UPnP/SOAP helper (www-51hf.4).
 * All network calls are stubbed , tests never reach real hardware.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SonosClient, SonosError, type SonosFavorite, type ZoneGroup } from "../integrations/sonos";

// ---- SOAP envelope helpers -------------------------------------------------

function soapEnvelope(body: string): string {
  return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>${body}</s:Body>
</s:Envelope>`;
}

// Real Sonos firmware does NOT CDATA-wrap the embedded XML in GetZoneGroupState
// / Browse , it ENTITY-encodes it (&lt;ZoneGroup&gt; ...). Encode a literal XML
// fragment the way the device actually sends it, so the parser is exercised
// against reality, not a CDATA fixture that masked the missing decode (www-51hf.56).
function entityEncode(literalXml: string): string {
  return literalXml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function volumeResponse(vol: number): string {
  return soapEnvelope(`<u:GetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
    <CurrentVolume>${vol}</CurrentVolume>
  </u:GetVolumeResponse>`);
}

function muteResponse(muted: boolean): string {
  return soapEnvelope(`<u:GetMuteResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
    <CurrentMute>${muted ? "1" : "0"}</CurrentMute>
  </u:GetMuteResponse>`);
}

function transportInfoResponse(state: string): string {
  return soapEnvelope(`<u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
    <CurrentTransportState>${state}</CurrentTransportState>
    <CurrentTransportStatus>OK</CurrentTransportStatus>
    <CurrentSpeed>1</CurrentSpeed>
  </u:GetTransportInfoResponse>`);
}

function positionInfoResponse(): string {
  return soapEnvelope(`<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
    <Track>1</Track>
    <TrackDuration>0:04:32</TrackDuration>
    <TrackMetaData><![CDATA[<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="1"><dc:title>Test Track</dc:title><dc:creator>Test Artist</dc:creator><upnp:albumArtURI>http://example.com/art.jpg</upnp:albumArtURI></item></DIDL-Lite>]]></TrackMetaData>
    <TrackURI>x-sonos-http:track.mp3</TrackURI>
    <RelTime>0:01:23</RelTime>
    <AbsTime>0:01:23</AbsTime>
    <RelCount>2147483647</RelCount>
    <AbsCount>2147483647</AbsCount>
  </u:GetPositionInfoResponse>`);
}

function zoneGroupStateResponse(): string {
  return soapEnvelope(`<u:GetZoneGroupStateResponse xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1">
    <ZoneGroupState><![CDATA[<ZoneGroups>
      <ZoneGroup Coordinator="RINCON_74CA6093255801400" ID="RINCON_74CA6093255801400:1">
        <ZoneGroupMember UUID="RINCON_74CA6093255801400" ZoneName="Living Room" Location="http://192.168.0.193:1400/xml/device_description.xml"/>
      </ZoneGroup>
      <ZoneGroup Coordinator="RINCON_804AF28AAB2001400" ID="RINCON_804AF28AAB2001400:5">
        <ZoneGroupMember UUID="RINCON_804AF28AAB2001400" ZoneName="Desk" Location="http://192.168.0.152:1400/xml/device_description.xml"/>
        <ZoneGroupMember UUID="RINCON_804AF288FDBA01400" ZoneName="Desk + Bonded" Location="http://192.168.0.161:1400/xml/device_description.xml"/>
      </ZoneGroup>
    </ZoneGroups>]]></ZoneGroupState>
  </u:GetZoneGroupStateResponse>`);
}

function browseFavoritesResponse(): string {
  return soapEnvelope(`<u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
    <Result><![CDATA[<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="FV:2/1"><dc:title>Riordan Radio</dc:title><upnp:albumArtURI>http://example.com/radio.jpg</upnp:albumArtURI><res>x-sonosapi-radio:spotify%3AartistRadio%3A6v8FB84lnmJs434UByMr75</res></item></DIDL-Lite>]]></Result>
    <NumberReturned>1</NumberReturned>
    <TotalMatches>1</TotalMatches>
    <UpdateID>1</UpdateID>
  </u:BrowseResponse>`);
}

function soapFaultResponse(): string {
  return soapEnvelope(`<s:Fault>
    <faultcode>s:Client</faultcode>
    <faultstring>UPnPError</faultstring>
    <detail>
      <UPnPError xmlns="urn:schemas-upnp-org:control-1-0">
        <errorCode>714</errorCode>
        <errorDescription>IllegalMimeType</errorDescription>
      </UPnPError>
    </detail>
  </s:Fault>`);
}

function okResponse(body: string) {
  return { ok: true, status: 200, text: () => Promise.resolve(body) };
}

function errorResponse(status: number) {
  return { ok: false, status, text: () => Promise.resolve("Bad request") };
}

// ---- test setup ------------------------------------------------------------

const LIVING_ROOM_IP = "192.168.0.193";

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- GetVolume -------------------------------------------------------------

describe("SonosClient.getVolume", () => {
  it("parses volume from RenderingControl response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(volumeResponse(42))));
    const client = new SonosClient(LIVING_ROOM_IP);
    const vol = await client.getVolume();
    expect(vol).toBe(42);
  });

  it("throws SonosError on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(500)));
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.getVolume()).rejects.toBeInstanceOf(SonosError);
  });

  it("throws SonosError on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.getVolume()).rejects.toBeInstanceOf(SonosError);
  });

  it("throws SonosError on SOAP fault", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(soapFaultResponse())));
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.getVolume()).rejects.toBeInstanceOf(SonosError);
  });
});

// ---- SetVolume -------------------------------------------------------------

describe("SonosClient.setVolume", () => {
  it("sends correct SOAP action and resolves on 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse(soapEnvelope("<u:SetVolumeResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient(LIVING_ROOM_IP);
    await client.setVolume(75);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(":1400");
    expect(url).toContain("RenderingControl");
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("SetVolume"),
    });
    expect(init.body as string).toContain("<DesiredVolume>75</DesiredVolume>");
  });

  it("throws SonosError when volume is out of 0-100 range", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.setVolume(101)).rejects.toBeInstanceOf(SonosError);
    await expect(client.setVolume(-1)).rejects.toBeInstanceOf(SonosError);
  });
});

// ---- GetMute / SetMute -----------------------------------------------------

describe("SonosClient mute", () => {
  it("parses muted=true from GetMute response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(muteResponse(true))));
    const client = new SonosClient(LIVING_ROOM_IP);
    expect(await client.getMute()).toBe(true);
  });

  it("parses muted=false from GetMute response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(muteResponse(false))));
    const client = new SonosClient(LIVING_ROOM_IP);
    expect(await client.getMute()).toBe(false);
  });

  it("sends correct SOAPACTION for SetMute", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse(soapEnvelope("<u:SetMuteResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient(LIVING_ROOM_IP);
    await client.setMute(true);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("SetMute"),
    });
    expect(init.body as string).toContain("<DesiredMute>1</DesiredMute>");
  });
});

// ---- GetTransportInfo ------------------------------------------------------

describe("SonosClient.getTransportInfo", () => {
  it("returns PLAYING state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(transportInfoResponse("PLAYING"))));
    const client = new SonosClient(LIVING_ROOM_IP);
    const info = await client.getTransportInfo();
    expect(info.state).toBe("PLAYING");
  });

  it("returns PAUSED_PLAYBACK state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse(transportInfoResponse("PAUSED_PLAYBACK"))),
    );
    const client = new SonosClient(LIVING_ROOM_IP);
    const info = await client.getTransportInfo();
    expect(info.state).toBe("PAUSED_PLAYBACK");
  });

  it("throws SonosError on HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(503)));
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.getTransportInfo()).rejects.toBeInstanceOf(SonosError);
  });
});

// ---- GetMediaInfo ----------------------------------------------------------

describe("SonosClient.getMediaInfo", () => {
  it("getMediaInfo returns the CurrentURI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(
          soapEnvelope(`<u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <NrTracks>1</NrTracks>
      <CurrentURI>x-rincon-stream:RINCON_804AF28AAB2001400:0</CurrentURI>
      <PlayMedium>NETWORK</PlayMedium>
    </u:GetMediaInfoResponse>`),
        ),
      ),
    );
    const info = await new SonosClient("192.168.0.152").getMediaInfo();
    expect(info.currentUri).toBe("x-rincon-stream:RINCON_804AF28AAB2001400:0");
  });

  it("getMediaInfo returns empty currentUri for an idle device (verified live: empty element)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(
          soapEnvelope(`<u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <NrTracks>0</NrTracks>
      <CurrentURI></CurrentURI>
      <PlayMedium>NONE</PlayMedium>
    </u:GetMediaInfoResponse>`),
        ),
      ),
    );
    const info = await new SonosClient("192.168.0.193").getMediaInfo();
    expect(info.currentUri).toBe("");
  });

  it("decodes XML entities in the CurrentURI (e.g. &amp; -> &)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(
          soapEnvelope(`<u:GetMediaInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <NrTracks>1</NrTracks>
      <CurrentURI>x-sonos-spotify:spotify%3atrack%3a2JB6?sid=12&amp;flags=8224</CurrentURI>
      <PlayMedium>NETWORK</PlayMedium>
    </u:GetMediaInfoResponse>`),
        ),
      ),
    );
    const info = await new SonosClient("192.168.0.152").getMediaInfo();
    expect(info.currentUri).toBe("x-sonos-spotify:spotify%3atrack%3a2JB6?sid=12&flags=8224");
  });
});

// ---- GetPositionInfo -------------------------------------------------------

describe("SonosClient.getPositionInfo", () => {
  it("parses track metadata, duration, and position", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(positionInfoResponse())));
    const client = new SonosClient(LIVING_ROOM_IP);
    const pos = await client.getPositionInfo();
    expect(pos.trackTitle).toBe("Test Track");
    expect(pos.trackArtist).toBe("Test Artist");
    expect(pos.albumArtUri).toBe("http://example.com/art.jpg");
    expect(pos.durationSeconds).toBe(272); // 4:32
    expect(pos.positionSeconds).toBe(83); // 1:23
  });

  it("returns nulls when metadata is absent (line-in / TV source)", async () => {
    const noMetadata =
      soapEnvelope(`<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <Track>0</Track>
      <TrackDuration>NOT_IMPLEMENTED</TrackDuration>
      <TrackMetaData></TrackMetaData>
      <TrackURI></TrackURI>
      <RelTime>NOT_IMPLEMENTED</RelTime>
      <AbsTime>NOT_IMPLEMENTED</AbsTime>
      <RelCount>2147483647</RelCount>
      <AbsCount>2147483647</AbsCount>
    </u:GetPositionInfoResponse>`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(noMetadata)));
    const client = new SonosClient(LIVING_ROOM_IP);
    const pos = await client.getPositionInfo();
    expect(pos.trackTitle).toBeNull();
    expect(pos.durationSeconds).toBeNull();
    expect(pos.positionSeconds).toBeNull();
  });

  it("getPositionInfo decodes entity-encoded TrackMetaData (real firmware shape)", async () => {
    const didl =
      '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' +
      '<item id="-1" parentID="-1">' +
      "<dc:title>Bounce Back</dc:title><dc:creator>Ben Miller</dc:creator>" +
      "<upnp:albumArtURI>https://i.scdn.co/image/abc</upnp:albumArtURI>" +
      "</item></DIDL-Lite>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(
          soapEnvelope(`<u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <Track>1</Track>
      <TrackDuration>0:03:38</TrackDuration>
      <TrackMetaData>${entityEncode(didl)}</TrackMetaData>
      <RelTime>0:00:30</RelTime>
    </u:GetPositionInfoResponse>`),
        ),
      ),
    );

    const client = new SonosClient(LIVING_ROOM_IP);
    const info = await client.getPositionInfo();

    expect(info.trackTitle).toBe("Bounce Back");
    expect(info.trackArtist).toBe("Ben Miller");
    expect(info.albumArtUri).toBe("https://i.scdn.co/image/abc");
  });
});

// ---- Transport write commands ----------------------------------------------

describe("SonosClient transport writes", () => {
  it("play sends AVTransport Play action", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse(soapEnvelope("<u:PlayResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient(LIVING_ROOM_IP);
    await client.play();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("AVTransport");
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("Play"),
    });
  });

  it("pause sends AVTransport Pause action", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse(soapEnvelope("<u:PauseResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient(LIVING_ROOM_IP);
    await client.pause();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("Pause"),
    });
  });

  it("next sends AVTransport Next action", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse(soapEnvelope("<u:NextResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient(LIVING_ROOM_IP);
    await client.next();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("Next"),
    });
  });

  it("previous sends AVTransport Previous action", async () => {
    const mockFetch = vi.fn().mockResolvedValue(okResponse(soapEnvelope("<u:PreviousResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient(LIVING_ROOM_IP);
    await client.previous();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("Previous"),
    });
  });
});

// ---- SetAVTransportURI (group / line-in / TV-grab) -------------------------

describe("SonosClient.setAVTransportURI", () => {
  it("sends correct URI for group join (x-rincon:)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse(soapEnvelope("<u:SetAVTransportURIResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient("192.168.0.152");
    await client.setAVTransportURI("x-rincon:RINCON_74CA6093255801400", "");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain("x-rincon:RINCON_74CA6093255801400");
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("SetAVTransportURI"),
    });
  });

  it("sends correct URI for line-in source (x-rincon-stream:)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse(soapEnvelope("<u:SetAVTransportURIResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient("192.168.0.152");
    await client.setAVTransportURI("x-rincon-stream:RINCON_804AF28AAB2001400:0", "");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain("x-rincon-stream:RINCON_804AF28AAB2001400:0");
  });

  it("sends correct URI for TV audio grab (x-sonos-htastream:)", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(okResponse(soapEnvelope("<u:SetAVTransportURIResponse/>")));
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient("192.168.0.193");
    await client.setAVTransportURI("x-sonos-htastream:RINCON_74CA6093255801400:spdif", "");
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body as string).toContain("x-sonos-htastream:RINCON_74CA6093255801400:spdif");
  });
});

// ---- BecomeCoordinatorOfStandaloneGroup (group leave) ------------------------

describe("SonosClient.becomeCoordinatorOfStandaloneGroup", () => {
  it("sends the BecomeCoordinatorOfStandaloneGroup AVTransport action", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(
        okResponse(soapEnvelope("<u:BecomeCoordinatorOfStandaloneGroupResponse/>")),
      );
    vi.stubGlobal("fetch", mockFetch);
    const client = new SonosClient("192.168.0.63");
    await client.becomeCoordinatorOfStandaloneGroup();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("AVTransport");
    expect(init.headers as Record<string, string>).toMatchObject({
      SOAPACTION: expect.stringContaining("BecomeCoordinatorOfStandaloneGroup"),
    });
  });

  it("throws SonosError on SOAP fault", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(soapFaultResponse())));
    const client = new SonosClient("192.168.0.63");
    await expect(client.becomeCoordinatorOfStandaloneGroup()).rejects.toBeInstanceOf(SonosError);
  });
});

// ---- SOAP fault readability --------------------------------------------------

describe("SonosClient SOAP fault on HTTP 500", () => {
  // Real firmware returns faults as HTTP 500 with an <s:Fault> body. The error
  // must carry the parsed UPnP errorCode/description, not a raw XML dump.
  it("parses the UPnP fault out of an HTTP 500 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(soapFaultResponse()),
      }),
    );
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.setAVTransportURI("x-rincon:RINCON_X", "")).rejects.toThrow(
      /SOAP fault 714 , IllegalMimeType/,
    );
  });
});

// ---- GetZoneGroupState -----------------------------------------------------

describe("SonosClient.getZoneGroupState", () => {
  it("parses zone groups from topology XML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(zoneGroupStateResponse())));
    const client = new SonosClient(LIVING_ROOM_IP);
    const groups: ZoneGroup[] = await client.getZoneGroupState();

    expect(groups).toHaveLength(2);

    const livingRoom = groups.find((g) => g.coordinatorUuid === "RINCON_74CA6093255801400");
    expect(livingRoom).toBeDefined();
    expect(livingRoom?.members).toHaveLength(1);
    const lr0 = livingRoom?.members[0];
    expect(lr0?.zoneName).toBe("Living Room");
    expect(lr0?.ip).toBe("192.168.0.193");

    const desk = groups.find((g) => g.coordinatorUuid === "RINCON_804AF28AAB2001400");
    expect(desk).toBeDefined();
    expect(desk?.members).toHaveLength(2);
  });

  it("parses entity-encoded topology (real Sonos firmware format)", async () => {
    // Mirrors what a real device returns: the inner ZoneGroupState document is
    // ENTITY-encoded (not CDATA), wrapped in an outer <ZoneGroupState> element.
    const inner = entityEncode(
      `<ZoneGroupState><ZoneGroups>` +
        `<ZoneGroup Coordinator="RINCON_74CA6093255801400" ID="RINCON_74CA6093255801400:1">` +
        `<ZoneGroupMember UUID="RINCON_74CA6093255801400" Location="http://192.168.0.193:1400/xml/device_description.xml" ZoneName="Living Room" Icon=""/>` +
        `</ZoneGroup>` +
        `<ZoneGroup Coordinator="RINCON_804AF28AAB2001400" ID="RINCON_804AF28AAB2001400:5">` +
        `<ZoneGroupMember UUID="RINCON_804AF28AAB2001400" Location="http://192.168.0.152:1400/xml/device_description.xml" ZoneName="Desk" Icon=""/>` +
        `<ZoneGroupMember UUID="RINCON_804AF288FDBA01400" Location="http://192.168.0.161:1400/xml/device_description.xml" ZoneName="Desk" Icon=""/>` +
        `</ZoneGroup>` +
        `</ZoneGroups></ZoneGroupState>`,
    );
    const body = soapEnvelope(
      `<u:GetZoneGroupStateResponse xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1"><ZoneGroupState>${inner}</ZoneGroupState></u:GetZoneGroupStateResponse>`,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(body)));
    const client = new SonosClient(LIVING_ROOM_IP);
    const groups = await client.getZoneGroupState();

    expect(groups).toHaveLength(2);
    const livingRoom = groups.find((g) => g.coordinatorUuid === "RINCON_74CA6093255801400");
    expect(livingRoom?.members).toHaveLength(1);
    expect(livingRoom?.members[0]?.zoneName).toBe("Living Room");
    expect(livingRoom?.members[0]?.ip).toBe("192.168.0.193");
    const desk = groups.find((g) => g.coordinatorUuid === "RINCON_804AF28AAB2001400");
    expect(desk?.members).toHaveLength(2);
  });

  it("throws SonosError on SOAP fault", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(soapFaultResponse())));
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.getZoneGroupState()).rejects.toBeInstanceOf(SonosError);
  });
});

// ---- Browse FV:2 favorites -------------------------------------------------

describe("SonosClient.browseFavorites", () => {
  it("returns parsed favorites list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(browseFavoritesResponse())));
    const client = new SonosClient(LIVING_ROOM_IP);
    const favs: SonosFavorite[] = await client.browseFavorites();

    expect(favs).toHaveLength(1);
    const fav0 = favs[0];
    expect(fav0?.title).toBe("Riordan Radio");
    expect(fav0?.albumArtUri).toBe("http://example.com/radio.jpg");
    expect(fav0?.uri).toBe("x-sonosapi-radio:spotify%3AartistRadio%3A6v8FB84lnmJs434UByMr75");
  });

  it("parses entity-encoded favorites (real Sonos firmware format)", async () => {
    const didl = entityEncode(
      `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
        `<item id="FV:2/1"><dc:title>Riordan Radio</dc:title><upnp:albumArtURI>http://example.com/radio.jpg</upnp:albumArtURI><res>x-sonosapi-radio:spotify%3AartistRadio%3A6v8FB84lnmJs434UByMr75</res></item>` +
        `</DIDL-Lite>`,
    );
    const body = soapEnvelope(
      `<u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><Result>${didl}</Result><NumberReturned>1</NumberReturned><TotalMatches>1</TotalMatches><UpdateID>1</UpdateID></u:BrowseResponse>`,
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(body)));
    const client = new SonosClient(LIVING_ROOM_IP);
    const favs = await client.browseFavorites();

    expect(favs).toHaveLength(1);
    expect(favs[0]?.title).toBe("Riordan Radio");
    expect(favs[0]?.albumArtUri).toBe("http://example.com/radio.jpg");
    expect(favs[0]?.uri).toBe("x-sonosapi-radio:spotify%3AartistRadio%3A6v8FB84lnmJs434UByMr75");
  });

  it("returns empty array when no favorites exist", async () => {
    const emptyBrowse =
      soapEnvelope(`<u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <Result><![CDATA[<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"></DIDL-Lite>]]></Result>
      <NumberReturned>0</NumberReturned>
      <TotalMatches>0</TotalMatches>
      <UpdateID>1</UpdateID>
    </u:BrowseResponse>`);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(emptyBrowse)));
    const client = new SonosClient(LIVING_ROOM_IP);
    const favs = await client.browseFavorites();
    expect(favs).toHaveLength(0);
  });

  it("throws SonosError on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    const client = new SonosClient(LIVING_ROOM_IP);
    await expect(client.browseFavorites()).rejects.toBeInstanceOf(SonosError);
  });
});

// ---- SonosError is a proper Error subclass ---------------------------------

describe("SonosError", () => {
  it("is an instance of Error", () => {
    const err = new SonosError("test error");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SonosError");
    expect(err.message).toBe("test error");
  });
});

// ---- extractText limitation documentation (www-51hf.32) --------------------
// extractText uses non-greedy regex; it is only safe on leaf-node tags that
// Sonos UPnP responses always produce (volume, mute state, transport state,
// dc:title, etc.). These tests confirm the public API correctly parses the
// real flat shapes , and document the known limitation as an explicit comment
// rather than a hidden trap. Real SOAP responses are used (not raw XML) so we
// test through the public SonosClient API.

describe("extractText limitation , leaf-node tags in Sonos responses are always flat", () => {
  it("getVolume correctly extracts CurrentVolume from a flat SOAP envelope", async () => {
    // CurrentVolume is always a leaf node in Sonos RenderingControl responses;
    // it never nests inside another <CurrentVolume> element.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(volumeResponse(42))));
    const client = new SonosClient(LIVING_ROOM_IP);
    const vol = await client.getVolume();
    expect(vol).toBe(42);
  });

  it("getTransportInfo correctly extracts CurrentTransportState from a flat SOAP envelope", async () => {
    // CurrentTransportState is always a leaf; Sonos never nests it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(transportInfoResponse("PLAYING"))));
    const client = new SonosClient(LIVING_ROOM_IP);
    const info = await client.getTransportInfo();
    expect(info.state).toBe("PLAYING");
  });
});
