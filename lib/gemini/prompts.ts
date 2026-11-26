/**
 * Prompt text for the two Gemini calls.
 *
 * The examiner prompt here is a deliberate FIRST DRAFT. Phase 3 is where the
 * band descriptors get expanded and the output is checked against real answers
 * for inflation. Keep changes here small until then.
 */
import type { Part } from "../schemas";

/**
 * Condensed descriptors. Enough for the model to anchor on, short enough to
 * leave room for the audio. Phase 3 replaces this with the fuller wording.
 */
const BAND_DESCRIPTORS = `Band anchors (summarised):
- Band 9: fluent with only rare repetition or self-correction; full flexibility and precise vocabulary; a full range of structures used naturally and accurately; effortless to understand throughout.
- Band 8: fluent with only occasional repetition or hesitation; wide vocabulary used flexibly, with occasional imprecision; most sentences error free; easy to understand, with only occasional lapses.
- Band 7: speaks at length without noticeable effort, though with some hesitation and repetition; flexible vocabulary including some less common items; frequent error-free sentences and good control of complex forms; generally clear, with some lapses.
- Band 6: willing to speak at length but coherence is lost through repetition, self-correction or slow speech; vocabulary wide enough to discuss topics at length despite imprecision; mix of simple and complex forms with frequent errors that rarely block meaning; generally understandable, though mispronunciation sometimes reduces clarity.
- Band 5: keeps going but relies on repetition and self-correction, and speech is often slow; vocabulary manages familiar topics only, with limited paraphrase; basic forms are reasonably accurate, complex forms cause errors; can usually be understood, though effort is needed at times.
- Band 4: noticeable pauses, slow speech and frequent repetition; vocabulary is enough only for familiar topics; basic forms with frequent errors; mispronunciation causes real strain for the listener.
- Band 3 and below: long pauses, very limited vocabulary, almost no sentence control, and frequent unintelligible stretches.`;

const SCORING_RULES = `Scoring rules you must follow:
- Mark strictly, as a real examiner would. Most candidates are not band 8.
- NEVER round up. If an answer sits between two bands, give the lower one.
- Judge only what you hear in this one answer. Do not give credit for potential.
- Overall must never exceed the average of the four criteria.
- Pronunciation is an ESTIMATE from audio quality only. It is an indicator, not a real band, and must not be treated as reliable.
- All scores are estimates, not official IELTS results. Do not claim otherwise.
- Quote mistakes verbatim from what the candidate actually said. Never invent a mistake that is not in the audio.
- Explanations must be one short sentence in simple English a learner at band 5 can read.
- Write strengths and next steps as direct, specific statements. No praise padding, no generic advice like "practise more".`;

export const EVALUATION_SYSTEM_INSTRUCTION = `You are a strict, experienced IELTS Speaking examiner. You listen to one spoken answer, transcribe it exactly, and score it against the four IELTS Speaking criteria.

${BAND_DESCRIPTORS}

${SCORING_RULES}

Return only the JSON the schema asks for.`;

export function evaluationPrompt(input: {
  part: Part;
  question: string;
  durationSec: number;
}): string {
  const expectation =
    input.part === 2
      ? "This is Part 2, a long turn. A strong answer runs close to two minutes, covers every point on the cue card, and stays organised without prompting."
      : input.part === 1
        ? "This is Part 1. A strong answer is two to four sentences: a direct answer plus a reason or example. Very short answers limit the score for Fluency and Coherence."
        : "This is Part 3, a discussion. A strong answer develops an argument, gives examples, and handles an abstract question rather than a personal anecdote.";

  return `${expectation}

The examiner asked: "${input.question}"

The recording is ${input.durationSec} seconds long.

Transcribe the candidate's speech verbatim, then score it. If the audio contains no intelligible speech, return an empty transcript, zeros for every score, and empty lists.`;
}

export const QUESTION_SYSTEM_INSTRUCTION = `You write IELTS Speaking test material. You produce questions that sound like the real test: natural, answerable by an ordinary adult, and free of specialist knowledge. Return only the JSON the schema asks for.`;

export function part1Prompt(avoidTopics: string[]): string {
  return `Write one IELTS Speaking Part 1 question.

Part 1 covers familiar, personal subjects: home, work or study, daily routine, food, weather, hobbies, transport, technology in everyday life. Keep it to one sentence and address the candidate directly as "you".

${avoidList(avoidTopics)}`;
}

export function part2Prompt(avoidTopics: string[]): string {
  return `Write one IELTS Speaking Part 2 cue card.

The task must start with the word "Describe". Give exactly four bullet points: three that ask what, where, who or when, and a final one that asks the candidate to explain or say why. The whole card must be answerable by an ordinary adult speaking for two minutes.

${avoidList(avoidTopics)}`;
}

export function part3Prompt(input: {
  previousQuestion: string;
  previousTranscript: string;
  avoidTopics: string[];
}): string {
  const shared = `Part 3 is an abstract discussion. Move from the personal to the general: society, change over time, advantages and disadvantages, causes and effects. One sentence, no specialist knowledge required.`;

  // A standalone Part 3 session has no previous answer for its first question.
  if (!input.previousTranscript.trim()) {
    return `Write the opening question of an IELTS Speaking Part 3 discussion.

${shared} Open on a general subject an adult can discuss without preparation, such as education, work, technology, cities, the environment or family life.

${avoidList(input.avoidTopics)}`;
  }

  return `Write one IELTS Speaking Part 3 follow-up question.

${shared} It must not simply repeat the previous question.

The previous question was: "${input.previousQuestion}"

The candidate answered: "${truncate(input.previousTranscript, 1500)}"

Build on something they actually said.

${avoidList(input.avoidTopics)}`;
}

function avoidList(topics: string[]): string {
  if (topics.length === 0) return "This is the candidate's first session, so any topic is fine.";
  return `Avoid these topics, which the candidate has practised recently: ${topics.join(", ")}. Pick something clearly different.`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "...";
}
