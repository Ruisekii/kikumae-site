# Validation Gate

## Gateの使い方

このGateは、Kikumaeを続ける資格を判定するためのもの。評価を良く見せるためのSuccess Criteria変更は禁止する。前のGateが未達なら、新機能開発へ戻らない。

## Gate 1 — Core Problem exists

### 必須証拠

- 8〜15件のProblem Interview。
- 複数の役割または組織で、住民対応・苦情・強い感情等による精神的負担が具体例付きで反復。
- 相談の把握・記録・優先順位・引継ぎは、ストレス要因または別問題として記録。
- 頻度、影響、既存workaround、誰が困るかを記録。
- 「文章整理ではなく別問題」「現行で十分」「低優先」を反証として集計。

### 判定

- **未実施**: 現在の状態。
- **Pass**: Core Problemが複数の具体例で確認され、現行手段の不足とKikumae境界への接続が示される。
- **Hold/Refine**: 問題はあるが、中心が引継ぎ・情報不足・人員など別要因。
- **Stop/Pivot**: Core Problem not found。

## Gate 2 — A〜D Pilot成立

### 必須証拠

- 30基礎ケース、4条件バリアント、AI出力ではないGround Truth。
- 条件順のランダム化/カウンターバランス。
- 12〜20名のPilot。
- 手順完了率90%以上、欠損/操作不能5%未満、重大Safety見逃し0。

### 判定

- **未実施**: 現在の状態。
- **Pass**: タイマー、設問、ケース、Ground Truth、保存、分析が再現可能。
- **Hold**: ケースや設問の意味が揃っていない。
- **Stop/Pivot**: 実験を成立させること自体が困難、または参加者安全・データ境界が確保できない。

## Gate 3 — Practitioner Evaluation

### 必須証拠

- 実務者12〜24名を目標。
- A〜Dで精神的負担をPrimary KPIとして比較。
- DがAより精神的負担を1.0ポイント以上下げ、B/Cに対して明確な価値を示す。
- 重要事実正答率が最良対照から3ポイント超低下しない。
- Safety false negative 0、原文消失0。
- 役割別の失敗例、信頼感、負担、原文閲覧理由を報告。

### 判定

- **未実施**: 現在の状態。
- **Pass**: 精神的負担のPrimary KPIとGuardrailを同時に満たし、B/Cへの固有価値がある。
- **Refine**: 一部の条件・役割でのみ有効、またはB/Cとの差が曖昧。
- **Pivot/Stop**: DがB/Cに勝てず、複雑さだけが増える。

## Gate 4 — Decision

Gate 1〜3と運用責任を確認して、必ず一つを選ぶ。

- KEEP
- REFINE
- PIVOT
- STOP

判定前に、新モデル、新機能、公開デプロイ、UI大改修を行わない。

## 現在の判定

| Gate | 現在 |
| --- | --- |
| Gate 1 | 未実施 |
| Gate 2 | 未実施 |
| Gate 3 | 未実施 |
| Gate 4 | 保留 |

## 次Phaseへ進む条件

Gate 4がKEEPまたは条件付きREFINEとなるまで、新機能開発へ戻らない。PIVOTなら、構造化フォーム＋原文保存＋Safety＋職員カード＋CSV/API Exportの最小案だけを再評価する。STOPなら、実装を続ける理由を作らず、資料と学びを保存する。
