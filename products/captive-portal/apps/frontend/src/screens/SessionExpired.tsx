import { Button } from "@/components/Button";
import { WifiIcon } from "@/components/icons";

export function SessionExpired({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-icon-ring">
          <WifiIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          Your access has expired
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
          Your 30-day Wi-Fi access has ended. Sign in again to reconnect this device.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" onClick={onReconnect}>
            Sign in again
          </Button>
        </div>
      </div>
    </div>
  );
}
