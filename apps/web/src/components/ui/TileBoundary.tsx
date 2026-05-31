import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Class component required because React error boundaries must use
 * getDerivedStateFromError / componentDidCatch lifecycle methods.
 * Wraps each board grid cell so one crashed tile can't white-screen the board.
 * The board runs 24/7 with no manual reload, so fallback fills 100% height to
 * preserve grid layout while the tile retries on the next data change.
 */
export class TileBoundary extends Component<Props, State> {
  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console so the wall-panel operator can spot persistent failures.
    console.error("[TileBoundary] tile render error:", error, info.componentStack);
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
          {/* Shimmer rows mirror a loading state so layout appears intentional. */}
          <div
            style={{
              width: "60%",
              height: 14,
              borderRadius: 6,
              background:
                "linear-gradient(90deg, var(--tile-2) 25%, var(--nest) 50%, var(--tile-2) 75%)",
              backgroundSize: "200%",
              animation: "shimmer 1.6s linear infinite",
            }}
          />
          <div
            style={{
              width: "40%",
              height: 14,
              borderRadius: 6,
              background:
                "linear-gradient(90deg, var(--tile-2) 25%, var(--nest) 50%, var(--tile-2) 75%)",
              backgroundSize: "200%",
              animation: "shimmer 1.6s linear infinite",
            }}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
