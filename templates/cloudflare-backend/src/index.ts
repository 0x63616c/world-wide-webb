type Environment = {
  ENVIRONMENT: "staging" | "production";
  RELEASE_REVISION: string;
};

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== "/healthz") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (request.method !== "GET") {
      return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });
    }
    return Response.json(
      { status: "ok", environment: env.ENVIRONMENT, revision: env.RELEASE_REVISION },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
};
