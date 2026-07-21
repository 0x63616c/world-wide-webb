import { describe, expect, it } from "vitest";
import { portalClient } from "./trpc";

// The App (task 2.5) will drive runEffect(portalClient, effect); this just
// proves the vanilla tRPC client is wired to the PortalClient shape
// effects.ts expects, without hitting the network (constructing the client
// doesn't issue a request).
describe("portalClient", () => {
  it("implements the PortalClient surface effects.ts consumes", () => {
    expect(typeof portalClient.checkPassword).toBe("function");
    expect(typeof portalClient.authorize).toBe("function");
    expect(typeof portalClient.status).toBe("function");
  });
});
