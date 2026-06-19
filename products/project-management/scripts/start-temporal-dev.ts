type ChildProcess = ReturnType<typeof Bun.spawn>;

function stopChildren(children: readonly ChildProcess[]): void {
  for (const child of children) child.kill();
}

async function waitForTemporal(address: string, timeoutMs: number): Promise<void> {
  const [hostname, portText] = address.split(":");
  const port = Number(portText);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const socket = await Bun.connect({ hostname, port, socket: {} });
      socket.end();
      return;
    } catch {
      await Bun.sleep(250);
    }
  }

  throw new Error(`Timed out waiting for Temporal dev server at ${address}`);
}

async function main(): Promise<number> {
  const address = Bun.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
  const temporal = Bun.spawn(["bun", "run", "temporal:server"], {
    stdout: "inherit",
    stderr: "inherit",
  });

  await waitForTemporal(address, 30_000);

  const worker = Bun.spawn(["bun", "run", "worker:temporal"], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const children = [temporal, worker] as const;

  process.on("SIGINT", () => {
    stopChildren(children);
    process.exit(130);
  });

  process.on("SIGTERM", () => {
    stopChildren(children);
    process.exit(143);
  });

  const firstExit = await Promise.race(children.map((child) => child.exited));
  stopChildren(children);
  return firstExit;
}

process.exit(await main());

export {};
