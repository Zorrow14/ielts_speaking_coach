/** Shown while the server component fetches. Keeps the layout from jumping. */
export default function Loading() {
  return (
    <main className="shell">
      <section className="card">
        <p className="muted" role="status">
          Loading&hellip;
        </p>
      </section>
    </main>
  );
}
