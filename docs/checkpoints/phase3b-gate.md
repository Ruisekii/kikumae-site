# Phase 3B Gate Checkpoint

判定: **未達（部分通過）**

## 通過した範囲

- Ollama／Conversation／Extractionの停止を模擬しても、原文を保持できる。
- timeout、不正JSON、ネットワーク断を模擬しても、Safety Guardの結果を保持できる。
- 医療Safety相談では、モデル応答に依存せず即時フラグが残る。
- 障害後の決定的triageとSafety-onlyが動作する。
- 本番データを書き換えず、同じ評価を再実行できる。
- クライアント端末の送信待ちキューと、通信復帰時の同一キー再送経路を追加した。

## 未通過の範囲

- DB再起動・破損・復元
- 電源断・PC再起動
- LAN切断／復帰と送信待ち再送の実機確認
- サーバー側の耐久アウトボックス
- ブラウザクラッシュ
- ディスク容量不足・時刻ずれ・長時間稼働
- 複数端末・競合更新
- バックアップ／復元の実証

## 次の判断

Phase 3Bの残りを実装・検証する。Phase 3C（職員業務ワークフロー）とPhase 3D以降は、3B Gateを満たすまで開始しない。

根拠: `docs/phase3b-resilience-latest.md` と `docs/phase3b-resilience-latest.json`
