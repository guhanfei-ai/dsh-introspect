# Metrics

> These five axes are a personal observation model — not a scientific scale, a medical measure, a psychological diagnosis, or a verdict on the person. They exist to help you observe what is happening to you, not to judge what kind of person you are.
>
> **Observe. Do not judge.**

dsh-introspect projects every recorded event onto five observation axes. The model assigns values at record time; the plugin stores, validates, aggregates and displays them. Scores can be re-derived from the raw text at any time — the raw event is always preserved.

---

## MEL — Mental Energy Level

**Question:** How much usable mental energy does this state show?

**Range:** 0–200, nullable.

| Band | Range | Label | Notes |
|------|-------|-------|-------|
| Low | 0–59 | Depleted / inner friction | Self-doubt, inner conflict, perfectionism drain. |
| Normal | 60–79 | Balanced | Sustainable focus, routine work. |
| High | 80–99 | Creative flow | Deep work, excited engagement, strong drive. |
| Over-limit | 100–200 | Above baseline | A delivery just landed ("逆熵效应"), or constructive anger / boundary defence ("战斗充能"). Not pathology. |

**Aggregation:** latest value for the day; also average and trend (delta from the previous event).

**Important distinction:** MEL is not physical fitness, not mood, and not a score of how "good" you are. It is an estimate of available cognitive fuel.

The over-100 bands have specific names in the source system (逆熵效应, 战斗充能). They represent above-baseline states driven by achievement release or constructive anger — not mania or danger. See the original rubric at `tools_mel/ai_prompt_system.md` in the old tay2mel project for the full theory.

---

## RRI — Reality Response Index

**Question:** Did the real world observably move, independently of how it felt?

**Range:** 0–100, nullable.

| Band | Range | Label | What it means |
|------|-------|-------|---------------|
| Very low | 0–20 | Purely internal | Thinking, planning, feeling — nothing externally observable changed. |
| Low | 21–40 | A faint trace | A draft written, a plan shared, a first ping sent. |
| Medium | 41–60 | A concrete action landed | Email sent, code committed, question answered. |
| High | 61–80 | A real external response | Approved, adopted, merged, used by someone. |
| Very high | 81–100 | A verifiable consequence | Downloads, revenue, a published release, a merged PR with downstream impact. |

**Aggregation:** latest value for the day; also average.

**Scoring rules (from the original rubric):**

- Judge only physical/social/observable feedback.
- Never judge whether it felt good, whether it was worth doing, or which way it pointed.
- Conservative default: when unsure, score lower.
- Long-term latent impact is explicitly excluded.

RRI deliberately does not evaluate "was this worthwhile" — only "did the real world respond."

---

## ROI — Return On Investment

**Question:** What did this exchange return to me, relative to what it cost?

**Range:** unbounded (positive = net personal gain, near zero = wash, negative = cost exceeded return), nullable.

**Unit:** personal utility points (元-equivalent). Not money. Not a financial instrument.

This is a personal utility balance: immediate and conservatively discounted future return, minus the cost in time, money, feeling and energy. The old system used a formula with weighted feeling/energy inputs; in this plugin the model scores ROI directly from the event description.

**Aggregation:** today's cumulative sum (daily net utility).

---

## ARCTIC — Direction / Goal Alignment

**Question:** Did this move me toward where I actually want to go, or away from it?

**Range:** -10 to +10, nullable. A signed step, not an absolute distance.

In the original tay2mel system, ARCTIC was a "remaining kilometres" counter (a monotonically decreasing chain-read). This plugin redesigns it as a per-event signed direction delta: positive = toward, negative = away, zero = sideways. This makes each event independently meaningful and avoids the fragile chain-dependency of the old design.

**Aggregation:** today's cumulative sum (net direction for the day).

---

## TSA — Time Spent / Time Scarcity Accounting

**Question:** How much of a finite day did this consume?

**Range:** 0–10080 minutes (one week), nullable.

TSA is the one axis where the old system had a rich display model: one day = 86400 seconds = 86400 virtual 元. The plugin keeps the raw minutes and lets the UI decide how to present it. Minutes are summed for the day.

**Null rule:** If the user did not say how long something took, pass null. Never invent a precise number. Unknown > fabricated precision.

---

## Energy-Reality Gap

A derived quantity, not stored in the database.

```
gap = MEL - RRI
```

Shown only when both values are known. Because MEL can exceed 100 while RRI caps at 100, the gap can legitimately reach +100. A large positive gap means high internal energy with limited external feedback; a large negative gap means the opposite. The plugin does not interpret what this means — it draws the line and lets you look.

---

## Quadrant Model

When both MEL and RRI are present, each event can be placed in one of four quadrants (thresholds: MEL ≥ 60, RRI ≥ 40):

| | RRI high (≥40) | RRI low (<40) |
|---|---|---|
| **MEL high (≥60)** | High energy, high reality feedback | High energy, low reality feedback |
| **MEL low (<60)** | Low energy, high reality feedback | Low energy, low reality feedback |

This is for observation, not diagnosis. "High energy / low reality feedback" is a signal worth noticing — but the plugin will never say "you are spinning." It shows the quadrant counts and lets you see for yourself.

---

## Aggregation Rules Summary

| Axis | How it aggregates for a day |
|------|-----------------------------|
| MEL | Latest value + trend (delta from previous event) + average |
| RRI | Latest value + average |
| ROI | Cumulative sum |
| ARCTIC | Cumulative sum |
| TSA | Sum of minutes |
| Events | Count |
| Gap | Derived from latest MEL and RRI, not aggregated |

---

## Limitations

- These are subjective self-reports, not objective measurements.
- RRI is a personal perception of external feedback, not a fact-checker.
- All metrics can be wrong. They can be corrected via `introspect_update`.
- The system does not validate the truth of `raw_text` — it preserves it as-is.
- No metric can diagnose mental health, productivity, or personal worth.