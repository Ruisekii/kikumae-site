# Kikumae Roadmap From Goal

## 最上位ルール

```text
Purpose: 避難所職員の精神的ストレス軽減
        ↓
Problem Interview
        ↓
Core Problem Validation
        ↓
A〜D Pilot（必要なら第二段階でE）
        ↓
Mental Load + Information Accuracy比較
        ↓
Practitioner Evaluation
        ↓
KEEP / REFINE / PIVOT / STOP
        ↓
必要な場合のみ最小コード修正
        ↓
Controlled Disaster Drill
        ↓
Field Pilot
```

コード行数、機能数、Phase番号、LLM性能は進捗の主指標にしない。人間の仮説が確認・否定されたことを進捗とする。

## Current Gate

- 判定: **技術プロトタイプ**。
- Core Problem: 未検証。
- 職員の精神的ストレス軽減: 未証明。
- AI Organizerの独自価値: 未証明。
- Evidence strict pass: 0/170。
- Phase 3B: 未達。
- 公開版のQwen接続: 未実証。公開版はlocal-rules fallback。

### いま停止するもの

- 新しいLLM・9B・AI機能。
- UI大改修、センサ、複数避難所、在庫、広域統合。
- 公開デプロイ、本番データ、実在被災者データ。
- 人間評価なしの「ストレス軽減」主張。

## Step 1 — Problem Interview

### 目的

住民対応による精神的ストレスが、避難所職員の実際の主要課題か確認する。Kikumaeの名前やAIを先に説明しない。

### 実施

- まず3〜5人で探索。
- その後、必要なら実務者5〜10人へ拡張。
- 最初に「避難所運営で精神的に最も負担が大きい業務は何ですか」と聞く。
- 住民対応、苦情、繰り返し要求、強い怒り、夜間、外国語、情報不足、引継ぎが自発的に出るか記録。
- 抽象的な感想ではなく、最近の具体的な出来事、行動、記録、引継ぎ、影響を聞く。

### Gate 1

- **PASS候補**: 複数の実務者が、住民対応による精神的負担を具体例付きで示す。
- **REFINE**: 問題はあるが、中心は引継ぎ・情報不足・別の負担。
- **PIVOT/STOP**: 精神的ストレスが主要課題として確認できない。

## Step 2 — A〜D Pilot

### 目的

効果証明ではなく、評価設計をデバッグする。A〜Dが公平で、Ground Truth、タイマー、質問、負担尺度が機能するか確認する。

- A: 原文のみ
- B: 合理的な構造化フォーム＋ルール
- C: 通常利用を想定した単純LLM要約
- D: Kikumae整理方式

まず3〜5人、20〜30ケースで実施する。Cを意図的に弱く、Bを意図的に使いにくくしない。E（Structured-first Hybrid）はA〜D後の第二段階とする。

### Primary KPI

重要情報の把握精度を維持した状態での、職員の主観的精神的負担1〜5。

### Gate 2

- Ground Truthが人間確認済み。
- A〜Dが公平。
- 条件順がカウンターバランス。
- タイマー・回答・保存が再現。
- 重大Safety見逃し0。
- Pilotは効果の結論ではなく、設計妥当性を判定。

## Step 3 — Mental Load Comparison

Gate 1とGate 2の両方を満たした後、同じケース群で精神的負担と情報正確性を比較する。

- 総合精神的負担をPrimary。
- 読む負担と対応する負担をSecondaryで分ける。
- 原文閲覧率は、低ければよいとはせず、閲覧理由と正答を併記。
- DがAより1.0ポイント以上低く、B/Cに対して少なくとも1つの明確な業務価値を示すことを暫定基準とする。

## Step 4 — Practitioner Evaluation

Gate 1/2を通過した場合のみ、自治体防災担当、避難所運営経験者、保健師、施設管理者等を対象に5〜10人から探索し、必要に応じて12〜24人へ拡張する。

### Gate 3

- DがAより精神的負担を明確に下げる。
- 重要情報正答率、Safety、意図/不確実性、対応判断を守る。
- DがB/Cに対して少なくとも1つ明確な価値を示す。
- 現行業務へ置く担当者、入口、引継ぎ先がある。

## Step 5 — Product Decision

### KEEP

精神的ストレス軽減とGuardrailの両方が確認され、D固有の価値がある場合のみ。初めて最小コード改善を検討する。

### REFINE

Purposeは維持し、Evidence、UI、原文確認、フォーム併用など、評価で問題になった部分だけを修正する。

### PIVOT

ストレス問題はあるが、AI Organizerが有効でない場合は、段階表示、Structured-first、フォーム＋Safety＋原文＋Exportへ変更する。

### STOP

ストレス問題が確認できない、既存手段に勝てない、安全境界を閉じられない、運用責任者がいない場合はKikumae開発を終了または研究資料へ縮小する。

## Step 6 — Controlled Disaster Drill

Gate 4でKEEPまたは妥当なREFINEとなり、実務者評価で価値が確認された場合のみ開始する。

人工相談、複数職員、時間制約、引継ぎ、優先順位、同時発生を使い、見落とし、対応開始時間、情報正答率、Safety、引継ぎミス、主観的負担を測る。

ここを通過して初めて「実証可能性あり」と表現する。本番利用可能とはまだ言わない。

## Feature Filter

新機能は必ず次に答える。

> この機能は、どのストレス要因を、どの測定指標で減らすのか？

答えられなければ **NOT NOW**。

- Voice: 読む/入力する負荷を下げる可能性があるため検証対象。
- Translation: 外国語理解負担を下げる可能性があるため検証対象。
- 9B model: 精神的負担への直接価値が不明なためNOT NOW。
- mmWave/sensor: 直接のストレス要因との関係が弱いためNOT NOW。

## Current next action

コードではなく、Problem Interviewを開始する。人間から得るべきデータをAIや仮想評価で代替しない。
