/**
 * Weight ingest — polls the HA Renpho BLE weight sensor and appends new
 * measurements. Idempotent via the measured_at unique index: the sensor state
 * is unchanged between weigh-ins, so most cycles insert nothing.
 * Spec: docs/superpowers/specs/2026-07-21-weight-tile-design.md.
 */
import { getLogger } from "@www/logger";
import { and, gte, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { weightMeasurement } from "../db/schema";
import { env } from "../env";
import { ha } from "../integrations/homeassistant/index";
import { HaError } from "../integrations/homeassistant/types";
import { isOutsideSanityBand, LB_PER_KG } from "./weight-domain";
import { notDeleted } from "./weight-sql";

function newWeightId(): string {
  return `wm_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function runWeightIngestCycle(): Promise<void> {
  let entity: Awaited<ReturnType<typeof ha.getEntity>>;
  try {
    entity = await ha.getEntity(env.HA_WEIGHT_ENTITY_ID);
  } catch (err) {
    // 404 = the scale isn't paired in HA yet (needs a connectable BT proxy).
    // A quiet no-op, not a failing worker: the entity may not exist for days.
    if (err instanceof HaError && err.status === 404) return;
    throw err;
  }
  const raw = Number.parseFloat(entity.state);
  if (!Number.isFinite(raw)) return; // 'unknown'/'unavailable' between weigh-ins

  const unit = (entity.attributes.unit_of_measurement as string | undefined) ?? "kg";
  const weightKg = unit === "lb" ? raw / LB_PER_KG : raw;
  const measuredAt = new Date(entity.last_updated);

  // 14-day included history feeds the sanity band.
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recent = await db
    .select({ weightKg: weightMeasurement.weightKg })
    .from(weightMeasurement)
    .where(
      and(
        isNull(weightMeasurement.excludedReason),
        notDeleted(),
        gte(weightMeasurement.measuredAt, cutoff),
      ),
    );
  const excluded = isOutsideSanityBand(
    weightKg,
    recent.map((r) => r.weightKg),
  );

  const inserted = await db
    .insert(weightMeasurement)
    .values({
      id: newWeightId(),
      measuredAt,
      weightKg,
      bodyMetrics: null,
      source: "ha_ble",
      excludedReason: excluded ? "sanity_band" : null,
    })
    .onConflictDoNothing({ target: weightMeasurement.measuredAt })
    .returning({ id: weightMeasurement.id });
  if (inserted.length > 0) {
    getLogger().info({ weightKg, measuredAt, excluded }, "weight measurement ingested");
  }
}
