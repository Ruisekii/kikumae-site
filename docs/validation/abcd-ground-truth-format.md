# A〜D Ground Truth Format

## 原則

- Ground TruthはAI出力から作らない。
- ケース作成者が先に作成し、別のレビュアー2名が原文と照合する。
- 不明は不明のまま保持する。推測を正答にしない。
- 否定、不確実性、伝聞、最新訂正、経緯を独立フィールドで持つ。
- Safetyは「危険かどうか」の最終診断ではなく、緊急確認が必要な兆候のラベルとする。

## 推奨JSON

```json
{
  "caseId": "C10-v3",
  "language": "ja",
  "sourceText": "何回言っても誰も来ないんです。子供が39度あってぐったりしています。",
  "facts": [
    { "field": "target.type", "value": "child", "certainty": "stated" },
    { "field": "symptom.fever", "value": "39℃", "certainty": "stated" },
    { "field": "symptom.condition", "value": "ぐったり", "certainty": "stated" }
  ],
  "request": [
    { "value": "medical_assistance", "certainty": "inferred_from_request" }
  ],
  "location": { "value": null, "certainty": "unknown" },
  "peopleCount": { "value": null, "certainty": "unknown" },
  "time": { "value": null, "certainty": "unknown" },
  "uncertainty": [],
  "negations": [],
  "latestCorrections": [],
  "safety": {
    "label": "possible_medical_emergency",
    "expectedAlert": true,
    "reason": "39℃の発熱とぐったりしているという記述"
  },
  "requiredForTask": ["symptom", "request", "safety"],
  "review": {
    "reviewerA": "",
    "reviewerB": "",
    "agreement": "pending",
    "notes": ""
  }
}
```

## ラベル規則

### facts

原文に明示された事実を入れる。言い換えは意味を変えない範囲に限定し、数値・単位・場所・時刻は正確に保持する。

### request

本人が求めていることを入れる。「困っている」だけを具体的要望へ勝手に変換しない。要望が明示されない場合はunknownとする。

### uncertainty

「かもしれない」「たぶん」「聞いた話」「分からない」「確認できていない」を保持する。不確実な事実を確定事実として採点しない。

### negations

「〜ではない」「息苦しくはない」等を独立して記録する。同一文の別の危険兆候は否定で消さない。

### latestCorrections

「3人、訂正して4人」のような場合、最新値と訂正履歴を両方保存する。職員の正答は最新値を優先し、経緯も保持する。

### safety

Safety Guardの期待値は、人間レビュアーが定義した緊急確認ラベル。医療診断名や最終対応をGround Truthにしない。

## 採点

- exact: 数字・場所・時刻・否定等が意味を変えず一致。
- partial: 一部だけ正しい。Primary KPIでは誤答または未回答として扱う。
- missing: 原文にある必須情報が抜けた。
- hallucinated: 原文にない事実を追加した。
- uncertainty-lost: 不確実/伝聞を確定した。
- correction-lost: 最新訂正を古い値のまま扱った。

Primary KPIでは、ケースに該当する必須フィールドをすべて正しく回答できた場合のみ、そのケースの把握成功とする。
