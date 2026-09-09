# Phase 2H — オフライン・音声・アクセシビリティ監査

作成日: 2026-09-09

## 結論

この監査では OS 全体のネットワーク切断やマイク権限の許可は実施していない。したがって「完全オフライン対応」や「音声が外部へ送信されない」とは判定しない。

localhost での Web UI と Safety Guard は動作した。LLM・翻訳・職員画面は、ローカルWeb/DBと同一PCまたは避難所LANのOllamaが稼働している場合に限る条件付き対応である。音声認識・読み上げはブラウザ/OSの実装差があり、オフライン合格とは扱わない。

## 実施した確認

- `npm run audit:phase2c:offline`
  - localhost Web UI: HTTP 200
  - HTMLに検出できる外部 `src` / `href`: なし
  - Safety-only経路: HTTP 200、`immediate: true`
- `node scripts/phase2c-faults.mjs`
  - Ollama停止、Conversation停止、Extraction停止、timeout、不正JSON、ネットワーク障害注入を Conversation / Extraction 各6件、計12件で実施。
  - 12/12 が fallback と Safety情報を保持。
  - 翻訳障害時も原文 `She may have a fever.` を保持し、翻訳は `failed` とした。
- `npm run audit:phase2h`
  - 上記結果に加え、音声実装、下書き保持、CSP、モバイルブレークポイント、静的アクセシビリティ指標をJSON化した。

## 機能別の判定

| 機能 | 判定 | 根拠・制限 |
| --- | --- | --- |
| Web UI | localhost限定で full-offline-local-ui | localhost応答、HTML外部参照なし。ブラウザキャッシュやPWAとしての再起動は別試験。 |
| Safety Guard | full-offline-local | Worker内の決定的ルール。LLM・翻訳に依存しない。 |
| Conversation Qwen3.5 2B | 条件付き | 同一PC/LANのOllamaが必要。停止時はlocal-rulesへfallback。 |
| Incident Extraction Qwen3.5 4B | 条件付き | 同一PC/LANのOllamaが必要。停止時はlocal-rulesへfallback。 |
| 外国語→日本語 | 条件付き | ローカルLLMが必要。失敗時も原文保持。 |
| 職員画面 | 条件付き | ローカルWeb/DBでは動作可能だが、実機の通信断は未実施。 |
| 音声認識 | 未証明 | `SpeechRecognition` / `webkitSpeechRecognition`。`processLocally`プロパティの有無は記録するが、その値を信頼判定に使っていない。ブラウザ提供元へ送信される可能性を残す。 |
| 音声読み上げ | 未証明 | `SpeechSynthesis`。OS/ブラウザ音声エンジンがオフラインで利用できるか未確認。 |
| VAD | 条件付き | `getUserMedia` + `AudioContext`の音量閾値型。マイク権限とブラウザAPIが必要で、Silero等のローカルモデルではない。 |

## 住民の入力を失わないための確認

この時点の監査では、入力途中のフォームは `localStorage` の `kikumae-shelter-draft` に保存・復元され、通信断時の送信待ちキューは未実装だった。その後Phase 3Bで端末内キューと `submissionKey` 再送が追加されたが、実機LAN復帰・端末再起動・再送結果の検証は未実施である。現状の正本は `docs/stabilization-final-report.md` とする。

これは Phase 2I 以降の重要課題である。現時点では、送信失敗時に「保存できた」と誤表示しないこと、下書きが残ること、Safety-onlyの速報経路をLLM障害から独立させることを合格条件とする。

## アクセシビリティ静的監査

確認できたもの:

- 主要ボタンには可視テキストまたは `aria-label` がある。
- 状態、エラー、Safety通知に `aria-live` / `role="status"` / `role="alert"` を使用している箇所がある。
- 住民画面には `@media (max-width: 680px)` があり、タッチ用の大きなボタンがある。
- 管理画面は左メニューを持ち、スマホ時にはメニュー開閉と背景クリックで閉じられる。

未実施:

- VoiceOver / TalkBackの実機操作。
- 200%拡大、色覚差、キーボードのみ操作。
- マイク権限拒否・音声サービス無効状態の実ブラウザ操作。
- 通信を切った状態でのブラウザ再起動後の画面復元。

## 今回採用しなかった変更

音声が必ずローカルになるように見せる表示変更、未検証のPWAキャッシュ、送信を自動再送するキューは、試験なしで安心感を損なうため実装していない。

正本データ: `docs/phase2h-offline-audio-accessibility-latest.json`
