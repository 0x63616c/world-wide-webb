import { describe, expect, test } from "vitest";
import { type ImageDigests, serviceSpecs } from "../src/services.ts";

// The digest-pinning seam (www-j934.14): the CI deploy job sets a per-service
// digest map as Pulumi config (`imageDigests.<svc>`), serviceSpecs renders each
// GHCR ref as @sha256:… when a digest is supplied and falls back to the mutable
// :main tag otherwise. A changed digest is a changed Deployment image, so only
// that workload rolls on `pulumi up` (the www-czg property, now driven by the
// digest-pinned Pulumi program).

const imageOf = (specs: ReturnType<typeof serviceSpecs>, logicalName: string): string => {
  const spec = specs.find((s) => s.logicalName === logicalName);
  if (!spec) throw new Error(`no spec for ${logicalName}`);
  return spec.image;
};

// serviceSpecs takes the full ServiceSpecOptions object; only imageDigests is
// under test here, so the replica/NFS knobs are held at their defaults.
const specsWith = (imageDigests?: ImageDigests): ReturnType<typeof serviceSpecs> =>
  serviceSpecs({
    mediaWorkerReplicas: 0,
    cloudflaredReplicas: 2,
    storybookReplicas: 0,
    drizzleReplicas: 0,
    nasNfsServer: "192.168.0.218",
    imageDigests,
  });

const VALID = `sha256:${"a".repeat(64)}`;

describe("serviceSpecs image digest pinning", () => {
  test("falls back to the :main tag when no digest is supplied", () => {
    const specs = specsWith();
    expect(imageOf(specs, "control-center-api")).toBe(
      "ghcr.io/0x63616c/www-control-center-api:main",
    );
    expect(imageOf(specs, "control-center-web")).toBe(
      "ghcr.io/0x63616c/www-control-center-web:main",
    );
    expect(imageOf(specs, "amp-app")).toBe("ghcr.io/0x63616c/www-amp-app:main");
  });

  test("pins the GHCR ref by digest when one is supplied for that service", () => {
    const specs = specsWith({ "control-center-api": VALID });
    expect(imageOf(specs, "control-center-api")).toBe(
      `ghcr.io/0x63616c/www-control-center-api@${VALID}`,
    );
  });

  test("pins only the services in the map; the rest stay on :main", () => {
    const specs = specsWith({ "control-center-web": VALID });
    expect(imageOf(specs, "control-center-web")).toBe(
      `ghcr.io/0x63616c/www-control-center-web@${VALID}`,
    );
    // worker has no digest, so it must NOT roll: still the mutable tag.
    expect(imageOf(specs, "control-center-worker")).toBe(
      "ghcr.io/0x63616c/www-control-center-worker:main",
    );
  });

  test("pins the AMP image through its product-aware repository name", () => {
    const specs = specsWith({ "amp-app": VALID });
    expect(imageOf(specs, "amp-app")).toBe(`ghcr.io/0x63616c/www-amp-app@${VALID}`);
  });

  test("the upstream cloudflared image is never digest-pinned by this map", () => {
    const specs = specsWith();
    expect(imageOf(specs, "platform-cloudflared")).toBe("cloudflare/cloudflared:2025.10.1");
  });

  test("rejects old component-only digest keys to prevent product collisions", () => {
    expect(() => specsWith({ api: VALID } as ImageDigests)).toThrow(/product-component/);
    expect(() => specsWith({ web: VALID } as ImageDigests)).toThrow(/product-component/);
    expect(() => specsWith({ cloudflared: VALID } as ImageDigests)).toThrow(/product-component/);
  });

  test("rejects a malformed digest so a bad config value can't ship an unpullable ref", () => {
    expect(() => specsWith({ "control-center-api": "not-a-digest" })).toThrow(/sha256/);
    expect(() => specsWith({ "control-center-api": "sha256:tooshort" })).toThrow(/sha256/);
  });
});
