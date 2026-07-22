import { Button } from "../../components/ui/Button";
import { CheckIcon } from "../components/icons";
import { col, h1, stage, sub, textBtn } from "./layout";
import { successRing } from "./rings";

interface AlreadyConnectedProps {
  /** "Continue browsing", open the default page. */
  onPrimary: () => void;
  /** "Not you? Sign in again", restart the flow. */
  onReset: () => void;
}

export function AlreadyConnected({ onPrimary, onReset }: AlreadyConnectedProps) {
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span style={successRing}>
          <CheckIcon size={26} />
        </span>
        <h1 style={{ ...h1, marginTop: 22, fontSize: 22, width: "100%" }}>
          You’re already online.
        </h1>
        <p style={{ ...sub, marginTop: 8, width: "100%" }}>
          This device is already signed in, nothing to do.
        </p>
        <div style={{ marginTop: 24, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" onClick={onPrimary}>
            Continue browsing
          </Button>
        </div>
        <button type="button" onClick={onReset} style={textBtn}>
          Not you? Sign in again
        </button>
      </div>
    </div>
  );
}
