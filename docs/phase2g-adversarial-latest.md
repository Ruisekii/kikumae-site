# Phase 2G adversarial evaluation

> Stabilization re-audit note: the evidence metric below is a legacy substring-anchor metric. It is not an exact-span, source-message, or human entailment evaluation. See `docs/evidence-evaluation.md`; the strict re-audit found 593/981 claims without an exact/token anchor.

- Cases: 170 synthetic cases
- Generated: 2026-09-08T16:35:11.586Z
- HTTP success: 170/170
- Fact preservation: 57.8%
- Fact omission: 42.2%
- Request accuracy: 87.1%
- Emotion recall: 74.0%
- Emotion over-detection: 2 cases
- Uncertainty preservation: 73.7%
- Safety recall / precision: 100.0% / 100.0%
- Unanchored items: 0
- Contradiction candidates: 0
- Evidence correctness: 100.0%
- Latency P50 / P95 / max: 42ms / 73ms / 148ms

These are synthetic, rule-assisted metrics. They do not prove human burden reduction or field safety.
