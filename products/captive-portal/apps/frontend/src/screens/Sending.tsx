// Sending screen: brief loading after the landing submit while the code is
// dispatched. Ported 1:1 from docs/captive-portal/design/screens.jsx.
export function Sending({ email }: { email: string }) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 408, alignItems: "center", textAlign: "center" }}>
        <div
          className="wwb-spinner wwb-spinner-lg"
          style={{ marginBottom: 22 }}
          aria-hidden="true"
        />
        <h1 className="wwb-h1">Sending your code</h1>
        <p className="wwb-sub" style={{ marginTop: 8 }}>
          It’s on its way to your inbox.
        </p>
        <p className="wwb-mono-faint" style={{ marginTop: 18 }}>
          {email}
        </p>
      </div>
    </div>
  );
}
