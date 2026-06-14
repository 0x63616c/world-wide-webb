import { expect, type Page } from "@playwright/test";

// Sign in as the seeded demo user (Calum) via "Sign in with Apple".
export async function signInDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with Apple" }).click();
  await expect(page.getByText("Your jars")).toBeVisible();
}

// Sign in as a brand-new phone user, returns through profile setup with the given name.
export async function signUpPhone(page: Page, digits: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with phone" }).click();
  for (const d of digits) await page.getByRole("button", { name: d, exact: true }).first().click();
  await page.getByRole("button", { name: "Send me the code" }).click();
  // wait for OTP screen before entering digits
  await expect(page.getByText("Check your texts")).toBeVisible();
  // any 6 digits accepted
  for (const d of "123456")
    await page.getByRole("button", { name: d, exact: true }).first().click();
  // new user → setup profile
  await expect(page.getByText("Make it official")).toBeVisible();
  await page.getByPlaceholder("Calum").fill(name);
  await page.getByRole("button", { name: "Start the shame →" }).click();
  await expect(page.getByText("Your jars")).toBeVisible();
}

export async function openJar(page: Page, name: string) {
  await page.locator(`[data-testid="jar-card"][data-jar-name="${name}"]`).click();
  await expect(page.getByTestId("jar-pot")).toBeVisible();
}

export function shameRow(page: Page, member: string) {
  return page.locator(`[data-testid="shame-row"][data-member="${member}"]`);
}
