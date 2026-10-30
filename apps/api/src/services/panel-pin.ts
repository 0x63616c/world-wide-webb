import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { SETTINGS_SINGLETON_ID, settings } from "../db/schema";

// Unlike the display settings reader, a failed/missing read must never accept
// a default PIN. This additive seam leaves existing settings callers unchanged.
export async function verifyPanelPIN(pin: string): Promise<boolean> {
  if (!/^\d{6}$/.test(pin)) return false;
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.id, SETTINGS_SINGLETON_ID))
    .limit(1);
  const expected = rows[0]?.value?.pinCode;
  return (
    typeof expected === "string" &&
    /^\d{6}$/.test(expected) &&
    timingSafeEqual(Buffer.from(pin), Buffer.from(expected))
  );
}
