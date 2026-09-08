# Phase 2B 評価結果

生成日時: 2026-09-08T07:20:46.560Z
固定評価セット: 110件 / 今回評価: 20件

## Extraction

## Conversation
- qwen3.5:2b: HTTP 20/20, 契約有効 20/20, total P50/P90/P95/max 5235/5799/5886/11715ms
- qwen3.5:4b: HTTP 20/20, 契約有効 20/20, total P50/P90/P95/max 7970/8928/8958/8961ms

## 補足

- totalはAPI応答全体、modelTimingsはHTTPヘッダー受信・first token・prompt待ち・生成・JSON parse・補正を分離した値です。
- Ollamaのserver-side prompt_eval_duration / eval_durationが返る場合はmodelTimingsにも記録します。
- 重要案件の最終判断・返信送信は引き続き職員が行います。
