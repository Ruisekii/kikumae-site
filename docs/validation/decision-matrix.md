# Decision Matrix

## 目的

A〜D比較とProblem Interviewの結果を、**職員の精神的ストレス軽減というPurpose**に照らして、既存のSuccess Criteriaを変更せずに、KEEP / REFINE / PIVOT / STOPのいずれかへ変換する。結果を見て閾値や評価定義を都合よく変更しない。

## 判定順序

1. Gate 1: Problem existsか。
2. Gate 2: A〜D比較が成立したか。
3. Gate 3: DがGuardrailを守りつつPrimary KPIで価値を示したか。
4. Gate 4: 現場に置く責任者・経路・復旧があるか。

## Matrix

| 判定 | 条件 | 残すもの | 捨てる/止めるもの |
| --- | --- | --- | --- |
| KEEP | Core Problem exists、DがAより精神的負担を1.0ポイント以上下げ、重要事実・Safety・意図/不確実性・原文Guardrailを満たし、B/Cに対して明確な価値がある | 現在の薄い相談・整理・引継ぎ境界 | 価値に寄与しない機能 |
| REFINE | Core Problem existsだが、Dは一部条件のみ改善、またはEvidence/UX/運用に限定課題 | 原文、Safety、必要な構造化、負担低下に寄与した機能 | 使われないAI会話、不要な表示、過剰なフィールド |
| PIVOT | Core Problemは存在するが、AI文章整理より段階表示・フォーム・引継ぎが有効、またはBがDと同等以上 | 原文保存、構造化フォーム、Safety、職員カード、CSV/API Export | AI Conversation、複雑なOrganizer、不要なLLM |
| STOP | Core Problem not found、DがB/C/Aに勝てず負担だけ増加、Safety/原文境界を閉じられない、責任者不在 | 評価資料、再利用可能な最小部品 | Kikumaeとしての開発・公開・導入主張 |

## 必須条件

次のどれか一つでも失敗すれば、Primary KPIの改善だけでKEEPにしない。

- 重大Safety false negative 0。
- 原文消失0、内部メモ漏えい0。
- 重要事実正答率が最良対照から3ポイント超低下しない。
- 精神的負担低下だけでKEEPにしない。DがAより1.0ポイント以上低く、B/Cへの明確な価値が必要。
- DがB/Cより遅くならない。
- 非スマホ経路、紙、口頭を排除しない。

## 典型的な結果の解釈

### DがAに勝つがB/Cと同等

Kikumae独自の複雑さが必要とは言えない。Bの構造化フォーム＋原文保存＋Safety＋Exportへ縮小する。AIは削除または任意の補助にする。

### DがBより遅く正答率も同じ

フォーム中心へPivotする。Dの固有機能を正当化しない。

### DがCと同等

一般要約との差別化未証明。原文保持、Evidence、状態、Safetyが業務上明確な価値を持たない限り、複雑なOrganizerを削除する。

### Dが速いが正答率を落とす

Failure。速度を優先せず、整理方式を止めるか原文優先へ戻す。

### Problemが小さい

機能追加で需要を作らない。既存手段で十分ならSTOPまたは別問題へのPivot。
