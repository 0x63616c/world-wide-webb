import { Button } from "@/components/Button";
import { AlertIcon } from "@/components/icons";

interface GenericErrorProps {
  onRetry: () => void;
  onReset: () => void;
}

export function GenericError({ onRetry, onReset }: GenericErrorProps) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-icon-ring">
          <AlertIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          Something went wrong
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
          We couldn’t complete your connection. Please try again in a moment.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
        <button type="button" className="wwb-textbtn" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}
