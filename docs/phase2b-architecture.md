# Phase 2B AI接続アーキテクチャ比較

## 推奨

Phase 2Cでは、**避難所LAN内のEdge Gateway（Mini PCまたはGPU PC）を標準構成**にする。避難者ブラウザと職員端末は、QRコードで案内したLAN内の相談画面またはLAN内Gatewayへ接続し、Safety Guard・Conversation・Incident Extraction・ローカルDBを同じ施設内で動かす。インターネットが復旧した場合だけ、選択した統計・FAQ・対応履歴をCloudflare側へ同期する。

理由は、災害時の一次受付をインターネットとクラウドAIから切り離しつつ、4B以下のCPUモデルから将来GPUモデルへ交換できるためである。公開Web版は引き続き、AI Gatewayが無い場合にlocal-rulesへfallbackする。

## 候補比較

| 候補 | インターネット断 | 個人情報 | レイテンシ | 導入コスト | 運用難度 | 複数避難所 | fallback | 判定 |
|---|---|---|---|---|---|---|---|---|
| A. 避難所LAN内ローカルAI | 強い | 施設内に閉じやすい | 低〜中 | 中 | 中 | Gatewayごとに管理 | 強い | 採用の基礎 |
| B. Mini PC / GPU PC Edge | 強い | 施設内に閉じやすい | 低 | 中〜高 | 中 | イメージ配布で拡張 | 強い | Aの実装形 |
| C. ブラウザ→LAN Edge API | 強い | API境界を明確化 | 低 | 低〜中 | 中 | 施設単位 | 強い | 推奨API境界 |
| D. Cloudflare→安全なトンネル | トンネル断で不可 | 外部経路を設計必要 | 中 | 中 | 高 | まとめやすい | 可能 | 復旧後の補助 |
| E. 完全クラウドAI | 弱い | 外部送信が前提 | 中〜高 | 低〜中 | 低 | 強い | 可能 | 一次受付の標準にはしない |

## Phase 2C API境界

```text
住民端末 / 職員端末
        │ HTTPS（避難所LAN）
        ▼
Local Edge Gateway
  ├─ Safety Guard（LLM外・同期）
  ├─ /v1/conversation       低遅延・短文・1項目だけ
  ├─ /v1/incident-extract    JSON Schema・原文照合
  ├─ /v1/health              model / mode / fallback
  ├─ Local DB                原文・案件・対応履歴
  └─ Sync Queue              通信復旧後だけCloudへ
        │ optional
        ▼
Cloudflare Site / D1（同期・公開ステータス・集計）
```

APIレスポンスには `requestId`, `aiMode`, `model`, `fallback`, `safety`, `telemetry` を含める。ただし住民画面には内部モデル名を表示せず、職員画面だけが実行状態を確認できるようにする。重要案件の確定と住民向け送信は、EdgeでもCloudでも職員操作を必須にする。

## 通信断時の動作

1. Safety Guardとlocal-rulesで受付・速報・最低限のIncident Cardを継続する。
2. Local LLM停止時も、相談原文・受付時刻・場所・職員向け緊急表示を失わない。
3. 同期再開時は、原文と対応履歴を重複排除キー付きでCloudへ送る。
4. 同期失敗は職員へ表示するが、住民の受付処理を止めない。

現段階では、公開Workerから利用者PCのlocalhostへ直接接続する構成は採用しない。これは公開版を完全オフラインAIと誤認させないためでもある。
