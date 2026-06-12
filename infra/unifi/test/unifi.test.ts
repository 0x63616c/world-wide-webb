import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, test } from "vitest";

// Pulumi runtime mocks: resource constructors resolve without a real backend,
// so we can assert the declared inputs (the adopt-only contract + the additive
// guest VLAN shape) as pure unit tests. The mock echoes inputs back as state,
// so each resource's output properties carry exactly what we declared. Must be
// installed before importing the module that instantiates resources.
pulumi.runtime.setMocks({
  newResource(args: pulumi.runtime.MockResourceArgs) {
    return { id: `${args.name}-id`, state: args.inputs };
  },
  call(args: pulumi.runtime.MockCallArgs) {
    // getApGroup data source: return the default AP group id the WLAN attaches to.
    if (args.token.includes("getApGroup")) {
      return { id: "ap-group-default" };
    }
    return {};
  },
});

let mod: typeof import("../src/unifi.ts");
beforeAll(async () => {
  mod = await import("../src/unifi.ts");
});

const testProvider = () => mod.makeProvider({ apiUrl: "https://test", apiKey: "test-key" });

// Read a single output property off a resource (mock records inputs as state).
function get<T>(r: pulumi.Resource, prop: string): Promise<T> {
  const out = (r as unknown as Record<string, pulumi.Output<T>>)[prop];
  return new Promise((resolve) => {
    out.apply((v) => {
      resolve(v);
      return v;
    });
  });
}

describe("IMPORT_IDS", () => {
  test("site-scoped types carry the `default:` prefix; bare-id types do not", () => {
    expect(mod.IMPORT_IDS.defaultNetwork).toBe("69334b751c01c943e7e9a93a");
    expect(mod.IMPORT_IDS.worldWideWebbWlan).toBe("6934b503428b6c14e973b740");
    expect(mod.IMPORT_IDS.captivePortalDns.startsWith("default:")).toBe(true);
    expect(mod.IMPORT_IDS.guestAccess.startsWith("default:")).toBe(true);
  });

  test("rsyslogd is NOT managed (provider cannot round-trip it on 10.4.57; CC-2gpa)", () => {
    expect("rsyslogd" in mod.IMPORT_IDS).toBe(false);
  });
});

describe("adoptExisting", () => {
  test("adopts 1:1 over the passed fixed-IP reservations, no rsyslogd", () => {
    // Count-agnostic: adopt maps exactly the reservations the program hands it
    // (the live baseline is 2 today, homeassistant .147 + NAS .218; CC-j934.3.1).
    const reservations = Array.from({ length: 2 }, (_, i) => ({
      logicalName: `client-${i}`,
      importId: `id-${i}`,
      mac: `00:00:00:00:00:${i.toString(16).padStart(2, "0")}`,
    }));
    const adopted = mod.adoptExisting(testProvider(), reservations);
    expect(adopted.defaultNetwork).toBeDefined();
    expect(adopted.worldWideWebbWlan).toBeDefined();
    expect(adopted.captivePortalDns).toBeDefined();
    expect(adopted.guestAccess).toBeDefined();
    expect(adopted.fixedIpUsers).toHaveLength(reservations.length);
    expect((adopted as unknown as Record<string, unknown>).rsyslogd).toBeUndefined();
  });

  test("the captive-portal DNS record adopts the live host -> .147 mapping", async () => {
    const adopted = mod.adoptExisting(testProvider(), []);
    expect(await get<string>(adopted.captivePortalDns, "name")).toBe(
      "captive-portal.worldwidewebb.co",
    );
    expect(await get<string>(adopted.captivePortalDns, "value")).toBe("192.168.0.147");
  });
});

describe("createGuestVlan (additive, gated, OPEN captive-portal guest net)", () => {
  test("OPEN isolated guest SSID (no passphrase) + the single scoped portal allow rule", async () => {
    // No passphrase: www-guest is an OPEN network. Access is gated by the
    // captive portal (guest_access external portal, CC-q002.15), not a wifi
    // password (CC-j934.3.2).
    const guest = mod.createGuestVlan(testProvider(), {
      vlanId: 20,
      subnet: "192.168.20.1/24",
      dhcpStart: "192.168.20.6",
      dhcpStop: "192.168.20.254",
      ssid: "www-guest",
      portalHost: "192.168.0.147",
      firewallRuleIndex: 2000,
    });

    expect(await get<string>(guest.network, "purpose")).toBe("guest");
    expect(await get<boolean>(guest.network, "networkIsolationEnabled")).toBe(true);
    expect(await get<number>(guest.network, "vlanId")).toBe(20);

    // OPEN security, no WPA password; still a guest network (client isolation +
    // guest-control behaviors), so guests are isolated and portal-gated.
    expect(await get<string>(guest.wlan, "security")).toBe("open");
    expect(await get<boolean>(guest.wlan, "isGuest")).toBe(true);
    // Explicit client isolation: guests can't reach each other on the open SSID.
    expect(await get<boolean>(guest.wlan, "l2Isolation")).toBe(true);
    expect(await get<string | undefined>(guest.wlan, "passphrase")).toBeFalsy();
    // Assigned to the default AP group (else the controller errors ApGroupMissing).
    expect(await get<string[]>(guest.wlan, "apGroupIds")).toEqual(["ap-group-default"]);

    // The one scoped cross-VLAN allowance: guest -> portal .147 on 80/443.
    expect(await get<string>(guest.portalAllowRule, "action")).toBe("accept");
    expect(await get<string>(guest.portalAllowRule, "dstAddress")).toBe("192.168.0.147");
    expect(await get<string>(guest.portalAllowRule, "dstPort")).toBe("80,443");
    expect(await get<string>(guest.portalAllowRule, "ruleset")).toBe("LAN_IN");
  });
});
