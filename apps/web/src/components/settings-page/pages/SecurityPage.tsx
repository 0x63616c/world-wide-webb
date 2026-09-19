/**
 * Security settings page , one row: Change PIN.
 *
 * The change-PIN machine used to be mounted inline here, permanently on screen,
 * which is why it needed a "PIN changed / Change again" terminal state: a card
 * that cannot dismiss itself has to end on something. It now lives on its own
 * surface (`PinChangeModal`), so this page is just a settings row (#298). The
 * dialog holds an explicit "PIN changed" beat before it leaves , that is the
 * confirmation, shown where the person is already looking. The row keeps a
 * quieter echo of it for anyone who glanced away as the surface dismissed.
 *
 * The PIN gates on Settings, Photo Booth and Activity are always on, so there
 * is no lock-toggle card; the keypad-layout picker and the idle lock screen
 * went with The Simplification.
 */

import { useEffect, useState } from "react";
import { PIN_LENGTH } from "../../../lib/settings";
import { PinChangeModal } from "../../pin/PinChangeModal";
import { ChevronValue, RowShell, SectionCard } from "../blocks";

/** How long the row echoes "Changed" before falling back to the masked value.
 *  It is the second confirmation, not the only one , the dialog's own success
 *  beat is what a person actually reads , so this only has to outlast a glance
 *  away, and be gone by the time you come back to the page. */
const CONFIRM_MS = 2400;

const MASKED_PIN = "•".repeat(PIN_LENGTH);

/** The row is in exactly one of three states, so it is spelled as one value.
 *  Two booleans could represent "changing AND confirmed", which is reachable ,
 *  tap the row again inside the confirmation window and it reads "Changed"
 *  behind a freshly-opened dialog (01-impossible-states). */
type PinRowState = { kind: "idle" } | { kind: "changing" } | { kind: "confirmed" };

export function SecurityPage() {
  const [row, setRow] = useState<PinRowState>({ kind: "idle" });

  // Clear the row's echo on a timer, and on unmount, so navigating away and
  // back never shows a stale "Changed" from an earlier visit.
  useEffect(() => {
    if (row.kind !== "confirmed") return;
    const t = setTimeout(() => setRow({ kind: "idle" }), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [row.kind]);

  return (
    <>
      <SectionCard title="PIN">
        {[
          <RowShell
            key="change"
            label="Change PIN"
            sub="Six digits. Used by every panel."
            control={
              <ChevronValue
                value={row.kind === "confirmed" ? "Changed" : MASKED_PIN}
                tone={row.kind === "confirmed" ? "good" : undefined}
                label="Change PIN"
                onClick={() => setRow({ kind: "changing" })}
              />
            }
          />,
        ]}
      </SectionCard>
      <PinChangeModal
        open={row.kind === "changing"}
        onClose={() => setRow({ kind: "idle" })}
        onChanged={() => setRow({ kind: "confirmed" })}
      />
    </>
  );
}
