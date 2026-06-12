// Fixed-IP manifest derivation (CC-j934.3.1).
//
// The adopt-only baseline imports each genuine DHCP reservation as a
// `unifi.iam.User`. The list of reservations lives in an off-repo manifest
// (~/cc-j934-unifi-baseline/fixed-ip-manifest.json) because it carries client
// MACs. That manifest used to be hand-curated, which let it drift: 19 plain
// auto-tracked client records were mislabelled as reservations and the one that
// mattered (homeassistant .147, the portal host) was dropped.
//
// This module is the SINGLE derivation point. `selectFixedIpReservations` is the
// pure filter (testable, hermetic); `scripts/gen-fixed-ip-manifest.ts` feeds it
// the live controller payload and writes the manifest. A reservation is exactly
// a client with `use_fixedip === true` on the controller, nothing else.

/** A single fixed-IP reservation, as stored in the manifest the program reads. */
export interface FixedIpReservation {
  // Stable, lowercase, unique Pulumi resource name (slug of the client label).
  logicalName: string;
  // The UniFi client `_id`, used as the `pulumi import` id for the iam.User.
  importId: string;
  // The client MAC (the required key to import a User).
  mac: string;
  // Human label, surfaced in the resource for readability (optional).
  name?: string;
}

/**
 * @public - the relevant subset of a UniFi `rest/user` record. The controller
 * returns one of these for EVERY client it has ever seen; only those with
 * `use_fixedip === true` are real reservations.
 */
export interface RawUnifiUser {
  _id: string;
  mac: string;
  name?: string;
  hostname?: string;
  use_fixedip?: boolean;
  fixed_ip?: string;
}

// Lowercase, collapse any non-alphanumeric run to a single dash, trim dashes.
// "NAS - HomeTB" -> "nas-hometb". Falls back to a mac-derived slug if a client
// has neither a name nor a hostname.
function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "client";
}

/**
 * @public - derive the manifest reservation list from the controller's raw user
 * payload. Keeps ONLY `use_fixedip === true` clients (the structural fix for
 * CC-j934.3.1), maps each to the manifest entry shape, and de-duplicates
 * colliding logicalNames (`sonos`, `sonos-2`, ...) so Pulumi resource names stay
 * unique. Order is preserved from the input.
 */
export function selectFixedIpReservations(users: RawUnifiUser[]): FixedIpReservation[] {
  const seen = new Map<string, number>();
  return users
    .filter((u) => u.use_fixedip === true)
    .map((u) => {
      const base = slugify(u.name ?? u.hostname ?? u.mac);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const logicalName = count === 0 ? base : `${base}-${count + 1}`;
      return {
        logicalName,
        importId: u._id,
        mac: u.mac,
        ...(u.name ? { name: u.name } : {}),
      };
    });
}
