# Stabilization trust boundary

作成日: 2026-09-09

## 正本の境界

住民ブラウザから受け取る `body` は原文として保存する。`incident`、要約、Safety、会話の状態をブラウザから受け取って、そのまま職員向けの正本にしてはいけない。

受付時の正本は、サーバー側で次の順に作る。

```text
raw body
  ├─ Safety Guard（決定的ルール、LLM非依存）
  ├─ allowlist済み intake（避難所位置・人数等）
  └─ server canonical incident
       └─ staff organization（候補・出所・証拠付き）
```

`db/local-ai.ts` の `buildServerCanonicalIncident()` が原文・サーバー側Safety・許可済み選択値から構造化データを再生成する。`app/api/questions/route.ts` と確認URLからの更新経路では、ブラウザの `incident` を無視する。

## 出所レベル

| 出所 | 意味 | 人の確認 |
| --- | --- | --- |
| `user_text` | 原文に明記された内容 | 対応前に確認 |
| `user_selection` | 許可された選択UIの値 | 原則確認 |
| `safety_rule` | 原文に対する決定的Safetyルール | 必ず職員確認 |
| `server_rule` | サーバー側の分類・構造化 | 候補、確定ではない |
| `llm_extraction` | LLMの抽出候補 | 必ず職員確認 |
| `staff_edit` | 職員が修正した値 | 操作履歴が必要 |

`ai_organized` は既存保存データとの互換用の表示上の候補であり、原文の代替ではない。

## 原文の不変性

`body_original` は初回受付の原文であり、確認URLから追加情報を受け取っても上書きしない。追加情報は会話履歴と集約処理用の `body` に追記し、職員は初回原文・追加情報を分けて確認できる。これはコード契約テストで確認しているが、本番相当D1での更新統合テストは未完了である。

## 証拠

整理項目は `messageId`、`evidence`、`evidenceStatus` を持つ。根拠が完全一致しない場合に原文先頭を代入する処理は削除し、`token` または `not_found` として表示する。証拠評価は意味的含意の証明ではないため、職員には候補として示す。

## 残る境界

- 会話履歴の一部はブラウザ入力由来であり、正本のIncidentには使わない。
- `mode=organize` の評価経路は正本保存経路ではないが、評価フラグを本番で有効化しないこと。
- 2026-09-09時点で本番相当の認証・D1・バックアップ復元テストは未実施。
