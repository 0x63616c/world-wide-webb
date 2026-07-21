import { Button } from "../../components/ui/Button";
import { WifiIcon } from "../components/icons";
import { col, h1, stage, sub } from "./layout";
import { neutralRing } from "./rings";

export function SessionExpired({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span style={neutralRing}>
          <WifiIcon size={24} />
        </span>
        <h1 style={{ ...h1, marginTop: 22, fontSize: 22, width: "100%" }}>
          Your access has expired
        </h1>
        <p style={{ ...sub, marginTop: 10, width: "100%" }}>
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
