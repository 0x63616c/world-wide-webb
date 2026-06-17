import { Button } from "@/components/Button";
import { CheckIcon } from "@/components/icons";

interface AlreadyConnectedProps {
  /** "Continue browsing", open the default page. */
  onPrimary: () => void;
  /** "Not you? Sign in again", restart the flow. */
  onReset: () => void;
}

export function AlreadyConnected({ onPrimary, onReset }: AlreadyConnectedProps) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-success-ring">
          <CheckIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          You’re already online.
        </h1>
        <p className="wwb-sub" style={{ marginTop: 8, width: "100%" }}>
          This device is already signed in, nothing to do.
        </p>
        <div style={{ marginTop: 24, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" onClick={onPrimary}>
            Continue browsing
          </Button>
        </div>
        <button type="button" className="wwb-textbtn" onClick={onReset}>
          Not you? Sign in again
        </button>
      </div>
    </div>
  );
}
