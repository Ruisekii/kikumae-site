# 障害注入試験 — 最新結果

作成日: 2026-09-09
正本JSON: `docs/phase2c-faults-latest.json`

## 実施済み

`node scripts/phase2c-faults.mjs` を localhost に対して実行した。以下を Conversation / Extraction の各モードで試験した。

- Ollama停止
- Conversationモデル停止
- Extractionモデル停止
- timeout
- 不正JSON
- ネットワーク障害注入

全12ケースでHTTP応答があり、fallback=true、Safety情報ありとなった。翻訳障害では、原文を保持したまま `translationStatus: failed` を返した。

## 未実施

- OSレベルの通信断。
- ブラウザのマイク権限拒否、音声サービス停止、TTSエラーの実機操作。
- 端末の強制終了・再起動中の送信。
- D1障害、ストレージ満杯、時計ずれ、電源断。

## 判断

AI障害時のサーバー経路は、既存のlocal-rules fallbackとSafety独立処理を維持できている。完全な相談消失ゼロを証明したものではない。特に送信待ちキューと永続DB障害時の保護はPhase 2I/3Aの未解決事項である。
