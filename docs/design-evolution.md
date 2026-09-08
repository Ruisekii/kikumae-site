# きくまえ 避難所版 — Design Evolution Decision Log

この文書は、災害時の相談受付を「住民の声を職員へ安全に届ける」仕組みへ変えていくための意思決定ログです。原文は常に正本であり、AIの出力は候補・補助情報として扱います。

## Initial — 会話とFAQを入口にする

### Problem

FAQだけでは、怒り・不安・焦りを含む相談や、職員の判断が必要な相談を受け止められない。住民には回答と対応状況が必要で、職員には感情的な文章を大量に浴びない入口が必要だった。

### Hypothesis

相談を受け、類似FAQを検索し、必要なものだけ案件化し、職員が確認・返信・FAQ化する人間中心の流れなら、住民の安心と職員の負担軽減を両立できる。

### Action

FAQ検索、原文保持、AI候補、人間承認、案件の状態更新、住民向け確認ページを整備した。

### Result

相談受付から対応状況の公開、関連相談の統合、原文の後確認まで一連の保存境界ができた。

### Decision

AIは回答やFAQを自動確定・自動公開しない。職員確認を必須とする。

### Next

住民側の会話負担を減らし、職員がまず事実を見るための構造化を導入する。

## Phase 2B — 役割分担と性能計測

### Problem

Qwen3.5 2BはConversationの短文応答に向いた一方、Incident Extractionへ下げると重要事実取りこぼしが42.6%となった。4B Extractionは精度を保つがCPUでP50約21.6秒だった。

### Hypothesis

ConversationとExtractionを分離し、2Bを会話、4Bを事実抽出に割り当てれば、住民応答の遅延を抑えながら職員向け精度を維持できる。

### Action

Provider境界、JSON Schema、原文照合、独立Safety Guard、`auto`/`local-llm`/`local-rules`、110件評価と計測を追加した。

### Result

Conversation 2Bは20/20成功、P50約5.2秒。4Bは110/110 HTTP成功で、ただしExtractionの生成時間は災害現場の即時受付には長い。

### Decision

モデルを大きくすることを優先せず、受付とSafetyをLLM停止時にも動かす。

### Next

4Bを住民の待ち時間から外し、即時カードと後処理を分離する。

## Phase 2C — 現場信頼性

### Problem

多言語、オフライン、同時利用、Ollama停止、不正JSON、翻訳・音声障害が起きると、相談そのものを失う危険があった。10同時の4B処理は7/10成功、抽出P95約120.6秒だった。

### Hypothesis

原文保存とSafetyを最初に確定し、Conversationと4B Extractionを非同期にすれば、AIが遅くても相談受付と緊急速報は継続できる。

### Action

入力時保存、Safety先行、Conversation先行、4B後処理、fallback、翻訳失敗時の原文保持、障害注入評価を実装した。

### Result

住民フローは4B完了を待たずに進められるようになった。公開環境ではlocalhost Ollamaへ接続できないため、公開版はlocal-rulesへfallbackする。

### Decision

「完全ローカル」「音声が外部送信されない」とは、実機・ネットワーク遮断E2Eを通過するまで表示しない。

### Next

4B Extractionと別の整理AIを毎回二重に呼ばず、職員向け整理の責務を明確にする。

## Phase 2D — 4Bを必須処理から外す

### Problem

4Bを全相談で走らせると、CPU環境では受付・職員の初動を遅らせる。単純案件で4Bを待つ合理性も低かった。

### Hypothesis

Safety Guard、本人の選択、決定的なIncident項目から証拠付きの初期カードを作り、長文・矛盾・不確実性などの案件だけ4Bへ送ればよい。

### Action

`shouldRequestExtraction`ゲート、4B同時実行1・キュー上限4、重複排除、古い結果の無効化、provenanceを追加した。

### Result

固定20件で4B利用率50%、4B不要案件の完了率100%、Safety＋初回カードP50 66ms / P95 85ms。4B条件付き実測は51.5秒で、必須処理にはできなかった。

### Decision

4Bは「追加の意味理解が必要な案件の後処理」であり、住民受付・Safety・初期カードの必須依存にしない。

### Next

職員に表示する整理を一文要約ではなく、事実・要望・経緯・感情・不確実・Safetyへ分ける。

## Phase 2E — 整理AIの責務を再定義

### Problem

一文要約は、人数・場所・時刻・症状・否定・不確実性・繰り返し申し出た経緯を落としやすい。4B Extractionの出力だけを職員カードにすると、抽出役と整理役の責務が混ざる。

### Hypothesis

Conversation AIは「聴く・不足を一つ確認する」役に限定し、Safety Guardは独立させ、職員画面には原文に結び付いた証拠付き整理カードを最初に出す。4Bは必要な場合の候補生成に留めれば、職員は感情的な原文を最初から浴びず、必要な事実へ移れる。

### Action

`app/lib/staff-organization.ts` に `StaffOrganizationProvider` と `EvidenceBoundStaffOrganizationProvider` を追加した。受付時に `originalMessageId`、原文、原言語、作成時刻、`staff_organization` を保存し、管理画面に「確認できている事実」「要望」「経緯・背景」「感情の存在」「不確かな点」「Safety検出」を表示する。各項目には出所、確定/候補、根拠、メッセージIDを付けた。日本語訳・原文・会話履歴は整理カードと分離したタブで確認できる。

### Result

感情的な言葉を事実として昇格させず、否定表現とSafetyを分離できた。Phase 2E固定25件では、事実・要望・背景・感情・不確実性の保持、Safety recall/false-positive-free、証拠アンカーがすべて100%だった。整理処理はP50 49ms / P95 82msで、LLMを必須にしない即時表示ができる。障害注入時もfallbackカードとSafetyを保持した。

### Decision

「整理AI」は4Bと別の第二LLMを毎回呼ぶ処理ではなく、原文・Safety・本人選択・既存Incidentを統合する証拠拘束のProviderとして実装する。4Bを使う場合も、候補の補助入力に留め、原文・Safety・職員確認を上書きしない。

### Next

職員が整理項目を修正した履歴を `staff_edit` として保存し、同一相談をA:原文のみ / B:整理カードありで比較する人間評価を実施する。さらに避難所LANのローカルDB・AI Gateway・復旧後同期を運用試験する。

