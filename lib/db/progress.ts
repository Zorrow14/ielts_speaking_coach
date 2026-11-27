/**
 * Progress, mistake and activity aggregation. All of it in SQL.
 *
 * Two rules shape this file:
 *
 * - Every query filters by user_id, on every table it touches - including the
 *   joins, not just the outermost where clause.
 * - The aggregation happens in Postgres. Nothing here ships a row per answer
 *   to the browser to be averaged in JavaScript. The moving average, the
 *   streak and the window comparisons are all window functions or filtered
 *   aggregates.
 *
 * Day boundaries use APP_TIME_ZONE, bound as a parameter rather than
 * interpolated. Postgres stores timestamptz in UTC, so "answers per day" and
 * "the last 7 days" are meaningless without this cast.
 *
 * `numeric` columns come back from pg as strings to avoid precision loss, so
 * everything numeric goes through `num()` on the way out.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./index";
import { APP_TIME_ZONE } from "../time";
import type { MistakeCategory, Part } from "../schemas";

/** pg returns numeric/bigint as strings; null stays null. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function int(value: unknown): number {
  return num(value) ?? 0;
}

/**
 * Restricts an aggregate to one part. `sessions` is always joined because the
 * part lives there; the filter is only added when asked for.
 */
function partFilter(part?: Part) {
  return part ? sql`and s.part = ${part}` : sql``;
}

// --- Score series ----------------------------------------------------------

export type ScorePoint = {
  answerId: string;
  createdAt: string;
  part: number;
  overall: number | null;
  fluency: number | null;
  lexical: number | null;
  grammar: number | null;
  pronunciation: number | null;
  /** Five-answer trailing means, computed in SQL. */
  overallMa: number | null;
  fluencyMa: number | null;
  lexicalMa: number | null;
  grammarMa: number | null;
  pronunciationMa: number | null;
  promptVersion: string;
};

/**
 * One point per evaluated answer, oldest first, with a trailing five-answer
 * mean per criterion.
 *
 * The moving average is a window function rather than a JS loop so the browser
 * never has to hold the whole history. Pronunciation's window ignores nulls
 * naturally: avg() skips them, so answers with no usable audio do not drag the
 * line down to zero.
 */
export async function scoreSeries(
  userId: string,
  part?: Part,
): Promise<ScorePoint[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      a.id                    as answer_id,
      a.created_at            as created_at,
      s.part                  as part,
      f.overall               as overall,
      f.fluency               as fluency,
      f.lexical               as lexical,
      f.grammar               as grammar,
      f.pronunciation_est     as pronunciation,
      f.prompt_version        as prompt_version,
      avg(f.overall)           over w as overall_ma,
      avg(f.fluency)           over w as fluency_ma,
      avg(f.lexical)           over w as lexical_ma,
      avg(f.grammar)           over w as grammar_ma,
      avg(f.pronunciation_est) over w as pronunciation_ma
    from feedback f
      join answers  a on a.id = f.answer_id  and a.user_id = ${userId}
      join sessions s on s.id = a.session_id and s.user_id = ${userId}
    where f.user_id = ${userId}
      ${partFilter(part)}
    window w as (order by a.created_at rows between 4 preceding and current row)
    order by a.created_at
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      answerId: String(r.answer_id),
      createdAt: new Date(r.created_at as string).toISOString(),
      part: int(r.part),
      overall: num(r.overall),
      fluency: num(r.fluency),
      lexical: num(r.lexical),
      grammar: num(r.grammar),
      pronunciation: num(r.pronunciation),
      overallMa: num(r.overall_ma),
      fluencyMa: num(r.fluency_ma),
      lexicalMa: num(r.lexical_ma),
      grammarMa: num(r.grammar_ma),
      pronunciationMa: num(r.pronunciation_ma),
      promptVersion: String(r.prompt_version ?? "unknown"),
    };
  });
}

// --- Daily and weekly averages --------------------------------------------

export type PeriodAverage = {
  /** ISO date of the day, or of the Monday starting the week. */
  period: string;
  answers: number;
  overall: number | null;
  fluency: number | null;
  lexical: number | null;
  grammar: number | null;
  pronunciation: number | null;
};

async function periodAverages(
  userId: string,
  unit: "day" | "week",
  part?: Part,
): Promise<PeriodAverage[]> {
  const db = getDb();
  // The bucket expression differs only in the date_trunc unit, and `unit` is
  // a closed union rather than caller input, so the two branches are written
  // out instead of interpolating an identifier.
  const bucket =
    unit === "day"
      ? sql`(a.created_at at time zone ${APP_TIME_ZONE})::date`
      : sql`(date_trunc('week', a.created_at at time zone ${APP_TIME_ZONE}))::date`;

  const result = await db.execute(sql`
    select
      ${bucket}                     as period,
      count(*)                      as answers,
      avg(f.overall)                as overall,
      avg(f.fluency)                as fluency,
      avg(f.lexical)                as lexical,
      avg(f.grammar)                as grammar,
      avg(f.pronunciation_est)      as pronunciation
    from feedback f
      join answers  a on a.id = f.answer_id  and a.user_id = ${userId}
      join sessions s on s.id = a.session_id and s.user_id = ${userId}
    where f.user_id = ${userId}
      ${partFilter(part)}
    group by ${bucket}
    order by ${bucket}
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      period: String(r.period),
      answers: int(r.answers),
      overall: num(r.overall),
      fluency: num(r.fluency),
      lexical: num(r.lexical),
      grammar: num(r.grammar),
      pronunciation: num(r.pronunciation),
    };
  });
}

export function dailyAverages(userId: string, part?: Part) {
  return periodAverages(userId, "day", part);
}

export function weeklyAverages(userId: string, part?: Part) {
  return periodAverages(userId, "week", part);
}

// --- Activity and streak ---------------------------------------------------

export type ActivityDay = { day: string; answers: number };

/** Answers per calendar day in APP_TIME_ZONE, oldest first. */
export async function activity(
  userId: string,
  days = 60,
): Promise<ActivityDay[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      (a.created_at at time zone ${APP_TIME_ZONE})::date as day,
      count(*)                                           as answers
    from answers a
    where a.user_id = ${userId}
      and (a.created_at at time zone ${APP_TIME_ZONE})::date
          > (now() at time zone ${APP_TIME_ZONE})::date - ${days}::int
    group by day
    order by day
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return { day: String(r.day), answers: int(r.answers) };
  });
}

/**
 * The current run of consecutive practice days, counted in APP_TIME_ZONE.
 *
 * Classic gaps-and-islands: subtracting a row number from a dense date series
 * gives every run of consecutive days the same constant, so grouping on it
 * collapses each run to one row. The run only counts as "current" if it ends
 * today or yesterday - otherwise practising for six days last month would show
 * as a live six-day streak.
 */
export async function currentStreak(userId: string): Promise<number> {
  const db = getDb();
  const result = await db.execute(sql`
    with days as (
      select distinct (a.created_at at time zone ${APP_TIME_ZONE})::date as d
      from answers a
      where a.user_id = ${userId}
    ),
    grouped as (
      select d, d - (row_number() over (order by d))::int as grp
      from days
    ),
    islands as (
      select grp, count(*) as len, max(d) as last_day
      from grouped
      group by grp
    )
    select len
    from islands
    where last_day >= (now() at time zone ${APP_TIME_ZONE})::date - 1
    order by last_day desc
    limit 1
  `);

  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? int(row.len) : 0;
}

// --- Repeated mistakes -----------------------------------------------------

export type MistakeFilters = {
  category?: MistakeCategory;
  part?: Part;
  /** ISO dates, inclusive, interpreted in APP_TIME_ZONE. */
  from?: string;
  to?: string;
};

function mistakeFilterSql(filters: MistakeFilters) {
  return sql`
    ${filters.category ? sql`and m.category = ${filters.category}` : sql``}
    ${filters.part ? sql`and s.part = ${filters.part}` : sql``}
    ${
      filters.from
        ? sql`and (m.created_at at time zone ${APP_TIME_ZONE})::date >= ${filters.from}::date`
        : sql``
    }
    ${
      filters.to
        ? sql`and (m.created_at at time zone ${APP_TIME_ZONE})::date <= ${filters.to}::date`
        : sql``
    }
  `;
}

export type CategoryCount = {
  category: MistakeCategory;
  total: number;
  last7: number;
  previous7: number;
  /** last7 - previous7. Negative means the mistake is fading. */
  change: number;
};

/** Mistake counts per category, with the two trailing weeks side by side. */
export async function mistakesByCategory(
  userId: string,
  filters: MistakeFilters = {},
): Promise<CategoryCount[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      m.category as category,
      count(*)   as total,
      count(*) filter (
        where (m.created_at at time zone ${APP_TIME_ZONE})::date
              > (now() at time zone ${APP_TIME_ZONE})::date - 7
      ) as last7,
      count(*) filter (
        where (m.created_at at time zone ${APP_TIME_ZONE})::date
              > (now() at time zone ${APP_TIME_ZONE})::date - 14
          and (m.created_at at time zone ${APP_TIME_ZONE})::date
              <= (now() at time zone ${APP_TIME_ZONE})::date - 7
      ) as previous7
    from mistakes m
      join answers  a on a.id = m.answer_id  and a.user_id = ${userId}
      join sessions s on s.id = a.session_id and s.user_id = ${userId}
    where m.user_id = ${userId}
      ${mistakeFilterSql(filters)}
    group by m.category
    order by total desc, m.category
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const last7 = int(r.last7);
    const previous7 = int(r.previous7);
    return {
      category: r.category as MistakeCategory,
      total: int(r.total),
      last7,
      previous7,
      change: last7 - previous7,
    };
  });
}

export type RepeatedPair = {
  category: MistakeCategory;
  original: string;
  correction: string;
  explanation: string | null;
  total: number;
  last7: number;
  previous7: number;
  change: number;
  /** The most recent answer this pair appeared in, for the link. */
  latestAnswerId: string;
  latestAt: string;
};

/**
 * The same correction made more than once, grouped by the original-to-
 * correction pair.
 *
 * Grouped on a case-folded, whitespace-trimmed key so "The informations" and
 * "the informations " count as one mistake, while a representative spelling is
 * kept with min() for display.
 */
export async function repeatedPairs(
  userId: string,
  filters: MistakeFilters = {},
  limit = 50,
): Promise<RepeatedPair[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      min(m.category::text)                        as category,
      min(m.original)                              as original,
      min(m.correction)                            as correction,
      min(m.explanation)                           as explanation,
      count(*)                                     as total,
      count(*) filter (
        where (m.created_at at time zone ${APP_TIME_ZONE})::date
              > (now() at time zone ${APP_TIME_ZONE})::date - 7
      ) as last7,
      count(*) filter (
        where (m.created_at at time zone ${APP_TIME_ZONE})::date
              > (now() at time zone ${APP_TIME_ZONE})::date - 14
          and (m.created_at at time zone ${APP_TIME_ZONE})::date
              <= (now() at time zone ${APP_TIME_ZONE})::date - 7
      ) as previous7,
      (array_agg(m.answer_id order by m.created_at desc))[1]  as latest_answer_id,
      max(m.created_at)                                        as latest_at
    from mistakes m
      join answers  a on a.id = m.answer_id  and a.user_id = ${userId}
      join sessions s on s.id = a.session_id and s.user_id = ${userId}
    where m.user_id = ${userId}
      ${mistakeFilterSql(filters)}
    group by lower(btrim(m.original)), lower(btrim(m.correction))
    order by total desc, latest_at desc
    limit ${limit}
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const last7 = int(r.last7);
    const previous7 = int(r.previous7);
    return {
      category: r.category as MistakeCategory,
      original: String(r.original),
      correction: String(r.correction),
      explanation: r.explanation === null ? null : String(r.explanation),
      total: int(r.total),
      last7,
      previous7,
      change: last7 - previous7,
      latestAnswerId: String(r.latest_answer_id),
      latestAt: new Date(r.latest_at as string).toISOString(),
    };
  });
}

/**
 * "Fix these first": the pairs repeated most in the last 14 days.
 *
 * Deliberately windowed rather than all-time - a mistake you stopped making
 * two months ago is not what to practise tonight.
 */
export async function fixTheseFirst(
  userId: string,
  limit = 3,
): Promise<RepeatedPair[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      min(m.category::text) as category,
      min(m.original)       as original,
      min(m.correction)     as correction,
      min(m.explanation)    as explanation,
      count(*)              as total,
      (array_agg(m.answer_id order by m.created_at desc))[1] as latest_answer_id,
      max(m.created_at)     as latest_at
    from mistakes m
      join answers a on a.id = m.answer_id and a.user_id = ${userId}
    where m.user_id = ${userId}
      and (m.created_at at time zone ${APP_TIME_ZONE})::date
          > (now() at time zone ${APP_TIME_ZONE})::date - 14
    group by lower(btrim(m.original)), lower(btrim(m.correction))
    having count(*) > 1
    order by total desc, latest_at desc
    limit ${limit}
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    const total = int(r.total);
    return {
      category: r.category as MistakeCategory,
      original: String(r.original),
      correction: String(r.correction),
      explanation: r.explanation === null ? null : String(r.explanation),
      total,
      last7: total,
      previous7: 0,
      change: 0,
      latestAnswerId: String(r.latest_answer_id),
      latestAt: new Date(r.latest_at as string).toISOString(),
    };
  });
}

// --- Baseline vs now -------------------------------------------------------

export type BucketAverage = {
  answers: number;
  overall: number | null;
  fluency: number | null;
  lexical: number | null;
  grammar: number | null;
  pronunciation: number | null;
};

export type Baseline = {
  first: BucketAverage;
  recent: BucketAverage;
  totalAnswers: number;
  /** True once the two buckets stop overlapping, i.e. at 10 answers. */
  comparable: boolean;
};

/**
 * The first five evaluated answers against the most recent five.
 *
 * Below ten answers the two buckets share rows, so the comparison is partly
 * an answer against itself. That is reported rather than hidden: `comparable`
 * is what the UI uses to decide whether to draw a conclusion.
 */
export async function baseline(
  userId: string,
  part?: Part,
  size = 5,
): Promise<Baseline> {
  const db = getDb();
  const result = await db.execute(sql`
    with ordered as (
      select
        f.overall, f.fluency, f.lexical, f.grammar, f.pronunciation_est,
        row_number() over (order by a.created_at)      as rn_asc,
        row_number() over (order by a.created_at desc) as rn_desc,
        count(*)    over ()                            as total
      from feedback f
        join answers  a on a.id = f.answer_id  and a.user_id = ${userId}
        join sessions s on s.id = a.session_id and s.user_id = ${userId}
      where f.user_id = ${userId}
        ${partFilter(part)}
    )
    select
      'first' as bucket, count(*) as answers, max(total) as total,
      avg(overall) as overall, avg(fluency) as fluency,
      avg(lexical) as lexical, avg(grammar) as grammar,
      avg(pronunciation_est) as pronunciation
    from ordered where rn_asc <= ${size}
    union all
    select
      'recent' as bucket, count(*) as answers, max(total) as total,
      avg(overall) as overall, avg(fluency) as fluency,
      avg(lexical) as lexical, avg(grammar) as grammar,
      avg(pronunciation_est) as pronunciation
    from ordered where rn_desc <= ${size}
  `);

  const empty: BucketAverage = {
    answers: 0,
    overall: null,
    fluency: null,
    lexical: null,
    grammar: null,
    pronunciation: null,
  };

  let first = empty;
  let recent = empty;
  let totalAnswers = 0;

  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    const bucket: BucketAverage = {
      answers: int(r.answers),
      overall: num(r.overall),
      fluency: num(r.fluency),
      lexical: num(r.lexical),
      grammar: num(r.grammar),
      pronunciation: num(r.pronunciation),
    };
    totalAnswers = Math.max(totalAnswers, int(r.total));
    if (r.bucket === "first") first = bucket;
    else recent = bucket;
  }

  return { first, recent, totalAnswers, comparable: totalAnswers >= size * 2 };
}

// --- Prompt versions -------------------------------------------------------

export type PromptWindow = {
  promptVersion: string;
  model: string;
  firstAt: string;
  lastAt: string;
  answers: number;
};

/**
 * When each prompt version was in use. Charts mark the boundaries, because a
 * band from one prompt is not strictly comparable with a band from another.
 */
export async function promptWindows(
  userId: string,
  part?: Part,
): Promise<PromptWindow[]> {
  const db = getDb();
  const result = await db.execute(sql`
    select
      f.prompt_version   as prompt_version,
      min(f.model)       as model,
      min(a.created_at)  as first_at,
      max(a.created_at)  as last_at,
      count(*)           as answers
    from feedback f
      join answers  a on a.id = f.answer_id  and a.user_id = ${userId}
      join sessions s on s.id = a.session_id and s.user_id = ${userId}
    where f.user_id = ${userId}
      ${partFilter(part)}
    group by f.prompt_version
    order by min(a.created_at)
  `);

  return result.rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      promptVersion: String(r.prompt_version ?? "unknown"),
      model: String(r.model ?? "unknown"),
      firstAt: new Date(r.first_at as string).toISOString(),
      lastAt: new Date(r.last_at as string).toISOString(),
      answers: int(r.answers),
    };
  });
}

// --- Weekly report ---------------------------------------------------------

export type WeekWindow = BucketAverage & { label: string };

/**
 * The last seven days against the seven before them, as two filtered
 * aggregates over one scan.
 */
export async function weekComparison(
  userId: string,
  part?: Part,
): Promise<{ thisWeek: WeekWindow; lastWeek: WeekWindow }> {
  const db = getDb();
  const inWindow = (fromDaysAgo: number, toDaysAgo: number) => sql`
    (a.created_at at time zone ${APP_TIME_ZONE})::date
        > (now() at time zone ${APP_TIME_ZONE})::date - ${fromDaysAgo}::int
    and (a.created_at at time zone ${APP_TIME_ZONE})::date
        <= (now() at time zone ${APP_TIME_ZONE})::date - ${toDaysAgo}::int
  `;

  const result = await db.execute(sql`
    select
      count(*) filter (where ${inWindow(7, 0)})  as this_answers,
      avg(f.overall)            filter (where ${inWindow(7, 0)}) as this_overall,
      avg(f.fluency)            filter (where ${inWindow(7, 0)}) as this_fluency,
      avg(f.lexical)            filter (where ${inWindow(7, 0)}) as this_lexical,
      avg(f.grammar)            filter (where ${inWindow(7, 0)}) as this_grammar,
      avg(f.pronunciation_est)  filter (where ${inWindow(7, 0)}) as this_pronunciation,
      count(*) filter (where ${inWindow(14, 7)}) as last_answers,
      avg(f.overall)            filter (where ${inWindow(14, 7)}) as last_overall,
      avg(f.fluency)            filter (where ${inWindow(14, 7)}) as last_fluency,
      avg(f.lexical)            filter (where ${inWindow(14, 7)}) as last_lexical,
      avg(f.grammar)            filter (where ${inWindow(14, 7)}) as last_grammar,
      avg(f.pronunciation_est)  filter (where ${inWindow(14, 7)}) as last_pronunciation
    from feedback f
      join answers  a on a.id = f.answer_id  and a.user_id = ${userId}
      join sessions s on s.id = a.session_id and s.user_id = ${userId}
    where f.user_id = ${userId}
      ${partFilter(part)}
  `);

  const r = (result.rows[0] ?? {}) as Record<string, unknown>;
  return {
    thisWeek: {
      label: "Last 7 days",
      answers: int(r.this_answers),
      overall: num(r.this_overall),
      fluency: num(r.this_fluency),
      lexical: num(r.this_lexical),
      grammar: num(r.this_grammar),
      pronunciation: num(r.this_pronunciation),
    },
    lastWeek: {
      label: "The 7 days before",
      answers: int(r.last_answers),
      overall: num(r.last_overall),
      fluency: num(r.last_fluency),
      lexical: num(r.last_lexical),
      grammar: num(r.last_grammar),
      pronunciation: num(r.last_pronunciation),
    },
  };
}
