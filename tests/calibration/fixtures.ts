/**
 * Calibration fixtures: transcripts written by hand to sit at a known band.
 *
 * `intended` is my judgement of where each answer sits, not a certified band.
 * The harness uses it for two things only: checking the ORDER is preserved
 * (the band 5 answer should score below the band 7 answer) and flagging any
 * fixture that scores more than half a band above where it was aimed. It is
 * not evidence that the model's absolute numbers are correct.
 *
 * Each transcript is written the way speech actually comes out - false starts,
 * fillers, repetition - because that is what the real pipeline transcribes and
 * what the prompt is asked to judge.
 */
import type { Part } from "../../lib/schemas";

export type Fixture = {
  id: string;
  /** Hand-assigned target band. See the caveat above. */
  intended: number;
  part: Part;
  question: string;
  /** Roughly how long this would take to say, for the Part 2 guardrail. */
  durationSec: number;
  transcript: string;
  /** What this fixture is meant to probe. */
  note: string;
};

export const FIXTURES: Fixture[] = [
  // --- Band 5 --------------------------------------------------------------
  {
    id: "b5-part1-hometown",
    intended: 5,
    part: 1,
    durationSec: 42,
    question: "Do you like the place where you live?",
    note: "Band 5: simple forms only, repetition, failed paraphrase, basic linking.",
    transcript:
      "Yes, I like. I like my city because, um, because is very nice. There is many shop and, and many people. The weather is, how to say, is hot. Always hot. I live here since I am child, so I know everything. My friends also live here. Is good for me because I like, I like when many people around. Yeah, I like my city.",
  },
  {
    id: "b5-part2-teacher",
    intended: 5,
    part: 2,
    durationSec: 78,
    question:
      "Describe a teacher who influenced you.\nYou should say:\n- who the teacher was\n- what subject they taught\n- what they were like\n- and explain why they influenced you",
    note: "Band 5: a long turn that is mostly listing, slow, with frequent basic errors.",
    transcript:
      "I want to talk about my teacher in secondary school. Her name is Mrs Thida. She teach me English. She teach me English for three year. She is very kind and she is very, um, patient. When I don't understand, she explain again. She explain again and again. Her class is always interesting because she make game for us. We play game and we learn word. I remember one time I am very shy, I don't want to speak, and she tell me, you must try. So I try. And after that I am not so shy. This is why she influence me. Because of her I like English. Now I still study English. Yeah, that's all about my teacher.",
  },

  // --- Band 6 --------------------------------------------------------------
  {
    id: "b6-part1-cooking",
    intended: 6,
    part: 1,
    durationSec: 48,
    question: "Do you enjoy cooking at home?",
    note: "Band 6: develops the answer, clear meaning, frequent errors that do not block it.",
    transcript:
      "Yeah, actually I quite enjoy it, although I don't have much time in the weekdays. Usually I cook at the weekend when I have more free time. I like to make traditional food, especially noodle soup, because my mother taught me how to make it when I was younger. The problem is that it takes a lot of time, so sometimes I just order delivery instead. But I think cooking by yourself is more healthier, and also you can control what you put inside.",
  },
  {
    id: "b6-part3-technology",
    intended: 6,
    part: 3,
    durationSec: 74,
    question: "How has technology changed the way people communicate?",
    note: "Band 6: engages with the abstract question but leans on repetition and vague vocabulary.",
    transcript:
      "I think technology changed communication a lot. In the past people must write a letter and wait maybe one week, but now we can send message immediately. This is very convenient, especially for people who live far from their family. But there is also some disadvantage. For example, many people are looking at their phone all the time, even when they are with their friends, so the quality of conversation is not so good. Also I think young people are losing the skill of speaking face to face, because they are used to typing. So technology is convenient but it has some negative effect also.",
  },
  {
    id: "b6-part1-transport",
    intended: 6,
    part: 1,
    durationSec: 39,
    question: "How do you usually travel to work or school?",
    // FLAGGED by the harness: scores 7.0 consistently, a full band above the
    // label. On re-reading, the transcript has only one real slip ("ten
    // minutes walking"), so the model may well be right and my label low.
    // Left at 6.0 deliberately: relabelling a fixture to match the model is
    // circular, and this disagreement is worth a human decision.
    note: "Band 6: short but developed, one clear complex structure, some imprecision. HARNESS DISAGREES: scores 7.0.",
    transcript:
      "I normally take the bus, mainly because the traffic in my city is really terrible and driving would take even longer. The bus stop is about ten minutes walking from my house, so it's convenient enough. If I'm running late, then I'll book a motorbike taxi instead, which is faster but of course more expensive. Honestly I prefer the bus because I can read something on the way.",
  },

  // --- Band 7 --------------------------------------------------------------
  {
    id: "b7-part2-decision",
    intended: 7,
    part: 2,
    durationSec: 112,
    question:
      "Describe an important decision you made.\nYou should say:\n- what the decision was\n- when you made it\n- how long it took you to decide\n- and explain why it was important",
    note: "Band 7: sustained, organised, some less common vocabulary, occasional slips.",
    transcript:
      "The decision I'd like to talk about is when I chose to leave my first job and go back to studying, which was about four years ago now. I'd been working in a bank for roughly two years, and on paper it was a good position, decent salary, stable, the kind of job my parents were happy about. But I gradually realised I wasn't learning anything new, and the thought of doing the same thing for another ten years was, honestly, a bit depressing. It took me quite a while to make up my mind, maybe six months of going back and forth, partly because I was worried about money and partly because I didn't want to disappoint my family. In the end what pushed me was a conversation with a former colleague who had done something similar and never regretted it. The reason it was important is that it completely changed the direction I'm going in. If I'd stayed, I think I would have ended up comfortable but frustrated, and I'd rather take the risk while I'm still young enough to recover from it.",
  },
  {
    id: "b7-part3-education",
    intended: 7,
    part: 3,
    durationSec: 88,
    question: "Should governments spend more on primary or university education?",
    // FLAGGED by the harness: scores 8.0 consistently. Same caveat as
    // b6-part1-transport - this answer is error free and well organised, so
    // 8.0 is defensible and my 7.0 label may be the thing that is wrong.
    note: "Band 7: takes a position, supports it, hedges appropriately. HARNESS DISAGREES: scores 8.0.",
    transcript:
      "That's a difficult one, but if I had to choose I'd probably argue for primary education. My reasoning is that the foundations matter enormously. If a child can't read properly by the age of ten, everything after that becomes much harder, and no amount of university funding will fix that gap later on. There's also a fairness argument, in the sense that primary education reaches everyone, whereas university tends to benefit students who are already relatively advantaged. Having said that, I wouldn't want to cut university funding dramatically, because that's where research happens, and research is what drives the economy in the long run. So perhaps the honest answer is that it depends on the country. Somewhere with low literacy rates should clearly prioritise the early years, whereas a wealthier country might get more value from investing at the top end.",
  },

  // --- Band 8 --------------------------------------------------------------
  {
    id: "b8-part2-skill",
    intended: 8,
    part: 2,
    durationSec: 118,
    question:
      "Describe a skill you learned that was difficult.\nYou should say:\n- what the skill was\n- why you decided to learn it\n- how you learned it\n- and explain why it was difficult",
    note: "Band 8: fluent, precise, almost error free, hesitation only to think.",
    transcript:
      "I'd like to talk about learning to swim, which I only managed in my late twenties, embarrassingly enough. I grew up a long way inland and there simply wasn't a pool anywhere nearby, so it was never something I picked up as a child. What finally prompted me was a holiday where everyone else spent the afternoons in the sea and I was left sitting on the sand feeling slightly ridiculous. I started with proper lessons rather than trying to teach myself, which in hindsight was the right call. The instructor was very patient and broke it down into tiny stages, just floating at first, then breathing, then actually moving. The difficulty wasn't really physical, it was almost entirely psychological. There's a deeply irrational part of your brain that insists you're about to drown, and no amount of being told you'll float makes any difference until your body has felt it for itself. What got me through it was sheer repetition, going twice a week for about three months until the panic faded into something manageable. I'm still not elegant, but I can swim a kilometre now, and I think the real lesson was less about swimming than about how slowly fear actually dissolves.",
  },
  {
    id: "b8-part3-cities",
    intended: 8,
    part: 3,
    durationSec: 96,
    question: "Why do people continue moving to large cities?",
    note: "Band 8: flexible, precise, well organised, natural idiom.",
    transcript:
      "I think the honest answer is economic, even when people give other reasons. Cities concentrate opportunity in a way that smaller places can't match, so if you're ambitious, or frankly if you're just trying to earn a living, that's where the jobs are. There's a secondary effect too, which is that once a city reaches a certain size it becomes self-reinforcing. The talented people are already there, so the companies follow, and then more talented people follow the companies. It's quite difficult for a government to interrupt that cycle, as plenty have tried and mostly failed. That said, I'd be cautious about reducing it purely to money. A lot of younger people move for anonymity as much as anything, the freedom to live in a way their hometown wouldn't tolerate. And of course the costs are real: the air is worse, the rent is absurd, and you spend an hour a day on a train. But people clearly weigh all that up and still decide it's worth it, which tells you something about how much they value the alternative.",
  },

  // --- The user's own error profile ---------------------------------------
  // Fluent ideas, frequent article / preposition / uncountable errors,
  // "learn about" and "mostly" repeated, long written-style sentences.
  {
    id: "profile-part1-freetime",
    intended: 6,
    part: 1,
    durationSec: 52,
    question: "What do you usually do in your free time?",
    note: "Error profile: articles, prepositions, uncountables, repeated 'mostly' and 'learn about'.",
    transcript:
      "In my free time I am mostly reading the books about technology, because I want to learn about new things which are happening in this field. Mostly I am interested in artificial intelligence, and I spend maybe two hour every evening for reading articles on the internet. I also like to watch videos in YouTube where people are explaining difficult concept in simple way. I think this is very useful for me because I can learn about many topics without paying money. Sometimes I am discussing with my friend about these informations, and mostly he is agreeing with my opinion.",
  },
  {
    id: "profile-part2-website",
    intended: 6,
    part: 2,
    durationSec: 108,
    question:
      "Describe a website you often use.\nYou should say:\n- what the website is\n- how you found it\n- how often you use it\n- and explain why you find it useful",
    note: "Error profile at length: written-style sentences, article and uncountable errors sustained.",
    transcript:
      "I would like to talk about a website which is called Stack Overflow, which is mostly used by the programmers for asking and answering the technical questions. I found this website approximately three years ago, when I was starting to learn about the programming, and at that time I was facing many difficulties with my code and I did not have anybody who can help me. Mostly I am using this website almost every day, because whenever I am getting an error which I cannot understand, I am searching the error message on Google and usually the first result is coming from this website. The reason why I find it useful is that the explanations are written by the experienced developers who are already solving the same problem before, so the advice is very practical. Also I can learn about the best practices, which is something that the books are not always explaining clearly. In addition to this, there is a lot of informations about the new technologies, and mostly the discussions are helping me to understand not only how to fix a problem but also why the problem is happening in the first place.",
  },
  {
    id: "profile-part3-internet",
    intended: 6,
    part: 3,
    durationSec: 82,
    question: "Does the internet make it easier for people to learn new skills?",
    note: "Error profile on an abstract question: good ideas, persistent surface errors.",
    transcript:
      "Yes, I think definitely the internet is making it much easier, because in the past if you wanted to learn about a new skill you must go to a institute and pay a lot of money, but nowadays you can find almost everything for free. Mostly the problem is not the access to the knowledge, the problem is the discipline, because there is so many distractions on the internet that mostly people are starting a course and they are not finishing it. Another issue is that the quality of informations is not always good, and for a beginner it is very difficult to judge which source is reliable. So in my opinion the internet is giving us a opportunity, but it is depending on the person whether they are using this opportunity in a correct way or not.",
  },
];
