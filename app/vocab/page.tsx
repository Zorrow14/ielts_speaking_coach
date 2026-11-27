/**
 * The vocabulary notebook.
 *
 * Search and the source filter are a GET form, so the filtering runs in SQL
 * and each view is a URL. The list itself is a client component because edit
 * and delete are per-row.
 */
import Link from "next/link";
import { auth } from "@/auth";
import SaveToNotebook from "@/components/SaveToNotebook";
import VocabList from "@/components/VocabList";
import { ensureUser } from "@/lib/db/users";
import { listVocab, vocabCounts, type VocabSource } from "@/lib/db/vocab";
import { VOCAB_SOURCES } from "@/lib/schemas";

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

      <form className="card filters-form" method="get">
        <h2>Find a phrase</h2>
        <div className="field field--wide">
          <label htmlFor="search">Search</label>
          <input
            id="search"
            name="search"
            type="search"
            defaultValue={search}
            placeholder="phrase, meaning or example"
          />
        </div>
        <div className="field">
          <label htmlFor="source">Source</label>
          <select id="source" name="source" defaultValue={source}>
            <option value="all">Everything</option>
            <option value="feedback">Saved from feedback</option>
            <option value="manual">Added by hand</option>
          </select>
        </div>
        <div className="row">
          <button type="submit" className="button">
            Search
          </button>
          <Link className="button button--quiet" href="/vocab">
            Clear
          </Link>
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
