import type { ReactNode } from "react";
import { ArrowLeft } from "../components/icons";
import { col, stageTerms } from "./layout";

function TermsSection({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <h2
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 14.5,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            flexShrink: 0,
            fontFamily: "var(--mono)",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--ink-2)",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid var(--hair)",
            borderRadius: 6,
          }}
        >
          {n}
        </span>
        {title}
      </h2>
      <p
        style={{
          margin: 0,
          paddingLeft: 32,
          fontSize: 13.5,
          lineHeight: 1.65,
          color: "var(--ink-2)",
        }}
      >
        {children}
      </p>
    </section>
  );
}

// Terms of use, a modal-style detour that returns to wherever it was opened
// from with form state intact (the flow owns the return; www-q002.7). Ported
// 1:1 from the design. No SSID name and no "guest" in the copy.
export function Terms({ onBack }: { onBack: () => void }) {
  return (
    <div style={stageTerms}>
      <div style={{ ...col, maxWidth: 620, width: "100%" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "var(--ui)",
            fontSize: 13.5,
            fontWeight: 500,
            color: "var(--ink-2)",
            padding: "4px 0",
          }}
        >
          <ArrowLeft /> Back
        </button>
        <div
          style={{
            position: "relative",
            background: "var(--tile)",
            border: "1px solid var(--hair)",
            borderRadius: "var(--r)",
            padding: "34px 34px 30px",
            marginTop: 16,
          }}
        >
          <h1
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
              color: "var(--ink)",
            }}
          >
            Terms of use
          </h1>
          <p
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              color: "var(--ink-3)",
              margin: "6px 0 0",
            }}
          >
            Last updated · Jun 2026
          </p>

          <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 22 }}>
            <TermsSection n="1" title="A friendly network">
              This is a private home Wi-Fi network offered as a courtesy. By connecting, you agree
              to use it responsibly and in line with these terms.
            </TermsSection>
            <TermsSection n="2" title="Acceptable use">
              Please don’t use the connection for anything illegal, for downloading or sharing
              copyrighted material without permission, or for activity that disrupts the network or
              other devices on it.
            </TermsSection>
            <TermsSection n="3" title="What we collect">
              We record the name and email you provide, along with your device identifier and
              connection time, purely to manage access. We don’t sell your details or use them for
              marketing.
            </TermsSection>
            <TermsSection n="4" title="Access & sessions">
              A session lasts 30 days, after which you may be asked to sign in again. Access may be
              paused or revoked at any time to keep the network healthy.
            </TermsSection>
            <TermsSection n="5" title="No warranty">
              The network is provided “as is.” We can’t guarantee speed, uptime, or security, and
              we’re not liable for any loss arising from its use. Treat any public or shared network
              with sensible caution.
            </TermsSection>
          </div>

          <hr
            style={{
              height: 1,
              background: "var(--hair)",
              border: "none",
              margin: "24px 0 18px",
            }}
          />
          <p
            style={{
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--ink-3)",
              margin: 0,
              textAlign: "left",
            }}
          >
            Questions about the network? Ask your host, they’ll sort you out.
          </p>
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
