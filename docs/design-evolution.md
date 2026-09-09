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

## Phase 2F — 職員負担の実証可能性

### Problem

Phase 2Eで整理カードの構造と証拠拘束は整ったが、それだけでは「職員の情報把握負担や精神的負担が減った」とは言えない。モデルの指標だけでなく、原文のみと整理カードありを同じ評価軸で比較する必要がある。

### Hypothesis

原文を削除せず、事実・要望・経緯・感情・不確実性・Safetyを分けたカードを先に表示すれば、重要情報を保ったまま内容把握時間、対応判断時間、原文閲覧率、主観的な読みづらさ・負担を下げられる可能性がある。

### Action

怒り・口語・否定・訂正・不確実性・Safety境界・多言語・普通の相談を含む100件の匿名合成固定セット、A/B人間評価プロトコル、8枠の匿名評価計画を追加した。実際の参加者回答はまだ収集していない。fallback全100件と、ローカルQwen3.5:4bの代表10件を別々に評価し、原文にない事実の追加・重要情報の欠落・Safety・訂正処理を記録する。

### Result

fallbackはHTTP 100/100、Safety recall/precision 100%だった一方、重要事実保持率は56.8%、文脈保持率59.4%、不確実性保持率72.7%、感情検出再現率67.7%だった。Qwen代表10件はHTTP 10/10、重要事実保持率68.2%、文脈100%、要望分類100%、Safety recall/precision 100%だったが、1件あたりのレイテンシはP50 23.9秒、重要事実の近似hallucination 5件であり、標準処理には採用しない。

### Decision

Phase 2Fの結果は「負担軽減が証明された」ではなく、次の人間評価へ進むための測定可能な土台と、現行カードの弱点を示す監査結果とする。公開版は引き続きfallback、Qwenはローカル評価専用である。実際の職員・住民データは収集しない。

### Next

人工データを用いたPilotと実務者評価をA/B・カウンターバランスで実施し、内容把握時間・対応判断時間・重要情報正答率・原文閲覧率・主観負担を条件別に比較する。並行して、重要事実保持率の低いカード項目を職員が修正できる履歴とともに改善し、Qwenは全100件を測定できるハードウェアで再評価する。

## Phase 2G — 敵対的・境界ケース評価

### Problem

Phase 2E/2Fの小規模な固定セットでは、Safetyと証拠拘束が高く見えても、怒り、短文、訂正、誤字、多言語、複合相談を同時に受けたときの取りこぼしが分からない。

### Hypothesis

170件へケースを広げ、事実・文脈・要望・感情・不確実性・訂正・Safety・証拠アンカーを個別に測定すれば、職員カードの実際の弱点を局所化できる。

### Action

既存Phase 2F 100件を再利用し、7群70件の敵対的・多言語・ノイズケースを追加した。Safety GuardはLLMより先に実行し、否定と別の危険兆候が同居する文を個別に修正した。評価専用のrate-limit bypassは環境変数とヘッダーの二重ゲートに限定した。

### Result

170/170 HTTP成功。Safety recall/precisionは合成固定セット上で100%/100%、未根拠evidenceは0だった。一方、期待事実保持は57.8%、文脈57.8%、感情recall74.0%、不確実性保持73.7%で、多言語の事実保持は日本語61.9%、英語36.7%、中国語31.8%、韓国語46.7%だった。Phase 2Eの25件100%は再現しなかった。

### Decision

Safetyの最小修正は採用する。期待値を緩めたり、合成結果を実災害の保証と扱ったりしない。一般キーワードを大量追加する自動分類強化は保留し、ラベルの妥当性と取りこぼしを分けて次に検証する。

### Next

オフライン・音声・アクセシビリティ、セキュリティ・プライバシー、障害・復旧の監査を先に行う。事実保持改善は、誤分類と見逃しの両方を含むラベル付きケースを追加してから着手する。

## Phase 2H/2I — 現場前提の監査

### Problem

コードにローカルAI Providerや音声入口が存在しても、ネットワーク断・ブラウザ音声・翻訳失敗・確認URL・内部メモ境界まで実際に保証されているとは限らない。

### Hypothesis

localhost実測、障害注入、音声Providerの実装監査、データフロー・脅威モデルを分けて記録すれば、実施済みと未実施を混同せずに次の運用試験へ進める。

### Action

`phase2h-audit`を追加し、Web UI、Safety-only、音声Provider、下書き復元、CSP、静的アクセシビリティ指標をJSON化した。`docs/security-threat-model.md` と `docs/privacy-data-map.md` を作成し、原文、翻訳、内部メモ、公開更新、確認URL、監査ログの境界を明文化した。

### Result

localhost Web UIは200、HTMLに外部src/hrefなし、Safety-onlyは動作した。LLM・翻訳・職員画面は条件付きオフライン、ASR/TTSは未証明、VADはブラウザ依存と判定した。入力途中のlocalStorage復元はあるが、送信待ちキューはない。確認URLはBearer資格情報であり、実機・本番相当D1・OS通信断の試験は未実施である。

### Decision

未実施のOS通信断・マイク権限・支援技術・本番相当D1試験を合格扱いにしない。公開は行わず、Phase 3Aのアプライアンス準備は設計メモに留める。

### Next

P0として管理APIの本番相当回帰、確認URLの失効・共有端末方針、送信待ちキューの設計、D1バックアップ／復元責任を確定する。

## Phase 3B — 災害現場耐性のGate確認

### Problem

Phase 3Aは避難所内エッジ構成、バックアップ、LAN、送信待ちを設計として整理した段階で、実機の復旧保証には到達していなかった。AIが停止してもSafetyと原文が残ることと、DB・端末・通信が壊れたときに相談そのものが失われないことを分けて確認する必要がある。

### Action

AIレーンの6種類の障害（Ollama停止、Conversation停止、Extraction停止、timeout、不正JSON、ネットワーク断）を評価専用ヘッダーで注入し、通常相談・医療Safety相談・反復・復旧後triage・Safety-onlyを再実行可能にした。モデル障害時のextractフォールバックには、原文から決定的に生成した最低限のIncident情報とSafety結果を含めるようにした。また、住民側には送信前の端末内キューと通信復帰時の同一submissionKey再送を追加した。

### Result

AI障害12/12で原文保持、Safety保持、医療Safetyフラグ保持に成功し、反復5/5、復旧後triage、Safety-onlyも成功した。一方、電源断、再起動、DB復元、LAN実機復帰、複数端末競合、ディスク容量不足、時刻ずれ、長時間運用は未実施である。評価結果は `docs/phase3b-resilience-latest.json`、判断は `docs/checkpoints/phase3b-gate.md` に保存した。

### Decision

Phase 3Bは部分通過・Gate未達。AIの簡単な障害では情報保持できるが、災害現場の耐性を示すにはサーバー側耐久アウトボックス、DBバックアップ／復元、実機LAN復帰、端末・DB再起動試験が必要である。3C以降には進まない。

## Stabilization Gate — 原文・正本・Safety・共用端末の収束

### Problem

Phase 3B以前の実装には、追加情報で `body_original` が上書きされる経路、ブラウザから送られたIncidentを正本として扱える境界、evidenceの未特定項目を原文prefixで埋める評価上の弱さが残っていた。Safetyの100%も、人間ラベルや独立したblind setを含む証明ではなかった。

### Action

`buildServerCanonicalIncident()` を追加し、受付・確認URL更新時の正本をサーバー側の原文・allowlist intake・Safetyから再生成するよう変更した。追加情報は原文と分離して履歴へ追記する。整理項目の証拠は `exact` / `token` / `not_found` で区別し、証拠がないときに本文先頭を代入しない。共用端末の履歴・送信待ち・下書き消去、送信待ちTTL、評価APIの管理者認証、Safety境界テストを追加した。

### Result

固定Safety開発セットは372件全HTTP成功、recall/precision 100%となったが、93 seedを4 variantに展開した合成評価であり、実運用のSafety保証ではない。証拠評価は170件・981 claimsで exact 276、token 112、not_found 593、strict case pass 0件だった。したがって、以前のevidence 100%は厳格な意味評価とは比較できない。Phase 3Bの電源断・DB復元・多端末競合・実機LAN復帰などは未検証のままである。

### Decision

Phase 3C以降の新機能開発と公開更新を停止する。Kikumaeは技術プロトタイプであり、本番利用可能とは扱わない。次は新しいAIを追加せず、Evidenceの人間確認、Phase 3B残試験、限定的な職員評価へ進む。

## Goal Recalibration — PurposeとMechanismの分離

### Problem

これまでのGoalは「住民の相談を、原文・Safety情報・根拠を失わず、職員が短時間で把握・引継ぎできる状態にする」と整理されていた。これは安全な情報整理の重要なOutcomeだが、Kikumaeの最終目的である「避難所職員の精神的ストレス軽減」と同じ階層に置かれていた。そのため、把握時間や引継ぎが改善すれば目的を達成したかのように扱う危険があった。

### Reassessment

外部調査は、被災自治体職員の負担と避難所で要望を把握する必要性を支持する。一方、住民の強い感情を含む相談への直接曝露が職員の主要なストレス要因であること、Kikumaeの整理方式がその負担を軽減することは未証明である。固定合成評価、Safety評価、LLM成功率だけでは人間の心理的効果を証明できない。

### Decision

North Starを「職員の精神的ストレス軽減」に戻す。原文保持、重要情報、Safety、Evidence、意図・不確実性、引継ぎは、目的を安全に実現するためのMechanism/Guardrailとして再配置する。Primary KPIは、重要情報の把握精度を実用上許容できる範囲に維持した状態での、職員の主観的精神的負担とする。

### Evaluation change

今後は、Core Problem exists（住民対応が実際に精神的負担の主要因か）と、Kikumae solves it（DがA/B/Cより負担を下げるか）を別々に検証する。A〜D比較を維持し、必要なら第二段階でE（Structured-first Hybrid）を加える。結果がフォーム＋原文保存＋Safety＋職員カードの方がよければ、AIを減らすことを成功とする。

### Principle

**目的は職員の精神的ストレス軽減。手段は検証結果によって変える。**

この再調整は、既存の「相談を短時間で把握・引継ぎ可能にする」という方向を否定するものではない。それを最終目的ではなく、Stress Reduction WITHOUT Voice Lossを実現するための手段として位置付け直すものである。
