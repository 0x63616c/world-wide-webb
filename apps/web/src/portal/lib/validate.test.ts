import { describe, expect, it } from "vitest";
import { validatePassword } from "./validate";

// Messages are ported VERBATIM from docs/captive-portal/design/components.jsx,
// including the curly apostrophe (’). Password-only since www-p9hx (the landing
// name/email validation was removed with the email/OTP flow).
describe("validatePassword(), Wi-Fi password", () => {
  it.each([
    ["", "Enter the Wi-Fi password to continue."],
    ["   ", "Enter the Wi-Fi password to continue."],
    ["abc", "That password looks too short."],
    ["12345", "That password looks too short."],
  ])("rejects %o", (pw, msg) => {
    expect(validatePassword(pw)).toBe(msg);
  });

  it.each([
    "123456",
    "guest-passw0rd",
    "a-perfectly-fine-password",
  ])("accepts %o (returns null)", (pw) => {
    expect(validatePassword(pw)).toBeNull();
  });
});
