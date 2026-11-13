// Keep responses inside the container; emit only facts needed by the health gate.
try {
  const read = async (path) => {
    const response = await fetch(`http://127.0.0.1:4201${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Unhealthy HTTP response");
    return response.json();
  };
  const [health, build] = await Promise.all([
    read("/healthz"),
    read("/trpc/health.buildHash"),
  ]);
  const data = build?.result?.data;
  const sourceRevision = (data?.json ?? data)?.hash;
  const workersEnabled = health?.cycles?.enabled;
  if (
    typeof health?.database !== "string" ||
    typeof health?.stopping !== "boolean" ||
    typeof workersEnabled !== "boolean" ||
    typeof sourceRevision !== "string"
  ) {
    throw new Error("Missing health facts");
  }
  console.log(
    JSON.stringify({
      database: health.database,
      stopping: health.stopping,
      workersEnabled,
      sourceRevision,
    }),
  );
} catch {
  process.exitCode = 1;
}
