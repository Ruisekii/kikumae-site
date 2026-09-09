# きくまえ — セキュリティ脅威モデル

作成日: 2026-09-09
対象コミット: `7c5db72cc5084bcc71cf7b593a7d23968cbe97f2` を基準にした Phase 2F/2G/2H 作業ツリー

## スコープと前提

対象は、住民の匿名相談、職員向け整理カード、公開ステータス、FAQ、音声入口、ローカルAI接続、管理者操作である。実災害の個人データ、実在住民の相談、公開本番データを評価に使用していない。今回の作業では公開デプロイと本番データ変更を行っていない。

本モデルはコードとlocalhost試験に基づく。クラウド環境、D1の実際のアクセスログ、避難所LAN、端末管理、バックアップ保管先の実設定を完全に検証したものではない。

## 資産

| 資産 | 機密性 | 完全性 | 可用性 | 主な保護境界 |
| --- | --- | --- | --- | --- |
| 住民の原文 | 高 | 高 | 高 | 職員認証、確認URL、原文表示操作の監査 |
| 会話履歴・音声由来テキスト | 高 | 高 | 高 | 保存時の入力制限、職員権限、原文保持 |
| Incident / Safety候補 | 高 | 最高 | 最高 | Safety Guard独立、職員最終判断、根拠表示 |
| 職員向け内部メモ | 高 | 高 | 中 | 管理者APIのみ。公開コメントとDB/APIを分離 |
| 住民に見える進捗・回答 | 中 | 最高 | 高 | 職員認証、同時更新のversion、公開状態の明示 |
| FAQ・FAQ候補 | 中 | 高 | 高 | 承認後公開、個人情報チェック、監査ログ |
| 確認URL token | 高 | 最高 | 高 | tokenのハッシュ保存、30日有効期限、URLを知る者に限定 |
| 管理者セッション／API token | 最高 | 最高 | 高 | HttpOnly/Secure/SameSite、HMAC、期限、レート制限 |
| 監査ログ | 高 | 高 | 中 | 管理API、actor記録、原文閲覧・削除・回答等を記録 |
| AIモデル・プロンプト設定 | 中 | 高 | 中 | サーバー側環境変数、LLM失敗時fallback |

## 構成とTrust Boundary

```text
住民ブラウザ
  ├─ 原文 / 会話 / 下書き（localStorage）
  ├─ BrowserASR / BrowserTTS（ブラウザ提供元・OS依存）
  └─ same-origin HTTPS API
        ├─ Safety Guard（LLM非依存）
        ├─ local-rules / LLM gateway（設定時のみ）
        └─ D1（原文、構造化候補、公開更新、監査）

職員ブラウザ
  └─ 管理者セッションまたは窓口セッション
        └─ 管理API（same-origin + 認証 + portal scope）
```

ローカルOllamaは公開Cloudflare Workerから自動的にlocalhostへ到達しない。公開版のlocal-rules fallbackを、ローカルAI接続済みと誤表示してはならない。

## 脅威と対策

| ID | 脅威 | 対象経路 | 現在の対策 | 残余リスク／判定 |
| --- | --- | --- | --- | --- |
| T1 | 未認証者が職員画面・原文・内部メモを読む | `/admin`、管理API | 管理者パスワードの署名セッション、API token、窓口はPBKDF2/HMACハッシュ + portal session、各APIで再認証 | セッション失効・端末共有・管理者端末のマルウェアは別管理。要運用対策 |
| T2 | 窓口Aの職員が窓口Bのデータを見る | `/:slug/admin` と portal API | sessionに紐づくportal IDとURL slugを毎回照合。DBクエリにportal scopeを付与 | 新規API追加時のscope漏れを継続監査する必要あり |
| T3 | CSRF / cross-originから更新・削除される | POST/PATCH/DELETE | same-origin検査、HttpOnly/Secure/SameSite cookie | Originが省略されるクライアントを許容しているため、CORS設定・運用の追加確認が必要 |
| T4 | パスワード総当たり | 管理者・窓口ログイン | 共有レート制限、失敗応答の均一化、ダミーハッシュ、長さ制限 | 分散IP・D1 binding障害時の挙動、監視・アラートは未検証 |
| T5 | 確認URLを知った第三者が相談を読む／改変する | `/questions/[token]` | tokenはUUID連結、DBにはハッシュ、30日期限、原文をURLに含めない | URLはBearer資格情報。スクリーンショット、履歴、転送で漏れると閲覧・追加情報更新が可能。短い寿命、再発行・失効UIはPhase 2D以降の課題 |
| T6 | 住民入力でXSS・prompt injection・過大入力 | 相談、回答、FAQ、AI prompt | 文字数/byte上限、React描画、`readRequestText`、Pii検出、原文はAI判断と分離 | AI gatewayのプロンプトインジェクション耐性、HTML/Markdown許可方針は別テストが必要 |
| T7 | AIが生命危険を見逃す／作り話を足す | Safety / Incident | Safety Guardを先行・独立実行、原文証拠アンカー、職員の最終判断、原文保存 | ルールの言語・方言・誤字カバレッジは有限。Phase 2G合成ケースでのrecall 100%を実運用保証にしない |
| T8 | LLM停止で相談が消える | AI障害、通信断 | Safety-only経路、local-rules fallback、失敗時も原文を保持、入力途中はlocalStorage、端末内送信待ちキューと同一submissionKey再送 | サーバー側の耐久アウトボックス、実機LAN復帰、端末再起動後の送信保証は未検証 |
| T9 | 翻訳が意味を変えて職員判断を誤らせる | 多言語相談 | 原文を正本として保持、翻訳失敗を `failed`、翻訳を構造化正本に使わない | 数字・否定・不確実性の人手評価は未完。翻訳成功表示の信頼度基準を強化すべき |
| T10 | 内部メモが住民に公開される | 対応更新API/UI | public messageとinternalNoteを別フィールド、公開プレビューを分離 | 回帰テストでフィールド境界を固定する必要あり |
| T11 | 削除で原文・監査証跡が失われる | bulk/delete | 管理者認証、scope、監査ログ、関連行をトランザクション的batch削除 | 実運用では削除の復元・保持期間ポリシーが未定。災害証跡としての削除権限を再検討する必要あり |
| T12 | CSP外部依存・クリックジャッキング | 公開Web | CSP、`X-Frame-Options: DENY`、`frame-ancestors 'none'`、`nosniff`、Referrer-Policy | `style-src/script-src unsafe-inline` が残る。画像のquickchart許可は用途を限定・監視する必要あり |
| T13 | ブラウザ音声が外部へ送信される | SpeechRecognition | `BrowserASRProvider`として明示、`processLocally`を無条件に信頼しない | 音声の外部送信先をアプリだけでは制御できない。UI/READMEで完全ローカルと断言しない |
| T14 | 同時更新で進捗を上書きする | 職員対応 | issue version、更新後の再読込、監査イベント | 競合UI・リトライ方針を実機確認する必要あり |

## セキュリティ不変条件

1. Safety GuardはLLM結果より前に動き、LLM停止・翻訳失敗でも動く。
2. 原文はAI要約・翻訳・職員用整理で置き換えない。
3. 住民向け返信・緊急度・FAQ公開は職員の明示操作なしに確定しない。
4. `internalNote` は公開更新のデータモデルと分離する。
5. ポータル管理APIはURLのslugだけで認可せず、セッションとDBのportal IDを再確認する。
6. AI失敗時に相談原文を破棄せず、fallbackまたは保留状態を残す。

## 優先度付き改善

### P0（公開前に必要）

- 本番に近いD1/Workers環境で、全管理APIの認証・portal scope・public/internal分離を自動回帰する。
- 確認URLのBearer性を利用規約・表示・運用に明記し、必要なら短期化または失効を追加する。
- 端末内送信待ちキューは追加済みだが、重複排除・再送結果・端末再起動・サーバー側耐久アウトボックスは実機で検証してから運用採用する。

### P1（Phase 2I/2J）

- 監査ログを改ざん検知可能な保管先へ複製し、保持期間・削除承認を決める。
- CSPのinline許可を段階的に縮小し、許可画像ドメインを用途別に整理する。
- 翻訳の数字・否定・不確実性の自動照合と職員への原文提示を強化する。
- 端末紛失、ブラウザ履歴、共用端末のログアウト・キャッシュ消去手順を作る。

## 今回の判定

重大な新規脆弱性をコード変更で修正したわけではない。上記は現状実装と既存試験からの脅威モデルであり、P0項目が未確認のため、災害現場での本番運用可否を承認する文書ではない。
