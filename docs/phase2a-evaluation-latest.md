# Phase 2A 評価結果

生成日時: 2026-09-08T00:47:55.678Z
モデル: qwen3.5:4b
ケース数: 10 / Qwen完全一致: 8 / local-rules完全一致: 0

| ケース | Qwen | local-rules | Qwen抽出(ms) | 会話(ms) |
|---|---:|---:|---:|---:|
| 飲料水不足 | 6/6 | 4/6 | 20654 | 8613 |
| トイレ | 4/6 | 4/6 | 24254 | 8538 |
| 乳児用品 | 6/6 | 2/6 | 24466 | 9552 |
| 高熱 | 6/6 | 1/6 | 26831 | 9606 |
| 意識異常 | 6/6 | 2/6 | 23840 | 7999 |
| 呼吸異常 | 4/5 | 1/5 | 22166 | 8566 |
| 火災 | 6/6 | 2/6 | 21532 | 8135 |
| 暴力 | 5/5 | 1/5 | 20388 | 9091 |
| 強い怒り・非緊急 | 5/5 | 2/5 | 22868 | 8896 |
| 情報不足 | 5/5 | 2/5 | 21959 | 8056 |

## ケース別の抽出結果

### 飲料水不足
入力: 昨日から水がありません。4人で、飲み水はほとんど残っていません。
期待: `{"location":null,"target":{"type":null,"count":4},"facts":["水","昨日"],"request":"water_supply","urgency":"medium","safetyFlags":[],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":{"type":null,"count":4},"facts":["困りごと：飲料水不足","人数：4人","最後に受け取った時刻：昨日","相談分類：水・飲料"],"request":"飲料水の配布場所・状況の確認","urgency":"low","safetyFlags":[],"missingFields":["場所","残量"]}`
Qwen: `{"language":"ja","location":null,"target":{"type":null,"count":4,"ageGroup":null},"facts":["昨日から水がありません。","4人で、飲み水はほとんど残っていません。"],"request":"water_supply","urgency":"medium","safetyFlags":[],"missingFields":["場所"],"askedFields":["追加確認"],"originalText":["昨日から水がありません。4人で、飲み水はほとんど残っていません。"],"confidence":0.95,"category":null}`
会話応答: `{"reply":"水がないとのこと、心配です。今、どの避難所におられますか？","nextField":"場所","requiresConfirmation":true}`

### トイレ
入力: 北トイレが詰まっていて使えません。別のトイレを案内してください。
期待: `{"location":"北トイレ","target":null,"facts":["詰まって","使用でき"],"request":"toilet_assistance","urgency":"medium","safetyFlags":[],"missingFields":[]}`
local-rules: `{"location":"北トイレ","target":null,"facts":["困りごと：トイレの使用・衛生","場所：北トイレ","相談分類：トイレ・衛生"],"request":"トイレ・衛生についての案内や対応","urgency":"medium","safetyFlags":[],"missingFields":["人数"]}`
Qwen: `{"language":"ja","location":null,"target":null,"facts":["北トイレが詰まっている"],"request":"toilet_assistance","urgency":"medium","safetyFlags":[],"missingFields":["場所"],"askedFields":["場所","人数","残量","最後に受け取った時刻","追加確認"],"originalText":["北トイレが詰まっていて使えません。別のトイレを案内してください。"],"confidence":0.95,"category":null}`
会話応答: `{"reply":"北トイレが使えないですね。避難所の場所を確認しますか？","nextField":"場所","requiresConfirmation":true}`

### 乳児用品
入力: 生後3か月の赤ちゃんのおむつがありません。今日中に必要です。
期待: `{"location":null,"target":{"type":"infant","count":1},"facts":["生後3か月","おむつ"],"request":"infant_supplies","urgency":"medium","safetyFlags":[],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":{"type":"child","count":null},"facts":["困りごと：育児用品の不足","相談分類：食料・物資","子どもを含む可能性"],"request":"食料・物資の配布状況の確認","urgency":"low","safetyFlags":[],"missingFields":["場所"]}`
Qwen: `{"language":"ja","location":null,"target":{"type":"infant","count":1,"ageGroup":"生後3か月"},"facts":["生後3か月の赤ちゃんがいる","おむつが不足している","今日中に必要である"],"request":"infant_supplies","urgency":"medium","safetyFlags":[],"missingFields":["場所"],"askedFields":["追加確認"],"originalText":["生後3か月の赤ちゃんのおむつがありません。今日中に必要です。"],"confidence":0.95,"category":null}`
会話応答: `{"reply":"おむつがないとのこと、心配ですね。今、避難所内ですか？","nextField":"場所","requiresConfirmation":true}`

### 高熱
入力: 何回言っても誰も来ないんですけど！子供が39度あってぐったりしてるんです！
期待: `{"location":null,"target":{"type":"child","count":1},"facts":["39℃","ぐったり"],"request":"medical_assistance","urgency":"high","safetyFlags":["possible_medical_emergency"],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：避難所の案内・対応","以前にも申し出た可能性"],"request":"相談内容の確認と必要な支援","urgency":"medium","safetyFlags":[],"missingFields":["場所","人数","残量","最後に受け取った時刻"]}`
Qwen: `{"language":"ja","location":null,"target":{"type":"child","count":1,"ageGroup":null},"facts":["39度の高熱がある","ぐったりしている（意識・体力の低下）"],"request":"medical_assistance","urgency":"high","safetyFlags":["possible_medical_emergency"],"missingFields":["場所"],"askedFields":[],"originalText":["何回言っても誰も来ないんですけど！子供が39度あってぐったりしてるんです！"],"confidence":0.85,"category":null}`
会話応答: `{"reply":"緊急の可能性がある内容として、先に職員へ知らせます。今いる場所を教えてください。","nextField":"場所","requiresConfirmation":false}`

### 意識異常
入力: 母が意識がぼんやりして呼びかけても反応が弱いです。
期待: `{"location":null,"target":{"type":"adult","count":1},"facts":["意識がぼんやり","反応が弱い"],"request":"medical_assistance","urgency":"high","safetyFlags":["possible_medical_emergency"],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：避難所の案内・対応"],"request":"相談内容の確認と必要な支援","urgency":"high","safetyFlags":["rule_urgent_review"],"missingFields":["場所"]}`
Qwen: `{"language":"ja","location":null,"target":{"type":"adult","count":1,"ageGroup":null},"facts":["意識がぼんやりしている","呼びかけに反応が弱い"],"request":"medical_assistance","urgency":"high","safetyFlags":["possible_medical_emergency"],"missingFields":["場所"],"askedFields":[],"originalText":["母が意識がぼんやりして呼びかけても反応が弱いです。"],"confidence":0.85,"category":null}`
会話応答: `{"reply":"お母様の状態、心配ですね。","nextField":"場所","requiresConfirmation":true}`

### 呼吸異常
入力: 息が苦しくて会話が続きません。すぐ救護を呼んでください。
期待: `{"location":null,"target":null,"facts":["息苦し","会話"],"request":"medical_assistance","urgency":"high","safetyFlags":["possible_medical_emergency"],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：避難所の案内・対応"],"request":"相談内容の確認と必要な支援","urgency":"low","safetyFlags":[],"missingFields":["場所"]}`
Qwen: `{"language":"ja","location":null,"target":null,"facts":["息が苦しい"],"request":"medical_assistance","urgency":"high","safetyFlags":["possible_medical_emergency"],"missingFields":["場所"],"askedFields":[],"originalText":["息が苦しくて会話が続きません。すぐ救護を呼んでください。"],"confidence":0.95,"category":null}`
会話応答: `{"reply":"緊急の可能性がある内容として、先に職員へ知らせます。今いる場所を教えてください。","nextField":"場所","requiresConfirmation":false}`

### 火災
入力: 調理室から煙が出ています。火が見えます。
期待: `{"location":"調理室","target":null,"facts":["煙","火が見える"],"request":"fire_response","urgency":"high","safetyFlags":["possible_fire"],"missingFields":[]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：避難所の案内・対応"],"request":"相談内容の確認と必要な支援","urgency":"high","safetyFlags":["rule_urgent_review"],"missingFields":["場所"]}`
Qwen: `{"language":"ja","location":"調理室","target":null,"facts":["調理室から煙が出ている","火が見える"],"request":"fire_response","urgency":"high","safetyFlags":["possible_fire"],"missingFields":[],"askedFields":[],"originalText":["調理室から煙が出ています。火が見えます。"],"confidence":0.95,"category":null}`
会話応答: `{"reply":"緊急の可能性がある内容として、先に職員へ知らせます。今いる場所を教えてください。","nextField":"場所","requiresConfirmation":false}`

### 暴力
入力: 隣の人が怒鳴りながら椅子を振り回しています。怖いです。
期待: `{"location":null,"target":null,"facts":["怒鳴","椅子を振り回"],"request":"safety_assistance","urgency":"high","safetyFlags":["possible_violence"],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：避難所の案内・対応"],"request":"相談内容の確認と必要な支援","urgency":"low","safetyFlags":[],"missingFields":["場所"]}`
Qwen: `{"language":"ja","location":null,"target":null,"facts":["隣人が怒鳴っている","椅子を振り回している"],"request":"safety_assistance","urgency":"high","safetyFlags":["possible_violence"],"missingFields":["場所"],"askedFields":[],"originalText":["隣の人が怒鳴りながら椅子を振り回しています。怖いです。"],"confidence":null,"category":null}`
会話応答: `{"reply":"緊急の可能性がある内容として、先に職員へ知らせます。今いる場所を教えてください。","nextField":"場所","requiresConfirmation":false}`

### 強い怒り・非緊急
入力: 何回言えば水をもらえるんですか！ずっと待たされて腹が立ちます。
期待: `{"location":null,"target":null,"facts":["水","待"],"request":"water_supply","urgency":"medium","safetyFlags":[],"missingFields":["場所"]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：飲料水不足","相談分類：水・飲料","以前にも申し出た可能性"],"request":"飲料水の配布場所・状況の確認","urgency":"low","safetyFlags":[],"missingFields":["場所","人数","残量","最後に受け取った時刻"]}`
Qwen: `{"language":"ja","location":null,"target":null,"facts":["水を待っている"],"request":"water_supply","urgency":"medium","safetyFlags":[],"missingFields":["場所","人数","残量","追加確認"],"askedFields":["場所","人数","残量","最後に受け取った時刻","追加確認"],"originalText":["何回言えば水をもらえるんですか！ずっと待たされて腹が立ちます。"],"confidence":null,"category":null}`
会話応答: `{"reply":"お待たせして申し訳ありません。今、どの場所ですか？","nextField":"場所","requiresConfirmation":true}`

### 情報不足
入力: 困っています。どうしたらいいですか。
期待: `{"location":null,"target":null,"facts":[],"request":"general_assistance","urgency":"unknown","safetyFlags":[],"missingFields":["場所","追加確認"]}`
local-rules: `{"location":null,"target":null,"facts":["困りごと：避難所の案内・対応"],"request":"相談内容の確認と必要な支援","urgency":"medium","safetyFlags":[],"missingFields":["場所"]}`
Qwen: `{"language":"ja","location":null,"target":null,"facts":["困っています。"],"request":"general_assistance","urgency":"unknown","safetyFlags":[],"missingFields":["場所","追加確認"],"askedFields":["場所","人数","残量","最後に受け取った時刻","追加確認"],"originalText":["困っています。どうしたらいいですか。"],"confidence":null,"category":null}`
会話応答: `{"reply":"お困りのこと、承知いたしました。","nextField":"場所","requiresConfirmation":true}`
