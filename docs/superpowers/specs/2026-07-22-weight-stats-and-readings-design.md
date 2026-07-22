# Weight tile — correct window stats + day-grouped Readings

**Date:** 2026-07-22
**Supersedes parts of:** `docs/superpowers/specs/2026-07-21-weight-tile-design.md`
**Status:** design agreed, not yet implemented

Two problems, one root cause. The Trend page reports LOW/HIGH that are neither,
and the Readings page is an undifferentiated list of raw numbers. Both come from
the same unexamined decision: that "a day" and "a reading" are interchangeable
units. They are not, and the fix is to say explicitly which one each number is
built from.

A third problem surfaced while tracing the first: the backend decides what a
calendar day is by reading the server process's ambient timezone. It is correct
today only because a Pulumi env var happens to be set.

---

## 1. Which readings feed which number

`summarize()` is currently fed `dailyMedians()` output, so with four readings on
a single day `low === high === average` — all three collapse to that day's
median (`weight-domain.ts:44-57`, `weight.ts:34-35`). Observed: four real
readings of 160.2 / 160.4 / 160.8 / 160.9 lb reported LOW 160.6 and HIGH 160.6.

The rule, after this change:

| Stat | Computed over | Why |
| --- | --- | --- |
| LOW / HIGH | **raw included readings** in the window | Read as "lightest/heaviest I have been". A median can never be the lightest. |
| AVERAGE | daily medians | A day you weighed four times must not outvote a day you weighed once. |
| CHANGE | daily medians, first vs last day | A day-over-day trend, not the gap between two arbitrary weigh-ins. |
| Hero number | **the latest day's median** | Was the latest raw reading, which disagreed with every other number on the page. |

The window filter (excluded rows dropped, `measured_at >= cutoff`) applies before
any of this, exactly as it does today.

`summarize()` is pure and already unit-testable. Change it test-first: the
failing case is several readings inside one day.

## 2. Timezone: the backend must be told, never assume

`localDay()` (`weight-domain.ts:22-27`) buckets days with `getFullYear/
getMonth/getDate` — the api **process's** local time. In production this is
correct only because `infra/src/services.ts:108` sets
`TZ=America/Los_Angeles` on the deployment. Lose that env var and every
weigh-in after 4pm Pacific silently counts as the next day.

**The backend stores and returns UTC and never assumes a location.** But a
calendar day cannot exist without a timezone, so the caller supplies one:

- `weight.*` procedures take a required `tz` input (IANA name), validated by
  attempting `new Intl.DateTimeFormat(undefined, { timeZone: tz })`.
- The panel sends `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Day bucketing happens in **SQL**: `(measured_at AT TIME ZONE $tz)::date`,
  passed as a bound parameter — never string-interpolated. Postgres applies the
  correct UTC offset per row, so DST boundaries are handled for free.
- Statistics stay in `weight-domain.ts`, operating on rows that already carry a
  `day` key. Median is not reimplemented in SQL.
- `localDay()` is deleted.

The `TZ` env var stays on the deployment — `infra/src/crons.ts` needs it for
cron schedules — but nothing in the weight path depends on it any more.

## 3. The Readings page

The day is the unit. One row per recorded day, collapsed by default, expanding
to the raw readings behind it.

**Day row:** date label · median · change vs previous day · `(n)` reading count,
with a chevron. Tapping anywhere on the row expands it.

**Reading row (revealed):** time · weight · change vs the previous included
reading · `AUTO-FLAGGED` pill when the sanity band excluded it · overflow menu.

**Change vs previous day** compares against the **last recorded day**, not the
last calendar day. With a gap the figure spans more than 24h, so it is labelled
as a comparison to the previous weigh-in rather than to "yesterday".

**Colour:** down is `--green`, up is `--red`, unchanged is `--ink-2`. Note
`--green` was never declared in `tokens.css` despite `NotificationBanner`
consuming `var(--green, #7ac48f)`; declaring it is part of this work.

**Loading:** all-time, paged lazily. The query takes a cursor and returns the
most recent N days plus a `nextCursor`; older days load as the list scrolls. The
range picker stays on Trend only.

### Row actions

An overflow menu (`ui/OverflowMenu.tsx`), not inline buttons — the panel is
touch-only, so actions cannot be hover-revealed, and a bordered `Exclude` on
every row dominated the list.

- **Delete** — always present, red, gated behind `ConfirmDialog` (`tone="danger"`).
- **Count this reading** — present *only* on an excluded row. Auto-exclusion
  stays, and this is its undo. There is deliberately no manual "don't count
  this" on a normal row: the sanity band is the only thing that excludes.

### Delete must be a tombstone

`runWeightIngestCycle` polls HA's *current* sensor state every cycle and inserts
with `onConflictDoNothing` keyed on `measured_at` (`weight-service.ts:50-61`).
The unique index is the only thing preventing re-insertion, so a hard-deleted
row is **re-created on the next poll** and stays resurrected until the next
weigh-in moves the sensor on.

Therefore: a nullable `deleted_at timestamptz` column. Every read filters
`deleted_at IS NULL`; the conflict target is untouched, so the tombstone keeps
the row dead.

## 4. Trend chart

Two defects, both invisible until now because there was only one day of data.

- **Not enough data:** below two daily points the chart area is replaced with an
  explicit "not enough data yet" state rather than drawing a single dot on a
  flat axis with identical min and max labels. Mirrors what commit `3e68f7ff6`
  already did for the tile sparkline.
- **X axis is not time:** `linePoints()` (`WeightPageView.tsx:41-49`) spaces
  points by array index, so a skipped day is drawn as an ordinary interval and
  the line misrepresents the rate of change. Position points by date within the
  window instead.
- The y-axis min/max labels currently print the `low`/`high` **stats**
  (`WeightPageView.tsx:199,213`) while positioning them on the daily series'
  extremes. Once LOW/HIGH move to raw readings these are different numbers, so
  the axis labels must be derived from the daily series itself.

---

## API shape

```
weight.summary({ range, tz })   -> { latest, daily[], low, high, average, change }
weight.days({ tz, cursor?, limit? }) -> { days: WeightReadingDay[], nextCursor }
weight.setExcluded({ id, excluded })
weight.delete({ id })           -> sets deleted_at
```

`weight.readings` is replaced by `weight.days`. `low`/`high` come from raw rows;
`average`/`change`/`daily` from daily medians; every procedure filters
`deleted_at IS NULL`.

## Open question, deliberately not settled

`--red` is this codebase's error tint (error banners, destructive confirms).
Rendering a 0.2 lb overnight fluctuation in it may over-signal ordinary noise;
`--amber` would read softer. Left as-is pending a look at real multi-day data.

## Out of scope

The ingest may be dropping readings: `weight-service.ts` keys `measured_at` off
the HA sensor's `last_updated`, so two readings sharing a timestamp — or a
repeat of an identical weight, where HA updates only `last_reported` — are
silently discarded. Tracked separately.
