# Kikumae overnight baseline

作成時点：この長時間評価・改善作業の開始時点
対象コミット：`7c5db72cc5084bcc71cf7b593a7d23968cbe97f2`
作業方針：公開デプロイ、本番DB変更、データ削除、既存作業の破棄を行わない。

> ファイル名は依頼に合わせて `baseline-before-2f.md` としているが、Phase 2Fのコード・評価成果物はこの開始時点ですでにコミット済みだった。そのため、本書は「今回のovernight作業開始時点」の凍結記録である。

## Git状態

- 作業開始時の `git status --short`：変更なし。
- 直近コミット：Phase 2Fスタッフ負担評価。
- 他作業の変更を削除・上書きしていない。
- この作業では公開用push、Sites version保存、デプロイを行わない。

## 実装済みで動いているもの

- 避難者の匿名テキスト相談、FAQ検索、相談ID・進捗確認。
- 職員向けダッシュボード、相談一覧、案件詳細、原文表示、対応状態変更、公開コメントと内部メモの分離。
- 原文を保存し、職員カードで `facts`、`requests`、`context`、`emotionalState`、`uncertainPoints`、`safetySignals` を分離。
- 各整理項目に出所・根拠・メッセージID・確認状態を付与。
- Safety GuardをConversation/Extractionより先に実行する独立ルールレーン。
- Conversation / Incident Extraction / Staff Organization / ASR / TTS / VAD / EmbeddingのProvider境界。
- `auto`、`local-llm`、`local-rules` のモデル動作モード。
- Qwen停止・不正JSON・timeout等でlocal-rulesへfallbackする境界。
- 職員による最終確認、返信案の編集、FAQ候補の承認・公開。
- Phase 2Fの100件匿名合成固定評価とA/B人間評価プロトコル。

## モデル・公開版・ローカル版

| 項目 | 現状 |
|---|---|
| Conversationの候補構成 | ローカルOllamaのQwen3.5:2B。公開版は未接続時fallback |
| Incident Extraction | ローカルOllamaのQwen3.5:4B。住民受付の必須依存ではなく非同期候補 |
| Safety Guard | Worker内の決定的ルール。LLM非依存 |
| 公開版 | public Site。localhost Ollamaへ接続しないためlocal-rules/evidence-bound整理 |
| ローカル評価 | OpenAI互換API経由でOllamaへ接続可能 |
| 音声認識 | `SpeechRecognition` / `webkitSpeechRecognition`。ブラウザ提供元依存 |
| 音声合成 | `SpeechSynthesis` / `SpeechSynthesisUtterance`。OS/ブラウザ依存 |
| VAD | Web Audio RMSレベル検知。Sileroではない |
| Embedding | Provider境界のみ。Qwen embeddingモデル未接続 |

## 評価結果の既知ベースライン

- Phase 2B：Conversation 2B、Extraction 4Bを採用。Safetyは固定110件で高い結果だが、固定データ上の値。
- Phase 2C：多言語・障害・同時利用・オフライン条件を評価。10同時では4B Extractionが遅く、公開版はfallback。
- Phase 2D：4B必須依存を外し、Safety・初期カードを先行。4Bは必要案件の後処理。
- Phase 2E：固定25件で整理項目・根拠アンカー・Safety分離が25/25。ただし人間の負担軽減を示す評価ではない。
- Phase 2F：fallback 100件で重要事実保持率56.8%、文脈59.4%、不確実性72.7%、感情再現率67.7%、Safety recall/precision 100%。Qwen代表10件では重要事実68.2%、P50約23.9秒、近似hallucination 5件。

## 動いていない／未実証のもの

- 職員の情報把握時間・対応判断時間・精神的負担が実際に減ること。
- 実職員・実務者を対象にしたA/B人間評価。現在はプロトコルと空の計画だけ。
- 100件全件のQwen4B比較。代表10件のみ実行済み。
- ネットワークを完全遮断した実機E2E。
- Web Speech APIがネットワークなしで認識すること、音声が外部送信されないこと。
- 避難所LANへの実配備、Ollamaの常駐運用、バックアップ・復元・モデル更新の現場試験。
- Qwen3-ASR、Silero VAD、VOICEVOX、Qwen-TTS、Qwen Embedding。
- 複数自治体・複数避難所の運用分離を実地で確認すること。

## 既知の問題

1. fallbackの重要事実保持率が低く、整理カードだけを正本にできない。
2. 不確実性や訂正を確定値へ変換しない追加検証が必要。
3. Qwen4BはCPUで遅く、同期的な住民体験に使えない。
4. 音声処理のプライバシー・オフライン性はブラウザ依存。
5. D1の保持期間・削除・バックアップ・監査ログの運用設計は、自治体・専門家確認が必要。
6. `/admin` と窓口別管理者の認証・権限は実装済みだが、独立した脅威モデルと攻撃試験は未完了。

## 今回の評価停止条件

- Safety recall低下、原文消失、権限逸脱、本番データ破壊につながる変更は即時停止。
- 人間評価を実施していない限り、ストレス低減率などの効果量を生成しない。
- 実機オフライン試験ができない場合、「実機確認済み」と報告しない。
