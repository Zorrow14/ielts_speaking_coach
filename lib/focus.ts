/**
 * Focus points for the weekly report, derived from the stored numbers.
 *
 * No Gemini call. Everything here is a rule over data the app already has,
 * which means the advice is reproducible, free, and auditable - you can always
 * see which number produced which suggestion, and the `because` field says so.
 *
 * The rules are ordered by how much they usually matter, and each one declares
 * how many answers it is based on so a suggestion drawn from two answers can
 * be labelled as weak rather than presented as a finding.
 */
import type { CategoryCount, RepeatedPair, WeekWindow } from "./db/progress";
import type { MistakeCategory } from "./schemas";

/** Below this many answers in the window, a weekly average is noise. */
export const MIN_ANSWERS_FOR_CONCLUSION = 5;

const CRITERION_LABEL = {
  fluency: "Fluency and Coherence",
  lexical: "Lexical Resource",
  grammar: "Grammatical Range and Accuracy",
} as const;

const CATEGORY_ADVICE: Record<MistakeCategory, string> = {
  article: "Articles: before you speak, decide whether each noun is one specific thing (the), one of many (a), or a general idea (no article).",
  preposition: "Prepositions: learn them inside whole phrases rather than one at a time - \"interested IN\", \"depends ON\", \"arrive AT\".",
  countability: "Uncountable nouns: information, advice, research and knowledge take no plural -s. Say \"a piece of information\" when you need a count.",
  agreement: "Subject-verb agreement: slow down on third person singular - \"he goes\", \"it depends\", \"the problem is\".",
  tense: "Tenses: pick your time frame before you start the sentence and keep it for the whole answer.",
  word_choice: "Word choice: when you are unsure of a word, use the simpler one you are certain about. A precise simple word beats a vague advanced one.",
  collocation: "Collocations: practise the words that naturally go together - \"make a decision\", \"heavy traffic\", \"strong opinion\".",
  repetition: "Repetition: build a short list of alternatives for the words you lean on, and use a different one each time.",
  fluency: "Fluency: practise speaking for 2 minutes without stopping, even if the language is imperfect. Hesitation costs more than a small error.",
  other: "Review the corrections in your history and pick the two that appear most often.",
};

export type FocusPoint = {
  title: string;
  /** The number this came from, stated so the advice can be checked. */
  because: string;
  /** How many answers or occurrences back this suggestion. */
  sampleSize: number;
  weak: boolean;
};

export function focusPoints(input: {
  thisWeek: WeekWindow;
  lastWeek: WeekWindow;
  categories: CategoryCount[];
  repeated: RepeatedPair[];
  streak: number;
  answersThisWeek: number;
}): FocusPoint[] {
  const points: FocusPoint[] = [];
  const weak = input.answersThisWeek < MIN_ANSWERS_FOR_CONCLUSION;

  // 1. The weakest criterion is where a band is most cheaply gained.
  const criteria = (["fluency", "lexical", "grammar"] as const)
    .map((key) => ({ key, value: input.thisWeek[key] }))
    .filter((entry): entry is { key: typeof entry.key; value: number } =>
      entry.value !== null,
    )
    .sort((a, b) => a.value - b.value);

  if (criteria.length > 0) {
    const lowest = criteria[0];
    points.push({
      title: `Push ${CRITERION_LABEL[lowest.key]} first - it is your lowest criterion this week at ${lowest.value.toFixed(1)}.`,
      because: `Average of ${input.thisWeek.answers} ${input.thisWeek.answers === 1 ? "answer" : "answers"} in the last 7 days.`,
      sampleSize: input.thisWeek.answers,
      weak,
    });
  }

  // 2. The mistake category that actually recurs.
  const topCategory = input.categories
    .filter((row) => row.last7 > 0)
    .sort((a, b) => b.last7 - a.last7)[0];

  if (topCategory) {
    points.push({
      title: CATEGORY_ADVICE[topCategory.category],
      because: `${topCategory.last7} ${topCategory.last7 === 1 ? "occurrence" : "occurrences"} in the last 7 days${
        topCategory.previous7 > 0
          ? `, against ${topCategory.previous7} the week before`
          : ""
      }.`,
      sampleSize: topCategory.last7,
      weak: topCategory.last7 < 3,
    });
  }

  // 3. A specific repeated correction beats general advice, so prefer it.
  const topPair = input.repeated.filter((pair) => pair.total > 1)[0];
  if (topPair) {
    points.push({
      title: `Drill one phrase: say "${topPair.correction}" correctly ten times, out loud. You have corrected "${topPair.original}" ${topPair.total} times.`,
      because: `Repeated ${topPair.total} times in the period shown.`,
      sampleSize: topPair.total,
      weak: topPair.total < 3,
    });
  }

  // 4. Consistency, only if there is room for it in the list.
  if (points.length < 3) {
    points.push({
      title:
        input.streak === 0
          ? "Record one answer today. A short daily answer is worth more than one long session a week."
          : `Keep the ${input.streak}-day streak going - practise today as well.`,
      because: `Current streak: ${input.streak} ${input.streak === 1 ? "day" : "days"}; ${input.answersThisWeek} answers in the last 7 days.`,
      sampleSize: input.answersThisWeek,
      weak: false,
    });
  }

  // 5. Last resort, so the report always has three.
  while (points.length < 3) {
    points.push({
      title:
        "Record more answers - there is not enough data this week to tell you anything useful.",
      because: `Only ${input.answersThisWeek} answers in the last 7 days.`,
      sampleSize: input.answersThisWeek,
      weak: true,
    });
  }

  return points.slice(0, 3);
}
