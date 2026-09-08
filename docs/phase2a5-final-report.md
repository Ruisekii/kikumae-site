# Phase 2A.5 実装・実測レポート

実測日時: 2026-09-08（日本時間）

## 実装したもの

- `local-llm` / `local-rules` / `auto` の3モードを維持。
- ConversationとIncident Extractionを別リクエスト・別プロンプト・別モデル設定で実行。
- `auto`ではLocal LLM失敗時にlocal-rulesへFallback。
- Incident JSONはJSON Schemaで正規化し、原文はアプリ状態から保持。
- Safety GuardをLLMと並列の独立レーンとして実行し、重大候補は先に職員へ速報。
- LLM抽出後に、原文に根拠がない事実を落とし、原文中の場所・対象・重要語を補う境界処理を追加。
- Conversationのモデルが`nextField`を空にしても、初回は場所確認へ安全に補正。
- 出力上限をConversation 120 / Extraction 260 tokensへ短縮。
- 110件の固定合成ケース、Safety指標、フィールド精度、事実取りこぼし、近似hallucination、速度の評価スクリプトを追加。

## 110件固定評価（最終コード）

- 対象: 飲料水、トイレ、物資・育児用品、医療、火災・暴力、安全、一般相談、強い表現、方言・ASR崩れ、情報不足、複合案件、アクセシビリティ。
- Qwen HTTP成功: 110/110
- JSON Schema形状確認: 110/110
- Qwen4B完全一致: 39/110（完全一致は全チェックの厳しい回帰指標）
- local-rules完全一致: 0/110
- 場所精度: 105/110（95.5%）
- 対象精度: 107/110（97.3%）
- request精度: 100/110（90.9%）
- urgency精度: 83/110（75.5%）
- missingFields精度: 98/110（89.1%）
- facts全件一致: 59/110（53.6%）
- 重要事実取りこぼし: 67/209（32.1%）
- 近似hallucinatedFacts: 15件
- Safety Guard: critical recall 29/29（100%）、precision 29/29（100%）、見逃し0、誤警報0
- Extraction API時間: 平均20,555ms、最短14,948ms、最長28,450ms

完全一致だけでは、意味的には正しい言い換えを失敗扱いするため、場所・対象・requestなどを分解した値も併記しています。factsとurgencyはまだ人間確認を前提にするべき水準です。

## 2B / 4B Conversation比較

- 固定20件、JSON有効: 2B 20/20、4B 20/20
- 平均応答: 2B 3,221ms、4B 4,197ms
- 2Bは形式上のJSONを返しても、`nextField`に未定義値・自由文が混ざる例や原文にない表現がありました。
- 4Bは場所など許可済みの1項目を返す安定性が高く、Conversationは4Bを第一候補にします。

## 実行環境・速度

- モデル: `qwen3.5:4b` / `qwen3.5:2b`
- 4B配布サイズ: 約3.13GB、量子化: `Q4_K_M`
- 実行: Ollama 0.33.3、OpenAI互換API、`reasoning_effort: none`
- AMD Ryzen 7 8840U、8コア16スレッド、RAM約15.27GiB
- AMD Radeon 780M系内蔵GPUは存在するが、OllamaログではROCmが`gfx1103`のrocBLAS不足で除外、Vulkan統合GPUも無効化され、推論はCPU実行。
- `/api/ps`の`size_vram`: 2B/4Bとも0
- 4B Extractionは目標5秒をCPUでは達成できず、現状は「送信後に一度だけ抽出する」MVP設計が現実的。

## 次の判断

今すぐ9Bへ上げるより、Safety Guard・原文保持・職員確認を維持し、抽出の事実取りこぼしとurgencyを追加の評価データで改善する方が先です。9BはGPUまたはメモリ余裕のある避難所LAN Gatewayで、同じ110件を再評価してから比較します。Qwen3-ASR、Silero VAD、Qwen3-TTS、VOICEVOX、Embedding、完全オフライン化は今回導入していません。

## 関連ファイル

- `docs/phase2a5-evaluation-latest.md` / `.json`: 110件のケース別結果
- `docs/phase2a5-conversation-comparison.md` / `.json`: 2B / 4B比較
- `docs/phase2a5-ollama-benchmark.md` / `.json`: cold/warm・token速度・VRAM
- `docs/phase2a5-hardware-audit.md`: GPU・CPU・RAM・Ollamaログ監査
- `scripts/phase2a5-cases.mjs`: 固定110件
- `scripts/phase2a5-eval.mjs`: 110件評価
- `scripts/phase2a5-postprocess.mjs`: Safety Guard・Schema再集計
