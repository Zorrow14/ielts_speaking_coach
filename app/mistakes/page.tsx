/**
 * Mistake history.
 *
 * Grouped by category, then by the original-to-correction pair, so a mistake
 * made six times reads as one entry with a count rather than six rows. The
 * grouping and the counting both happen in SQL.
 *
 * Filters are a plain GET form: no JavaScript needed, and each filtered view
 * is a URL you can come back to.
 */
import Link from "next/link";
import { auth } from "@/auth";
import Icon from "@/components/Icon";
import SegmentedField from "@/components/SegmentedField";
import { ensureUser } from "@/lib/db/users";
import {
  fixTheseFirst,
  mistakesByCategory,
  repeatedPairs,
  type MistakeFilters,
  type RepeatedPair,
} from "@/lib/db/progress";
import {
  MISTAKE_CATEGORIES,
  partSchema,
  type MistakeCategory,
} from "@/lib/schemas";
import { DAY_FORMAT } from "@/lib/time";

const CATEGORY_LABEL: Record<MistakeCategory, string> = {
  article: "Articles",
  preposition: "Prepositions",
  countability: "Countable / uncountable",
  agreement: "Agreement",
  tense: "Tense",
  word_choice: "Word choice",
  collocation: "Collocation",
  repetition: "Repetition",
  fluency: "Fluency",
  other: "Other",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const PART_OPTIONS = [
  { value: "", label: "All" },
  { value: "1", label: "Part 1" },
  { value: "2", label: "Part 2" },
  { value: "3", label: "Part 3" },
] as const;

/**
 * The same view without one filter, for the removable chips. Only applied
 * (validated) filters are carried over, so a bad value in the URL is dropped
 * rather than preserved.
 */
function hrefWithout(
  filters: Record<string, string | undefined>,
  drop: string,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key !== drop && value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/mistakes?${query}` : "/mistakes";
}

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default async function MistakesPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    part?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const query = await searchParams;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return (
      <main className="shell">
        <p className="alert">You need to sign in to see your mistakes.</p>
      </main>
    );
  }
  const userId = session.user.id ?? (await ensureUser(email));

  const category = MISTAKE_CATEGORIES.includes(
    query.category as MistakeCategory,
  )
    ? (query.category as MistakeCategory)
    : undefined;
  const partParsed = query.part ? partSchema.safeParse(Number(query.part)) : null;
  const filters: MistakeFilters = {
    category,
    part: partParsed?.success ? partParsed.data : undefined,
    from: query.from && ISO_DATE.test(query.from) ? query.from : undefined,
    to: query.to && ISO_DATE.test(query.to) ? query.to : undefined,
  };

  const [categories, pairs, priority] = await Promise.all([
    mistakesByCategory(userId, filters),
    repeatedPairs(userId, filters),
    fixTheseFirst(userId),
  ]);

  // What is actually applied, as URL values, for the chips and their links.
  const applied: Record<string, string | undefined> = {
    category: filters.category,
    part: filters.part ? String(filters.part) : undefined,
    from: filters.from,
    to: filters.to,
  };
  const formatDay = (iso: string) => SHORT_DATE.format(new Date(`${iso}T00:00:00Z`));
  const chips = [
    filters.category
      ? { key: "category", label: CATEGORY_LABEL[filters.category] }
      : null,
    filters.part ? { key: "part", label: `Part ${filters.part}` } : null,
    filters.from ? { key: "from", label: `From ${formatDay(filters.from)}` } : null,
    filters.to ? { key: "to", label: `To ${formatDay(filters.to)}` } : null,
  ].filter((chip): chip is { key: string; label: string } => chip !== null);
  const activeCount = chips.length;

  // Group the flat pair list by category for display.
  const byCategory = new Map<MistakeCategory, RepeatedPair[]>();
  for (const pair of pairs) {
    const list = byCategory.get(pair.category) ?? [];
    list.push(pair);
    byCategory.set(pair.category, list);
  }

  return (
    <main className="shell">
      <header className="shell__header">
        <h1>Mistakes</h1>
        <p className="muted">
          The same correction made more than once is the one worth practising.
        </p>
      </header>

      <section className="card card--priority">
        <h2>Fix these first</h2>
        <p className="muted">
          Most repeated in the last 14 days. Mistakes you have stopped making
          are not listed.
        </p>
        {priority.length === 0 ? (
          <p className="muted">
            Nothing repeated in the last 14 days. Either you are not repeating
            yourself, or there is not enough recent practice to tell.
          </p>
        ) : (
          <ol className="bullets bullets--ranked">
            {priority.map((pair, index) => (
              <li key={`${pair.original}-${index}`}>
                <strong>{pair.total}&times;</strong>{" "}
                <s>{pair.original}</s> &rarr; <strong>{pair.correction}</strong>
                <span className="tag">{CATEGORY_LABEL[pair.category]}</span>
                {pair.explanation ? (
                  <p className="muted">{pair.explanation}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <form
        className="card filter-panel"
        method="get"
        aria-labelledby="filter-title"
      >
        <div className="filter-panel__head">
          <h2 id="filter-title" className="filter-panel__title">
            <Icon name="sliders" />
            Filter
          </h2>
          <p className="filter-panel__count" aria-live="polite">
            {pairs.length} {pairs.length === 1 ? "correction" : "corrections"}
            {activeCount > 0 ? " match" : " in total"}
          </p>
        </div>

        <div className="filter-panel__grid">
          <div className="filter-panel__group filter-panel__group--full">
            <SegmentedField
              name="part"
              legend="Part"
              options={PART_OPTIONS}
              value={applied.part ?? ""}
            />
          </div>

          <div className="filter-panel__group">
            <label className="field__label" htmlFor="category">
              Category
            </label>
            <span className="select">
              <select
                id="category"
                name="category"
                className="input"
                defaultValue={category ?? ""}
              >
                <option value="">All categories</option>
                {MISTAKE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABEL[value]}
                  </option>
                ))}
              </select>
            </span>
          </div>

          {/* role="group" rather than a fieldset: a fieldset laid out with
              flexbox is unreliable in Safari, and this is just as clear to a
              screen reader ("Dates, group"). */}
          <div
            className="filter-panel__group"
            role="group"
            aria-labelledby="dates-label"
          >
            <span id="dates-label" className="field__label">
              Dates
            </span>
            <div className="date-range">
              <label className="date-range__field" htmlFor="from">
                <span className="date-range__label">From</span>
                <input
                  id="from"
                  name="from"
                  type="date"
                  className="input"
                  defaultValue={filters.from ?? ""}
                />
              </label>
              <label className="date-range__field" htmlFor="to">
                <span className="date-range__label">To</span>
                <input
                  id="to"
                  name="to"
                  type="date"
                  className="input"
                  defaultValue={filters.to ?? ""}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="filter-panel__actions">
          <button type="submit" className="button">
            Apply filters
          </button>
          {activeCount > 0 ? (
            <>
              <Link className="button button--ghost" href="/mistakes">
                Clear all
              </Link>
              <ul className="filter-chips" aria-label="Applied filters">
                {chips.map((chip) => (
                  <li key={chip.key}>
                    <Link
                      className="chip chip--active chip--removable"
                      href={hrefWithout(applied, chip.key)}
                      aria-label={`Remove filter: ${chip.label}`}
                    >
                      {chip.label}
                      <Icon name="close" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </form>

      <section className="card">
        <h2>By category</h2>
        {categories.length === 0 ? (
          <p className="muted">No mistakes recorded for this filter.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Total</th>
                  <th scope="col">Last 7 days</th>
                  <th scope="col">Previous 7</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{CATEGORY_LABEL[row.category]}</th>
                    <td>{row.total}</td>
                    <td>{row.last7}</td>
                    <td>{row.previous7}</td>
                    <td>
                      {row.change === 0
                        ? "–"
                        : `${row.change > 0 ? "+" : ""}${row.change}`}
                      {row.change < 0 ? (
                        <span className="muted"> fading</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {[...byCategory.entries()].map(([group, list]) => (
        <section className="card" key={group}>
          <h2>{CATEGORY_LABEL[group]}</h2>
          <ul className="mistakes">
            {list.map((pair, index) => (
              <li key={`${group}-${index}`}>
                <p>
                  {pair.total > 1 ? <strong>{pair.total}&times; </strong> : null}
                  <s>{pair.original}</s> &rarr;{" "}
                  <strong>{pair.correction}</strong>
                </p>
                {pair.explanation ? (
                  <p className="muted">{pair.explanation}</p>
                ) : null}
                <p className="muted">
                  Last seen {DAY_FORMAT.format(new Date(pair.latestAt))}
                  {pair.last7 > 0 || pair.previous7 > 0
                    ? ` · ${pair.last7} in the last 7 days, ${pair.previous7} the week before`
                    : ""}
                  {" · "}
                  <Link href={`/history/answer/${pair.latestAnswerId}`}>
                    see the answer
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
