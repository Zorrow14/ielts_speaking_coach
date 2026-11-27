# Calibration harness

`npm run calibrate`

Runs every fixture transcript in `fixtures.ts` through the real evaluation
prompt three times and reports per-criterion bands, the spread between runs,
the mean overall against the intended band, whether band ordering holds, and
any fixture scoring more than 0.5 above target. Exits non-zero on broken
ordering or inflation.

`last-run.txt` is the most recent run, kept so prompt changes can be compared
against something.

## What this does and does not show

It measures **consistency between runs** and **relative ordering**. It does not
measure accuracy. The `intended` band on each fixture is a hand-assigned
judgement, not an official mark, so a disagreement between the harness and the
label can mean either the model is wrong or the label is.

Two fixtures currently disagree by a full band (`b6-part1-transport`,
`b7-part3-education`). Both are annotated in `fixtures.ts`. They have
deliberately **not** been relabelled: moving a label to match the model's
output would make the check circular and the exit code meaningless. They need
a human read instead.

## Pronunciation

The fixtures are text, so the prompt is told there is no audio. Pronunciation
comes back as a null band with `unavailable` confidence, and the harness warns
if any run invents a pronunciation score from spelling instead. No run has.
The pronunciation half of the prompt is therefore **not** exercised here and
can only be checked by recording real audio.

## Adding a fixture

Write the transcript the way speech actually comes out - false starts,
repetition, fillers - because that is what the live pipeline transcribes.
Set `intended` from your own reading before you run it, not after.
