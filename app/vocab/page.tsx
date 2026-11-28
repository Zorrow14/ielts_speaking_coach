/**
 * The vocabulary notebook.
 *
 * Search and the source filter are a GET form, so the filtering runs in SQL
 * and each view is a URL. The list itself is a client component because edit
 * and delete are per-row.
 */
import Link from "next/link";
import { auth } from "@/auth";
import Icon from "@/components/Icon";
import SaveToNotebook from "@/components/SaveToNotebook";
import SegmentedField from "@/components/SegmentedField";
import VocabList from "@/components/VocabList";
import { ensureUser } from "@/lib/db/users";
import { listVocab, vocabCounts, type VocabSource } from "@/lib/db/vocab";
import { VOCAB_SOURCES } from "@/lib/schemas";

const SOURCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "feedback", label: "From feedback" },
  { value: "manual", label: "Added by hand" },
] as const;

const SOURCE_LABEL: Record<string, string> = {
  feedback: "From feedback",
  manual: "Added by hand",
};

/** The same view without one filter, for the removable chips. */
function hrefWithout(applied: { search: string; source: string }, drop: "search" | "source") {
  const params = new URLSearchParams();
  if (drop !== "search" && applied.search) params.set("search", applied.search);
  if (drop !== "source" && applied.source !== "all") params.set("source", applied.source);
  const query = params.toString();
  return query ? `/vocab?${query}` : "/vocab";
}

export default async function VocabPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; source?: string }>;
}) {
  const query = await searchParams;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see your notebook.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));

  const source: VocabSource = VOCAB_SOURCES.includes(
    query.source as VocabSource,
  )
    ? (query.source as VocabSource)
    : "all";
  const search = query.search?.trim() ?? "";

  const [entries, counts] = await Promise.all([
    listVocab(userId, { search, source }),
    vocabCounts(userId),
  ]);

  const activeCount = (search ? 1 : 0) + (source !== "all" ? 1 : 0);

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Vocabulary</h1>
        <p className="muted">
          {counts.total} {counts.total === 1 ? "phrase" : "phrases"} saved
          &middot; {counts.fromFeedback} from feedback &middot; {counts.due} due
          for review
        </p>
      </header>

      {counts.due > 0 ? (
        <section className="card card--priority">
          <h2>
            {counts.due} {counts.due === 1 ? "phrase" : "phrases"} ready to
            review
          </h2>
          <p className="muted">
            Try using each one in your own sentence out loud, then say whether
            it came easily.
          </p>
          <Link className="button" href="/vocab/review">
            Start reviewing
          </Link>
        </section>
      ) : null}

      <form
        className="card filter-panel"
        method="get"
        role="search"
        aria-labelledby="find-title"
      >
        <div className="filter-panel__head">
          <h2 id="find-title" className="filter-panel__title">
            <Icon name="search" />
            Find a phrase
          </h2>
          <p className="filter-panel__count" aria-live="polite">
            {entries.length} {entries.length === 1 ? "phrase" : "phrases"}
            {activeCount > 0 ? " match" : ""}
          </p>
        </div>

        <div className="filter-panel__grid">
          <div className="filter-panel__group filter-panel__group--full">
            <label className="field__label" htmlFor="search">
              Search
            </label>
            <span className="search-field">
              <Icon name="search" />
              <input
                id="search"
                name="search"
                type="search"
                className="input"
                defaultValue={search}
                placeholder="Phrase, meaning or example"
                enterKeyHint="search"
              />
            </span>
          </div>

          <div className="filter-panel__group filter-panel__group--full">
            <SegmentedField
              name="source"
              legend="Source"
              options={SOURCE_OPTIONS}
              value={source}
            />
          </div>
        </div>

        <div className="filter-panel__actions">
          <button type="submit" className="button">
            Search
          </button>
          {activeCount > 0 ? (
            <>
              <Link className="button button--ghost" href="/vocab">
                Clear all
              </Link>
              <ul className="filter-chips" aria-label="Applied filters">
                {search ? (
                  <li>
                    <Link
                      className="chip chip--active chip--removable"
                      href={hrefWithout({ search, source }, "search")}
                      aria-label={`Remove search: ${search}`}
                    >
                      &ldquo;{search}&rdquo;
                      <Icon name="close" />
                    </Link>
                  </li>
                ) : null}
                {source !== "all" ? (
                  <li>
                    <Link
                      className="chip chip--active chip--removable"
                      href={hrefWithout({ search, source }, "source")}
                      aria-label={`Remove filter: ${SOURCE_LABEL[source]}`}
                    >
                      {SOURCE_LABEL[source]}
                      <Icon name="close" />
                    </Link>
                  </li>
                ) : null}
              </ul>
            </>
          ) : null}
        </div>
      </form>

      <section className="card">
        <h2>Add a phrase</h2>
        <p className="muted">
          For something you read or heard elsewhere. Phrases from your own
          feedback are saved straight from the results screen.
        </p>
        <SaveToNotebook phrase="" label="Add a phrase by hand" />
      </section>

      <section className="card">
        <h2>
          {source === "feedback"
            ? "Saved from feedback"
            : source === "manual"
              ? "Added by hand"
              : "All phrases"}
          {search ? ` matching "${search}"` : ""}
        </h2>
        <VocabList entries={entries} />
      </section>
    </main>
  );
}
