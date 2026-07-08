# 海外問い合わせ対応アプリ 仕様書 v1.2
## 「返信生成エンジン」プロンプト設計 + 入出力JSON定義

作成日: 2026-07-09(v1.0)/ 改訂: 2026-07-08(v1.1 レビュー反映、v1.2 2段階方式へ変更)
対象: 生田プリーツ株式会社 海外小ロット受注窓口
前提: React (GitHub Pages) + Apps Script + スプレッドシート + Anthropic API

### v1.2 変更点(運用方針の確定)
**前提: 社員は日本語での確認しかできない。翻訳は完全にAIに頼る。**

1. **2段階方式に変更**:
   - **1回目(process_inquiry)**: 問い合わせ → 日本語訳+要約+抽出+**日本語の返信案3つ**
   - 社員が日本語の返信案を選択・自由に修正して確定
   - **2回目(translate_reply)**: 確定した日本語文 → 相手言語への翻訳+**逆翻訳(日本語への訳し戻し)**
   - 社員は逆翻訳を読んで最終確認 → 外国語文をコピーして送信
2. **数字整合チェック(コード側)**: 確定日本語文に含まれる数値が翻訳文にすべて含まれるかをGASで機械チェック。欠落・不一致があればUIに警告表示
3. 案件台帳に「確定日本語文」「送信した外国語文」の2列を確保
4. 日本語の問い合わせは2回目の呼び出しをスキップ(1段階で完結)

### v1.1 変更点(参考)
structured outputs採用 / max_tokens増量 / APIキーはScript Properties / doPost簡易認証 / エラー処理の穴埋め / anthropic-versionヘッダ等の追記

---

## 1. 全体アーキテクチャ

```
[社員] 問い合わせ文を貼り付け
   ↓
[React UI] 入力フォーム
   ↓
[Apps Script] doPost (action: process_inquiry)
   ├─ ① 単価マスター・送料マスターをシートから読込
   ├─ ② Anthropic API 呼び出し【1回目】翻訳+抽出+日本語返信案3つ
   ├─ ③ 結果をシート「案件台帳」に自動記録
   ↓
[React UI] 日本語訳・要約・日本語返信案3つを表示
   ↓
[社員] 返信案を選択し、日本語のまま自由に修正 → 「翻訳する」ボタン
   ↓
[Apps Script] doPost (action: translate_reply)
   ├─ ④ Anthropic API 呼び出し【2回目】相手言語へ翻訳+日本語への逆翻訳
   ├─ ⑤ 数字整合チェック(コード側)
   ├─ ⑥ 確定日本語文・翻訳文を台帳に記録
   ↓
[React UI] 翻訳文+逆翻訳を表示(数字警告があれば赤表示)
   ↓
[社員] 逆翻訳を読んで最終確認 → 外国語文をコピーして送信
```

**設計原則**
- 社員が読み書きするのは常に日本語。外国語文は「コピーするだけの成果物」
- 逆翻訳が最終確認の代替。社員が読めない文をそのまま送らせない
- 金額計算はAIにやらせない。マスター参照と計算はApps Script側で行い、計算済みの数字をプロンプトに渡す
- 数字の翻訳ミスはコードで検知する(AIの自己申告に頼らない)
- 自動送信は実装しない。必ず人が確認してコピー&送信
- 出力の構造はプロンプトではなく **APIのstructured outputsで強制**

### 1-1. セキュリティ
- Anthropic APIキーは **GASのScript Properties** に保存し、コードにもReactにも書かない
  (`PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY')`)
- doPostのWebアプリURLは既存の生産管理アプリ同様に実質公開になるため、入力JSONに簡易トークン(合言葉)フィールドを設け、GAS側で照合してから処理する(APIコスト濫用防止)
- 既存アプリと同じく `Content-Type: text/plain` でPOSTし、CORSプリフライトを回避する

---

## 2. 入力JSON(React → Apps Script)

### 2-1. 1回目: 問い合わせ処理

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

`force_reply_types` に "quote" が含まれるが `calculated_estimate` が null または status ≠ "computable" の場合、GAS側でエラーを返す(API呼び出し前に弾く)。UIは「見積情報を入力してください」と表示。

### 2-2. 2回目: 確定文の翻訳

```json
{
  "action": "translate_reply",
  "token": "(簡易認証トークン)",
  "case_id": "(1回目の応答で発行された案件ID。台帳の行と紐づく)",
  "confirmed_subject_ja": "プリーツ加工お見積りの件",
  "confirmed_body_ja": "(社員が修正・確定した日本語の返信全文)",
  "target_language": "en",
  "channel": "email",
  "tone": "standard",
  "operator": "yamada"
}
```

| フィールド | 必須 | 説明 |
|---|---|---|
| case_id | ○ | 台帳のどの行に書き戻すかの特定用。1回目の応答に含めて返す |
| confirmed_subject_ja | - | メールの場合のみ。DMは空文字 |
| confirmed_body_ja | ○ | 社員確定版の日本語本文 |
| target_language | ○ | 1回目の `detected_language` をReactが引き回す。"ja" の場合はGASが翻訳せずそのまま確定扱いにする |
| channel / tone | ○ | 語数上限・文体の制御に使用 |

---

## 3. Apps Script 前処理(1回目のAPI呼び出し前)

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

## 4. Anthropic API【1回目】問い合わせ処理エンジン

### 4-1. システムプロンプト(全文・実装用)

※返信案は**日本語で**生成する。社員は日本語しか確認できず、翻訳は2回目の呼び出しで行うため。

```
You are the inquiry-response engine for Ikuta Pleats Co., Ltd. (生田プリーツ株式会社), a pleating and sewing factory founded in 1976 in Saitama, Japan. The factory accepts small-lot pleating orders from overseas designers and brands.

Your job: given an incoming inquiry (any language), return a single JSON object following the provided schema. All reply drafts must be written in natural Japanese — a staff member who reads only Japanese will review and edit them, and a separate translation step will convert the confirmed draft into the customer's language later.

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
5. All replies are written in Japanese, regardless of the inquiry language. Write them so they translate cleanly: short sentences, no wordplay, no Japanese-only idioms.
6. Length: write so that the eventual translation fits the channel — email replies should translate to under 180 words, Instagram DM replies to under 90 words. As a guide, keep email drafts under 400 Japanese characters and DM drafts under 200.
7. Tone: warm, precise, craftsman-like. No exclamation marks except at most one. No excessive superlatives.

## Reply types (generate all three unless force_reply_types specifies otherwise)
- "quote": present the calculated estimate (only if calculated_estimate.status == "computable")
- "info_request": ask for the minimum missing information needed to quote
- "decline": politely decline (only when the request is clearly outside capabilities); otherwise generate "holding" (we will review and reply within 2 business days) as the third option instead

## Field meanings
- translation.detected_language: ISO 639-1 code of the inquiry
- translation.japanese_translation: 問い合わせ全文の自然な日本語訳(問い合わせが日本語の場合は原文をそのまま)
- translation.summary_ja: 3行以内の要約(社員向け)
- extraction.*: values extracted from the inquiry; null when absent. pleat_type_guess is one of available_pleat_types or "unknown". missing_fields lists field names still required for quoting.
- risk.requires_owner_review / reason / payment_risk_note: see Hard rule 4
- replies[].type: quote | info_request | decline | holding
- replies[].subject_ja: 件名(日本語。DMの場合は空文字)
- replies[].body_ja: 返信本文(日本語)
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
  calculated_estimate: calculatedEstimate  // §5参照。抽出前は null
});
```

### 4-3. API呼び出しパラメータ
- エンドポイント: `POST https://api.anthropic.com/v1/messages`
- 必須ヘッダ: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- model: `claude-sonnet-4-6`(翻訳+定型生成なのでSonnetで十分。品質不足なら `claude-opus-4-8` へ)
- max_tokens: **4096**
- temperature: 0.3(返信文のばらつきを抑える)
  - ※注意: claude-sonnet-4-6 では有効。**claude-sonnet-5 / opus-4-7以降へ移行する場合はこのパラメータを削除**(400エラーになる)
- **output_config**(structured outputs・最重要):

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
            "required": ["type", "subject_ja", "body_ja"],
            "properties": {
              "type": {"type": "string", "enum": ["quote", "info_request", "decline", "holding"]},
              "subject_ja": {"type": "string"},
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

GASは応答を受けて `case_id`(台帳の行番号またはUUID)を発行し、`detected_language` とともにReactへ返す。Reactは2回目の呼び出しでこれらを引き回す。

---

## 4B. Anthropic API【2回目】翻訳エンジン(v1.2新設)

### 4B-1. システムプロンプト(全文・実装用)

```
You are the outbound-translation engine for Ikuta Pleats Co., Ltd. (生田プリーツ株式会社), a Japanese pleating factory replying to overseas customers.

You receive a customer-service reply written and approved in Japanese. Translate it into the target language for sending to the customer. The Japanese author cannot read the target language at all, so your translation will be sent verbatim — accuracy is critical.

## Hard rules
1. Preserve every number exactly: prices, quantities, weeks, dates, percentages. Never convert currencies or units unless the Japanese text itself does.
2. Do not add, remove, or soften any commitment, condition, or request. The translation must carry exactly the same obligations as the Japanese text.
3. Natural business writing in the target language — not word-for-word literal, but faithful in content. Tone: warm, precise, craftsman-like.
4. Length limits: email body under 180 words, Instagram DM under 90 words. If the Japanese text is too long to fit, tighten the wording but NEVER drop facts, numbers, or requests. If it still cannot fit, set length_warning to true.
5. After translating, write back_translation_ja: an independent, faithful Japanese re-translation of YOUR translated text (not a copy of the input). The Japanese author will use it as their only way to verify what is being sent. If your translation deviates from the input anywhere, the back-translation must reveal it.
6. translator_note_ja: 1-2 sentences in Japanese, only if there is something the author should know (e.g. a phrase that has no direct equivalent, a culturally adjusted expression). Empty string otherwise.
```

### 4B-2. ユーザーメッセージ

```javascript
const userMessage = JSON.stringify({
  target_language: req.target_language,   // 例 "en", "fr", "da"
  channel: req.channel,                   // "email" / "instagram_dm" / "web_form"
  tone: req.tone,
  subject_ja: req.confirmed_subject_ja,   // DMは空文字
  body_ja: req.confirmed_body_ja
});
```

### 4B-3. API呼び出しパラメータ
- model: `claude-sonnet-4-6` / max_tokens: **2048** / temperature: 0.2
- ヘッダ等は1回目と同じ
- **output_config**:

```json
"output_config": {
  "format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["subject_translated", "body_translated", "back_translation_ja",
                   "translator_note_ja", "length_warning"],
      "properties": {
        "subject_translated": {"type": "string"},
        "body_translated": {"type": "string"},
        "back_translation_ja": {"type": "string"},
        "translator_note_ja": {"type": "string"},
        "length_warning": {"type": "boolean"}
      }
    }
  }
}
```

### 4B-4. 数字整合チェック(GAS側・コードで実施)

AIの自己申告(Hard rule 1)に頼らず、コードで検証する:

1. `confirmed_body_ja` から数値列を正規表現で抽出(`/[0-9][0-9,.]*/g`。カンマ・ピリオドを除去して正規化)
2. `body_translated` から同様に抽出・正規化
3. 日本語側の各数値が翻訳側に存在するか照合
4. 欠落があれば応答JSONに `number_check: {ok: false, missing: ["138000", ...]}` を付けて返す
   → UIは赤帯で「⚠ 金額・数量が翻訳文で確認できません。再翻訳してください」と表示し、コピーボタンを無効化
5. 全数値が一致すれば `number_check: {ok: true}`

※「3週間」→「3 weeks」のように数字自体は保存される前提の単純照合。漢数字(「三週間」)は1回目の生成時点で使わないようプロンプトで担保済み(算用数字で書く旨をHard ruleに含めてもよい)。

### 4B-5. target_language が "ja" の場合
2回目のAPI呼び出しをスキップし、確定日本語文をそのまま最終文として台帳に記録する(国内問い合わせ)。

---

## 5. 見積もり計算の流れ

**Phase 1(推奨)**: 初回問い合わせの大半は情報不足なので、calculated_estimate は null のまま1回目を呼び出す
- → AIは info_request 中心の日本語3案を返す
- 情報が揃った2通目以降は、社員がUI上で「生地m数・型・国」を手入力
- → Apps Scriptがマスター参照で概算計算 → calculated_estimate に入れて再度1回目の呼び出し
- → AIは quote 案を含む日本語3案を返す

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

**AIに計算させない理由**: 単価×数量の掛け算でもAIは間違え得る。海外取引で金額誤りは信用問題。数字は必ずコードで計算し、AIは「言葉にする」だけ。さらに翻訳段階でも§4B-4の機械チェックで数字を守る。

---

## 6. スプレッドシート「案件台帳」スキーマ(v1.2改訂)

| 列 | 内容 | 書き込みタイミング |
|---|---|---|
| A | 案件ID(case_id) | 1回目 |
| B | 受付日時(自動) | 1回目 |
| C | 対応者(operator) | 1回目 |
| D | チャネル | 1回目 |
| E | 送信者名 / F: メール | 1回目 |
| G | 国(推定) | 1回目 |
| H | 検出言語 | 1回目 |
| I | 要約(日本語) | 1回目 |
| J | プリーツ型(推定) | 1回目 |
| K | 数量 / L: 生地m数 | 1回目 |
| M | ステータス(新規/見積提示/受注/辞退/保留) ← 社員が手動更新 | - |
| N | 見積金額(円) | 1回目(見積時) |
| O | requires_owner_review フラグ | 1回目 |
| P | 原文(全文) | 1回目 |
| Q | 確定した日本語返信文 | 2回目 |
| R | 送信した外国語返信文(翻訳結果) | 2回目 |
| S | 逆翻訳(日本語) | 2回目 |
| T | 数字チェック結果(OK / NG詳細) | 2回目 |

※Q〜S列が揃うと「日本語で何を言ったつもりで、実際に何を送ったか」が後から監査できる。プロンプト改善材料にもなる。

---

## 7. エラー処理

| ケース | 挙動 |
|---|---|
| APIエラー(429/529/5xx) | 2秒待って1回だけ自動リトライ → 失敗なら「AI処理に失敗しました」と表示。1回目なら原文だけ台帳に記録 |
| APIエラー(400/401) | リトライしない。設定ミス(キー・パラメータ)の可能性が高いので管理者向けメッセージを表示 |
| タイムアウト | 上と同じ扱い |
| JSON parse 失敗 | structured outputs採用後は原則発生しない。保険: コードフェンス除去 → 再パース → 失敗なら1回だけ自動リトライ |
| stop_reason = "max_tokens" | 途中切れ。max_tokensを上げて1回だけ自動リトライ |
| stop_reason = "refusal" | requires_owner_review 相当として扱い、原文のみ台帳記録+赤帯表示 |
| requires_owner_review = true | UIに赤帯表示「代表確認が必要な案件です」+ holding 返信(日本語)のみ表示(replies配列は1件)。翻訳(2回目)は代表確認後に実行 |
| 数字チェックNG(§4B-4) | 赤帯警告+コピーボタン無効化。「再翻訳」ボタンで2回目を再実行 |
| length_warning = true | 黄帯表示「文字数上限に収まりません。日本語文を短くして再翻訳してください」 |
| 検出言語が日本語 | 国内問い合わせ。1回目で日本語3案を生成(japanese_translationは原文のまま)。2回目はスキップ(§4B-5) |

---

## 8. 実装前に必要なデータ(生田さん側の宿題)

1. **単価マスター**: プリーツ型ごとの海外向け単価(国内単価×係数でも可。係数の決定が必要)
2. **送料マスター**: DHLゾーン表と重量帯別料金の手入力(EU/US/AU/アジアの4ゾーンから開始で十分)
3. **過去の海外案件3件の実績値**: プロンプトのテストケースに使用(実際の問い合わせ文があれば最良)
4. **利用規約の骨子**: 生地破損時の責任範囲・前払い条件(※法務は専門家確認が必要)
5. **簡易認証トークンの決定**: React→GASのdoPost濫用防止用の合言葉

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

## 10. 概算コスト

claude-sonnet-4-6($3/M入力・$15/M出力、1 USD = 150円換算):

| 呼び出し | 入力 | 出力 | 概算 |
|---|---|---|---|
| 1回目(問い合わせ処理) | ≒3,000tok | ≒1,500tok(日本語3案のみ) | ≒5円 |
| 2回目(翻訳+逆翻訳) | ≒1,000tok | ≒1,200tok | ≒3円 |

**合計 約8円/件**。再翻訳が発生しても十数円。月100件で1,000円前後。

---

## 11. Phase 2 候補(v1完成後)

- Gmail連携: 問い合わせメールの自動取込(コピペ廃止)
- 為替レート自動取得
- DHL API連携(法人契約後)
- 台帳ダッシュボード(月次の問い合わせ数・受注率・国別分布)
- 頻出表現の対訳集(用語集)を2回目のプロンプトに注入し、訳語を固定(例: 「型代」= "mold fee")
