import { describe, expect, it, vi } from "vitest";
import { handleServeRequest } from "../src/serve.ts";

// The receiver routes CI deploy webhooks. Path is namespaced per stack so the
// shared hooks.worldwidewebb.co host can front many projects: /deploy/<stack>.
const STACK = "control-center";
const TOKEN = "s3cret-token";

function opts(onDeploy = vi.fn()) {
  return { stackName: STACK, token: TOKEN, onDeploy };
}

function post(path: string, auth?: string) {
  const headers = auth ? { Authorization: auth } : undefined;
  return new Request(`http://localhost:4202${path}`, { method: "POST", headers });
}

describe("serve — webhook receiver request handling", () => {
  it("answers GET /up with 200 and no auth (health probe)", async () => {
    const res = handleServeRequest(new Request("http://localhost:4202/up"), opts());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("triggers deploy + 202 on POST /deploy/<stack> with the correct bearer token", () => {
    const onDeploy = vi.fn();
    const res = handleServeRequest(post(`/deploy/${STACK}`, `Bearer ${TOKEN}`), opts(onDeploy));
    expect(res.status).toBe(202);
    expect(onDeploy).toHaveBeenCalledOnce();
  });

  it("rejects a wrong token with 401 and does NOT deploy", () => {
    const onDeploy = vi.fn();
    const res = handleServeRequest(post(`/deploy/${STACK}`, "Bearer nope"), opts(onDeploy));
    expect(res.status).toBe(401);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header with 401", () => {
    const onDeploy = vi.fn();
    const res = handleServeRequest(post(`/deploy/${STACK}`), opts(onDeploy));
    expect(res.status).toBe(401);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("does NOT accept the legacy un-namespaced /deploy path (regression guard)", () => {
    const onDeploy = vi.fn();
    const res = handleServeRequest(post("/deploy", `Bearer ${TOKEN}`), opts(onDeploy));
    expect(res.status).toBe(404);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("does NOT accept a different stack's deploy path", () => {
    const onDeploy = vi.fn();
    const res = handleServeRequest(
      post("/deploy/other-project", `Bearer ${TOKEN}`),
      opts(onDeploy),
    );
    expect(res.status).toBe(404);
    expect(onDeploy).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown paths", () => {
    const res = handleServeRequest(post("/", `Bearer ${TOKEN}`), opts());
    expect(res.status).toBe(404);
  });
});
