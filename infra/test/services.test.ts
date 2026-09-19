import { describe, expect, test } from "vitest";
import { LAN_SERVICE_IPS, METALLB_ADDRESS_POOL_RANGE } from "../src/metallb.ts";
import {
  composeGhcrDockerConfigJson,
  haTarget,
  parseSubstrate,
  parseSubstrateTarget,
  plexAdvertiseIp,
} from "../src/services.ts";

// The pure string builder pulled out of deployServices (www-j934.6): the GHCR
// imagePullSecret `.dockerconfigjson`. It takes plain inputs and returns a
// deterministic string, so its credential encoding and exact wire shape are
// unit-testable without instantiating any Pulumi resource. deployServices just
// feeds vault values through it.

describe("composeGhcrDockerConfigJson", () => {
  const decode = (json: string) =>
    JSON.parse(json) as {
      auths: Record<string, { username: string; password: string; auth: string }>;
    };

  test("emits a single ghcr.io auth entry with the org username and PAT", () => {
    const entry = decode(composeGhcrDockerConfigJson("ghp_token")).auths["ghcr.io"];
    expect(entry.username).toBe("0x63616c");
    expect(entry.password).toBe("ghp_token");
  });

  test("auth is base64('username:pat') for the registry Basic-auth header", () => {
    const entry = decode(composeGhcrDockerConfigJson("ghp_token")).auths["ghcr.io"];
    expect(entry.auth).toBe(Buffer.from("0x63616c:ghp_token").toString("base64"));
    expect(Buffer.from(entry.auth, "base64").toString()).toBe("0x63616c:ghp_token");
  });

  test("only ghcr.io is present (no other registries leak in)", () => {
    expect(Object.keys(decode(composeGhcrDockerConfigJson("t")).auths)).toEqual(["ghcr.io"]);
  });

  test("pins the exact wire shape for a known PAT", () => {
    expect(composeGhcrDockerConfigJson("ghp_token")).toBe(
      JSON.stringify({
        auths: {
          "ghcr.io": {
            username: "0x63616c",
            password: "ghp_token",
            auth: Buffer.from("0x63616c:ghp_token").toString("base64"),
          },
        },
      }),
    );
  });

  test("is deterministic: identical PAT yields byte-identical output", () => {
    expect(composeGhcrDockerConfigJson("ghp_token")).toBe(composeGhcrDockerConfigJson("ghp_token"));
  });
});

// The `substrate` flag (mini-migration Task 3): haTarget/plexAdvertiseIp must
// keep the mini's ("orbstack") values byte-identical to today's live deploy
// when the flag is absent, and switch to the node LAN IP on "talos".
describe("parseSubstrate", () => {
  test("undefined config defaults to orbstack (the mini)", () => {
    expect(parseSubstrate(undefined)).toBe("orbstack");
  });

  test("accepts the two known substrates verbatim", () => {
    expect(parseSubstrate("orbstack")).toBe("orbstack");
    expect(parseSubstrate("talos")).toBe("talos");
  });

  test("rejects an unknown substrate value", () => {
    expect(() => parseSubstrate("swarm")).toThrow(/wwwinfra:substrate/);
  });
});

describe("haTarget", () => {
  test("ha target is the node LAN IP on talos (api/worker are non-hostNetwork pods)", () => {
    expect(haTarget({ substrate: "talos", nodeIp: "192.168.0.5" })).toBe("192.168.0.5");
    expect(haTarget({ substrate: "orbstack" })).toBe("homelab.tail8c014d.ts.net");
  });
});

describe("plexAdvertiseIp", () => {
  // Nothing listens on :32400 in the node's netns - Plex is reached only
  // through its MetalLB LoadBalancer - so advertising the node IP hands every
  // client a refused connection.
  test("plex advertise uses the LoadBalancer address, not the node IP, on talos", () => {
    expect(plexAdvertiseIp({ substrate: "talos", nodeIp: "192.168.0.5" })).toBe(
      `http://${LAN_SERVICE_IPS.plex}:32400`,
    );
    expect(plexAdvertiseIp({ substrate: "talos", nodeIp: "192.168.0.5" })).not.toContain(
      "192.168.0.5",
    );
  });

  test("orbstack is the mini's frozen LAN IP", () => {
    expect(plexAdvertiseIp({ substrate: "orbstack" })).toBe("http://192.168.0.147:32400");
  });
});

// The pinned addresses and the pool they come from live in the same file, but
// nothing stops one being edited without the other; an out-of-pool pin leaves
// the Service permanently <pending>.
describe("LAN_SERVICE_IPS", () => {
  test("every pinned address falls inside the MetalLB pool range", () => {
    const [start, end] = METALLB_ADDRESS_POOL_RANGE.split("-");
    const asNumber = (ip: string) =>
      ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);

    for (const ip of Object.values(LAN_SERVICE_IPS)) {
      expect(asNumber(ip)).toBeGreaterThanOrEqual(asNumber(start));
      expect(asNumber(ip)).toBeLessThanOrEqual(asNumber(end));
    }
  });

  test("no two services are pinned to the same address", () => {
    const addresses = Object.values(LAN_SERVICE_IPS);
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});

// Task 4's deferred Task-3 cleanup: a talos SubstrateTarget always carries its
// nodeIp by construction (no `nodeIp?: string` default-"" footgun), so the
// only place a nodeIp is ever attached to a substrate is this boundary function.
describe("parseSubstrateTarget", () => {
  test("undefined config defaults to orbstack, with no nodeIp field at all", () => {
    expect(parseSubstrateTarget(undefined, undefined)).toEqual({ substrate: "orbstack" });
  });

  test("talos with an explicit nodeIp config value", () => {
    expect(parseSubstrateTarget("talos", "10.0.0.9")).toEqual({
      substrate: "talos",
      nodeIp: "10.0.0.9",
    });
  });

  test("talos with no nodeIp config falls back to the locked static IP", () => {
    expect(parseSubstrateTarget("talos", undefined)).toEqual({
      substrate: "talos",
      nodeIp: "192.168.0.5",
    });
  });

  test("talos with an empty-string nodeIp config also falls back (not a silent empty nodeIp)", () => {
    expect(parseSubstrateTarget("talos", "")).toEqual({
      substrate: "talos",
      nodeIp: "192.168.0.5",
    });
  });

  test("orbstack ignores any nodeIp value entirely (the field doesn't exist on this variant)", () => {
    expect(parseSubstrateTarget("orbstack", "10.0.0.9")).toEqual({ substrate: "orbstack" });
  });

  test("rejects an unknown substrate value (delegates to parseSubstrate)", () => {
    expect(() => parseSubstrateTarget("swarm", undefined)).toThrow(/wwwinfra:substrate/);
  });
});
