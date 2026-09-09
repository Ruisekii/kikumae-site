# Phase 2H/2I checkpoint

作成日: 2026-09-09

## Phase 2Hの判定

- localhost Web UI は HTTP 200、HTMLに検出できる外部 `src` / `href` はなかった。
- Safety-only API は LLM なしで `immediate: true` を返した。
- 既存の障害注入 12/12 は fallback とSafety情報を保持した。翻訳障害でも原文を保持した。
- Browser ASR は `SpeechRecognition` / `webkitSpeechRecognition`、TTS は `SpeechSynthesis`、VAD は `getUserMedia` + `AudioContext` である。
- `processLocally` プロパティの有無を記録するコードはあるが、実行値をローカル保証に使っていない。音声の完全オフライン性は未証明。
- OSネットワーク遮断、実機マイク権限、VoiceOver/TalkBack、音声エンジンのオフライン再生は未実施。
- 入力途中はlocalStorageに復元できるが、送信待ちキュー・再送結果確認は未実装。

正本: `docs/phase2h-offline-audio-accessibility-latest.json`、`docs/phase2h-offline-audio-accessibility.md`

## Phase 2Iの判定

`docs/security-threat-model.md` と `docs/privacy-data-map.md` を作成し、次のデータ境界を固定した。

- 原文とAI整理・翻訳は別データとして保持する。
- Safety GuardはLLMより先行し、LLM停止中も動作する。
- 職員の内部メモと住民向け公開コメントは別フィールドで扱う。
- portal sessionはURL slugだけでなくDBのportal IDを照合する。
- 管理者操作、原文閲覧、削除、回答等に監査イベントを記録する。
- 確認URLはBearer資格情報であり、DBにはハッシュを保存するが、URL漏えい時のリスクは残る。

## 未解決のP0

1. 本番相当D1/Workersで全管理APIの認証・portal scope・public/internal分離を回帰確認する。
2. 確認URLの短期化・失効・共有端末での漏えい対策を決める。
3. 送信待ちキューを追加する場合は、重複排除と送信状態のUIを先に設計する。
4. D1バックアップ、保持期間、削除と証跡の関係を運用責任者が決める。

## 判断

Phase 2H/2Iの監査成果は採用するが、未実施の実機・OS・本番相当環境試験を合格扱いにしない。公開は行わない。
