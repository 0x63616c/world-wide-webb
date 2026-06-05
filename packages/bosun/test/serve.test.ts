import { describe, expect, it, vi } from "vitest";
import { handleServeRequest } from "../src/serve.ts";

// The receiver routes CI deploy webhooks. Path is namespaced per stack so the
// shared hooks.worldwidewebb.co host can front many projects: /deploy/<stack>.
const STACK = "control-center";
const TOKEN = "s3cret-token";

function opts(onDeploy = vi.fn()) {
  return { stackName: STACK, token: TOKEN, onDeploy };
}

function post(path: string, auth?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (auth) headers.Authorization = auth;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost:4202${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("serve — webhook receiver request handling", () => {
  it("answers GET /up with 200 and no auth (health probe)", async () => {
    const res = await handleServeRequest(new Request("http://localhost:4202/up"), opts());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("triggers deploy + 202 on POST /deploy/<stack> with the correct bearer token", async () => {
    const onDeploy = vi.fn();
    const res = await handleServeRequest(
      post(`/deploy/${STACK}`, `Bearer ${TOKEN}`),
      opts(onDeploy),
    );
    expect(res.status).toBe(202);
    expect(onDeploy).toHaveBeenCalledOnce();
  });

  it("rejects a wrong token with 401 and does NOT deploy", async () => {
    const onDeploy = vi.fn();
    const res = await handleServeRequest(post(`/deploy/${STACK}`, "Bearer nope"), opts(onDeploy));
    expect(res.status).toBe(401);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header with 401", async () => {
    const onDeploy = vi.fn();
    const res = await handleServeRequest(post(`/deploy/${STACK}`), opts(onDeploy));
    expect(res.status).toBe(401);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("does NOT accept the legacy un-namespaced /deploy path (regression guard)", async () => {
    const onDeploy = vi.fn();
    const res = await handleServeRequest(post("/deploy", `Bearer ${TOKEN}`), opts(onDeploy));
    expect(res.status).toBe(404);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("does NOT accept a different stack's deploy path", async () => {
    const onDeploy = vi.fn();
    const res = await handleServeRequest(
      post("/deploy/other-project", `Bearer ${TOKEN}`),
      opts(onDeploy),
    );
    expect(res.status).toBe(404);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handleServeRequest(post("/", `Bearer ${TOKEN}`), opts());
    expect(res.status).toBe(404);
  });

  // CC-czg: CI sends the per-image digest map in the JSON body; the handler
  // forwards it to onDeploy so the deploy pins images by digest.
  it("forwards the body's image digest map to onDeploy", async () => {
    const onDeploy = vi.fn();
    const images = { "control-center-bosun": "sha256:abc123" };
    const res = await handleServeRequest(
      post(`/deploy/${STACK}`, `Bearer ${TOKEN}`, { images }),
      opts(onDeploy),
    );
    expect(res.status).toBe(202);
    expect(onDeploy).toHaveBeenCalledWith(images);
  });

  it("deploys with undefined overrides when the body is missing or not JSON (backward compatible)", async () => {
    const onDeploy = vi.fn();
    const res = await handleServeRequest(
      post(`/deploy/${STACK}`, `Bearer ${TOKEN}`),
      opts(onDeploy),
    );
    expect(res.status).toBe(202);
    expect(onDeploy).toHaveBeenCalledWith(undefined);
  });
});
