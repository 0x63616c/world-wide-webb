import { describe, expect, test } from "vitest";
import { type ImageDigests, serviceSpecs } from "../src/services.ts";

// The digest-pinning seam (CC-j934.14): the CI deploy job sets a per-service
// digest map as Pulumi config (`imageDigests.<svc>`), serviceSpecs renders each
// GHCR ref as @sha256:… when a digest is supplied and falls back to the mutable
// :main tag otherwise. A changed digest is a changed Deployment image, so only
// that workload rolls on `pulumi up` (the CC-czg property, formerly the bosun
// webhook's digest-pinned `docker stack deploy`).

const imageOf = (specs: ReturnType<typeof serviceSpecs>, name: string): string => {
  const spec = specs.find((s) => s.name === name);
  if (!spec) throw new Error(`no spec for ${name}`);
  return spec.image;
};

// serviceSpecs takes the full ServiceSpecOptions object; only imageDigests is
// under test here, so the replica/NFS knobs are held at their defaults.
const specsWith = (imageDigests?: ImageDigests): ReturnType<typeof serviceSpecs> =>
  serviceSpecs({
    mediaWorkerReplicas: 0,
    cloudflaredReplicas: 2,
    nasNfsServer: "192.168.0.218",
    imageDigests,
  });

const VALID = `sha256:${"a".repeat(64)}`;

describe("serviceSpecs image digest pinning", () => {
  test("falls back to the :main tag when no digest is supplied", () => {
    const specs = specsWith();
    expect(imageOf(specs, "api")).toBe("ghcr.io/0x63616c/control-center-api:main");
    expect(imageOf(specs, "web")).toBe("ghcr.io/0x63616c/control-center-web:main");
  });

  test("pins the GHCR ref by digest when one is supplied for that service", () => {
    const specs = specsWith({ api: VALID });
    expect(imageOf(specs, "api")).toBe(`ghcr.io/0x63616c/control-center-api@${VALID}`);
  });

  test("pins only the services in the map; the rest stay on :main", () => {
    const specs = specsWith({ web: VALID });
    expect(imageOf(specs, "web")).toBe(`ghcr.io/0x63616c/control-center-web@${VALID}`);
    // worker has no digest, so it must NOT roll: still the mutable tag.
    expect(imageOf(specs, "worker")).toBe("ghcr.io/0x63616c/control-center-worker:main");
  });

  test("the upstream cloudflared image is never digest-pinned by this map", () => {
    const specs = specsWith({ cloudflared: VALID } as ImageDigests);
    expect(imageOf(specs, "cloudflared")).toBe("cloudflare/cloudflared:2025.10.1");
  });

  test("rejects a malformed digest so a bad config value can't ship an unpullable ref", () => {
    expect(() => specsWith({ api: "not-a-digest" })).toThrow(/sha256/);
    expect(() => specsWith({ api: "sha256:tooshort" })).toThrow(/sha256/);
  });
});
