# Calibration review: two disputed fixtures

`npm run calibrate` flags any fixture whose mean overall lands more than 0.5
above its intended band. Two do. This file puts everything a human needs to
settle them in one place: the full transcript, the label and the reasoning
behind it, the model's bands across three runs, and the exact evidence quotes
the model gave for each criterion.

**Nothing here has been relabelled.** Moving a label to match the model would
make the harness circular and its exit code meaningless — it would then be
checking that the model agrees with the model. Both fixtures stay at their
original `intended` values until a person decides otherwise.

**The question to answer for each is narrow:** is the label too low, or is the
model too generous? Those need opposite fixes. A low label is a one-line edit
to `fixtures.ts`. A generous model is a prompt change and a `PROMPT_VERSION`
bump, and it affects every real score the app has ever given.

---

## What the harness can and cannot tell you

It measures **run-to-run consistency** and **relative ordering**. It does not
measure accuracy, and no amount of running it will. The `intended` band on
each fixture is one person's judgement of their own hand-written transcript,
not an official mark.

Ordering currently holds across all four levels, which is the more valuable
signal: intended 5.0 → 5.00, 6.0 → 6.22, 7.0 → 7.50, 8.0 → 8.08. A model that
ranks correctly but sits half a band high is a calibration offset, which is
fixable. A model that ranks incorrectly is a different and much worse problem.

**Pronunciation is not exercised here at all.** The fixtures are text, so the
prompt is told there is no audio, and pronunciation comes back `null` with
`unavailable` confidence in every run below. It can only be judged from real
recordings.

---

## Fixture 1 — `b6-part1-transport`

| | |
|---|---|
| Part | 1 |
| Question | "How do you usually travel to work or school?" |
| Duration | 39s |
| **Intended** | **6.0** |
| Label reasoning | "Band 6: short but developed, one clear complex structure, some imprecision." |
| Recorded run (27 Nov, `last-run.txt`) | 7.0 / 7.0 / 7.0 — mean **7.00**, spread 0 |
| Re-run for this document | 6.5 / 6.5 / 7.0 — mean **6.67**, spread 0.5 |

### Transcript

> I normally take the bus, mainly because the traffic in my city is really
> terrible and driving would take even longer. The bus stop is about ten
> minutes walking from my house, so it's convenient enough. If I'm running
> late, then I'll book a motorbike taxi instead, which is faster but of course
> more expensive. Honestly I prefer the bus because I can read something on the
> way.

### The model's three runs, with evidence

| Run | Fluency | Lexical | Grammar | Overall |
|---|---|---|---|---|
| 1 | 7.0 | 6.0 | 7.0 | **6.5** |
| 2 | 7.0 | 6.0 | 7.0 | **6.5** |
| 3 | 7.0 | 7.0 | 7.0 | **7.0** |

**Fluency 7.0** — quoted, consistently across runs:
- "I normally take the bus, mainly because the traffic in my city…"
- "If I'm running late, then I'll book a motorbike taxi instead"

**Lexical 6.0, 6.0, 7.0** — the only criterion that moved:
- "the traffic in my city is really terrible"
- "convenient enough"
- "driving would take even longer" (run 2)
- "more expensive" (run 2)

**Grammar 7.0** — every run found the same single error:
- "driving would take even longer"
- "If I'm running late, then I'll book a motorbike taxi instead"
- `sentences_total: 4`, `sentences_with_errors: 1`, `error_types: ["prepositions"]`

**The one mistake, identically found in all three runs:**
"ten minutes walking from my house" → "a ten-minute walk from my house".

### What to weigh

The grammar count is the crux. Four sentences, one error, and that error is a
minor one. The model is not hallucinating quality — it found exactly the slip
the fixture's own note describes ("one real slip"), counted it honestly, and
still landed at 7.0 for grammar.

Against 7.0: the answer is short, and the vocabulary is unremarkable — "really
terrible", "convenient enough", "more expensive" are all common currency. Two
of three runs put lexical at 6.0 for that reason, which is a defensible read.

For 7.0: "If I'm running late, then I'll book…" is a clean conditional,
"driving would take even longer" is a correct hypothetical, and the answer has
a reason, a contrast and a preference in four sentences.

A point worth noticing: **this fixture is less inflated than recorded.** The
flag came from a 7.00 mean; today it scores 6.67. The disagreement may be
closer to 0.5 than the full band the README claims. Worth a re-run before
deciding.

---

## Fixture 2 — `b7-part3-education`

| | |
|---|---|
| Part | 3 |
| Question | "Should governments spend more on primary or university education?" |
| Duration | 88s |
| **Intended** | **7.0** |
| Label reasoning | "Band 7: takes a position, supports it, hedges appropriately." |
| Recorded run (27 Nov) | 8.0 / 8.0 / 8.0 — mean **8.00** |
| Re-run for this document | 8.0 / 8.0 / 8.0 — mean **8.00**, stable |

### Transcript

> That's a difficult one, but if I had to choose I'd probably argue for primary
> education. My reasoning is that the foundations matter enormously. If a child
> can't read properly by the age of ten, everything after that becomes much
> harder, and no amount of university funding will fix that gap later on.
> There's also a fairness argument, in the sense that primary education reaches
> everyone, whereas university tends to benefit students who are already
> relatively advantaged. Having said that, I wouldn't want to cut university
> funding dramatically, because that's where research happens, and research is
> what drives the economy in the long run. So perhaps the honest answer is that
> it depends on the country. Somewhere with low literacy rates should clearly
> prioritise the early years, whereas a wealthier country might get more value
> from investing at the top end.

### The model's three runs, with evidence

| Run | Fluency | Lexical | Grammar | Overall |
|---|---|---|---|---|
| 1 | 8.0 | 8.0 | 8.0 | **8.0** |
| 2 | 8.0 | 7.5 | 8.0 | **8.0** |
| 3 | 8.0 | 8.0 | 8.0 | **8.0** |

**Fluency 8.0** — the same three quotes every run:
- "That's a difficult one, but if I had to choose…"
- "Having said that, I wouldn't want to cut university funding dramatically"
- "Somewhere with low literacy rates should clearly prioritise the early years"

**Lexical 8.0, 7.5, 8.0:**
- "the foundations matter enormously"
- "relatively advantaged"
- "drives the economy in the long run"

**Grammar 8.0:**
- "If a child can't read properly by the age of ten, everything after that becomes much harder"
- "whereas university tends to benefit students who are already relatively advantaged"
- "Somewhere with low literacy rates should clearly prioritise the early years, whereas a wealthier country might get more value from investing at the top end."
- `sentences_total: 9` (8 in run 3), `sentences_with_errors: 0`, `error_types: []`

**Mistakes found: none, in any run.**

### What to weigh

This is the harder of the two, and the model's position is strong. Nine
sentences, zero errors, and the evidence quotes are genuinely band-8 material:
"whereas" used twice correctly for contrast, a clean second conditional, a
concessive "Having said that", and a conclusion that qualifies rather than
restates.

The honest difficulty is that this transcript was **written, not spoken.** It
has no false starts, no self-correction, no fillers, no repetition — and real
band 7 speech has all of those. The model is marking a polished paragraph. On
the page it reads as an 8; out of a mouth, under timed conditions, it would
almost certainly arrive messier and mark lower.

That points at a limitation of the fixture rather than of either the label or
the model. If this is the conclusion you reach, the fix is not to relabel it —
it is to rewrite the transcript with the disfluency real speech has, which is
what `tests/calibration/README.md` already tells future contributors to do.

Note also that the three runs agree almost perfectly (one 0.5 wobble on
lexical). This is a stable judgement, not a coin flip.

---

## Possible outcomes

| Conclusion | What to change |
|---|---|
| The labels are low | Edit `intended` in `fixtures.ts` and note why in the fixture comment. No prompt change. |
| The model is generous | Tighten the strictness rules in `lib/prompts/evaluate.ts`, bump `PROMPT_VERSION`, re-run the whole harness. Affects every future score, and the progress charts mark the version boundary. |
| The fixtures are not speech-like | Rewrite the transcripts with false starts and repetition, keep the labels, re-run. Most likely right for `b7-part3-education`. |
| Leave it | Legitimate, but then `npm run calibrate` keeps exiting non-zero and will eventually be ignored, which is worse than either fix. |

## Reproducing

```bash
npm run calibrate       # all fixtures, three runs each, writes last-run.txt
```

The evidence quotes above came from a one-off run of these two fixtures at
seeds 1, 2 and 3 on 28 Nov 2026, using `PROMPT_VERSION` and `GEMINI_MODEL` as
they stand in the repo today. `last-run.txt` records bands and evidence
*counts* but not the quotes themselves, which is why they are reproduced here.
