# きくまえ 避難所版 Phase 2B 最終レポート

実施日: 2026-09-08  
対象: `kikumae-site` の Phase 2A.5 から Phase 2B への実装・評価

## 結論

Phase 2Bでは、LLM処理を速く見せるための単純な置き換えはせず、実際の処理区間を分解して計測できる基盤を追加した。固定110件で再評価した結果、現在のCPU環境では次の役割分担を採用する。

- Conversation: `qwen3.5:2b`
- Incident Extraction: `qwen3.5:4b`
- Safety Guard: LLMと独立したルール処理を先行実行
- prompt: extractionは`full`を標準。`compact`はA/B用として残すが標準採用しない
- LLM停止時: `local-rules`へfallback

2BはConversationの応答を短くするには有効だった。一方、2BをIncident Extractionへ下げると重要事実の取りこぼしが増えたため、4Bを抽出役に残す。9Bは現在のPCでは未導入・GPU推論不可のため、標準モデルにはしていない。

## 1. 現状監査

Phase 2A.5のコード、4つのレポート、既存110件評価、関連テスト・ビルド構成を確認した。

| 処理 | 現在の実装 |
|---|---|
| 音声認識 | `BrowserASRProvider`。`SpeechRecognition` / `webkitSpeechRecognition`。`processLocally`がbooleanでない限りlocalとは表示しない |
| VAD | `BrowserVADProvider`。Web AudioのRMSレベル検知。Silero VADではない |
| リアルタイム字幕 | Web Speech APIのinterim result |
| 音声合成 | `BrowserTTSProvider`。`SpeechSynthesis` / `SpeechSynthesisUtterance` |
| 割り込み | TTS停止後にASR開始、利用者の停止操作・確定transcriptでASR停止 |
| 会話生成 | `/api/ai/voice` のConversation処理。設定時はOpenAI互換Local Gateway、失敗時はlocal-rules |
| 不足情報判定 | Conversationの`nextField`とIncident JSONの`missingFields`を別処理で検証 |
| Incident Card | `incidentStateJsonSchema`を正本にJSONを正規化して生成。原文はアプリ状態から保持 |
| 緊急判定 | `Safety Guard`。LLMより先に同期的なルール処理 |
| 類似相談 | 既存D1の案件グルーピング・類似ロジック。Embeddingは現在Provider境界のみ |

Web Speech APIの通信先やlocal language packはブラウザ依存であり、完全ローカル・外部送信なしとは扱っていない。現時点で完全ローカルE2Eの条件は満たしていない。

## 2. 実装した変更

### Provider / Gateway

- `VADProvider`、`ASRProvider`、`ConversationProvider`、`IncidentExtractor`、`SafetyGuard`、`TTSProvider`、`EmbeddingProvider`の交換境界を維持。
- `requestModelJsonDetailed`を追加し、ストリーミング時のfirst tokenと生成完了を分離。
- OpenAI互換レスポンスから取得可能なserver-side metricは別フィールドに保存し、取得できない値を推測しない。
- `AI_MODEL_STREAMING`、`AI_EXTRACTION_PROMPT_VARIANT`、評価時だけの`AI_ALLOW_EVAL_MODEL_OVERRIDE`を追加。
- `auto`はLocal LLMを優先し、接続失敗・timeout・不正JSONでlocal-rulesへfallbackする。

### Safety Guard

- 否定表現（例: 「火事ではありません」「呼吸が苦しくありません」）を抑制。
- 「さっきは苦しかったが今は大丈夫」のような過去症状を現在の呼吸緊急として誤発火しない処理を追加。
- 110件固定セットのSafety Guardを再走査し、`29/29`、false positive `0`、recall `100%`、precision `100%`を確認。
- 境界・否定を含む追加16件も`16/16`、false positive `0`、false negative `0`。
- Phase 2B途中で「薬もありません」の既存回帰を1件検出し、`薬が/薬も/薬はありません・ない`を重大な体調変化候補として補正した。補正後に110件と追加16件を再確認した。

### 管理者画面

`/api/admin/ai-status`を追加し、管理者ダッシュボードに以下を表示する。

- AI mode
- Local Gatewayの接続状態
- Conversation / Extractionモデル
- auto時のfallback状態
- Safety Guardが独立laneであること
- 案件にSafety Guardが発火したこと

避難者画面には内部モデル名や内部状態を過度に表示せず、「受付済み」「職員に共有しました」を優先する。

### 評価・計測

追加した評価コマンド・成果物:

- `npm run eval:phase2b`
- `npm run eval:phase2b:safety`
- `npm run eval:phase2b:safety:110`
- `npm run eval:phase2b:postprocess`
- `npm run snapshot:phase2b:hardware`
- `docs/phase2b-evaluation-latest.json` / `.md`
- `docs/phase2b-extraction-2b-latest.json` / `.md`
- `docs/phase2b-conversation-role-latest.json` / `.md`
- `docs/phase2b-safety-110-latest.json`
- `docs/phase2b-safety-latest.json`
- `docs/phase2b-hardware-latest.json`

## 3. レイテンシ計測

値はミリ秒。`HTTP headers`はクライアントからレスポンスヘッダーを受け取るまで、`first token`はストリーム最初のtoken、`generation`はfirst token後のbody受信区間、`total`はAPI処理全体。OpenAI互換ストリームではOllamaのserver-side prompt/eval durationが返らないため、`promptEvalMs`・`generationEvalMs`はnullとして保存した。

### Incident Extraction: Qwen3.5 4B / compact（固定110件）

| 指標 | P50 | P90 | P95 | 最大 |
|---|---:|---:|---:|---:|
| total | 21,558 | 24,676 | 26,073 | 45,384 |
| HTTP headers | 6,786 | 7,329 | 7,774 | 26,835 |
| first token | 6,787 | 7,330 | 7,775 | 26,837 |
| prompt→first token | 1 | 2 | 11 | 33 |
| generation | 14,682 | 17,376 | 19,115 | 20,067 |
| JSON parse | 0 | 0 | 0 | 1 |
| normalization | 0 | 1 | 2 | 19 |
| Safety Guard | 0 | 0 | 1 | 1 |

生成区間が主なボトルネックであり、parse・schema・原文照合・Safety Guardは支配的ではない。

### Conversation役割比較（20件）

| モデル | 契約有効 | HTTP成功 | total P50 | P90 | P95 | 最大 |
|---|---:|---:|---:|---:|---:|---:|
| Qwen3.5 2B | 20/20 | 20/20 | 5,235 | 5,799 | 5,886 | 11,715 |
| Qwen3.5 4B | 20/20 | 20/20 | 7,970 | 8,928 | 8,958 | 8,961 |

2Bは会話の短文応答と`nextField`契約を維持しながら4Bより短かったため、ローカル開発設定のConversationを2Bへ変更した。

## 4. 110件評価結果

### Phase 2A.5の4B/fullとの比較

| 指標 | Phase 2A.5 Qwen4B/full | Phase 2B Qwen4B/compact |
|---|---:|---:|
| HTTP成功 | 110/110 | 110/110 |
| schema成功 | 110/110 | 97/110 |
| 完全一致 | 39/110 | 34/110 |
| 重要事実取りこぼし | 32.1% | 28.7% |
| hallucinated facts | 15 | 15 |
| request正解 | 90.9% | 90.0% |
| urgency正解 | 75.5% | 61.8% |
| missingFields正解 | 89.1% | 89.1% |
| 平均 / total P50 | 平均20,555ms | P50 21,558ms |

compact promptは重要事実の取りこぼしだけを見ると改善したが、schema成功率、完全一致、urgencyが悪化した。したがって標準promptには採用せず、fullを正本にした。

### Qwen3.5 2B/full（固定110件）

| 指標 | 結果 |
|---|---:|
| HTTP成功 | 110/110 |
| schema成功 | 110/110 |
| 完全一致 | 31/110 |
| 重要事実取りこぼし | 42.6% |
| hallucinated facts | 14 |
| location / target / request | 95.5% / 98.2% / 89.1% |
| urgency / missingFields / facts | 78.2% / 89.1% / 39.1% |
| total P50 / P90 / P95 / 最大 | 11,559 / 14,038 / 14,945 / 19,255ms |

2Bは速く、schema形状も保てるが、重要事実・factsの保持が4Bの既存full（facts 53.6%、取りこぼし32.1%）より弱い。Incident Extractionの標準には採用しない。

## 5. ハードウェアと9B判断

既存ハードウェア監査とOllama APIの最新snapshotを確認した。

- CPU: AMD Ryzen 7 8840U、8C/16T
- RAM: 約15.27 GiB
- GPU: AMD Radeon 780M iGPU
- 現在のOllamaロード状態: Qwen3.5 2B、`size_vram=0`
- 2B: Q8_0、約2.3B、ディスク約2.74GB
- 4B: Q4_K_M、約4.7B、ディスク約3.39GB
- Qwen3.5 9B: 未導入（Ollama `/api/show` 404）
- GPU/VRAM: 今回のローカル実行ではGPU VRAMを使用していない

AMD 780Mの現環境では、4BでもCPU生成がP50約21.6秒、2BでもP50約11.6秒である。9Bをいきなり導入しても、メモリ・速度・運用上の改善が測定できないため、標準モデルには採用しない。必要性がある場合は、Phase 2CでGPU搭載Edge Gatewayを用意してから少数評価を行う。

## 6. Phase 2Cの推奨構成

推奨は、避難所LAN内のEdge Gateway（Mini PCまたはGPU PC）を一次受付の基盤にする構成である。

```text
住民端末 / 職員端末
        │ HTTPS（避難所LAN）
        ▼
Local Edge Gateway
  ├─ Safety Guard（LLM外・先行）
  ├─ /v1/conversation
  ├─ /v1/incident-extract
  ├─ /v1/health
  ├─ Local DB（原文・案件・対応履歴）
  └─ Sync Queue（通信復旧後だけCloudへ）
        │ 任意
        ▼
Cloudflare Site / D1（同期・公開状態・集計）
```

比較の結論:

- 避難所LAN内AI: インターネット断に強く、個人情報を施設内に閉じやすい。一次受付の基礎に採用。
- Mini PC / GPU PC: 上記の実装形。将来9Bや高速推論へ交換可能。
- ブラウザ→LAN Edge API: API境界を明確にし、住民端末へモデル資格情報を渡さない。推奨境界。
- Cloudflareトンネル: 通信復旧後の補助。一次受付の必須経路にはしない。
- 完全クラウドAI: インターネット断と外部送信が前提になるため、災害時一次受付の標準にはしない。

公開Workerから利用者PCのlocalhost Ollamaへ接続する構成は採用しない。公開版は引き続きAI Gatewayが無い場合にlocal-rulesへfallbackする。

## 7. 失敗した改善案・採用しなかった案

- extraction promptを短縮すれば5秒以内になる、という案: prompt待ち・parseは数msで、生成が大半だったため不成立。
- compact promptを標準化: schema 110/110→97/110、完全一致39→34となり不採用。
- 2BをExtraction標準にする案: P50は11.6秒まで短くなったが、重要事実取りこぼし42.6%で4Bより悪化。
- 9Bを今のPCへ追加する案: 未導入、GPU推論環境なし。速度・精度の価値を測れないため保留。
- Safety GuardをLLMに統合する案: 否定・停止中の症状・モデル障害で安全性が揺れるため不採用。
- ブラウザ音声認識を完全ローカルと表示する案: `processLocally`や言語パックを確認できないブラウザがあるため不採用。

## 8. 残っている問題

- 現行PCのCPU推論ではIncident Extractionの目標5秒に未到達。
- OpenAI互換ストリーム経由ではOllama server-sideのprompt/eval時間が返らない場合があり、現状はクライアント観測値と分けて保存している。
- QwenのIncident Extractionはschema形状を満たしても、重要事実の取りこぼし・urgencyの揺れ・近い意味のfacts追加が残る。AI出力を最終判断や自動返信に使わず、職員確認を維持する。
- 公開版はLocal Ollamaへ接続できないため、公開環境ではlocal-rules fallbackのまま。今回のローカルLLM評価結果を公開版の動作と混同しない。
- ASR、VAD、TTS、EmbeddingはまだブラウザAPIまたはProvider境界であり、Qwen3-ASR、Silero、VOICEVOX、Qwen-TTS、Qwen Embeddingの完全ローカルE2Eには未到達。
- ネットワーク遮断下での音声→ASR→Conversation→Extraction→Incident Card→TTSのE2E判定は未実施。

## 9. Phase 2Cでやるべきこと

1. LAN内Edge Gatewayの認証・証明書・ローカルDB・同期キューを実装する。
2. GPU搭載機で2B/4B/9Bを同じ110件と境界例で比較し、P95 5秒以内を確認する。
3. Ollamaのserver metricsを直接取得できる計測経路を追加し、queue / prompt eval / generationを分離する。
4. Safety Guardを固定110件・否定・境界・多言語の回帰テストとしてCI相当で固定する。
5. 4B Extractionのfacts・urgency欠落を減らすため、schema制約・few-shot・入力前処理を一つずつ評価する。
6. 公開・LAN・完全オフラインの3環境でAI状態を明示し、住民画面には安心状態、職員画面には技術状態を表示する。
7. ASR/TTSを追加する場合も、`BrowserASRProvider` / `BrowserTTSProvider`を壊さず、ローカル実装を差し替え可能なProviderとして追加する。

## 10. 検証結果

- `npm run lint`: エラー0。既存の未使用変数など警告11件のみ。
- `npm run build`: 成功。
- Safety境界16件: 16/16、false positive 0、false negative 0。
- Safety固定110件: true positive 29、false positive 0、false negative 0、recall 100%、precision 100%。
- Qwen3.5 4B compact extraction: HTTP 110/110。schema 97/110。評価JSON保存済み。
- Qwen3.5 2B full extraction: HTTP 110/110。schema 110/110。評価JSON保存済み。
- Conversation 2B/4B: 各20/20、HTTP各20/20。

## 11. 公開状態

今回のPhase 2B変更は、ローカルコード・評価成果物・ビルド確認まで実施した。公開版へはまだデプロイしていない。公開Workerへlocalhost Ollamaを接続することはできないため、公開する場合も現在の安全なlocal-rules fallbackを前提に、別途Edge Gateway接続の公開設計を行う必要がある。
