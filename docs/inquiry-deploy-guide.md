# 海外問い合わせ対応アプリ デプロイ手順書

対象ファイル: `gas/inquiry-engine.gs`
参照仕様書: `docs/inquiry-response-engine-spec.md`(v1.4)
参照マスター: `docs/inquiry-provisional-masters.md`(暫定値・要差し替え)

---

## ① スプレッドシートの新規作成と貼り付け

1. Googleドライブで新規スプレッドシートを作成する(名前は例: 「海外問い合わせ対応 台帳」)。
2. メニュー「拡張機能」→「Apps Script」を開く。
3. 既定で開かれる `コード.gs` の中身を全削除し、`gas/inquiry-engine.gs` の内容を丸ごと貼り付ける。
4. ファイル名は任意(例: `inquiry-engine.gs` のまま、または `コード.gs` のまま)。1ファイル完結なので他のファイルは不要。
5. 画面上部の「プロジェクトを保存」(フロッピーアイコン)で保存する。

---

## ② Script Properties の設定(APIキー・認証トークン)

Apps Scriptエディタの左側メニュー「プロジェクトの設定」(歯車アイコン)を開く。

1. 「スクリプト プロパティ」セクションで「スクリプト プロパティを追加」を押し、以下の2つを登録する。

   | プロパティ | 値 |
   |---|---|
   | `ANTHROPIC_API_KEY` | Anthropic Consoleで発行したAPIキー(`sk-ant-...`) |
   | `APP_TOKEN` | React側と共有する簡易認証トークン(合言葉)。推測されにくい文字列を自分で決める |

2. 「スクリプト プロパティを保存」を押す。

**注意**: このキー・トークンはコードにもReact側のソースにも書かない。GASのScript Propertiesにのみ保存する(仕様書§1-1)。

---

## ③ setupSpreadsheet() の実行(マスターシート初期化)

1. Apps Scriptエディタの関数選択プルダウンで `setupSpreadsheet` を選ぶ。
2. 「実行」ボタン(▷)を押す。
3. 初回実行時は権限の承認ダイアログが出る。「権限を確認」→ Googleアカウントを選択 →「詳細」→「(プロジェクト名)に移動」→「許可」と進む。
4. 実行が完了すると、スプレッドシートに以下のシートが作成・初期化される。
   - 加工単価ルール表 / オプション料金表 / 型代表 / 送料ゾーン表 / 送料料金表(暫定マスター値で初期化)
   - レート(B2にGOOGLEFINANCE式、D2に手動フォールバック150を設定)
   - 案件台帳(A〜W列のヘッダーのみ設定。データ行は追加されない)
5. スプレッドシートを開いて各シートが作成されていることを目視確認する。「レート」シートのB2が数値(為替レート)を表示していれば取得成功。`#N/A`や`#ERROR!`の場合は少し待つか、GOOGLEFINANCE関数が有効か確認する。

**再実行時の注意**: `setupSpreadsheet()` を再度実行すると、加工単価ルール表・オプション料金表・型代表・送料ゾーン表・送料料金表は暫定値で**上書き・全消去**される(初期化専用の関数のため)。実数値に差し替えた後に誤って再実行しないよう注意する。「案件台帳」と「レート」はデータを消さない(ヘッダー・数式のみ再設定)。

---

## ④ ウェブアプリとしてデプロイ

1. Apps Scriptエディタ右上の「デプロイ」→「新しいデプロイ」をクリック。
2. 「種類の選択」(歯車アイコン)で「ウェブアプリ」を選ぶ。
3. 設定:
   - 説明: 任意(例: 「海外問い合わせ対応エンジン v1」)
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」を押す。初回は権限承認が再度求められる場合がある。
5. 発行された「ウェブアプリのURL」(`https://script.google.com/macros/s/xxxxx/exec` の形式)をコピーする。
6. React側(`sewing-tracker.jsx` と同様の構成のファイル)の `GAS_URL` 定数にこのURLを設定する。
   - 既存の生産管理アプリ(`sewing-tracker.jsx`)とは**別のスプレッドシート・別のデプロイURL**になる想定。問い合わせ対応アプリ用のReact側コードで新しい定数(例: `INQUIRY_GAS_URL`)を用意し、そこにこのURLを設定する。

**コード変更後の再デプロイ**: `inquiry-engine.gs` の内容を修正した場合、「デプロイ」→「デプロイを管理」→ 対象デプロイの鉛筆アイコン →「新しいバージョン」を選んで「デプロイ」を押さないと変更が反映されない(URLは変わらない)。

---

## ⑤ 動作確認手順

### 5-1. curlでの疎通確認(process_inquiry)

`YOUR_WEBAPP_URL` と `YOUR_APP_TOKEN` は①④②で設定した実際の値に置き換える。

```bash
curl -X POST "YOUR_WEBAPP_URL" \
  -H "Content-Type: text/plain" \
  -d '{
    "action": "process_inquiry",
    "token": "YOUR_APP_TOKEN",
    "inquiry": {
      "raw_text": "Hi, I run a small fashion label in Copenhagen and I am interested in accordion pleating for a silk chiffon dress. Could you tell me more about pricing and lead time?",
      "sender_name": "",
      "sender_email": "",
      "channel": "email"
    },
    "operator": "yamada",
    "options": { "tone": "standard", "force_reply_types": [] }
  }'
```

正常なら `{"ok":true,"case_id":"xxxxxxxx","detected_language":"en","result":{...}}` が返り、スプレッドシートの「案件台帳」に1行追加される。`token` を誤った値にすると `{"ok":false,"error":"unauthorized"}` が返ることも確認する。

### 5-2. calculate_estimate の確認

①のレスポンスで得た `case_id` を使う。

```bash
curl -X POST "YOUR_WEBAPP_URL" \
  -H "Content-Type: text/plain" \
  -d '{
    "action": "calculate_estimate",
    "token": "YOUR_APP_TOKEN",
    "case_id": "xxxxxxxx",
    "quote_kit": {
      "pleat_type": "accordion",
      "pleat_size_mm": 6,
      "garment_length_cm": 90,
      "cutting": true,
      "hemming": false,
      "quantity_pieces": 20,
      "fabric_meters": 45,
      "mold": "new",
      "country": "Denmark",
      "notes_ja": "シルクシフォン。バイアス裁断希望"
    },
    "manual_line_items": []
  }'
```

`status: "computable"` と `line_items`(型代・加工費・裁断・送料の4行)、`fx`(為替換算)が返ることを確認する。「案件台帳」の該当行のU〜W列(適用為替レート・見積明細・見積キット入力値)が埋まっていることも確認する。

### 5-3. translate_reply の確認

①のレスポンスの `case_id` と `detected_language`(この例なら `"en"`)を使う。

```bash
curl -X POST "YOUR_WEBAPP_URL" \
  -H "Content-Type: text/plain" \
  -d '{
    "action": "translate_reply",
    "token": "YOUR_APP_TOKEN",
    "case_id": "xxxxxxxx",
    "confirmed_subject_ja": "プリーツ加工お見積りの件",
    "confirmed_body_ja": "お問い合わせありがとうございます。ご希望の内容を確認し、追ってお見積りをお送りいたします。",
    "target_language": "en",
    "channel": "email",
    "tone": "standard",
    "operator": "yamada"
  }'
```

`{"ok":true,"result":{...},"number_check":{"ok":true}}` が返り、「案件台帳」のQ〜T列(確定日本語文・翻訳文・逆翻訳・数字チェック結果)が埋まっていることを確認する。`target_language` を `"ja"` にした場合は `{"ok":true,"skipped":true}` が返り、Q列のみ更新されることも確認する。

### 5-4. エラー系の確認

- `force_reply_types: ["quote"]` を付けて `calculated_estimate` を渡さず `process_inquiry` を呼ぶと、AI呼び出し前に `{"ok":false,"error":"estimate_required"}` が返ることを確認する。
- `token` を空や誤った値にすると `{"ok":false,"error":"unauthorized"}` が返ることを確認する。
- `ANTHROPIC_API_KEY` を意図的に不正な値にしてAPI呼び出しを行うと、リトライせず `{"ok":false,"error":"api_error_401: ..."}` 系のエラーが返ることを確認する(設定ミスの検知)。

---

## ⑥ マスター実数値への差し替え方法

`setupSpreadsheet()` で書き込まれる値は**すべて暫定値(テスト用)**(`docs/inquiry-provisional-masters.md` 参照)。リリース前に必ず生田プリーツの実際の料金で差し替えること(仕様書§8)。

差し替え手順:

1. スプレッドシートを直接開き、対象シートのセルを編集する(GASコードの再実行は不要)。
2. **加工単価ルール表**: 「サイズ帯(mm)」「丈帯(cm)」列は `"3mm未満"` `"3〜9"` `"9超〜30"` のような文字列表記で入力する(空欄=不問)。
   - `〜X` : X以下
   - `X超` : Xより大きい(上限なし)
   - `X未満` : Xより小さい(下限なし)
   - `X〜Y` : X以上Y以下(Xに「超」、Yに「未満」を付けると、それぞれ排他的な境界にできる)
   - 行の評価は上から順に行われ、最初に一致した行が採用される。該当行がない組み合わせ(例: geometric_custom)は自動計算されず「計算不能」として社員の手動明細入力に委ねられる(仕様どおり)。
3. **オプション料金表・型代表**: 単価・型代の数値セルをそのまま書き換える。
4. **送料ゾーン表**: 「国名(英語)」列は `quote_kit.country` に入力される表記(英語国名)に合わせる。表にない国は自動的にゾーン5として扱われるため、対応国が増えたら行を追加する。
5. **送料料金表**: DHL(または実際に使う配送業者)の重量帯別料金に差し替える。列見出し(Z1〜Z5)は送料ゾーン表のゾーン番号と対応させる。5kg超の重量帯が必要な場合は、行を追加するだけでなく `computeEstimate_()` 内の `weightKg > 5.0` の判定(needs_manual扱いにしている部分)も仕様に応じて見直す。
6. **レート**: D2(手動フォールバック為替レート)は月1回程度手動更新する運用を想定。B2のGOOGLEFINANCE式は通常そのままでよい。
7. 差し替え後は `setupSpreadsheet()` を**再実行しない**こと(再実行すると①〜⑤のシートが暫定値で上書きされる)。

---

## 補足: 既存の生産管理アプリとの関係

`sewing-tracker.jsx` の `GAS_URL` および紐づくスプレッドシート・デプロイとは完全に独立させる。問い合わせ対応アプリは専用の新規スプレッドシート・新規Apps Scriptデプロイ・専用の `APP_TOKEN` を持つ設計とし、既存の生産管理データとは混在させない。
