/**
 * Escape and edge swipes close the topmost surface, and only that one.
 *
 * Every dismissible overlay used to attach its own `window` keydown listener,
 * and window listeners do not nest: with Settings open and a PIN dialog over it,
 * a single Escape ran both handlers and closed both surfaces (#298). Nothing
 * about the individual listeners was wrong , the bug only exists in the
 * composition, which is exactly the kind a component test cannot see.
 *
 * So the arbitration lives here rather than in any one overlay. There is ONE
 * listener for the whole app, holding the open surfaces in the order they
 * opened, and Escape calls the last of them. An overlay opting in cannot get
 * this wrong, and adding a fourth overlay does not add a fourth way to get it
 * wrong either.
 *
 * ORDER IS BY TIME OPENED, not by DOM or React nesting: surfaces on this panel
 * appear one after another because a person taps them into existence. Two
 * overlays mounted in the SAME commit would register child-first, and the
 * outer one would wrongly be treated as topmost. No flow in the app does that;
 * if one ever needs to, this is the assumption to revisit.
 */

import { useEffect, useRef } from "react";

const stack: Array<() => void> = [];
let listening = false;

// One gesture belongs to the surface that was topmost when the finger landed.
let edge: { x: number; y: number; id: number; dismiss: () => void } | null = null;

function onTouchStart(event: TouchEvent) {
  edge = null;
  if (event.touches.length !== 1) return;
  const touch = event.touches[0];
  const dismiss = stack.at(-1);
  // A range input owns its drag even if it reaches the physical edge.
  if (event.target instanceof Element && event.target.closest('input, [role="slider"]')) return;
  if (dismiss && touch.clientX >= 0 && touch.clientX <= 24) {
    edge = { x: touch.clientX, y: touch.clientY, id: touch.identifier, dismiss };
  }
}

function onTouchMove(event: TouchEvent) {
  if (!edge) return;
  const touch = event.touches[0];
  if (event.touches.length !== 1 || touch.identifier !== edge.id) {
    edge = null;
    return;
  }
  const dx = touch.clientX - edge.x;
  const dy = Math.abs(touch.clientY - edge.y);
  if (dy > 16 && dy > Math.abs(dx) / 2) {
    edge = null;
  } else if (dx > 16 && dx > dy * 2 && event.cancelable) {
    // Claim only an edge-start horizontal gesture; ordinary scrolling is untouched.
    event.preventDefault();
  }
}

function onTouchEnd(event: TouchEvent) {
  const start = edge;
  edge = null;
  if (!start || event.touches.length !== 0 || stack.at(-1) !== start.dismiss) return;
  const touch = Array.from(event.changedTouches).find((t) => t.identifier === start.id);
  if (!touch) return;
  const dx = touch.clientX - start.x;
  if (dx > 80 && dx > Math.abs(touch.clientY - start.y) * 2) start.dismiss();
}

function onTouchCancel() {
  edge = null;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const topmost = stack.at(-1);
  if (!topmost) return;
  topmost();
}

/**
 * Register a surface as the topmost Escape target. Call when it opens; invoke
 * the returned disposer when it closes.
 *
 * The listener is attached only while at least one surface is open, so Escape
 * with nothing up stays untouched by this module.
 */
export function pushEscapeHandler(onEscape: () => void): () => void {
  stack.push(onEscape);
  if (!listening) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    listening = true;
  }

  let released = false;
  return () => {
    if (released) return; // idempotent: a double cleanup must not evict a peer
    released = true;
    const at = stack.lastIndexOf(onEscape);
    if (at !== -1) stack.splice(at, 1);
    if (stack.length === 0) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      edge = null;
      listening = false;
    }
  };
}

/**
 * Close this surface on Escape while `active`, and only while it is the topmost
 * open surface.
 *
 * `onEscape` is read through a ref, so a caller passing a fresh closure every
 * render does not re-register , which would silently reorder the stack and hand
 * topmost status to whoever last re-rendered.
 */
export function useEscapeToClose(active: boolean, onEscape: () => void): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    return pushEscapeHandler(() => onEscapeRef.current());
  }, [active]);
}
