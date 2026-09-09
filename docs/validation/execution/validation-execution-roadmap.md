# Validation Execution Roadmap

## 現在地

**READY FOR INTERVIEW**

Problem Interview、A〜D Pilot、Ground Truth、Gate判定の資料は作成済み。ただし実際の参加者データはなく、Problemの存在、Pilotの妥当性、Solutionの優位性は未証明である。

## Step 1 — 最初のInterview

1. 候補者へ依頼文を送る。
2. 役割の異なる3〜5人へ、5/15/30分版を使い分ける。
3. 各Interview後に記録シートを埋める。
4. 回答、観察、解釈、反証を分ける。
5. 1人ごとに製品方向を変えない。

### 1人目の後

- 質問が誘導的でなかったか確認。
- 具体例を聞けたか確認。
- Problem分類を暫定記録。
- 次の相手の役割を変え、同じ回答だけを集めない。

## Step 2 — 3〜5 Interviews

1. 役割別にProblem、Low priority、Not found、Different Problemを集計。
2. Frequency、Severity、Workaround、Unmet needを比較。
3. 反証を残したままGate 1の暫定判定を作る。
4. 面談内容から、A〜Dケースの追加・削除候補を洗い出す。

3〜5人では最終判定をしない。問題が一貫して現れるか、役割依存か、別問題なのかを確認する。

## Step 3 — Gate 1

Gate 1がPASS候補なら、既存24〜30ケースを問題特性に合わせて確認する。Problemが小さい、低優先、別問題なら、Pilotを延期してInterviewを追加するか、PIVOT/STOPを検討する。

## Step 4 — A〜D Pilot

1. Ground Truthを人間2名で固定。
2. BとCを弱いBaselineにしない。
3. 3〜5人で最初のPilotを実施。
4. `Experiment design valid? YES / NO` を判定。
5. 結果で効果を主張せず、Gate 2だけ判定。

## Step 5 — Gate 2

PASSならPractitioner Evaluationの募集・割付・ケース版を凍結する。REFINEなら設計だけ修正し、実務者評価へ進まない。

## Step 6 — Practitioner Evaluation

5〜10人程度から探索を開始し、役割と質を優先する。統計的な一般化を過剰に主張しない。既存基準の12〜24名は拡張目標として扱い、初回結果を捏造しない。

## Step 7 — Gate 3 / Gate 4

- Dが勝つ: KEEPまたは限定REFINE。
- Bが勝つ: AI削減、フォーム＋Safety＋原文＋ExportへPIVOT。
- CとDが同等: 独自Organizerを削減し、単純LLMまたは非AIへ縮小。
- Aが強い: 整理による情報損失と信頼低下を疑う。
- 全部悪い: Problem/Workflowを再定義。

Gate 4では必ずKEEP、REFINE、PIVOT、STOPの一つを選び、「今後も検討」で終わらせない。

## Step 8 — Gate後

KEEPまたは妥当なREFINEが出て、実務者評価で価値が確認された場合のみ、次の順で検討する。

```text
必要な最小コード修正
  ↓
Controlled Disaster Drill（人工相談）
  ↓
限定Field Pilot
  ↓
Product Scope再決定
```

本番災害、医療判断、複数避難所、センサ、在庫、マイナンバーはこの資料の対象外である。

## STOP CONDITIONS

- Problemが複数の実務者から確認されない。
- DがB/Cに勝たず、複雑さだけが増える。
- Safety false negative、原文消失、意味の重大な変形。
- 非スマホ経路を排除しないと成立しない。
- 運用責任者、保持責任者、訓練機会がない。
- 評価データを人間から取得できず、AIで代替しようとしている。
