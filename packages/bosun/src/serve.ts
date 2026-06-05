// Pure request handler for the bosun deploy webhook receiver. cli.ts `serve`
// wires this into Bun.serve with the real deploy trigger; keeping it pure makes
// the auth + routing logic unit-testable without binding a socket or shelling
// out to a real `bosun up`.

export interface ServeOptions {
  // Stack this receiver deploys. The deploy path is namespaced by it so the
  // shared hooks.worldwidewebb.co host can front many projects.
  stackName: string;
  // Shared secret the CI caller must present as `Authorization: Bearer <token>`.
  token: string;
  // Trigger a deploy (`bosun up`). Injected so tests don't run a real deploy.
  // Trigger a deploy (`bosun up`). Injected so tests don't run a real deploy.
  // `imageOverrides` is the per-image digest map from the request body (CC-czg);
  // undefined when the caller sends no/invalid JSON body (legacy/manual).
  onDeploy: (imageOverrides?: Record<string, string>) => void;
}

export async function handleServeRequest(req: Request, opts: ServeOptions): Promise<Response> {
  const url = new URL(req.url);

  // Health check — no auth. Used by the service's httpProbe and CF.
  if (req.method === "GET" && url.pathname === "/up") {
    return new Response("ok", { status: 200 });
  }

  // Deploy endpoint — bearer auth. Path is /deploy/<stack> to match the CI
  // caller (POST https://hooks.worldwidewebb.co/deploy/control-center) and to
  // keep the hooks host multi-project shaped.
  if (req.method === "POST" && url.pathname === `/deploy/${opts.stackName}`) {
    const auth = req.headers.get("Authorization") ?? "";
    if (auth !== `Bearer ${opts.token}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    // The CI caller sends {"images": {"<ghcr-name>": "sha256:..."}} so the deploy
    // can pin images by digest (CC-czg). A missing or non-JSON body yields
    // undefined overrides — the legacy behaviour (deploy by :main tag).
    const images = await parseImageOverrides(req);
    // Fire-and-forget: respond immediately so the caller doesn't wait for the
    // full deploy (which can take minutes) and time out.
    opts.onDeploy(images);
    return new Response("Deploy triggered", { status: 202 });
  }

  return new Response("Not Found", { status: 404 });
}

// Extract the {"images": {...}} digest map from the request body, tolerating a
// missing/empty/invalid body (returns undefined) so legacy/manual callers that
// POST no body still trigger a normal deploy.
async function parseImageOverrides(req: Request): Promise<Record<string, string> | undefined> {
  try {
    const body = (await req.json()) as { images?: unknown };
    if (body && typeof body.images === "object" && body.images !== null) {
      return body.images as Record<string, string>;
    }
  } catch {
    // No body / not JSON — fall through to undefined.
  }
  return undefined;
}
