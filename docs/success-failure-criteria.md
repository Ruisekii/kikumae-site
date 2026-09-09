# Kikumae Success / Failure Criteria

## 0. 判定の前提

Kikumaeの最終目的は、避難所職員の精神的ストレス軽減である。内容把握、原文保持、Safety、Evidence、引継ぎは、その目的を安全に実現するためのMechanism/Guardrailであって、目的そのものではない。

現在の合成評価・HTTP成功・Safety 100%は、職員の精神的負担軽減を証明しない。評価開始前に、以下のPrimary KPI、Guardrail、Thresholdを固定し、結果を見て変更しない。

## 1. Core Problem Validation

### Core Problem Hypothesis

避難所職員は、被災者からの怒り・焦り・不安・要求・強い不満などを直接繰り返し受け止めることで、精神的負荷を受ける可能性がある。

### Problem Gate（暫定）

5〜10名程度の実務者Interviewで、次を確認する。

- 少なくとも複数の役割から、住民対応・苦情・強い感情・繰り返し要求が自発的に負担として出る。
- 具体的な出来事、頻度、影響、現在のworkaroundがある。
- 住民対応による精神的負担が、他の課題と比べて無視できない。

満たさない場合は `Core Problem Hypothesis unsupported` とし、REFINEではなくPIVOT/STOPを含めて判断する。

## 2. Primary KPI

**重要情報の把握精度を実用上許容できる範囲に維持した状態での、職員の主観的精神的負担。**

### 尺度

各相談について、表示・把握・次の対応判断が終わった直後に、次の1〜5で回答する。

1. まったく負担を感じなかった
2. 少し負担を感じた
3. どちらともいえない
4. かなり負担を感じた
5. 非常に強い負担を感じた

Primaryは「相談1件に対する総合精神的負担」とする。文章を読む負担と、実際に対応する負担はSecondaryとして別々に測り、混ぜない。

### 暫定Success Threshold

実務者評価において、D（Kikumae）がA（原文のみ）より総合精神的負担の中央値を**1.0ポイント以上低下**させること。小標本のPilotでは効果の証明を行わず、尺度と実験の妥当性だけを確認する。

## 3. Guardrails

### 重要情報正答率

- 重要情報正答率95%以上を目標。
- 最良の比較条件から3ポイントを超えて低下しない。
- 人数、場所、時刻、要望、症状、経緯、Safety、その他ケース固有の必須事項をGround Truthで採点。

### Safety見落とし率

- Critical Safety false negative 0。
- Safety GuardはLLM、翻訳、Conversationが停止しても動作。
- Safetyは診断・最終トリアージではなく、職員への緊急確認シグナル。

### 意図・不確実性保持

- 要望、否定、伝聞、可能性、最新訂正、経緯を確定事実へ変形しない。
- 意図不一致、uncertainty-lost、negation-lost、correction-lostを別集計。

### 対応判断精度

- ケースの次のActionを誤らせる重大な誤り0。
- AI・整理カードのみで重要判断を確定しない。

### 原文・Evidence・Human-in-the-loop

- 原文消失/改変0。
- 重要主張は原文または明示された本人入力に遡れる。
- `not_found` を確定情報として表示しない。
- 重要な返信、緊急度、FAQ公開、解決は職員確認を必要とする。

## 4. Secondary KPI

- 内容把握時間
- 対応判断時間
- 読むこと自体の精神的負担
- 対応することの心理的負担
- 原文閲覧率と閲覧理由
- 読みやすさ、認知負荷、次の対応の分かりやすさ
- 信頼感1〜5
- 情報不足を感じた割合
- 引継ぎのしやすさ
- 住民の受付/進捗確認
- 強い原文への直接曝露回数

原文閲覧率の低下だけを成功としない。見なくても安全に対応できたのか、必要な確認を省いたのかを記録する。

## 5. 比較条件

| 条件 | 内容 |
| --- | --- |
| A | 原文のみ |
| B | AIなしの合理的な構造化フォーム＋決定的ルール |
| C | 通常利用を想定した単純LLM要約＋原文リンク。Kikumae固有ロジックなし |
| D | 原文保持、facts、requests、context、Safety、evidence/source、不確実性、職員確認 |
| E（第二段階） | Structured-first。情報が十分ならAI不要、曖昧・複雑な相談だけAI補助 |

EはA〜D Pilotが成立した後に追加する。Pilotを複雑にして設計妥当性を損なう場合は、第二段階へ延期する。

## 6. Kikumaeが勝ったと言える条件

Dが次をすべて満たすこと。

- Aより精神的負担の中央値を1.0ポイント以上下げる。
- 重要情報正答率、Safety、意図/不確実性、対応判断のGuardrailを満たす。
- BまたはCに対して、精神的負担、正答、原文曝露、引継ぎなどのうち少なくとも1つの明確な業務上の優位性を示す。
- 原文保持、Evidence、Human-in-the-loopの複雑さが、上記の優位性を正当化する。

例として、Cの負担2.3・正答94%、Dの負担2.4・正答94%なら、D独自Organizerの価値は弱い。Cの正答が82%でDが94%、かつ負担が同等以下ならDの価値候補になる。

## 7. Failure Criteria

### Failure A

精神的負担がAとほぼ変わらない。情報整理が速度を改善しても、最終目的を満たさない。

### Failure B

精神的負担は下がるが、重要情報正答率、Safety、意図、不確実性、対応判断が実用上許容できないほど低下する。

### Failure C

C（単純LLM要約）とDが同等で、原文保持・Evidence・状態管理の追加価値が複雑さを正当化しない。

### Failure D

B（構造化フォーム）の方が、精神的負担・正答率・速度・導入容易性のすべてで優れる。

### Failure E

Problem Interviewで、住民対応による精神的ストレスが主要課題として確認できない。

### Failure F

原文、Safety、内部メモ、個人情報、復旧境界に重大な失敗が起きる。

## 8. PIVOT Conditions

- 精神的ストレス問題は確認されたが、AI Organizerが負担を下げない: **職員への一次遮蔽・段階表示**へPivot。
- 自由記述が負担の原因: **Structured-first**へPivot。
- BがDに勝つ: **フォーム＋Safety＋原文＋職員カード＋Export**へ縮小。
- CがDと同等: 単純要約または非AIへ縮小し、独自Organizerを削除。
- 住民対応ストレスが主要問題でない: Core Problem PivotまたはSTOP。

## 9. Kill Criteria

- 独立した5〜10名の実務者からCore Problemが確認できない。
- 2回の実務者評価でDがA/B/CをPrimary KPIで上回らない。
- Safety false negative、原文消失、重大な意味変形を解決できない。
- 職員のストレス要因が人員・物資・権限など別問題で、Kikumaeの境界内で改善できない。
- 運用責任者・データ保持責任者・訓練機会が確保できない。

## 10. 現在の判定

- Core Problem exists: 未検証
- Solution value: 未検証
- Primary KPI: 未測定
- 技術プロトタイプ: 達成
- 本番利用: 不可
- 次のGate: Problem Interview → A〜D Pilot → Practitioner Evaluation
