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
 * Small themed modal behind the Guest Wi-Fi tile tap (design pick 2026-07-19,
 * "quiet label"): title, one white-on-black QR that joins the guest network,
 * a single cap line. Nothing else.
 */
export function GuestWifiQrModal({ open, onClose, qrValue, qrStyle }: GuestWifiQrModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Guest Wi-Fi" width={420}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          padding: "4px 0 22px",
        }}
      >
        <GuestWifiQr value={qrValue} size={280} qrStyle={qrStyle} />
        <div className="cap">scan to join</div>
      </div>
    </Modal>
  );
}
