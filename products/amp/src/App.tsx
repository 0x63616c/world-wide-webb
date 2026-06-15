type ProductFact = {
  readonly label: string;
  readonly value: string;
};

const productFacts = [
  { label: "Product", value: "AMP" },
  { label: "Route", value: "app--amp.worldwidewebb.co" },
  { label: "Data model", value: "Stateless v0" },
  { label: "Exposure", value: "Private Cloudflare Access" },
] as const satisfies readonly ProductFact[];

export function App() {
  return (
    <main className="amp-shell" aria-labelledby="amp-title">
      <section className="hero-card">
        <p className="eyebrow">AMP</p>
        <h1 id="amp-title">Application Management Plane</h1>
        <p className="lede">
          A private internal product shell for future platform operations, deployed as a standalone
          product rather than a Control Center view.
        </p>
      </section>

      <section className="status-card" aria-labelledby="amp-scope-title">
        <div>
          <p className="eyebrow">v0 scope</p>
          <h2 id="amp-scope-title">No platform operations are wired into AMP v0 yet.</h2>
        </div>
        <p data-testid="amp-empty-state" className="empty-copy">
          This shell is intentionally stateless. It declares the product surface without inventing
          health counts, deploy totals, availability percentages, or database-backed state.
        </p>
      </section>

      <section className="fact-grid" aria-label="AMP product facts">
        {productFacts.map((fact) => (
          <article className="fact-card" key={fact.label}>
            <p>{fact.label}</p>
            <strong>{fact.value}</strong>
          </article>
        ))}
      </section>
    </main>
  );
}
