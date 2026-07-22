import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";
import { log } from "../../lib/log/logger";
import { Skeleton } from "./Skeleton";

const tileLog = log.child("tile");

interface Props {
  children: ReactNode;
  // Increment resetKey to clear a caught error and retry rendering children.
  // BoundedTile in Board.tsx increments this via the QueryErrorResetBoundary
  // render-prop reset callback so a recovered query clears the boundary without
  // a full page reload.
  resetKey?: number;
  // Called when the fallback's retry button is activated (future use) or when
  // the boundary resets via resetKey. Lets the parent signal QueryErrorResetBoundary.
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  // Track the resetKey we last acknowledged so getDerivedStateFromProps can
  // detect when the parent requests a reset without false-positives.
  acknowledgedResetKey: number;
}

/**
 * Class component required because React error boundaries must use
 * getDerivedStateFromError / componentDidCatch lifecycle methods.
 * Wraps each board grid cell so one crashed tile can't white-screen the board.
 * The board runs 24/7 with no manual reload, so fallback fills 100% height to
 * preserve grid layout while the tile retries on the next data change.
 *
 * Recovery: pass an incrementing resetKey (from BoundedTile / QueryErrorResetBoundary)
 * to clear the error state without unmounting the parent tree.
 */
export class TileBoundary extends Component<Props, State> {
  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  // Reset hasError when resetKey advances , decouples recovery from unmounting
  // and lets QueryErrorResetBoundary drive retries via BoundedTile.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const incoming = props.resetKey ?? 0;
    if (state.hasError && incoming !== state.acknowledgedResetKey) {
      return { hasError: false, acknowledgedResetKey: incoming };
    }
    if (incoming !== state.acknowledgedResetKey) {
      return { acknowledgedResetKey: incoming };
    }
    return null;
  }

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, acknowledgedResetKey: props.resetKey ?? 0 };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes to the log buffer (and, via the console patch, still to the console),
    // so a tile that crashes at 3am leaves evidence that survives the reload.
    tileLog.error("tile render error", {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          data-tile-boundary-fallback
          className="tile"
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 16,
          }}
        >
          {/* Reuse shared Skeleton primitive so shimmer style is consistent. */}
          <Skeleton w="60%" />
          <Skeleton w="40%" />
        </div>
      );
    }
    return this.props.children;
  }
}
