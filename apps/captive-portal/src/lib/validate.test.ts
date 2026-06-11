import { describe, expect, it } from "vitest";
import { EMAIL_RE, validate, validatePassword } from "./validate";

// Messages are ported VERBATIM from docs/captive-portal/design/components.jsx,
// including the curly apostrophe (’) the design uses. The PRD bans em dashes,
// not curly quotes (lead ruling), so these stay exactly as designed.
const NAME_REQUIRED = "Please enter your name.";
const EMAIL_REQUIRED = "Email is required to connect.";
const EMAIL_FORMAT = "That doesn’t look like a valid email address.";
const TERMS_REQUIRED = "You must accept";

describe("validate(), landing form (table-driven)", () => {
  const ok = { name: "John Appleseed", email: "john@example.com", agreed: true };

  it("passes a fully valid form with no errors", () => {
    expect(validate(ok)).toEqual({});
  });

  const cases: Array<{
    desc: string;
    input: { name: string; email: string; agreed: boolean };
    expected: Record<string, string>;
  }> = [
    {
      desc: "blank name",
      input: { ...ok, name: "" },
      expected: { name: NAME_REQUIRED },
    },
    {
      desc: "whitespace-only name (trimmed)",
      input: { ...ok, name: "   " },
      expected: { name: NAME_REQUIRED },
    },
    {
      desc: "blank email",
      input: { ...ok, email: "" },
      expected: { email: EMAIL_REQUIRED },
    },
    {
      desc: "malformed email, no @",
      input: { ...ok, email: "john.example.com" },
      expected: { email: EMAIL_FORMAT },
    },
    {
      desc: "malformed email, no TLD",
      input: { ...ok, email: "john@example" },
      expected: { email: EMAIL_FORMAT },
    },
    {
      desc: "malformed email, trailing space tolerated then validated",
      input: { ...ok, email: "john@" },
      expected: { email: EMAIL_FORMAT },
    },
    {
      desc: "terms unticked",
      input: { ...ok, agreed: false },
      expected: { agreed: TERMS_REQUIRED },
    },
    {
      desc: "every field invalid at once",
      input: { name: "", email: "nope", agreed: false },
      expected: { name: NAME_REQUIRED, email: EMAIL_FORMAT, agreed: TERMS_REQUIRED },
    },
  ];

  for (const { desc, input, expected } of cases) {
    it(desc, () => {
      expect(validate(input)).toEqual(expected);
    });
  }

  it("required beats format: a blank email reports required, not format", () => {
    expect(validate({ ...ok, email: "" }).email).toBe(EMAIL_REQUIRED);
  });
});

describe("EMAIL_RE, permissive typo catcher (matches the design regex)", () => {
  it.each([
    ["john@example.com", true],
    ["a@b.co", true],
    ["first.last@sub.domain.io", true],
    ["plain", false],
    ["no@tld", false],
    ["@nolocal.com", false],
    ["spaces in@email.com", false],
  ])("%s → %s", (email, valid) => {
    expect(EMAIL_RE.test(email)).toBe(valid);
  });
});

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
