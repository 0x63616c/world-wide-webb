import { Button } from "../../components/ui/Button";
import { CheckIcon } from "../components/icons";
import { col, h1, stage, sub } from "./layout";
import { successRing } from "./rings";

interface SuccessProps {
  /** Fired by "Start browsing", the flow opens the original URL / default page. */
  onPrimary: () => void;
}

export function Success({ onPrimary }: SuccessProps) {
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span style={successRing}>
          <CheckIcon size={26} />
        </span>
        <h1 style={{ ...h1, marginTop: 22, fontSize: 22, width: "100%" }}>You’re online.</h1>
        <p style={{ ...sub, marginTop: 10, width: "100%" }}>
          Your browser should redirect automatically. If it doesn’t, tap below.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" onClick={onPrimary}>
            Start browsing
          </Button>
        </div>
      </div>
    </div>
  );
}
