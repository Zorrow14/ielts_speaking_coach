/**
 * Prompt text for generating test material: Part 1 questions, Part 2 cue cards
 * and Part 3 follow-ups.
 *
 * The examiner prompt used to live here too. It now has its own versioned file
 * at `lib/prompts/evaluate.ts`, because score quality is the thing most worth
 * tracking changes to.
 */

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
