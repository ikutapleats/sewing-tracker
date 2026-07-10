# プリーツ加工 問い合わせフォーム デプロイ手順書

対象ファイル: `gas/pleats-form-receiver.gs`
対応フォーム: `pleats-form-app.jsx`(React／`pleatsinquiryform_1.jsx` 相当。冒頭に `ENDPOINT` 定数あり)

---

## ① スプレッドシートの新規作成

1. Googleドライブで新規スプレッドシートを作成する(名前は例: 「プリーツ問い合わせ 案件台帳」)。
2. アドレスバーの URL から スプレッドシートID(`https://docs.google.com/spreadsheets/d/【ここ】/edit` の部分)を控える。
3. シート自体の中身は空のままでよい。`案件台帳` シートとヘッダー行は、初回の doPost 実行時に `gas/pleats-form-receiver.gs` が自動で作成する。

---

## ② Driveに画像保存先フォルダを作成

1. Googleドライブで新規フォルダを作成する(名前は例: 「プリーツ問い合わせ 添付」)。
2. フォルダを開き、URL から フォルダID(`https://drive.google.com/drive/folders/【ここ】` の部分)を控える。
3. 送信ごとに、このフォルダの下へ `yyyyMMdd_HHmm_送信者名` というサブフォルダが自動作成され、画像・デザイン画がそこに保存される。

---

## ③ Apps Scriptへのコード貼り付けとスクリプト プロパティ設定

1. ①のスプレッドシートのメニュー「拡張機能」→「Apps Script」を開く。
2. 既定で開かれる `コード.gs` の中身を全削除し、`gas/pleats-form-receiver.gs` の内容を丸ごと貼り付ける。
3. ファイル名は任意(例: `コード.gs` のままでよい)。1ファイル完結なので他のファイルは不要。
4. 画面上部の「プロジェクトを保存」(フロッピーアイコン)で保存する。
5. 左側メニュー「プロジェクトの設定」(歯車アイコン)を開き、「スクリプト プロパティ」セクションで「スクリプト プロパティを追加」を押し、以下の2つを登録する。

   | プロパティ | 値 |
   |---|---|
   | `SHEET_ID` | ①で控えたスプレッドシートID |
   | `DRIVE_FOLDER_ID` | ②で控えたフォルダID |
   | `ADMIN_VIEW_URL`（任意） | スタッフ閲覧ページ(`pleats-admin`)のウェブアプリURL。設定すると、新規受付の通知メールにこのリンクが載る。未設定なら台帳リンクのみ。 |

6. 「スクリプト プロパティを保存」を押す。

**補足（`ADMIN_VIEW_URL`）**: 閲覧ページ(`gas/pleats-admin.gs`)を別プロジェクトでデプロイした後、その「ウェブアプリのURL」(`https://script.google.com/macros/s/……/exec`)をこのプロパティに登録すると、通知メールの先頭に「スタッフ閲覧ページ」のリンクが追加され、メールから1クリックで開ける。設定・変更後の受付GASの再デプロイは不要（プロパティは実行時に読まれる）。

**注意**: `SHEET_ID` と `DRIVE_FOLDER_ID` はコードに直書きしない(`getConfig_()` がスクリプト プロパティから読み出す設計)。未設定のまま実行すると「スクリプトプロパティ SHEET_ID / DRIVE_FOLDER_ID を設定してください」というエラーになる。

AI返信生成(後述⑥)を使わない現段階では `ANTHROPIC_API_KEY` の設定は不要。

---

## ④ ウェブアプリとしてデプロイ

1. Apps Scriptエディタ右上の「デプロイ」→「新しいデプロイ」をクリック。
2. 「種類の選択」(歯車アイコン)で「ウェブアプリ」を選ぶ。
3. 設定:
   - 説明: 任意(例: 「プリーツ問い合わせ受信 v1」)
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」を押す。初回は権限承認が求められる(「権限を確認」→ Googleアカウントを選択 →「詳細」→「(プロジェクト名)に移動」→「許可」)。
5. 発行された「ウェブアプリのURL」(`https://script.google.com/macros/s/xxxxx/exec` の形式)をコピーする。
6. フォーム側(`pleats-form-app.jsx`)冒頭の `ENDPOINT` 定数にこのURLを設定する。

```js
const ENDPOINT = "https://script.google.com/macros/s/xxxxx/exec";
```

**コード変更後の再デプロイ**: `pleats-form-receiver.gs` の内容を修正した場合、「デプロイ」→「デプロイを管理」→ 対象デプロイの鉛筆アイコン →「新しいバージョン」を選んで「デプロイ」を押さないと変更が反映されない(URLは変わらない)。

**認証トークンについて**: このエンドポイントは公開フォームの受け口であり、フォーム側は `mode: "no-cors"` の「投げっぱなし」送信で応答を読まない設計のため、他の問い合わせ対応アプリ(`inquiry-engine.gs`)のような `APP_TOKEN` は付与していない。この方針は既存のまま維持している。

---

## ⑤ 動作確認手順

### 5-1. フォームからのテスト送信

1. デプロイ後のフォームを開き、必須項目(氏名・メール・プリーツの種類・希望納期、種類によっては画像)を入力して1件テスト送信する。
2. スプレッドシートの「案件台帳」シートに1行追加されていることを確認する(ヘッダー行が無ければ初回実行時に自動生成される)。
3. Driveの保存先フォルダの下に `yyyyMMdd_HHmm_送信者名` サブフォルダが作成され、添付した画像が保存されていることを確認する。台帳の「画像」「デザイン画」列にそのファイルのURLが入っていることも確認する。

### 5-2. curlでの疎通確認

フォームは `no-cors` の投げっぱなし送信で応答を読まないため、動作確認には curl でレスポンスを直接見るのが確実。`YOUR_WEBAPP_URL` は④で発行されたURLに置き換える。

```bash
curl -X POST "YOUR_WEBAPP_URL" \
  -H "Content-Type: text/plain" \
  -d '{
    "action": "process_inquiry",
    "inquiry": {
      "channel": "web_form",
      "sender_name": "動作確認太郎",
      "sender_email": "test@example.com",
      "phone": "",
      "organization": "",
      "structured": {
        "pleat_type": "one_way",
        "pleat_type_label": "車ひだ",
        "dimensions": { "waist": { "表ひだ": "15", "影ひだ": "15" }, "hem": { "表ひだ": "20" }, "length": "600" },
        "flow_direction": "左流れ",
        "pattern": "ない",
        "multi_types": null,
        "multi_detail": null,
        "other_detail": null,
        "fabric": "オーガンジー ポリエステル100%",
        "fabric_width": "140",
        "quantity": "20枚",
        "hem_finish": ["三つ巻き"],
        "hem_finish_other": null,
        "deadline": "2026年9月1日",
        "image_files": [],
        "design_files": [],
        "note": "curlによる疎通確認"
      }
    }
  }'
```

正常なら `{"ok":true}` が返り、台帳に1行増える。`postData` を送らない(空の)POSTを行った場合は `{"ok":false,"error":"empty"}` が返ることも確認する。

### 5-3. 画像添付を含めた確認(8MB前後)

フォーム側(`pleats-form-app.jsx`)の `MAX_UPLOAD_BYTES` は合計8MBを上限としているが、この値は現時点では推測値であり実測していない。**リリース前に必ず8MB前後の実画像でテスト送信し、実際にGASが処理しきれるかを確認すること**(このタスクの検証対象)。

- Base64エンコードすると元データの約1.33倍のサイズになるため、8MBの画像は `postData.contents` としては約10.7MBのJSON文字列としてGASに届く。
- 確認方法: フォームから8MB前後の画像を複数枚添付して送信する、または上記curl例の `image_files` に実際の画像をbase64化して渡し、台帳に行が増えるか・Driveに画像が保存されるかを確認する。
- GASの doPost には明確な公開POSTサイズ上限のドキュメントが薄く、環境依存で失敗するケースがある。**失敗時の症状**は、台帳に行が増えない(doPost自体が呼ばれない、またはタイムアウト・ペイロード過大でリクエストが握りつぶされる)こと。Apps Scriptの実行ログ(「実行数」画面)にエラーが記録されない「サイレント失敗」になる場合もある。
- 対処: 実際に失敗が確認された場合は、`pleats-form-app.jsx` の `MAX_UPLOAD_BYTES` を実測できた安全な上限まで下げる(例: 8MBで失敗するなら5〜6MB程度に下げて再検証)。あわせて、上限超過時の案内文言(「送信後の返信メールに添付してください」)が実際の運用と合っているか確認する。

---

## ⑥ AI返信生成(ENABLE_AI_REPLY)について

`gas/pleats-form-receiver.gs` 内の `ENABLE_AI_REPLY` は既定で `false` になっている。現時点ではスタブとして残しているのみで、有効化(`true` への変更・`ANTHROPIC_API_KEY` のスクリプト プロパティ登録・返信生成プロンプトの移植)は将来のステップとする。有効化する際は、他の問い合わせ対応エンジン(`docs/inquiry-deploy-guide.md` の②)と同様に、APIキーをスクリプト プロパティにのみ保存し、コードに直書きしないこと。

---

## 補足: 既存アプリとの関係

`sewing-tracker.jsx`(生産管理)・`inquiry-engine.gs`(海外問い合わせ対応)とは完全に独立させる。本フォームは専用の新規スプレッドシート・新規Driveフォルダ・新規Apps Scriptデプロイを持つ設計とし、既存のデータとは混在させない。
