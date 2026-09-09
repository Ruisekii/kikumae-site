# きくまえ — Phase 2F以降の長時間評価・改善マスターレポート

作成日: 2026-09-09

## Stabilization re-audit notice

このマスターレポートは実装担当時点の記録であり、自己評価として扱わない。Phase 2Gの「evidence 100%」はsubstring anchorのみの旧定義で、Stabilization再評価では strict evidence pass 0/170、not_found 593/981となった。Safetyの新372件結果も合成派生セットであり、実運用保証ではない。最終判断は `docs/stabilization-final-report.md` と `docs/stabilization-gate.md` を正本とする。

## 0. 実施範囲と禁止事項

本作業は、公開・破壊的変更を行わず、匿名合成データとlocalhost環境を使って評価、監査、最小限のSafety修正、設計記録の更新を行った。実在住民データ、実災害の個人情報、実際の職員参加者の回答は使用していない。

この作業中に公開デプロイ、本番D1の削除・初期化、OS全体のネットワーク遮断、マイク音声の送信を行っていない。未実施の試験を合格扱いにしていない。

## 1. Baseline

開始時のGitコミットは `7c5db72cc5084bcc71cf7b593a7d23968cbe97f2`、作業開始時の差分はなかった。開始時の機能、モデル、公開版とローカル版の差、既存のPhase 2A.5〜2F結果は `docs/checkpoints/baseline-before-2f.md` に固定した。

## 2. 今回の変更

この章の記述は自律開発時点の記録であり、後続のStabilizationで再監査した。入力途中の端末キュー、原文不変性、サーバー正本、Safety blind set、証拠評価については本書の記述より後続レポートを優先する。

### 実装

- Phase 2Gの固定170ケースと評価スクリプトを追加。
- 評価専用rate-limit bypassを、環境変数と専用ヘッダーの二重ゲートで追加。通常の公開リクエストには適用しない。
- Safety Guardの境界漏れを最小限修正。
  - 「胸が少し痛い」などの表現。
  - 倒れた、起きない、薬が今夜で切れる、英語・中国語・韓国語の一部表現。
  - 「息苦しくはない」などの否定を維持しながら、同一文の煙など別の危険兆候を見逃さない処理。
- Phase 2Hの監査スクリプトを追加。
- Threat model、privacy data map、障害試験、避難所アプライアンス準備メモを追加。
- `README.md` と `docs/design-evolution.md` に、拡張評価で判明した弱点と未実施項目を反映。

### 追加した主な成果物

- `docs/phase2g-adversarial-latest.json`
- `docs/phase2g-adversarial-latest.md`
- `docs/phase2h-offline-audio-accessibility-latest.json`
- `docs/phase2h-offline-audio-accessibility.md`
- `docs/security-threat-model.md`
- `docs/privacy-data-map.md`
- `docs/failure-testing-latest.md`
- `docs/phase3a-appliance-prep.md`
- `docs/checkpoints/phase2fg-checkpoint.md`
- `docs/checkpoints/phase2hi-checkpoint.md`

## 3. Phase 2F — 人間評価の実施可否

既存のPhase 2Fプロトコルと100件匿名合成ケースを維持した。原文のみと整理カードありを比較するA/B計画、カウンターバランス、内容把握時間、対応判断時間、重要情報正答率、原文閲覧率、主観評価の項目は定義済みである。

実際の参加者による人間評価は実施していない。したがって、職員の精神的負担が何%減った、という結論は出していない。

## 4. Phase 2G — 敵対的・境界ケース

170件は、既存Phase 2F 100件と、怒り・侮辱、短文、訂正、Safety境界、複合相談、多言語、誤字・音声認識ノイズ各10件で構成した。合成データであり、人間の意味判定ではなく、期待パターンに基づくルール補助評価である。

### 全体結果

| 指標 | 結果 |
| --- | ---: |
| ケース | 170 |
| HTTP成功 | 170/170 |
| 期待事実保持 | 230/398 (57.8%) |
| 文脈保持 | 26/45 (57.8%) |
| 要望分類 | 148/170 (87.1%) |
| 感情recall | 39/50 (74.0%) |
| 感情over-detection | 2件 |
| 不確実性保持 | 14/19 (73.7%) |
| 訂正処理 | 18/20 (90.0%) |
| Safety recall / precision | 100% / 100% |
| 未根拠evidence | 0件 |
| 証拠正確性 | 170/170 (100%) |
| レイテンシ P50 / P95 / 最大 | 48ms / 62ms / 101ms |

### 言語別の期待事実保持

| 言語 | ケース | 事実保持 | 要望分類 | Safety |
| --- | ---: | ---: | ---: | ---: |
| 日本語 | 147 | 61.9% | 88.4% | 42/42 |
| 英語 | 10 | 36.7% | 80.0% | 4/4 |
| 中国語 | 7 | 31.8% | 85.7% | 1/1 |
| 韓国語 | 6 | 46.7% | 66.7% | 4/4 |

### 判断

Phase 2Eの25件100%は、ケースを拡張すると再現しなかった。Safetyと証拠アンカーは保守的に機能したが、事実・文脈の取りこぼしが大きい。特に多言語のIncident Cardは「対応済み」と扱えない。

Safetyの100%は今回の合成固定セットに対する値であり、実災害の安全保証ではない。未根拠項目0件と引き換えに、取りこぼしが増えるトレードオフも残っている。

初回評価では評価ハーネスのrate limitと集計再帰バグが露呈した。評価専用ゲートと集計修正後に170/170を再実行し、最終値を保存した。これは本番失敗とは別の評価環境の修正である。

## 5. Phase 2H — オフライン・音声・アクセシビリティ

### 実測・静的監査

- localhost Web UI: HTTP 200。
- HTMLに検出できる外部 `src` / `href`: なし。
- Safety-only: HTTP 200、緊急フラグを返却。
- 既存障害注入12件: 12/12でfallbackとSafety情報を保持。
- 翻訳障害: 原文保持、`translationStatus: failed`。
- `BrowserASRProvider`: `SpeechRecognition` / `webkitSpeechRecognition`。`processLocally`の存在は記録するが、実行値を完全ローカルの根拠にしていない。
- `BrowserTTSProvider`: `SpeechSynthesis`。
- `BrowserVADProvider`: `getUserMedia` + `AudioContext`の音量閾値。
- 入力下書き: `localStorage`に保存・復元。送信待ちキューはなし。

### 判定

| 機能 | 判定 |
| --- | --- |
| Web UI | localhost限定のオフライン相当 |
| Safety Guard | localhost限定でLLM非依存のオフライン相当 |
| Conversation 2B | Ollamaが同一PC/LANで稼働する場合の条件付き |
| Extraction 4B | Ollamaが同一PC/LANで稼働する場合の条件付き |
| 翻訳 | ローカルモデル稼働時の条件付き |
| 職員画面 | ローカルWeb/DBの条件付き |
| ASR | 未証明 |
| TTS | 未証明 |
| VAD | ブラウザ・マイク権限の条件付き |

OSの通信遮断、実機マイク許可、OS音声エンジン、VoiceOver/TalkBack、ブラウザ再起動後の復元は未実施である。

## 6. Phase 2I — セキュリティ・プライバシー

`docs/security-threat-model.md` と `docs/privacy-data-map.md` に、次を記録した。

- 原文、会話、Incident、Safety、翻訳、公開更新、内部メモ、FAQ、確認URL、監査ログのデータフロー。
- 管理者セッション、窓口セッション、portal scope、same-origin、レート制限、入力上限、CSPの境界。
- 確認URLがBearer資格情報であること、音声APIが外部送信の可能性を持つこと。
- LLM失敗、翻訳失敗、D1・端末・通信断、内部メモ漏えい、AI見逃しの残余リスク。

### 残るP0

1. 本番相当D1/Workersで全管理APIの認証・portal scope・公開/内部分離を回帰する。
2. 確認URLの失効・短期化・共有端末での漏えい対策を決める。
3. 送信待ちキューを追加する場合は、重複排除と送信状態の表示を先に決める。
4. D1バックアップ・復元責任、保持期間、削除と災害証跡の関係を決める。

## 7. Phase 3A準備

避難所内LANのエッジWeb/API、Local DB、Ollama、通信復旧後の同期境界を構成図にした。ただし、インストーラー、モデルを含む端末イメージ、DBバックアップ／復元コマンド、LAN認証、同期は未実装である。仕様が未確定のため設計メモに留めた。

## 8. 回帰確認

- `npm run audit:phase2h`: 成功。
- `npm run eval:phase2e`: 25/25、Safety recall 100%、証拠アンカー100%、fallback障害ケースもSafety保持。
- `npm run eval:phase2g`: 170/170 HTTP成功。上記の弱点を保存。
- `npm run lint`: エラー0。既存コードの未使用変数警告11件が残る。
- `npm run build`: 成功。ViteのJSON importに関する将来互換警告と、動的APIの静的分類警告がある。
- `git diff --check`: 成功。

## 9. 採用しなかった改善案

- 4Bを2Bへ置換: Phase 2Bで重要事実の取りこぼし42.6%だったため採用しない。
- Qwen9B追加: 今回のPhaseの範囲外。速度・VRAM・運用価値を追加測定せず標準化しない。
- 多言語キーワードの大量追加: 評価への過適合とSafety誤検出を招くため保留。
- Speech APIを完全ローカルと表示: `processLocally`の値とネットワーク遮断E2Eが未証明のため採用しない。
- 自動再送・PWAキャッシュ: 送信重複と古い情報の再表示を設計せず導入しない。
- 公開デプロイ: 今回の依頼の禁止条件により実施しない。

## 10. 次のPhase 2J / 3A

1. 本番相当環境で管理APIとportal scopeの自動回帰。
2. 多言語の意味保存を、数字・否定・不確実性・場所・症状別に人手または専門アノテーション付きで評価。
3. 送信待ちキュー、再送、重複、端末再起動時の状態を設計・障害試験。
4. 物理端末での通信断、マイク拒否、TTS失敗、アクセシビリティ試験。
5. エッジ端末のバックアップ／復元、電源断、時計ずれ、ストレージ満杯試験。
6. Phase 2Fの人間評価を、倫理・個人情報・参加者安全を定めた上で実施。

## 最終判定

Phase 2F以降の自動評価基盤、Safety最小修正、オフライン相当監査、脅威モデル、設計ログ、回帰確認は完了した。職員の負担軽減効果、多言語の十分な構造化、音声の完全オフライン性、本番災害運用の信頼性はまだ証明されていない。よって本作業の結論は「現場運用を承認」ではなく、「安全側の境界と未解決リスクを固定し、次の実機・人間評価へ進める状態になった」とする。
