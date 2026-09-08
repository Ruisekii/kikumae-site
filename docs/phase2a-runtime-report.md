# Phase 2A 実行レポート

実測日: 2026-09-08（日本時間）

## 実際に接続した構成

- モデル: `qwen3.5:4b`（Qwen3.5 4.7B）
- 量子化: `Q4_K_M`
- 実行バックエンド: Ollama の OpenAI互換 `/v1/chat/completions`
- Conversation: `AI_CONVERSATION_MODEL`
- Incident Extraction: `AI_EXTRACTION_MODEL`
- JSON出力: Ollama structured outputs の JSON Schema
- 推論設定: `reasoning_effort: none`
- モード: `auto`（Local LLM失敗時は local-rulesへFallback）

## 10件評価

- QwenのHTTP成功: 10/10
- Qwen期待JSON完全一致: 9/10
- local-rules期待JSON完全一致: 0/10
- Qwen Incident Extraction: 平均23,006ms、最短19,490ms、最長25,885ms
- Conversation: 平均8,730ms、最短8,222ms、最長9,438ms

評価ケースは飲料水不足、トイレ、乳児用品、高熱、意識異常、呼吸異常、火災、暴力、強い怒りだが非緊急の案件、情報不足の10件です。各ケースのlocal-rules結果・Qwen結果・期待JSONは `phase2a-evaluation-latest.json` と同名Markdownに保存しています。

## メモリ

- Ollama `/api/ps`: `size_vram: 0`
- `llama-server`: 約3,019.6MB working set / 約4,721.1MB private memory
- NVIDIA GPU telemetry: `nvidia-smi` 未導入のため取得不可。実測上はCPU実行として扱います。

## 安全上の扱い

Safety GuardはLLMと並列に実行し、医療・呼吸・火災・暴力を検出した場合は、会話AIの自由文をそのまま採用せず、職員への先行通知と場所確認へ固定します。Incident JSONは原文を `originalText` に保持し、職員向け正本はJSON構造です。

## 公開環境について

公開Workerから利用者PCの `localhost` や避難所LAN上のLLMへ直接接続する設定は入れていません。ローカル開発時だけ `.dev.vars` でQwenを接続し、公開版はAI Gateway未設定時に既存のlocal-rulesへ安全にFallbackします。したがって、現時点で「完全ローカル」「音声が外部送信されない」とは表示・断言しません。

## 次の判断

4Bでも医療・火災・暴力のSafety FlagとIncident JSON化は確認できました。次に9Bへ上げる場合は、速度・メモリ増加と引き換えに、複合案件の事実欠落、カテゴリ境界、追加確認項目の妥当性を比較する段階です。先に9Bへ移行するより、現在の10件を増やした回帰テストと、避難所固有のIntake情報を含む評価を増やす方が合理的です。

## Phase 2A.5 追補

110件の固定評価、2B/4B Conversation比較、Ollamaのcold/warmベンチマーク、GPU監査を追加しました。最新の実測値は以下です。

- `docs/phase2a5-evaluation-latest.md`
- `docs/phase2a5-conversation-comparison.md`
- `docs/phase2a5-ollama-benchmark.md`
- `docs/phase2a5-hardware-audit.md`
