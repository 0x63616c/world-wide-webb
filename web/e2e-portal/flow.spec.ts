import { expect, type Page, type Route, test } from "@playwright/test";

/**
 * Full portal journey (SDD track 0, task 2.6, password-only reality). Drives
 * the real reducer/UI through `/trpc/portal.*` with `page.route` mocking the
 * transport — this exercises the actual httpBatchLink client
 * (src/portal/lib/trpc.ts) and effect runner (src/portal/flow/effects.ts)
 * end to end, not a stub of them.
 *
 * Wire shapes are taken from the real server (products/control-center/api/src/trpc/routers/portal.ts
 * + init.ts's errorFormatter): success is a one-element batch array of
 * `{ result: { data } }`; a typed PortalError is `{ error: { code, message,
 * data: { portalCode } } }` — `data.portalCode` is the STRUCTURAL channel
 * effects.ts's parsePortalError prefers.
 */
const MAC = "aa:bb:cc:dd:ee:ff";

function procedureFromUrl(url: string): string {
  const match = url.match(/\/trpc\/portal\.(\w+)/);
  return match?.[1] ?? "";
}

// React StrictMode's dev-only double-invoke means the boot status effect
// fires twice in quick succession; httpBatchLink coalesces both into ONE
// request whose URL/body carries N sub-calls (portal.status,portal.status).
// The batch response array must have exactly N entries or the client's
// per-index resolution throws (silently swallowed by App.tsx's .catch, which
// looks like "nothing happened" — verified against the running app). Count N
// from the GET `input` object's keys (queries) or the POST body array length
// (mutations), and replicate the single logical result that many times.
function batchSizeFromRequest(route: Route): number {
  const req = route.request();
  if (req.method() === "GET") {
    const input = new URL(req.url()).searchParams.get("input");
    if (!input) return 1;
    return Math.max(1, Object.keys(JSON.parse(input)).length);
  }
  const body = req.postDataJSON();
  return Array.isArray(body) ? Math.max(1, body.length) : 1;
}

function ok(data: unknown) {
  return { result: { data } };
}

function portalError(portalCode: string, message: string, httpStatus: number) {
  return {
    error: {
      code: -32600,
      message: `${portalCode}: ${message}`,
      data: { code: "BAD_REQUEST", httpStatus, path: "portal", portalCode },
    },
  };
}

async function fulfillJson(route: Route, entry: unknown, status = 200) {
  const body = Array.from({ length: batchSizeFromRequest(route) }, () => entry);
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Mocks all three portal procedures for one test. `status` covers the boot
 *  status call; `checkPassword`/`authorize` are handlers invoked per call so
 *  a test can vary the outcome (e.g. wrong password). */
async function mockPortal(
  page: Page,
  handlers: {
    status?: () => unknown;
    checkPassword?: () => unknown;
    authorize?: () => unknown;
  },
) {
  await page.route("**/trpc/portal.*", async (route) => {
    const proc = procedureFromUrl(route.request().url());
    if (proc === "status") return fulfillJson(route, handlers.status?.() ?? ok({ state: "fresh" }));
    if (proc === "checkPassword")
      return fulfillJson(route, handlers.checkPassword?.() ?? ok({ ok: true }));
    if (proc === "authorize")
      return fulfillJson(route, handlers.authorize?.() ?? ok({ authorized: true }));
    return route.continue();
  });
}

test.describe("guest portal journey (route-mocked transport)", () => {
  test("happy path: password -> connecting -> success", async ({ page }) => {
    await mockPortal(page, {});
    await page.goto(`/portal.html?mac=${MAC}`);
    await page.locator("#w-pass").fill("hunter2!");
    await page.locator("#w-terms").check();
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.getByRole("heading", { name: "You’re online." })).toBeVisible();
  });

  test("wrong password: inline hint, stays on the password screen (no client lockout)", async ({
    page,
  }) => {
    await mockPortal(page, {
      checkPassword: () => portalError("WRONG_PASSWORD", "wrong password", 400),
    });
    await page.goto(`/portal.html?mac=${MAC}`);
    await page.locator("#w-pass").fill("definitely-wrong");
    await page.locator("#w-terms").check();
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.locator("#w-pass-error")).toHaveText(
      "That password isn’t right. Double-check with your host.",
    );
    await expect(page.getByRole("heading", { name: "Enter the Wi-Fi password" })).toBeVisible();
    // The Connect button is usable again (not self-locked; the server owns
    // the global daily limit).
    await expect(page.getByRole("button", { name: "Connect to Wi-Fi" })).toBeEnabled();
  });

  test("server RATE_LIMITED -> RateLimited screen", async ({ page }) => {
    await mockPortal(page, {
      checkPassword: () => portalError("RATE_LIMITED", "too many attempts", 429),
    });
    await page.goto(`/portal.html?mac=${MAC}`);
    await page.locator("#w-pass").fill("hunter2!");
    await page.locator("#w-terms").check();
    await page.getByRole("button", { name: "Connect to Wi-Fi" }).click();
    await expect(page.getByRole("heading", { name: "Too many attempts" })).toBeVisible();
  });

  test("already-online short-circuit on boot -> AlreadyConnected", async ({ page }) => {
    await mockPortal(page, { status: () => ok({ state: "active" }) });
    await page.goto(`/portal.html?mac=${MAC}`);
    await expect(page.getByRole("heading", { name: "You’re already online." })).toBeVisible();
  });

  test("lapsed session on boot -> SessionExpired", async ({ page }) => {
    await mockPortal(page, { status: () => ok({ state: "expired" }) });
    await page.goto(`/portal.html?mac=${MAC}`);
    await expect(page.getByRole("heading", { name: "Your access has expired" })).toBeVisible();
  });
});
