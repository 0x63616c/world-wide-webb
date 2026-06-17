import { Button } from "@/components/Button";
import { CheckIcon } from "@/components/icons";

interface SuccessProps {
  /** Fired by "Start browsing", the flow opens the original URL / default page. */
  onPrimary: () => void;
}

export function Success({ onPrimary }: SuccessProps) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-success-ring">
          <CheckIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          You’re online.
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
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
