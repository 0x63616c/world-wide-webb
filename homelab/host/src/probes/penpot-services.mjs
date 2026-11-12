// Probe only local service protocols; never emit bodies, credentials or sessions.
const role = process.argv[1];
try {
  const request = (url, options = {}) =>
    fetch(url, {
      ...options,
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
  if (role === "exporter") {
    const response = await request("http://127.0.0.1:6061/readyz");
    if (response.status !== 200 || (await response.text()).trim() !== "OK")
      throw new Error();
  } else if (role === "admin") {
    const response = await request("http://127.0.0.1:3000/admin-console");
    if (![200, 302, 303, 307, 308].includes(response.status)) throw new Error();
  } else if (role === "mcp") {
    const url = "http://127.0.0.1:4401/mcp";
    const response = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "homelab-health", version: "1" },
        },
      }),
    });
    const session = response.headers.get("mcp-session-id");
    try {
      if (response.status !== 200) throw new Error();
      const text = await response.text();
      const event = text.split("\n").find((line) => line.startsWith("data:"));
      const data = event ? event.slice(5).trim() : text;
      const body = JSON.parse(data);
      if (
        body.id !== 1 ||
        !body.result?.serverInfo?.name ||
        typeof body.result?.capabilities !== "object"
      )
        throw new Error();
    } finally {
      if (session)
        await request(url, {
          method: "DELETE",
          headers: { "mcp-session-id": session },
        });
    }
  } else throw new Error();
} catch {
  process.exitCode = 1;
}
