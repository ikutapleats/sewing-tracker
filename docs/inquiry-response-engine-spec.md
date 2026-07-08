# 海外問い合わせ対応アプリ 仕様書 v1.1
## 「返信生成エンジン」プロンプト設計 + 入出力JSON定義

作成日: 2026-07-09(v1.0)/ 改訂日: 2026-07-08(v1.1 レビュー反映)
対象: 生田プリーツ株式会社 海外小ロット受注窓口
前提: React (GitHub Pages) + Apps Script + スプレッドシート + Anthropic API

### v1.1 変更点(レビュー指摘の反映)
1. **JSON出力の保証方法を変更**: 「JSONだけ返せ」というプロンプト頼みをやめ、APIの **structured outputs(`output_config.format`)** でスキーマを強制。§7のJSONパース失敗系はフォールバックに格下げ
2. **max_tokens を 3000 → 4096 に増量**(3案×2言語+翻訳で3000では長文問い合わせ時に途中切れの恐れ)
3. **APIキーの管理方法を明記**(Script Properties。React側には絶対に置かない)
4. **仕様の穴を3つ定義**: 日本語問い合わせ時のスキーマ / force_reply_types=["quote"] なのに見積不能な場合 / requires_owner_review時のreplies件数
5. **anthropic-version ヘッダ・UrlFetchApp制約・概算コスト** を追記
6. temperature 0.3 は claude-sonnet-4-6 では有効だが、**将来 claude-sonnet-5 以降へ移行する場合は削除が必要**(新モデルはsamplingパラメータを400で拒否)と注記

---

## 1. 全体アーキテクチャ

```
[社員] 問い合わせ文を貼り付け
   ↓
[React UI] 入力フォーム
   ↓
[Apps Script] doPost
   ├─ ① 単価マスター・送料マスターをシートから読込
   ├─ ② Anthropic API 呼び出し(1回で翻訳+抽出+返信3案)
   ├─ ③ 結果をシート「案件台帳」に自動記録
   ↓
[React UI] 結果表示 → 社員が返信案を選択・微修正 → コピー
```

**設計原則**
- API呼び出しは1案件につき1回(翻訳・抽出・見積もり判定・返信生成を同時に)
- 自動送信は実装しない。必ず人が確認してコピー&送信
- 金額計算はAIにやらせない。マスター参照と計算はApps Script側で行い、計算済みの数字をプロンプトに渡す
- AIの役割は「言語」だけ。「数字」はコードが担当
- 出力の構造はプロンプトではなく **APIのstructured outputsで強制**(v1.1)

### 1-1. セキュリティ(v1.1追加)
- Anthropic APIキーは **GASのScript Properties** に保存し、コードにもReactにも書かない
  (`PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')`)
- doPostのWebアプリURLは既存の生産管理アプリ同様に実質公開になるため、入力JSONに簡易トークン(合言葉)フィールドを設け、GAS側で照合してから処理する(APIコスト濫用防止)
- 既存アプリと同じく `Content-Type: text/plain` でPOSTし、CORSプリフライトを回避する

---

## 2. 入力JSON(React → Apps Script)

```json
{
  "action": "process_inquiry",
  "token": "(簡易認証トークン)",
  "inquiry": {
    "raw_text": "Hi, I'm a designer based in Copenhagen...(原文そのまま)",
    "sender_name": "",
    "sender_email": "",
    "channel": "email"
  },
  "operator": "yamada",
  "options": {
    "tone": "standard",
    "force_reply_types": []
  }
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| raw_text | ○ | 問い合わせ原文。言語不問(英語以外も可) |
| sender_name / sender_email | - | 空欄可。原文から抽出できれば自動補完 |
| channel | ○ | "email" / "instagram_dm" / "web_form"。返信文の長さ・形式が変わる |
| operator | ○ | 対応した社員名(台帳記録用) |
| tone | - | "standard"(既定) / "formal" / "casual"。DMはcasual推奨 |
| force_reply_types | - | 空なら3案自動生成。["quote"]等で特定タイプのみ生成 |

**v1.1で定義**: `force_reply_types` に "quote" が含まれるが `calculated_estimate` が null または status ≠ "computable" の場合、GAS側でエラーを返す(API呼び出し前に弾く)。UIは「見積情報を入力してください」と表示。

---

## 3. Apps Script 前処理(API呼び出し前)

### 3-1. マスター読込
- シート「単価マスター」: プリーツ型ごとの加工単価(円/m)、型代、最小ロット
- シート「送料マスター」: ゾーン(1〜5)×重量帯(0.5kg刻み)のDHL料金表 + ゾーン国名対応表

### 3-2. プロンプトに渡すコンテキストの組み立て
マスター全体は渡さない。以下のサマリーだけをJSON化して渡す:

```json
{
  "pricing_context": {
    "available_pleat_types": ["accordion", "box", "sunray", "crystal", "geometric_custom"],
    "min_lot_note": "型により1着〜対応可",
    "mold_fee_range_jpy": [15000, 80000],
    "processing_fee_range_jpy_per_m": [800, 3500],
    "lead_time_weeks": {"standard": 3, "custom_mold": 5}
  },
  "shipping_context": {
    "carrier": "DHL Express",
    "sample_rates": {
      "zone_EU_2kg_jpy": 12000,
      "zone_US_2kg_jpy": 11000,
      "zone_AU_2kg_jpy": 10500
    },
    "note": "往復輸送。片道はお客様負担で日本へ送付"
  }
}
```

※金額は仮の値。**送料マスター整備後に差し替え必須**。

---

## 4. Anthropic API プロンプト設計

### 4-1. システムプロンプト(全文・実装用)

※v1.1: 出力スキーマの強制はstructured outputs(§4-3)に移したため、プロンプト内のスキーマ記述は「フィールドの意味の説明」として残す(モデルが各フィールドの意図を理解するために有効)。

```
You are the inquiry-response engine for Ikuta Pleats Co., Ltd. (生田プリーツ株式会社), a pleating and sewing factory founded in 1976 in Saitama, Japan. The factory accepts small-lot pleating orders from overseas designers and brands.

Your job: given an incoming inquiry (any language), return a single JSON object following the provided schema.

## Company facts you may state
- Founded 1976, 50 years of pleating craftsmanship
- Handles pattern making, cutting, pleating, and sewing in-house
- Accepts small lots (from 1 piece depending on pleat type)
- Past international work includes clients in New York, Melbourne, and Cairo (do not name specific clients unless the inquiry mentions them first)
- Standard lead time: 3 weeks door-to-door for existing molds, 5 weeks when a new mold is required
- Payment: advance payment via Stripe or bank transfer (Wise), required before production
- Customer sends fabric to Japan at their own cost; return shipping is included in our quoted price

## Hard rules
1. NEVER invent prices, lead times, or capabilities not present in pricing_context / shipping_context / calculated_estimate. If a number is not provided, the reply must ask for information or say a detailed quote will follow.
2. NEVER promise delivery dates, discounts, or exclusivity.
3. NEVER auto-accept an order. Every reply ends with a next step that requires customer action or states that a formal quote will follow after internal confirmation.
4. If the inquiry involves fur, leather requiring CITES documentation, military/defense use, or counterfeit/replica of another brand's design, set flag "requires_owner_review" to true and generate only a holding reply ("we will get back to you"). In that case the replies array contains exactly one entry.
5. Write replies in the language of the original inquiry. If the inquiry language is unclear, default to English.
6. If the inquiry is in Japanese: treat it as a domestic inquiry. Set translation.japanese_translation to the raw text unchanged, write summary_ja as usual, and generate all replies in Japanese with body_ja equal to body.
7. Keep email replies under 180 words, Instagram DM replies under 90 words.
8. Tone: warm, precise, craftsman-like. No exclamation marks except at most one. No excessive superlatives.

## Reply types (generate all three unless force_reply_types specifies otherwise)
- "quote": present the calculated estimate (only if calculated_estimate.status == "computable")
- "info_request": ask for the minimum missing information needed to quote
- "decline": politely decline (only when the request is clearly outside capabilities); otherwise generate "holding" (we will review and reply within 2 business days) as the third option instead

## Field meanings
- translation.detected_language: ISO 639-1 code of the inquiry
- translation.japanese_translation: 問い合わせ全文の自然な日本語訳
- translation.summary_ja: 3行以内の要約(社員向け)
- extraction.*: values extracted from the inquiry; null when absent. pleat_type_guess is one of available_pleat_types or "unknown". missing_fields lists field names still required for quoting.
- risk.requires_owner_review / reason / payment_risk_note: see Hard rule 4
- replies[].type: quote | info_request | decline | holding
- replies[].subject: email subject line (empty string for DM)
- replies[].body: reply text in the customer's language
- replies[].body_ja: 返信文の日本語訳(社員が内容確認するため必須)
- internal_note_ja: 社員向けメモ。対応上の注意点があれば1〜2行、なければ空文字
```

### 4-2. ユーザーメッセージの組み立て(Apps Script側)

```javascript
const userMessage = JSON.stringify({
  inquiry_raw_text: inquiry.raw_text,
  channel: inquiry.channel,
  tone: options.tone,
  force_reply_types: options.force_reply_types,
  pricing_context: pricingContext,
  shipping_context: shippingContext,
  calculated_estimate: calculatedEstimate  // 下記5章参照。抽出前は null
});
```

### 4-3. API呼び出しパラメータ(v1.1改訂)
- エンドポイント: `POST https://api.anthropic.com/v1/messages`
- 必須ヘッダ: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- model: `claude-sonnet-4-6`(翻訳+定型生成なのでSonnetで十分。品質不足なら `claude-opus-4-8` へ)
- max_tokens: **4096**(3案×2言語+翻訳。3000では長文時に途中切れの恐れ)
- temperature: 0.3(返信文のばらつきを抑える)
  - ※注意: claude-sonnet-4-6 では有効。**claude-sonnet-5 / opus-4-7以降へ移行する場合はこのパラメータを削除**(400エラーになる)
- **output_config**(v1.1追加・最重要):

```json
"output_config": {
  "format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["translation", "extraction", "risk", "replies", "internal_note_ja"],
      "properties": {
        "translation": {
          "type": "object", "additionalProperties": false,
          "required": ["detected_language", "japanese_translation", "summary_ja"],
          "properties": {
            "detected_language": {"type": "string"},
            "japanese_translation": {"type": "string"},
            "summary_ja": {"type": "string"}
          }
        },
        "extraction": {
          "type": "object", "additionalProperties": false,
          "required": ["sender_name", "sender_email", "country_guess", "fabric_type",
                       "fabric_meters", "pleat_type_guess", "quantity_pieces",
                       "deadline_mentioned", "budget_mentioned", "missing_fields"],
          "properties": {
            "sender_name": {"type": ["string", "null"]},
            "sender_email": {"type": ["string", "null"]},
            "country_guess": {"type": ["string", "null"]},
            "fabric_type": {"type": ["string", "null"]},
            "fabric_meters": {"type": ["number", "null"]},
            "pleat_type_guess": {"type": "string"},
            "quantity_pieces": {"type": ["number", "null"]},
            "deadline_mentioned": {"type": ["string", "null"]},
            "budget_mentioned": {"type": ["string", "null"]},
            "missing_fields": {"type": "array", "items": {"type": "string"}}
          }
        },
        "risk": {
          "type": "object", "additionalProperties": false,
          "required": ["requires_owner_review", "reason", "payment_risk_note"],
          "properties": {
            "requires_owner_review": {"type": "boolean"},
            "reason": {"type": ["string", "null"]},
            "payment_risk_note": {"type": ["string", "null"]}
          }
        },
        "replies": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false,
            "required": ["type", "language", "subject", "body", "body_ja"],
            "properties": {
              "type": {"type": "string", "enum": ["quote", "info_request", "decline", "holding"]},
              "language": {"type": "string"},
              "subject": {"type": "string"},
              "body": {"type": "string"},
              "body_ja": {"type": "string"}
            }
          }
        },
        "internal_note_ja": {"type": "string"}
      }
    }
  }
}
```

これにより応答の最初のtextブロックが**必ずこのスキーマに適合するJSON**になり、コードフェンス除去や再パースのリトライは原則不要になる。§7のパース失敗系は保険として残す。

### 4-4. Apps Script実装上の注意(v1.1追加)
- `UrlFetchApp.fetch()` はストリーミング不可・タイムアウト非設定(実質60秒前後)。max_tokens 4096程度なら通常10〜30秒で完了するため問題ないが、**Opusへ切り替える場合も max_tokens は8192以下に抑える**
- `muteHttpExceptions: true` を指定し、HTTPステータスで分岐する(429/529はリトライ対象、400系はエラー表示)
- 応答の `stop_reason` を確認する。`"max_tokens"` の場合は途中切れなので「もう一度実行してください」と表示(または max_tokens を上げて1回だけ自動リトライ)
- `"refusal"` の場合は requires_owner_review 相当として扱い、原文だけ台帳に記録

### 4-5. 概算コスト(v1.1追加)
claude-sonnet-4-6($3/M入力・$15/M出力)で、1件あたり入力≒3,000トークン・出力≒2,500トークン → **約6〜8円/件**(1 USD = 150円換算)。月100件でも1,000円未満。

---

## 5. 見積もり計算の流れ(2段階呼び出しの判断)

**Phase 1(推奨)**: 1回呼び出しで完結させる。
- 初回問い合わせの大半は情報不足なので、calculated_estimate は null のまま呼び出す
- → AIは info_request 中心の3案を返す
- 情報が揃った2通目以降は、社員がUI上で「生地m数・型・国」を手入力
- → Apps Scriptがマスター参照で概算計算 → calculated_estimate に入れて再呼び出し
- → AIは quote 案を含む3案を返す

```json
"calculated_estimate": {
  "status": "computable",
  "mold_fee_jpy": 30000,
  "processing_fee_jpy": 96000,
  "return_shipping_jpy": 12000,
  "total_jpy": 138000,
  "total_usd_approx": 920,
  "exchange_rate_note": "1 USD = 150 JPY (updated 2026-07-01)",
  "lead_time_weeks": 3
}
```

**AIに計算させない理由**: 単価×数量の掛け算でもAIは間違え得る。海外取引で金額誤りは信用問題。数字は必ずコードで計算し、AIは「言葉にする」だけ。

---

## 6. スプレッドシート「案件台帳」スキーマ

| 列 | 内容 |
|---|---|
| A | 受付日時(自動) |
| B | 対応者(operator) |
| C | チャネル |
| D | 送信者名 / E: メール |
| F | 国(推定) |
| G | 検出言語 |
| H | 要約(日本語) |
| I | プリーツ型(推定) |
| J | 数量 / K: 生地m数 |
| L | ステータス(新規/見積提示/受注/辞退/保留) ← 社員が手動更新 |
| M | 見積金額(円) |
| N | requires_owner_review フラグ |
| O | 原文(全文) |
| P | 送信した返信文(社員が確定版を貼り戻す欄) |

※P列を埋める運用にすると、後で「実際に送った文」がAIの学習素材(プロンプト改善材料)になる。

---

## 7. エラー処理(v1.1改訂)

| ケース | 挙動 |
|---|---|
| APIエラー(429/529/5xx) | 2秒待って1回だけ自動リトライ → 失敗なら「AI処理に失敗しました。原文をそのまま台帳に記録しました」と表示。台帳には raw_text だけ記録 |
| APIエラー(400/401) | リトライしない。設定ミス(キー・パラメータ)の可能性が高いので管理者向けメッセージを表示 |
| タイムアウト | 上と同じ扱い(原文のみ台帳記録) |
| JSON parse 失敗 | structured outputs採用後は原則発生しない。保険として: コードフェンス除去 → 再パース → 失敗なら1回だけ自動リトライ |
| stop_reason = "max_tokens" | 途中切れ。max_tokensを上げて1回だけ自動リトライ |
| stop_reason = "refusal" | requires_owner_review 相当として扱い、原文のみ台帳記録+赤帯表示 |
| requires_owner_review = true | UIに赤帯表示「代表確認が必要な案件です」+ holding 返信のみ表示(replies配列は1件) |
| 検出言語が日本語 | 国内問い合わせと判断。japanese_translation には原文をそのまま入れ、日本語返信3案を生成(スキーマは変えない。§4-1 Hard rule 6) |

---

## 8. 実装前に必要なデータ(生田さん側の宿題)

1. **単価マスター**: プリーツ型ごとの海外向け単価(国内単価×係数でも可。係数の決定が必要)
2. **送料マスター**: DHLゾーン表と重量帯別料金の手入力(EU/US/AU/アジアの4ゾーンから開始で十分)
3. **過去の海外案件3件の実績値**: プロンプトのテストケースに使用(実際の問い合わせ文があれば最良)
4. **利用規約の骨子**: 生地破損時の責任範囲・前払い条件(※法務は専門家確認が必要)
5. **(v1.1追加)簡易認証トークンの決定**: React→GASのdoPost濫用防止用の合言葉

---

## 9. モデル采配(Claude Code実装時)

| 作業 | モデル | 理由 |
|---|---|---|
| 本仕様書のレビュー・修正 | Fable | 設計判断 |
| 既存見積もりツール(Apps Script)のコード確認 | Haiku | 読むだけ |
| Apps Script実装(doPost・マスター参照・台帳書込) | Sonnet | 方針確定済み |
| React UI実装 | Sonnet | 方針確定済み |
| システムプロンプトの英文推敲・テストケース評価 | Opus | 出力品質の判断 |
| 結合テスト・リリース判断 | Fable | 手戻りが重い |

---

## 10. Phase 2 候補(v1完成後)

- Gmail連携: 問い合わせメールの自動取込(コピペ廃止)
- 為替レート自動取得
- DHL API連携(法人契約後)
- 台帳ダッシュボード(月次の問い合わせ数・受注率・国別分布)
