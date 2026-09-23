import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/trpc", () => ({
  trpc: {
    wifi: {
      guestQr: {
        useQuery: () => ({ data: { qr: "WIFI:T:WPA;S:Guest;P:example;;" }, isError: false }),
      },
    },
  },
}));

import { WifiTile } from "./WifiTile";

afterEach(cleanup);

it("opens the full-size QR from its tile button and closes it", () => {
  render(<WifiTile />);

  const button = screen.getByRole("button", { name: "Enlarge Wi-Fi QR code" });
  expect(screen.getByText("Wi-Fi").parentElement?.parentElement?.style.marginTop).toBe("10px");
  fireEvent.click(button);
  expect(screen.getByRole("dialog", { name: "Wi-Fi" })).not.toBeNull();
  expect(screen.getAllByRole("img", { name: "Guest Wi-Fi QR code" })).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Wi-Fi" })).toBeNull();
});
