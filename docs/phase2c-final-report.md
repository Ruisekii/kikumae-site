# きくまえ 避難所版 — Phase 2C 最終レポート

生成日: 2026-09-08（日本時間）

## 結論

現在の構成は、会話の入口を止めずにSafety Guardと会話2Bを先に返し、職員向けIncident Extraction 4Bをバックグラウンドで更新する形へ改善した。

一方、CPU実行の4B抽出は同時利用に弱い。10同時では10件中7件がHTTP成功、3件がlocal-rulesへFallbackし、抽出P95は120.6秒だった。したがって、現時点で10人規模の同時利用に対して「AI抽出が常に即時」とは言えない。住民の相談受付と安全速報は4B完了を待たずに進める必要がある。

Safety Guardは、初回の多言語評価で見逃した表現を追加し、再評価で日本語・英語・中国語・韓国語の各10件（重大5件）についてrecall 100%、precision 100%となった。これは固定ケース上の結果であり、実運用の安全性を保証するものではない。

## 今回の変更

- `app/components/voice-consultation.tsx`
  - Safety Guardとlocal-rules状態を先に作成。
  - Conversation 2Bの返答を4B Extractionから分離。
  - 4B抽出はバックグラウンドで実行し、完了後に職員向けカードをPATCH更新。
  - 抽出中でも住民は確認・送信を進められる。
  - 抽出中であることを「職員向けの整理をバックグラウンドで更新」と表示。
- `app/api/ai/voice/route.ts`
  - API側でも「落ち着いてください」「深呼吸してください」等を除外。
  - 評価専用の障害注入経路を追加。ただし `AI_ALLOW_EVAL_MODEL_OVERRIDE=1` と評価ヘッダーが必要。
- `app/lib/safety-guard.ts`
  - 日本語の「息ができません」等を追加。
  - 英語・中国語・韓国語の呼吸、発熱、煙、火災表現を追加。
  - 明示的な否定表現を安全側に扱い、「火災ではありません」などを不要に緊急扱いしない。
- `app/lib/model-gateway.ts`
  - `modelLoadMs` と `queueMs` の計測項目を追加。
  - Ollama OpenAI互換APIがqueue時間を返さないため、`queueMs`は未計測として明示する。
  - 翻訳モデルは `AI_TRANSLATION_MODEL`、未設定時はConversationモデルを使用できる構造にした。
- `db/translation.ts`
  - ローカルCPU上の翻訳を待てるようタイムアウトを30秒に延長。
  - 漢字だけの中国語出力を日本語翻訳成功と誤認しないよう、日本語かなの存在を確認。
  - 翻訳失敗時は原文を保持し、翻訳結果を正本にしない。
- 評価スクリプト・固定データ
  - `scripts/phase2c-cases.mjs`
  - `scripts/phase2c-multilingual-eval.mjs`
  - `scripts/phase2c-safety-multilingual.mjs`
  - `scripts/phase2c-translation-eval.mjs`
  - `scripts/phase2c-conversation-eval.mjs`
  - `scripts/phase2c-load.mjs`
  - `scripts/phase2c-faults.mjs`
  - `scripts/phase2c-offline-audit.mjs`

## 実行構成

```text
住民入力 / ASR Transcript
          │
          ├── Safety Guard（同期・決定的・LLM非依存）
          │       └── 緊急時は職員へ速報
          │
          ├── Conversation Provider（Qwen3.5 2B）
          │       └── 住民へ短い返答・不足情報1項目
          │
          └── Incident Extractor（Qwen3.5 4B）
                  └── 非同期でIncident JSON / 職員カードを更新
```

4B抽出のJSONを住民への返答に使わない。原文・会話履歴・構造化Incident JSONは別々に保持し、AIの自由文要約だけを正本にしない。

## 多言語評価

評価セットは日本語・英語・中国語・韓国語の各10件、計40件。水、トイレ、乳児用品、高熱、意識異常、呼吸異常、火災、暴力、怒りだが非緊急、不確実表現を含む。

| 言語 | Safety recall / precision | Conversation有効 | 会話P50 / P95 | Extraction Schema | 位置 | 対象 | 要望 | 緊急度 | Safety flags | 事実 | 抽出P50 / P95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 日本語 | 100% / 100% | 10/10 | 5.95s / 8.97s | 10/10 | 60% | 100% | 90% | 100% | 100% | 50% | 21.65s / 27.16s |
| 英語 | 100% / 100% | 10/10 | 6.07s / 7.15s | 10/10 | 40% | 80% | 100% | 90% | 100% | 40% | 20.87s / 26.14s |
| 中国語 | 100% / 100% | 10/10 | 6.08s / 7.40s | 10/10 | 30% | 90% | 80% | 70% | 90% | 50% | 20.21s / 24.89s |
| 韓国語 | 100% / 100% | 10/10 | 6.30s / 7.94s | 10/10 | 20% | 90% | 90% | 80% | 90% | 40% | 21.69s / 24.30s |

Conversationの言語混入は今回の40件で0件だった。ExtractionはJSON Schema自体は全40件で成立したが、場所と自由記述factsの精度は日本語以外で明確に低下した。外国語入力の職員カードでは、翻訳前の原文を必ず表示し、場所・人数・時刻・症状を職員が確認できるようにする。

詳細: [phase2c-multilingual-latest.json](./phase2c-multilingual-latest.json)、[phase2c-safety-multilingual-latest.json](./phase2c-safety-multilingual-latest.json)

## 職員向け日本語翻訳評価

数字、時刻、否定、不確実性、症状、場所を確認する9件を使用した。

- 翻訳成功: 7/9
- 意味保存チェック合格: 6/9
- 失敗時の原文保持: 障害注入で確認済み
- `She may have a fever.` は「発熱しています」と断定せず、「熱があるかもしれません」の形を保持できたケースを確認。
- 韓国語の「2名」を訳文が落としたケースがあり、数字の欠落リスクが残る。
- 英語・中国語の否定表現で翻訳失敗になったケースがあり、翻訳失敗時は原文確認が必要。

翻訳は安全判定・Incident Extractionの入力には使用しない。翻訳に失敗したら原文を職員へ見せる設計を維持する。

詳細: [phase2c-translation-latest.json](./phase2c-translation-latest.json)

## 完全オフライン監査

OS全体のネットワークを切断する試験は実施していない。共有PCの通信を壊す可能性があり、この評価ではlocalhost限定の監査に留めた。したがって、以下は「完全オフラインE2E合格」ではない。

| 機能 | 判定 | 根拠 |
|---|---|---|
| ローカルWeb UI | ローカルで確認 | localhost HTTP 200、HTMLに外部src/hrefなし |
| Safety Guard | 完全オフライン可能 | 決定的ルール、LLM・翻訳に依存しない |
| Conversation Qwen3.5 2B | 条件付き | 同一PC/避難所LANのOllamaが必要 |
| Incident Extraction Qwen3.5 4B | 条件付き | 同一PC/避難所LANのOllamaが必要 |
| 外国語→日本語翻訳 | 条件付き | ローカルLLMが必要。失敗時は原文保持 |
| 音声認識 | オフライン未証明 | `SpeechRecognition` / `webkitSpeechRecognition`。`processLocally === true`を保証できない |
| 音声読み上げ | オフライン未証明 | `SpeechSynthesis`。OS/ブラウザ音声エンジン依存 |
| 職員画面 | 条件付き | ローカルWeb/DBは可能、公開Cloudflare環境の同期はオンライン依存 |

現時点で「完全ローカルAI」「音声が外部送信されない」とは表示・報告しない。

詳細: [phase2c-offline-latest.json](./phase2c-offline-latest.json)

## 4B Extractionの非同期化

Phase 2Bの固定110件では4B抽出P50約21.6秒だった。今回、住民側の会話返答を4B抽出から切り離し、会話2Bの応答を先に返すよう変更した。

負荷試験ではこの差が重要だった。

| 同時セッション | Conversation HTTP成功 | Conversation P50 / P95 | Extraction HTTP成功 | Extraction P50 / P95 | Fallback |
|---:|---:|---:|---:|---:|---:|
| 1 | 1/1 | 5.36s / 5.36s | 1/1 | 48.97s / 48.97s | 0 |
| 3 | 3/3 | 2.78s / 4.06s | 3/3 | 31.05s / 47.60s | 0 |
| 5 | 5/5 | 4.55s / 7.25s | 5/5 | 48.22s / 82.50s | 0 |
| 10 | 10/10 | 6.96s / 13.44s | 7/10 | 77.49s / 120.62s | 3 |

10同時時のFallbackは相談を消すものではなく、local-rulesで最低限のIncident状態を作る経路である。ただし、職員が高精度な4B整理をすぐに見られるとは限らないため、Phase 2Dでキュー制御・モデル常駐・GPU/エッジサーバーを検討する。

Ollama互換APIからqueue時間は取得できなかったため、`queueMs`を推測値で埋めていない。評価にはサーバー合計時間とクライアント側オーバーヘッドを保存した。

詳細: [phase2c-load-latest.json](./phase2c-load-latest.json)

## 障害注入

| 障害 | 結果 |
|---|---|
| Ollama停止相当 | local-rules Fallback |
| Conversation停止相当 | local-rules Fallback |
| Extraction停止相当 | local-rules Fallback |
| timeout | local-rules Fallback |
| 不正JSON | local-rules Fallback |
| ネットワーク断相当 | local-rules Fallback経路を確認。OS実断は未実施 |
| 翻訳失敗 | 原文を保持、翻訳status=failed |
| 音声認識失敗 | BrowserASRProviderのonErrorから文字入力へ戻る実装。実機マイク試験は別途必要 |
| 音声読み上げ失敗 | BrowserTTSProviderのonErrorからIDLEへ戻る実装。実機音声試験は別途必要 |

音声モデル障害6種類×2モードの12/12でFallbackとSafety情報保持を確認した。Safety Guardは障害注入時も独立して返った。

詳細: [phase2c-faults-latest.json](./phase2c-faults-latest.json)

## Conversation追加評価

短文、丁寧語、誤字、途中切れ、口語、怒り、混乱、子ども、高齢者らしい表現、遠回しな緊急、否定、二重否定、複数症状、複数人、情報訂正など40件を評価した。

- 初回実行: HTTP 40/40、契約上有効38/40、禁止表現2件。
- 禁止表現2件はAPI側ガード追加後に再試験し、2件とも安全なFallback文へ置換。
- APIとクライアントの両方で禁止表現を抑止する二重化を採用。
- 改善後の2件確認では「落ち着いてください」が返らないことを確認した。

詳細: [phase2c-conversation-latest.json](./phase2c-conversation-latest.json)

## ハードウェア・メモリ

- CPU: AMD Ryzen 7 8840U、8コア/16論理プロセッサ
- RAM: Windows報告 約15.27 GiB
- GPU: AMD Radeon 780M系内蔵GPU
- Ollama推論: CPU実行
- VRAM: Ollama `/api/ps`でQwen 2B/4Bとも `size_vram: 0`
- 現在のAPIスナップショット: Qwen3.5 2BはQ8_0、Qwen3.5 4BはQ4_K_M。Qwen9Bは未導入。
- 負荷試験中のWindows CPU/RAMカウンタは権限制限で取得できなかったため、数値を推測していない。

根拠: [phase2a5-hardware-audit.md](./phase2a5-hardware-audit.md)、[phase2b-hardware-latest.json](./phase2b-hardware-latest.json)

## 既存Phase 2Bとの比較

| 指標 | Phase 2B基準 | Phase 2C |
|---|---:|---:|
| Conversation 2B | 20/20、P50約5.24秒 | 40件、初回有効38/40。禁止表現ガード追加後に該当2件を修正確認 |
| Extraction 4B | 110/110 HTTP、Schema 97/110、P50約21.56秒 | 多言語40/40 Schema、言語別P50約20.21〜21.69秒 |
| Safety Guard | 日本語110件 recall/precision 100% | 4言語各10件の再評価でrecall/precision 100%。110件日本語も29/29重大検出を再確認 |
| 住民UX | 4B完了待ちの可能性 | Conversation先行、4Bはバックグラウンド更新 |
| 同時10件 | 未測定 | Conversation10/10、Extraction7/10成功・3件Fallback |

## 現在残っている重大リスク

1. CPU上の4B Extractionは同時5〜10人で遅く、10同時ではFallbackが発生する。
2. 多言語Extractionの場所・facts精度が低い。職員は原文を必ず確認できる必要がある。
3. 翻訳は数字・否定の保存に失敗例がある。翻訳文だけで判断してはいけない。
4. Web Speech APIの音声が外部送信されないことを、この実装だけでは保証できない。
5. Safety Guardは固定ケースのルール評価であり、未知の表現・方言・誤認識への保証ではない。
6. 公開Cloudflare版から避難所PCのlocalhost Ollamaへ直接接続できない。現状公開版のAIモードはlocal-rules fallbackが基本になる。

## Phase 2Dでやるべきこと

1. 避難所LAN内のEdge AI Gatewayを設計し、ブラウザからは同一LANの認証済みAPIだけへ接続する。
2. Conversationを常時常駐、Extractionをキュー化し、最大同時数・タイムアウト・再試行・優先度を制御する。
3. Safety速報を最優先キューにし、Extraction待ちでも職員へ緊急カードを出す。
4. GPU/VRAMが使えるエッジPCと現在のCPU環境を比較し、2B/4B常駐時の同時利用を再測定する。
5. 多言語の固定評価を各言語110件へ拡張し、場所・数字・否定・不確実性・時刻のフィールド評価を増やす。
6. 翻訳は低信頼時に自動表示せず、原文タブを初期表示できる職員UIを用意する。
7. 実機ブラウザで、ネットワーク遮断後のASR/TTSを検証し、`processLocally`の状態を管理者へ表示する。
8. 相談の消失を防ぐため、ローカルDBの再送キュー、電源断復旧、同期復旧後のCloud反映をテストする。

## 検証結果

- `npm run lint`: 0 errors、既存warning 11件
- `npm run build`: 成功
- `git diff --check`: whitespace errorなし（Windowsの改行警告のみ）
- Phase 2B日本語Safety 110件: 29/29重大検出、false positive 0、false negative 0

今回のPhase 2Cでは、モデルを大きくすることではなく、住民の相談受付・Safety速報・会話応答を4B抽出から切り離し、障害時にも原文と最低限のIncident情報を失わないことを優先した。
