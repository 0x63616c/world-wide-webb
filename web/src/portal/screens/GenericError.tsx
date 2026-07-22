import { Button } from "../../components/ui/Button";
import { AlertIcon } from "../components/icons";
import { col, h1, stage, sub, textBtn } from "./layout";
import { neutralRing } from "./rings";

interface GenericErrorProps {
  onRetry: () => void;
  onReset: () => void;
}

export function GenericError({ onRetry, onReset }: GenericErrorProps) {
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span style={neutralRing}>
          <AlertIcon size={24} />
        </span>
        <h1 style={{ ...h1, marginTop: 22, fontSize: 22, width: "100%" }}>Something went wrong</h1>
        <p style={{ ...sub, marginTop: 10, width: "100%" }}>
          We couldn’t complete your connection. Please try again in a moment.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
        <button type="button" onClick={onReset} style={textBtn}>
          Start over
        </button>
      </div>
    </div>
  );
}
