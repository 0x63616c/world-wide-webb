import { expect, type Page } from "@playwright/test";

// Sign in as the seeded demo user (Calum). On the web the "Sign in with Apple"
// button uses the demo endpoint (no real Apple session); native builds do the
// real ASAuthorizationAppleIDProvider flow.
export async function signInDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Apple" }).click();
  await expect(page.getByText("Your jars")).toBeVisible();
}

export async function openJar(page: Page, name: string) {
  await page.locator(`[data-testid="jar-card"][data-jar-name="${name}"]`).click();
  await expect(page.getByTestId("jar-pot")).toBeVisible();
}

export function shameRow(page: Page, member: string) {
  return page.locator(`[data-testid="shame-row"][data-member="${member}"]`);
}
