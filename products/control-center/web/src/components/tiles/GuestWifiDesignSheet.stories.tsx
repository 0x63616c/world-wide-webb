/**
 * Guest Wi-Fi design contact sheets (design round 2, 2026-07-19).
 *
 * Two single-view sheets , 10 tile-face candidates and 10 modal candidates ,
 * built from the real primitives (Tile, TileHeader, Icon, GuestWifiQr, theme
 * classes) so every option is an honest render, not a mockup. The winning
 * option graduates into GuestWifiTileView / GuestWifiQrModal; this file is a
 * working surface and is expected to be deleted after the pick.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { Tile, TileHeader } from "@/components/ui";
import { tilePixelSize } from "../../lib/grid-constants";
import { GuestWifiQr, type GuestWifiQrStyle } from "./GuestWifiQr";

const STORY_QR = "WIFI:T:WPA;S:storybook-guest;P:storybook-password;;";
const { width: TILE_W, height: TILE_H } = tilePixelSize(2, 2);

// ─── shared shells ────────────────────────────────────────────────────────────

function SheetItem({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="cap">
        {n}. {label}
      </div>
      {children}
    </div>
  );
}

function FaceShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: TILE_W, height: TILE_H, display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  );
}

/** Static replica of the Modal panel chrome (header + body) at sheet scale. */
function PanelShell({
  title,
  width = 340,
  children,
}: {
  title?: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        background: "var(--tile)",
        color: "var(--ink)",
        border: "1px solid var(--hair)",
        borderRadius: "var(--r)",
        boxShadow: "0 24px 64px -16px rgba(0,0,0,0.7)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: 16,
          paddingBottom: title ? 16 : 0,
          minHeight: title ? undefined : 0,
        }}
      >
        {title ? <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>{title}</h2> : <span />}
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-2)",
            fontSize: 14,
          }}
        >
          ×
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── face candidates ──────────────────────────────────────────────────────────

function NestIcon({ size = 44, iconSize = 22 }: { size?: number; iconSize?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <Icon name="qr-code" s={iconSize} c="var(--ink-2)" />
    </div>
  );
}

const FACES: { label: string; node: ReactNode }[] = [
  {
    label: "chip",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <NestIcon />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Wi-Fi pass</div>
            <div className="cap" style={{ marginTop: 3 }}>
              tap for QR
            </div>
          </div>
        </div>
      </Tile>
    ),
  },
  {
    label: "glyph only",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "center",
            paddingBottom: 10,
          }}
        >
          <NestIcon size={64} iconSize={32} />
        </div>
      </Tile>
    ),
  },
  {
    label: "ghost corner",
    node: (
      <Tile padding={18} style={{ overflow: "hidden" }}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div style={{ position: "absolute", right: -14, bottom: -14, opacity: 0.16 }}>
          <Icon name="qr-code" s={110} c="var(--ink-2)" />
        </div>
        <div className="cap" style={{ marginTop: "auto" }}>
          tap to share
        </div>
      </Tile>
    ),
  },
  {
    label: "beacon",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            paddingBottom: 6,
          }}
        >
          <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
            <Icon name="wifi" s={38} c="var(--ink)" />
            <span className="dot" style={{ position: "absolute", right: -10, top: 0 }} />
          </div>
          <div className="cap">guest access</div>
        </div>
      </Tile>
    ),
  },
  {
    label: "share verb",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div style={{ marginTop: "auto" }}>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.015em" }}>
            Share Wi-Fi
          </div>
          <div className="cap" style={{ marginTop: 6 }}>
            tap for QR
          </div>
        </div>
      </Tile>
    ),
  },
  {
    label: "pill",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div style={{ marginTop: "auto" }}>
          <span className="pill">
            <span className="dot" style={{ width: 7, height: 7 }} />
            guest network
          </span>
        </div>
      </Tile>
    ),
  },
  {
    label: "mono center",
    node: (
      <Tile padding={18}>
        <div
          style={{
            margin: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <NestIcon size={56} iconSize={28} />
          <div className="cap">guest wi-fi</div>
        </div>
      </Tile>
    ),
  },
  {
    label: "chevron row",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Wi-Fi pass</div>
          <Icon name="chevron" s={18} c="var(--ink-3)" />
        </div>
      </Tile>
    ),
  },
  {
    label: "accent chip",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "var(--acc-dim)",
              border: "1px solid var(--acc-line)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="qr-code" s={22} c="var(--acc)" />
          </div>
          <div className="cap">tap for QR</div>
        </div>
      </Tile>
    ),
  },
  {
    label: "micro qr card",
    node: (
      <Tile padding={18}>
        <TileHeader icon="wifi" title="Guest" iconSize={16} titleSize={15} />
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
          }}
        >
          <div className="cap">tap</div>
          {/* Real (scannable) micro QR , SSID is in here, flagged for the pick. */}
          <GuestWifiQr value={STORY_QR} size={58} qrStyle="crisp" />
        </div>
      </Tile>
    ),
  },
];

// ─── modal candidates ─────────────────────────────────────────────────────────

function QrBody({
  qrStyle,
  size = 240,
  pad = "4px 0 20px",
  children,
}: {
  qrStyle: GuestWifiQrStyle;
  size?: number;
  pad?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: pad,
      }}
    >
      <GuestWifiQr value={STORY_QR} size={size} qrStyle={qrStyle} />
      {children}
    </div>
  );
}

const MODALS: { label: string; node: ReactNode }[] = [
  {
    label: "rounded",
    node: (
      <PanelShell title="Guest Wi-Fi">
        <QrBody qrStyle="rounded" />
      </PanelShell>
    ),
  },
  {
    label: "crisp",
    node: (
      <PanelShell title="Guest Wi-Fi">
        <QrBody qrStyle="crisp" />
      </PanelShell>
    ),
  },
  {
    label: "inverted plain",
    node: (
      <PanelShell title="Guest Wi-Fi">
        <QrBody qrStyle="inverted" />
      </PanelShell>
    ),
  },
  {
    label: "titleless",
    node: (
      <PanelShell>
        <QrBody qrStyle="rounded" pad="10px 0 24px" />
      </PanelShell>
    ),
  },
  {
    label: "wifi mark",
    node: (
      <PanelShell>
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 2 }}>
          <Icon name="wifi" s={22} c="var(--ink-2)" />
        </div>
        <QrBody qrStyle="rounded" pad="12px 0 24px" />
      </PanelShell>
    ),
  },
  {
    label: "quiet label",
    node: (
      <PanelShell title="Guest Wi-Fi">
        <QrBody qrStyle="rounded">
          <div className="cap">scan to join</div>
        </QrBody>
      </PanelShell>
    ),
  },
  {
    label: "edge to edge",
    node: (
      <PanelShell title="Guest Wi-Fi" width={300}>
        <div style={{ padding: "0 16px 16px" }}>
          <GuestWifiQr value={STORY_QR} size={268} qrStyle="rounded" />
        </div>
      </PanelShell>
    ),
  },
  {
    label: "framed float",
    node: (
      <PanelShell title="Guest Wi-Fi">
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0 28px" }}>
          <div
            style={{
              padding: 14,
              borderRadius: 22,
              background: "var(--nest)",
              border: "1px solid var(--hair)",
            }}
          >
            <GuestWifiQr value={STORY_QR} size={216} qrStyle="rounded" />
          </div>
        </div>
      </PanelShell>
    ),
  },
  {
    label: "inverted titleless",
    node: (
      <PanelShell>
        <QrBody qrStyle="inverted" pad="10px 0 24px" />
      </PanelShell>
    ),
  },
  {
    label: "compact",
    node: (
      <PanelShell title="Guest Wi-Fi" width={260}>
        <QrBody qrStyle="rounded" size={196} pad="0 0 18px" />
      </PanelShell>
    ),
  },
];

// ─── sheets ───────────────────────────────────────────────────────────────────

function Sheet({ items, zoom, cols }: { items: typeof FACES; zoom: number; cols: number }) {
  return (
    <div className="e-root" style={{ background: "var(--bg)", padding: 18, zoom }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, max-content)`,
          gap: 22,
          alignItems: "start",
        }}
      >
        {items.map((it, i) => (
          <SheetItem key={it.label} n={i + 1} label={it.label}>
            {"node" in it ? <FaceShellOrRaw node={it.node} isFace={items === FACES} /> : null}
          </SheetItem>
        ))}
      </div>
    </div>
  );
}

function FaceShellOrRaw({ node, isFace }: { node: ReactNode; isFace: boolean }) {
  return isFace ? <FaceShell>{node}</FaceShell> : <>{node}</>;
}

const meta = {
  title: "Tiles/GuestWifiDesignSheet",
  component: Sheet,
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Faces: Story = {
  args: { items: FACES, zoom: 0.62, cols: 5 },
};

export const Modals: Story = {
  args: { items: MODALS, zoom: 0.4, cols: 5 },
};
