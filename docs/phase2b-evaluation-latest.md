# Phase 2B 評価結果

生成日時: 2026-09-08T07:15:15.881Z
固定評価セット: 110件 / 今回評価: 110件

## Extraction
- qwen3.5:4b / compact: HTTP 110/110, Schema 97/110, 完全一致 34/110, 重要事実取りこぼし 28.7%, fallback 0件, total P50/P90/P95/max 21558/24676/26073/45384ms

## Conversation

## 補足

- totalはAPI応答全体、modelTimingsはHTTPヘッダー受信・first token・prompt待ち・生成・JSON parse・補正を分離した値です。
- Ollamaのserver-side prompt_eval_duration / eval_durationが返る場合はmodelTimingsにも記録します。
- 重要案件の最終判断・返信送信は引き続き職員が行います。
