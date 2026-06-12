import { describe, expect, test } from "vitest";

import { selectFixedIpReservations } from "../src/manifest.ts";

// The root-cause guard for CC-j934.3.1: the fixed-IP manifest must contain ONLY
// genuine reservations (`use_fixedip === true`), never the plain client records
// UniFi auto-tracks for every device it has ever seen. The original manifest was
// hand-curated and silently mixed 19 non-reservations in among the 2 real ones,
// and dropped homeassistant (.147, the portal host) entirely. This filter is the
// single derivation point so that can't recur.

// A realistic slice of the controller's rest/user payload: 4 records, only 2 of
// which are actually pinned. (Field names mirror the UniFi REST shape.)
const RAW_USERS = [
  {
    _id: "aaa111",
    mac: "ba:5d:f7:ba:d0:9d",
    name: "homeassistant",
    use_fixedip: true,
    fixed_ip: "192.168.0.147",
  },
  {
    _id: "bbb222",
    mac: "90:09:d0:16:0b:db",
    name: "NAS - HomeTB",
    use_fixedip: true,
    fixed_ip: "192.168.0.218",
  },
  // Plain auto-tracked clients: use_fixedip false / absent. MUST be excluded.
  { _id: "ccc333", mac: "80:4a:f2:8c:fd:68", name: "Sonos", use_fixedip: false },
  { _id: "ddd444", mac: "00:11:22:33:44:55", hostname: "philips-hue" },
];

describe("selectFixedIpReservations", () => {
  test("keeps ONLY use_fixedip===true clients (drops auto-tracked records)", () => {
    const res = selectFixedIpReservations(RAW_USERS);
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.importId).sort()).toEqual(["aaa111", "bbb222"]);
  });

  test("includes homeassistant .147 (the portal host the old manifest dropped)", () => {
    const res = selectFixedIpReservations(RAW_USERS);
    const ha = res.find((r) => r.mac === "ba:5d:f7:ba:d0:9d");
    expect(ha).toBeDefined();
    expect(ha?.importId).toBe("aaa111");
    expect(ha?.name).toBe("homeassistant");
  });

  test("maps to the manifest entry shape (logicalName, importId, mac, name)", () => {
    const res = selectFixedIpReservations(RAW_USERS);
    const nas = res.find((r) => r.importId === "bbb222");
    expect(nas).toMatchObject({
      importId: "bbb222",
      mac: "90:09:d0:16:0b:db",
      name: "NAS - HomeTB",
    });
    // logicalName is a stable, lowercase, Pulumi-safe slug derived from the name.
    expect(nas?.logicalName).toBe("nas-hometb");
  });

  test("derives logicalName from hostname when name is absent", () => {
    const res = selectFixedIpReservations([
      { _id: "x", mac: "aa:aa:aa:aa:aa:aa", hostname: "Robodog", use_fixedip: true },
    ]);
    expect(res[0]?.logicalName).toBe("robodog");
  });

  test("de-duplicates colliding logicalNames so Pulumi resource names stay unique", () => {
    const res = selectFixedIpReservations([
      { _id: "1", mac: "aa:aa:aa:aa:aa:01", name: "Sonos", use_fixedip: true },
      { _id: "2", mac: "aa:aa:aa:aa:aa:02", name: "Sonos", use_fixedip: true },
    ]);
    expect(res).toHaveLength(2);
    expect(new Set(res.map((r) => r.logicalName)).size).toBe(2);
  });
});
