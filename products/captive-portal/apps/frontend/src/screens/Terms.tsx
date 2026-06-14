import type { ReactNode } from "react";
import { ArrowLeft } from "@/components/icons";

function TermsSection({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section className="wwb-prose-sec">
      <h2>
        <span className="wwb-prose-n">{n}</span>
        {title}
      </h2>
      <p>{children}</p>
    </section>
  );
}

// Terms of use, a modal-style detour that returns to wherever it was opened
// from with form state intact (the flow owns the return; www-q002.7). Ported
// 1:1 from the design. No SSID name and no "guest" in the copy.
export function Terms({ onBack }: { onBack: () => void }) {
  return (
    <div className="wwb-stage wwb-stage-terms">
      <div className="wwb-col" style={{ maxWidth: 620, width: "100%" }}>
        <button type="button" className="wwb-backbtn" onClick={onBack}>
          <ArrowLeft /> Back
        </button>
        <div className="wwb-card" style={{ padding: "34px 34px 30px", marginTop: 16 }}>
          <h1 className="wwb-h1" style={{ fontSize: 26, marginTop: 0 }}>
            Terms of use
          </h1>
          <p className="wwb-mono-faint" style={{ marginTop: 6 }}>
            Last updated · Jun 2026
          </p>

          <div className="wwb-prose">
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

          <hr className="wwb-divider" style={{ margin: "24px 0 18px" }} />
          <p className="wwb-foot" style={{ textAlign: "left" }}>
            Questions about the network? Ask your host, they’ll sort you out.
          </p>
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
