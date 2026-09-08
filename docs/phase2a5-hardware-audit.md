# Phase 2A.5 ローカル推論環境監査

監査日時: 2026-09-08（日本時間）

## 結論

このPCには NVIDIA GPU はなく、AMD Radeon 780M 系の内蔵GPUがあります。Ollama 0.33.3 は起動時にAMD ROCmデバイスを検出しましたが、`gfx1103`向けrocBLASがないため対象から外しています。Vulkanデバイスも `dropping integrated GPU; to enable, set OLLAMA_IGPU_ENABLE=1` と記録されており、今回の実行では有効化されていません。

そのため、Qwen3.5の実測推論はCPU実行です。これは「AMD GPUが存在しない」という意味ではなく、現在のOllama設定・対応ランタイムでGPUオフロードできていないという意味です。ドライバ交換や環境変数の恒久変更は行っていません。

## 取得できたハードウェア情報

- CPU: AMD Ryzen 7 8840U w/ Radeon 780M Graphics
- CPU: 8コア / 16論理プロセッサ
- RAM: 約15.27 GiB（Windows報告値）
- GPU: AMD Radeon TM Graphics（Windows上のドライバ `32.0.22056.0`、2026-01-27）
- NVIDIA: `nvidia-smi` は利用不可
- Ollama: `0.33.3`

## Ollamaログの根拠

- `dropping ROCm device — no rocblas support for gfx target` (`gfx1103`)
- `dropping integrated GPU; to enable, set OLLAMA_IGPU_ENABLE=1` (`library=Vulkan`, AMD Radeon)
- `inference compute ... id=cpu library=cpu`
- `load_tensors: CPU model buffer size ...`
- `llama_context: CPU output buffer ...`
- `/api/ps`のQwen3.5:2B / 4Bで `size_vram: 0`

## モデル

- `qwen3.5:2b`: 約2.36 GB、Q4系のOllama配布モデル
- `qwen3.5:4b`: 約3.13 GB、タグのパラメータ表記4.7B、`Q4_K_M`
- 実行バックエンド: Ollama OpenAI互換API（`/v1/chat/completions`）
- 推論設定: `reasoning_effort: none`、構造化JSON Schema

## 解釈

現状は「CPUで動くローカルLLM」です。完全ローカル・オフライン・音声が外部送信されない、という判定にはしていません。音声認識はブラウザのWeb Speech API経路が残っており、プロバイダ側の通信可能性を除外できないためです。

AMD GPUを次に検証する場合は、Ollamaを停止・再起動して `OLLAMA_IGPU_ENABLE=1` またはVulkan設定を一時的に試し、ログの`inference compute`、`size_vram`、速度を比較します。今回のMVP動作に影響する恒久変更は保留しました。
