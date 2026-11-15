# MyGolf GAS バックエンド

検証用コピー「マイスコア_DB_新アプリ検証用」に紐づく新規・最小の GAS。
本番 DB には接続しない。

## 初回セットアップ（本人の1回だけの操作）

1. 検証用コピーのスプレッドシートを開く → 拡張機能 → Apps Script
2. 既定のコードを消し、この `Code.gs` の内容を貼り付けて保存
3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
   - 実行ユーザー: 自分
   - アクセスできるユーザー: 全員（認証なし運用のため。URL は秘匿すること）
4. 初回承認（Google の確認画面で許可）
5. 発行されたウェブアプリ URL をアプリ側の設定（`js/config.js` の GAS_URL）に入れる

以後の更新は「デプロイを管理」から既存デプロイを編集（新バージョン）し、URL を変えないこと。

## API

| action | 方式 | 内容 |
|---|---|---|
| getMaster | GET | Courses 全件（sub_courses_json はパース済み）＋メンバー集計＋プレー済みコース集計（Rounds から） |
| getDraft | GET | 最新の下書き（シート「下書き」、なければ draft:null） |
| saveDraft | POST | 下書き保存（1行保持） |
| saveRound | POST | Rounds へ降順挿入。round_id 重複時は duplicate:true で二重登録しない |
