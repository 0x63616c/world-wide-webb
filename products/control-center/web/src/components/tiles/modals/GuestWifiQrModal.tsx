import { Modal } from "@/components/ui";
import { GuestWifiQr, type GuestWifiQrStyle } from "../GuestWifiQr";

export interface GuestWifiQrModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Full WIFI: payload ("WIFI:T:WPA;S:<ssid>;P:<password>;;"). The SSID and
   * password appear ONLY inside the QR modules , the modal renders neither as
   * text anywhere (guest network details stay off the board by design).
   */
  qrValue: string;
  qrStyle?: GuestWifiQrStyle;
}

/**
 * Small themed modal behind the Guest Wi-Fi tile tap: one scannable QR that
 * joins the guest network, a caption, nothing else.
 */
export function GuestWifiQrModal({ open, onClose, qrValue, qrStyle }: GuestWifiQrModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Guest Wi-Fi" width={420}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
          padding: "10px 0 18px",
        }}
      >
        <GuestWifiQr value={qrValue} size={280} qrStyle={qrStyle} />
        <div className="cap">point your camera · joins automatically</div>
      </div>
    </Modal>
  );
}
