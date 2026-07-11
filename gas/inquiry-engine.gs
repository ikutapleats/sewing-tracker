// ============================================================================
// 海外問い合わせ対応アプリ「返信生成エンジン」 Apps Script 本体
// 対象: 株式会社生田プリーツ 海外小ロット受注窓口
// 仕様書: docs/inquiry-response-engine-spec.md (v1.4) を唯一の正とする
// 暫定マスター値: docs/inquiry-provisional-masters.md (実数値への差し替え必須)
//
// この1ファイルで完結(外部ライブラリなし・V8ランタイム前提)。
// 設定は Script Properties を使用する:
//   ANTHROPIC_API_KEY … Anthropic APIキー
//   APP_TOKEN          … React → GAS の簡易認証トークン(合言葉)
// ============================================================================

// ── シート名 ──
const SHEET_PROCESSING_RULES = "加工単価ルール表";
const SHEET_OPTION_RATES = "オプション料金表";
const SHEET_MOLD_FEES = "型代表";
const SHEET_SHIPPING_ZONES = "送料ゾーン表";
const SHEET_SHIPPING_RATES = "送料料金表";
const SHEET_RATE = "レート";
const SHEET_LEDGER = "案件台帳";

// ── 納期(週) ──
const LEAD_TIME_STANDARD_WEEKS = 3; // 既存型
const LEAD_TIME_CUSTOM_MOLD_WEEKS = 5; // 新規型

// ── Anthropic API 設定 ──
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

// ── ひだ形状コード → 日本語表示名(暫定マスター§1。ラベル整形用の補助) ──
const PLEAT_TYPE_LABELS_JA = {
  accordion: "アコーディオンプリーツ",
  knife: "ナイフプリーツ",
  box: "ボックスプリーツ",
  sunray: "サンレイプリーツ",
  crystal: "クリスタルプリーツ",
  geometric_custom: "変形・ジオメトリック",
};

// ============================================================================
// ① セットアップ(エディタから手動実行する初期化関数)
// ============================================================================

// 各マスターシート・案件台帳を(なければ)作成し、暫定マスター値を書き込む。
// 注意: 加工単価ルール表・オプション料金表・型代表・送料ゾーン表・送料料金表は
// 実行するたびに内容を全消去して暫定値で上書きする(初期化専用の想定)。
// 実数値に差し替えた後にこの関数を再実行すると暫定値に戻ってしまうので注意。
// 「案件台帳」「レート」はデータを消さずヘッダー・数式だけ整える。
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupProcessingRulesSheet_(ss);
  setupOptionRatesSheet_(ss);
  setupMoldFeesSheet_(ss);
  setupShippingZonesSheet_(ss);
  setupShippingRatesSheet_(ss);
  setupRateSheet_(ss);
  setupLedgerSheet_(ss);
  Logger.log("setupSpreadsheet: 初期化が完了しました。");
}

function getOrCreateSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

// ① 加工単価ルール表(仕様書§3-1・暫定マスター§4)
// サイズ帯・丈帯は "3mm未満" "3〜9" "9超〜30" のような範囲文字列で保持する。
// 空欄は「不問」。判定は matchesRange_() で行う(下限は超過、上限は以下が既定。
// "◯未満"は上限を超過なし側、"◯超"は下限を超過あり側として解釈する)。
function setupProcessingRulesSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_PROCESSING_RULES);
  sh.clear();
  const header = ["形状", "サイズ帯(mm)", "丈帯(cm)", "単位", "単価(円)", "最小金額(円)"];
  const data = [
    ["accordion", "3mm未満", "", "m", 2800, 15000],
    ["accordion", "3〜9", "", "m", 2200, 15000],
    ["accordion", "9超〜30", "", "m", 1800, 15000],
    ["knife", "3mm未満", "", "m", 2600, 15000],
    ["knife", "3〜9", "", "m", 2000, 15000],
    ["knife", "9超〜30", "", "m", 1600, 15000],
    ["box", "3〜9", "", "m", 2400, 15000],
    ["box", "9超〜30", "", "m", 2000, 15000],
    ["crystal", "3mm未満", "", "m", 3200, 18000],
    ["crystal", "3〜9", "", "m", 2600, 18000],
    // サンレイは実数値(生田さん提供): 180度半円の加工代10,000円/枚。
    // それ以外の開き角度(360度フルサークル等)の料金は未定義のため、特記事項で判断して手動明細で対応する。
    ["sunray", "", "", "枚", 10000, 10000],
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(2, 1, data.length, header.length).setValues(data);
  // box の S帯、crystal の L帯、geometric_custom は表にない = 該当なし(needs_manual)。仕様どおり。
}

// ② オプション料金表(暫定マスター§5)
function setupOptionRatesSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_OPTION_RATES);
  sh.clear();
  const header = ["オプション", "単位", "単価(円)"];
  const data = [
    ["裁断", "枚", 500],
    ["裾上げ", "枚", 400],
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(2, 1, data.length, header.length).setValues(data);
}

// ③ 型代表(暫定マスター§6)
function setupMoldFeesSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_MOLD_FEES);
  sh.clear();
  const header = ["形状", "新規型代(円)", "既存型(円)"];
  const data = [
    ["accordion", 30000, 0],
    ["knife", 30000, 0],
    ["box", 35000, 0],
    ["sunray", 30000, 0], // 実数値(生田さん提供): 型紙作成費
    ["crystal", 45000, 0],
    ["geometric_custom", 80000, 0],
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(2, 1, data.length, header.length).setValues(data);
}

// ④-1 送料ゾーン表(暫定マスター§7・ゾーン国名対応)
// 英語国名・日本語国名の両方で引けるようにしておく(quote_kit.country は英語想定)。
// 未掲載国はゾーン5として扱う(resolveZone_()側のデフォルト)。
function setupShippingZonesSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_SHIPPING_ZONES);
  sh.clear();
  const header = ["国名(英語)", "国名(日本語)", "ゾーン"];
  const data = [
    ["South Korea", "韓国", 1],
    ["Taiwan", "台湾", 1],
    ["China", "中国", 1],
    ["Hong Kong", "香港", 1],
    ["Singapore", "シンガポール", 1],
    ["Thailand", "タイ", 1],
    ["France", "フランス", 2],
    ["Germany", "ドイツ", 2],
    ["Italy", "イタリア", 2],
    ["Spain", "スペイン", 2],
    ["Netherlands", "オランダ", 2],
    ["Denmark", "デンマーク", 2],
    ["United Kingdom", "英国", 2],
    ["United States", "アメリカ", 3],
    ["Canada", "カナダ", 3],
    ["Australia", "オーストラリア", 4],
    ["New Zealand", "ニュージーランド", 4],
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(2, 1, data.length, header.length).setValues(data);
  sh.getRange(data.length + 3, 1).setValue("※この表にない国は自動的にゾーン5(その他)として計算されます。");
}

// ④-2 送料料金表(暫定マスター§7・DHL料金表)。5kg超は needs_manual。
function setupShippingRatesSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_SHIPPING_RATES);
  sh.clear();
  const header = ["重量帯上限(kg)", "Z1", "Z2", "Z3", "Z4", "Z5"];
  const data = [
    [0.5, 4000, 6000, 5500, 5000, 7000],
    [1.0, 5000, 7500, 7000, 6500, 9000],
    [1.5, 6000, 9000, 8500, 8000, 11000],
    [2.0, 7000, 10500, 10000, 9500, 13000],
    [2.5, 8000, 12000, 11500, 11000, 15000],
    [3.0, 9000, 13500, 13000, 12500, 17000],
    [4.0, 10500, 15500, 15000, 14500, 20000],
    [5.0, 12000, 17500, 17000, 16500, 23000],
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(2, 1, data.length, header.length).setValues(data);
  sh.getRange(data.length + 3, 1).setValue("※概算重量ルール: 1枚あたり150g + 梱包500g。5kg超は自動計算不可(needs_manual)。");
}

// ⑤ レート(仕様書§5-1)。B2はGOOGLEFINANCE、D2は手動フォールバック。
// データを消さない(再実行してもGOOGLEFINANCE式が壊れないよう常に再設定するのみ)。
function setupRateSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_RATE);
  sh.getRange(1, 1, 1, 4).setValues([["通貨コード", "レート(自動取得・約20分遅延)", "", "手動フォールバック(月1回目安で更新)"]]);
  sh.getRange("A2").setValue("USD");
  sh.getRange("B2").setFormula('=GOOGLEFINANCE("CURRENCY:USDJPY")');
  sh.getRange("D2").setValue(150);
  // 将来の国別通貨対応用(v1では未使用。仕様書§5-1)
  sh.getRange("A3").setValue("EUR");
  sh.getRange("B3").setFormula('=GOOGLEFINANCE("CURRENCY:EURJPY")');
}

// ⑥ 案件台帳(仕様書§6・A〜W列)。既存データは消さずヘッダーのみ整える。
function setupLedgerSheet_(ss) {
  const sh = getOrCreateSheet_(ss, SHEET_LEDGER);
  const header = [
    "案件ID", "受付日時", "対応者", "チャネル", "送信者名", "メール",
    "国(推定)", "検出言語", "要約(日本語)", "プリーツ型(推定)", "数量", "生地m数",
    "ステータス", "見積金額(円)", "requires_owner_reviewフラグ", "原文(全文)",
    "確定した日本語返信文", "送信した外国語返信文", "逆翻訳(日本語)", "数字チェック結果",
    "適用為替レート", "見積明細", "見積キット入力値",
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]);
}

// ============================================================================
// ② doPost エントリポイント
// ============================================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonOutput_({ ok: false, error: "invalid_request" });
    }
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOutput_({ ok: false, error: "invalid_json" });
    }

    const appToken = PropertiesService.getScriptProperties().getProperty("APP_TOKEN");
    if (!payload.token || payload.token !== appToken) {
      return jsonOutput_({ ok: false, error: "unauthorized" });
    }

    switch (payload.action) {
      case "process_inquiry":
        return jsonOutput_(handleProcessInquiry_(payload));
      case "calculate_estimate":
        return jsonOutput_(handleCalculateEstimate_(payload));
      case "translate_reply":
        return jsonOutput_(handleTranslateReply_(payload));
      default:
        return jsonOutput_({ ok: false, error: "unknown_action" });
    }
  } catch (err) {
    return jsonOutput_({ ok: false, error: "internal_error: " + (err && err.message ? err.message : String(err)) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// ③ アクション1: process_inquiry(仕様書§4)
// ============================================================================

function handleProcessInquiry_(payload) {
  const inquiry = payload.inquiry || {};
  const options = payload.options || {};
  const forceReplyTypes = options.force_reply_types || [];
  const calculatedEstimate = payload.calculated_estimate || null;

  // force_reply_types に "quote" が含まれるのに見積が未計算/計算不能ならAPIを呼ばずに弾く
  if (forceReplyTypes.indexOf("quote") !== -1) {
    if (!calculatedEstimate || calculatedEstimate.status !== "computable") {
      return { ok: false, error: "estimate_required" };
    }
  }

  const pricingContext = buildPricingContext_();
  const shippingContext = buildShippingContext_();

  const userMessage = {
    inquiry_raw_text: inquiry.raw_text,
    channel: inquiry.channel,
    tone: options.tone || "standard",
    force_reply_types: forceReplyTypes,
    pricing_context: pricingContext,
    shipping_context: shippingContext,
    calculated_estimate: calculatedEstimate,
  };

  const apiResult = callClaude_(
    SYSTEM_PROMPT_PROCESS_INQUIRY,
    userMessage,
    PROCESS_INQUIRY_SCHEMA,
    4096,
    0.3
  );

  if (!apiResult.ok) {
    // §7: APIエラー・パース失敗等の場合、原文だけを台帳に記録しておく
    recordRawInquiryOnFailure_(payload);
    return { ok: false, error: apiResult.error };
  }

  const result = apiResult.json;
  // React側は見積計算後の再実行で case_id を送ってくる。既存行があれば同じ行を更新し、
  // 案件が二重に台帳へ載らないようにする(なければ新規発行)。
  let caseId = payload.case_id || "";
  const existingRowIndex = caseId ? findLedgerRow_(caseId) : null;
  if (existingRowIndex) {
    writeLedgerFirstPass_(caseId, payload, result, calculatedEstimate, existingRowIndex);
  } else {
    caseId = Utilities.getUuid().split("-")[0];
    writeLedgerFirstPass_(caseId, payload, result, calculatedEstimate, null);
  }

  return {
    ok: true,
    case_id: caseId,
    detected_language: result.translation.detected_language,
    result: result,
  };
}

function recordRawInquiryOnFailure_(payload) {
  try {
    const inquiry = payload.inquiry || {};
    const sh = getSheet_(SHEET_LEDGER);
    const caseId = Utilities.getUuid().split("-")[0];
    const row = new Array(23).fill("");
    row[0] = caseId;
    row[1] = new Date();
    row[2] = payload.operator || "";
    row[3] = inquiry.channel || "";
    row[4] = inquiry.sender_name || "";
    row[5] = inquiry.sender_email || "";
    row[12] = "新規(AI処理失敗)";
    row[15] = inquiry.raw_text || "";
    sh.appendRow(row);
  } catch (e) {
    // 台帳記録に失敗してもエラー応答自体は返す(記録は best effort)
    Logger.log("recordRawInquiryOnFailure_ failed: " + e);
  }
}

function writeLedgerFirstPass_(caseId, payload, result, calculatedEstimate, existingRowIndex) {
  const inquiry = payload.inquiry || {};
  const sh = getSheet_(SHEET_LEDGER);
  const senderName = inquiry.sender_name || result.extraction.sender_name || "";
  const senderEmail = inquiry.sender_email || result.extraction.sender_email || "";
  const row = new Array(23).fill("");
  row[0] = caseId;
  row[1] = new Date();
  row[2] = payload.operator || "";
  row[3] = inquiry.channel || "";
  row[4] = senderName;
  row[5] = senderEmail;
  row[6] = result.extraction.country_guess || "";
  row[7] = result.translation.detected_language || "";
  row[8] = result.translation.summary_ja || "";
  row[9] = result.extraction.pleat_type_guess || "";
  row[10] = result.extraction.quantity_pieces != null ? result.extraction.quantity_pieces : "";
  row[11] = result.extraction.fabric_meters != null ? result.extraction.fabric_meters : "";
  row[12] = "新規";
  row[13] = calculatedEstimate ? calculatedEstimate.total_jpy : "";
  row[14] = !!result.risk.requires_owner_review;
  row[15] = inquiry.raw_text || "";

  if (existingRowIndex) {
    // 再実行(見積付きの返信生成): 既存行を更新する。
    // A(case_id)・B(受付日時)・M(ステータス: 社員が手動更新する列)・Q〜W(翻訳/見積計算の記録)は保持し、
    // C〜L と N〜P だけを書き換える。
    sh.getRange(existingRowIndex, 3, 1, 10).setValues([row.slice(2, 12)]);  // C〜L
    sh.getRange(existingRowIndex, 14, 1, 3).setValues([row.slice(13, 16)]); // N〜P
  } else {
    sh.appendRow(row);
  }
}

// ============================================================================
// ④ アクション2: calculate_estimate(仕様書§5-2。AIを呼ばずGASのみで計算)
// ============================================================================

function handleCalculateEstimate_(payload) {
  const caseId = payload.case_id;
  const quoteKit = payload.quote_kit || {};
  const manualLineItems = (payload.manual_line_items || []).map(function (mi) {
    return {
      source: "manual",
      label_ja: mi.label_ja || "",
      amount_jpy: Number(mi.amount_jpy) || 0,
    };
  });

  const computed = computeEstimate_(quoteKit, manualLineItems);

  if (caseId) {
    updateLedgerEstimateColumns_(caseId, computed, quoteKit);
  }

  return {
    ok: true,
    status: computed.status,
    line_items: computed.line_items,
    total_jpy: computed.total_jpy,
    fx: computed.fx,
    lead_time_weeks: computed.lead_time_weeks,
    unmatched_ja: computed.unmatched_ja,
  };
}

function numOrNull_(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// 見積もり計算本体(仕様書§5-2の計算手順1〜7)
function computeEstimate_(quoteKit, manualLineItems) {
  const unmatchedJa = [];
  const lineItems = [];

  const pleatType = quoteKit.pleat_type;
  const pleatSizeMm = numOrNull_(quoteKit.pleat_size_mm);
  const pleatCount = numOrNull_(quoteKit.pleat_count);
  const garmentLengthCm = numOrNull_(quoteKit.garment_length_cm);
  const quantityPieces = numOrNull_(quoteKit.quantity_pieces);
  const fabricMeters = numOrNull_(quoteKit.fabric_meters);
  const mold = quoteKit.mold;
  const country = quoteKit.country;

  // 1. 型代
  const moldFees = getMoldFees_();
  const moldRow = moldFees.filter(function (r) { return r.pleatType === pleatType; })[0];
  if (!moldRow) {
    unmatchedJa.push("型代表に形状「" + pleatType + "」の行がありません。");
  } else {
    const fee = mold === "new" ? moldRow.newFee : moldRow.existingFee;
    const kindLabel = mold === "new" ? "新規" : "既存";
    lineItems.push({
      source: "auto",
      label_ja: "型代(" + pleatTypeLabel_(pleatType) + "・" + kindLabel + ")",
      amount_jpy: fee,
    });
  }

  // 2. 加工費(geometric_customは常にルールなし扱い)
  if (pleatType === "geometric_custom") {
    unmatchedJa.push("変形・ジオメトリック(geometric_custom)は加工費の自動計算に対応していません。手動明細で加工費を追加してください。");
  } else {
    const rules = getProcessingRules_();
    let matchedRule = null;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.pleatType !== pleatType) continue;
      if (r.sizeToken && (pleatSizeMm === null || !matchesRange_(r.sizeToken, pleatSizeMm))) continue;
      if (r.lengthToken && (garmentLengthCm === null || !matchesRange_(r.lengthToken, garmentLengthCm))) continue;
      matchedRule = r;
      break;
    }
    if (!matchedRule) {
      unmatchedJa.push(
        "形状「" + pleatType + "」(サイズ" + (pleatSizeMm !== null ? pleatSizeMm + "mm" : "未入力") +
        "・丈" + (garmentLengthCm !== null ? garmentLengthCm + "cm" : "未入力") + ")に該当する加工単価ルールがありません。"
      );
    } else {
      const qty = matchedRule.unit === "m" ? fabricMeters : matchedRule.unit === "枚" ? quantityPieces : pleatCount;
      if (qty === null) {
        unmatchedJa.push("加工費の単位「" + matchedRule.unit + "」に対応する数量が入力されていないため計算できません。");
      } else {
        const raw = matchedRule.unitPrice * qty;
        const amount = Math.round(Math.max(raw, matchedRule.minAmount));
        const label =
          "プリーツ加工(" + (pleatSizeMm !== null ? pleatSizeMm + "mm・" : "") +
          qty + matchedRule.unit + " × " + matchedRule.unitPrice.toLocaleString() + "円)";
        lineItems.push({ source: "auto", label_ja: label, amount_jpy: amount });
      }
    }
  }

  // 3. オプション(裁断・裾上げ)
  const optionRates = getOptionRates_();
  const optionDefs = [
    { flag: "cutting", name: "裁断" },
    { flag: "hemming", name: "裾上げ" },
  ];
  optionDefs.forEach(function (def) {
    if (!quoteKit[def.flag]) return;
    const rate = optionRates.filter(function (o) { return o.name === def.name; })[0];
    if (!rate) {
      unmatchedJa.push("オプション料金表に「" + def.name + "」の行がありません。");
      return;
    }
    if (quantityPieces === null) {
      unmatchedJa.push(def.name + "の料金計算に必要な加工枚数が入力されていません。");
      return;
    }
    const amount = rate.unitPrice * quantityPieces;
    lineItems.push({
      source: "auto",
      label_ja: def.name + "(" + quantityPieces + "枚 × " + rate.unitPrice.toLocaleString() + "円)",
      amount_jpy: amount,
    });
  });

  // 4. 返送送料(概算重量ルール: 1枚150g + 梱包500g。5kg超はneeds_manual)
  if (quantityPieces === null) {
    unmatchedJa.push("送料の推定重量計算に必要な加工枚数が入力されていません。");
  } else {
    const weightKg = Math.round((quantityPieces * 0.15 + 0.5) * 100) / 100;
    if (weightKg > 5.0) {
      unmatchedJa.push("推定重量(約" + weightKg + "kg)が5kgを超えるため、送料は自動計算できません。");
    } else {
      const zoneInfo = resolveZone_(country);
      const rateTable = getShippingRateTable_();
      const rateRow = rateTable.filter(function (r) { return weightKg <= r.maxKg; })[0];
      if (!rateRow) {
        unmatchedJa.push("重量" + weightKg + "kgに該当する送料帯がありません。");
      } else {
        const amount = rateRow.rates[zoneInfo.zone];
        if (amount === undefined || amount === null || amount === "") {
          unmatchedJa.push("ゾーン" + zoneInfo.zone + "・重量" + weightKg + "kgの送料が未設定です。");
        } else {
          lineItems.push({
            source: "auto",
            label_ja: "返送送料(DHL・" + (country || "不明") + "・約" + weightKg + "kg)",
            amount_jpy: Number(amount),
          });
        }
      }
    }
  }

  // 6. 手動明細を合算
  manualLineItems.forEach(function (mi) { lineItems.push(mi); });

  // 合計
  const totalJpy = lineItems.reduce(function (sum, li) { return sum + (Number(li.amount_jpy) || 0); }, 0);

  // 為替(仕様書§5-1)
  const fxInfo = getExchangeRate_();
  const convertedTotal = Math.round(totalJpy / fxInfo.rate);
  const fx = {
    currency: "USD",
    rate: fxInfo.rate,
    converted_total: convertedTotal,
    retrieved_at: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX"),
    stale: fxInfo.stale,
  };

  // 納期
  const leadTimeWeeks = mold === "new" ? LEAD_TIME_CUSTOM_MOLD_WEEKS : LEAD_TIME_STANDARD_WEEKS;

  // 7. ステータス判定
  // unmatched_ja が残っていても、手動明細が1件以上追加されていれば「社員が補完した」ものとみなし
  // computable とする(仕様書: "unmatchedが残ったまま(かつ手動行で補われていない)場合はneeds_manual")。
  // ※ どの unmatched 項目を手動行が補っているかまでは厳密に対応付けない簡易判定。
  const status = unmatchedJa.length === 0 ? "computable" : (manualLineItems.length > 0 ? "computable" : "needs_manual");

  return { status: status, line_items: lineItems, total_jpy: totalJpy, fx: fx, lead_time_weeks: leadTimeWeeks, unmatched_ja: unmatchedJa };
}

function pleatTypeLabel_(code) {
  return PLEAT_TYPE_LABELS_JA[code] || code;
}

// 範囲文字列("3mm未満" "3〜9" "9超〜30" "〜60" "120超" 等)への一致判定
// 空欄トークンは呼び出し側で「不問」として扱う(この関数には渡さない想定)。
function matchesRange_(token, value) {
  if (!token) return true;
  token = String(token).trim();
  if (token.indexOf("〜") === -1) {
    if (token.indexOf("未満") !== -1) return value < parseFloat(token);
    if (token.indexOf("超") !== -1) return value > parseFloat(token);
    return value === parseFloat(token);
  }
  const parts = token.split("〜");
  const leftRaw = (parts[0] || "").trim();
  const rightRaw = (parts[1] || "").trim();

  let minOk = true;
  if (leftRaw) {
    const minExclusive = leftRaw.indexOf("超") !== -1;
    const minVal = parseFloat(leftRaw);
    minOk = minExclusive ? value > minVal : value >= minVal;
  }
  let maxOk = true;
  if (rightRaw) {
    const maxExclusive = rightRaw.indexOf("未満") !== -1;
    const maxVal = parseFloat(rightRaw);
    maxOk = maxExclusive ? value < maxVal : value <= maxVal;
  }
  return minOk && maxOk;
}

function resolveZone_(countryInput) {
  if (!countryInput) return { zone: 5, matched: false };
  const key = String(countryInput).trim().toLowerCase();
  const zones = getShippingZones_();
  if (zones[key] !== undefined) return { zone: zones[key], matched: true };
  return { zone: 5, matched: false }; // 未掲載国はゾーン5
}

function updateLedgerEstimateColumns_(caseId, computed, quoteKit) {
  const row = findLedgerRow_(caseId);
  if (row < 1) return; // 台帳に該当ケースが見つからない場合は計算結果のみ返す
  const sh = getSheet_(SHEET_LEDGER);
  const fx = computed.fx;
  const rateText = "USD " + fx.rate.toFixed(2) + (fx.stale ? "(手動フォールバック)" : "");
  const lineItemsText = computed.line_items
    .map(function (li) {
      return (li.source === "manual" ? "[手動] " : "") + li.label_ja + ": " + Number(li.amount_jpy).toLocaleString() + "円";
    })
    .concat(["合計: " + computed.total_jpy.toLocaleString() + "円"])
    .join("\n");
  sh.getRange(row, 21, 1, 3).setValues([[rateText, lineItemsText, JSON.stringify(quoteKit)]]);
}

// ============================================================================
// ⑤ アクション3: translate_reply(仕様書§4B)
// ============================================================================

function handleTranslateReply_(payload) {
  const caseId = payload.case_id;
  const confirmedSubjectJa = payload.confirmed_subject_ja || "";
  const confirmedBodyJa = payload.confirmed_body_ja || "";

  // §4B-5: target_language が "ja" ならAPIを呼ばずそのまま確定扱い
  if (payload.target_language === "ja") {
    if (caseId) updateLedgerTranslation_(caseId, { Q: confirmedBodyJa });
    return { ok: true, skipped: true };
  }

  const userMessage = {
    target_language: payload.target_language,
    channel: payload.channel,
    tone: payload.tone,
    subject_ja: confirmedSubjectJa,
    body_ja: confirmedBodyJa,
  };

  const apiResult = callClaude_(SYSTEM_PROMPT_TRANSLATE, userMessage, TRANSLATE_SCHEMA, 2048, 0.2);
  if (!apiResult.ok) {
    return { ok: false, error: apiResult.error };
  }
  const result = apiResult.json;

  // §4B-4: 数字整合チェック(コード側)
  const numberCheck = checkNumberConsistency_(confirmedBodyJa, result.body_translated);

  if (caseId) {
    const sentForeignText =
      (result.subject_translated ? "Subject: " + result.subject_translated + "\n\n" : "") + result.body_translated;
    updateLedgerTranslation_(caseId, {
      Q: confirmedBodyJa,
      R: sentForeignText,
      S: result.back_translation_ja,
      T: numberCheck.ok ? "OK" : "NG: " + numberCheck.missing.join(", "),
    });
  }

  return { ok: true, result: result, number_check: numberCheck };
}

// §4B-4: 数字を正規表現で抽出し、カンマ・ピリオドを除去して正規化した上で照合する
function extractNumbers_(text) {
  const matches = String(text || "").match(/[0-9][0-9,.]*/g) || [];
  return matches.map(function (m) { return m.replace(/[,.]/g, ""); });
}

function checkNumberConsistency_(jaText, translatedText) {
  const jaNums = extractNumbers_(jaText);
  const trNums = extractNumbers_(translatedText);
  const trSet = {};
  trNums.forEach(function (n) { trSet[n] = true; });
  const missing = [];
  jaNums.forEach(function (n) {
    if (!trSet[n] && missing.indexOf(n) === -1) missing.push(n);
  });
  return { ok: missing.length === 0, missing: missing };
}

function updateLedgerTranslation_(caseId, fields) {
  const row = findLedgerRow_(caseId);
  if (row < 1) return;
  const sh = getSheet_(SHEET_LEDGER);
  if (fields.Q !== undefined) sh.getRange(row, 17).setValue(fields.Q);
  if (fields.R !== undefined) sh.getRange(row, 18).setValue(fields.R);
  if (fields.S !== undefined) sh.getRange(row, 19).setValue(fields.S);
  if (fields.T !== undefined) sh.getRange(row, 20).setValue(fields.T);
}

// ============================================================================
// ⑥ Anthropic API 呼び出し(共通関数)
// ============================================================================

// systemPrompt / userMessageObj / schemaObj は呼び出し側で組み立てる。
// 戻り値: {ok:true, json:(パース済みJSON)} または {ok:false, error:"..."}
function callClaude_(systemPrompt, userMessageObj, schemaObj, maxTokens, temperature) {
  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    temperature: temperature,
    system: systemPrompt,
    messages: [{ role: "user", content: JSON.stringify(userMessageObj) }],
    output_config: { format: { type: "json_schema", schema: schemaObj } },
  };
  return callClaudeRaw_(body, maxTokens, { http: false, maxTokens: false, parse: false });
}

function callClaudeRaw_(body, maxTokens, retried) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL, options);
  const code = res.getResponseCode();
  const text = res.getContentText();

  // 429/529/5xx → 2秒待って1回だけリトライ
  if (code === 429 || code === 529 || code >= 500) {
    if (!retried.http) {
      Utilities.sleep(2000);
      retried.http = true;
      return callClaudeRaw_(body, maxTokens, retried);
    }
    return { ok: false, error: "api_error_" + code };
  }

  // 400/401 → リトライしない
  if (code === 400 || code === 401) {
    return { ok: false, error: "api_error_" + code + ": " + text };
  }

  if (code !== 200) {
    return { ok: false, error: "api_error_" + code + ": " + text };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "invalid_api_response" };
  }

  if (data.stop_reason === "refusal") {
    return { ok: false, error: "refusal" };
  }

  if (data.stop_reason === "max_tokens") {
    if (!retried.maxTokens) {
      retried.maxTokens = true;
      const newMax = Math.round(maxTokens * 1.5);
      const newBody = JSON.parse(JSON.stringify(body));
      newBody.max_tokens = newMax;
      return callClaudeRaw_(newBody, newMax, retried);
    }
    // リトライ後もmax_tokensで切れている場合はそのまま以下のパース処理へ(ベストエフォート)
  }

  const textBlock = (data.content && data.content[0] && data.content[0].text) || "";
  let parsed = tryParseJson_(textBlock);
  if (parsed === null) {
    // 保険: コードフェンス除去 → 再パース
    const stripped = textBlock.replace(/```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = tryParseJson_(stripped);
  }
  if (parsed === null) {
    if (!retried.parse) {
      retried.parse = true;
      return callClaudeRaw_(body, maxTokens, retried);
    }
    return { ok: false, error: "parse_failed" };
  }

  return { ok: true, json: parsed };
}

function tryParseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// ============================================================================
// ⑦ マスター読込・コンテキスト組み立てヘルパー
// ============================================================================

function getSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getSheetRows_(name) {
  const sh = getSheet_(name);
  const values = sh.getDataRange().getValues();
  return values.slice(1).filter(function (r) { return r[0] !== "" && r[0] !== null; });
}

function getProcessingRules_() {
  return getSheetRows_(SHEET_PROCESSING_RULES).map(function (r) {
    return {
      pleatType: String(r[0]).trim(),
      sizeToken: r[1] !== "" && r[1] != null ? String(r[1]).trim() : "",
      lengthToken: r[2] !== "" && r[2] != null ? String(r[2]).trim() : "",
      unit: String(r[3]).trim(),
      unitPrice: Number(r[4]),
      minAmount: Number(r[5]),
    };
  });
}

function getOptionRates_() {
  return getSheetRows_(SHEET_OPTION_RATES).map(function (r) {
    return { name: String(r[0]).trim(), unit: String(r[1]).trim(), unitPrice: Number(r[2]) };
  });
}

function getMoldFees_() {
  return getSheetRows_(SHEET_MOLD_FEES).map(function (r) {
    return { pleatType: String(r[0]).trim(), newFee: Number(r[1]), existingFee: Number(r[2]) };
  });
}

function getShippingZones_() {
  const map = {};
  getSheetRows_(SHEET_SHIPPING_ZONES).forEach(function (r) {
    const zone = Number(r[2]);
    if (!zone) return;
    if (r[0]) map[String(r[0]).trim().toLowerCase()] = zone;
    if (r[1]) map[String(r[1]).trim().toLowerCase()] = zone;
  });
  return map;
}

function getShippingRateTable_() {
  return getSheetRows_(SHEET_SHIPPING_RATES).map(function (r) {
    return {
      maxKg: Number(r[0]),
      rates: { 1: Number(r[1]), 2: Number(r[2]), 3: Number(r[3]), 4: Number(r[4]), 5: Number(r[5]) },
    };
  });
}

// 仕様書§5-1: レートシートB2を採用。不正値ならD2(手動フォールバック)+ stale:true
function getExchangeRate_() {
  const sh = getSheet_(SHEET_RATE);
  const raw = sh.getRange("B2").getValue();
  const num = parseFloat(raw);
  if (isFinite(num) && num > 0) {
    return { rate: num, stale: false };
  }
  const fallbackRaw = sh.getRange("D2").getValue();
  const fallback = parseFloat(fallbackRaw);
  return { rate: isFinite(fallback) && fallback > 0 ? fallback : 150, stale: true };
}

function findLedgerRow_(caseId) {
  const sh = getSheet_(SHEET_LEDGER);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === caseId) return i + 2;
  }
  return -1;
}

// 仕様書§3-2: マスター全体は渡さず、サマリーだけをAIプロンプト用に組み立てる。
// マスターシートから動的に算出するため、実数値へ差し替えれば自動的にサマリーも更新される。
function buildPricingContext_() {
  const moldFees = getMoldFees_();
  const availableTypes = moldFees.map(function (r) { return r.pleatType; });
  const newFees = moldFees.map(function (r) { return r.newFee; }).filter(function (v) { return v > 0; });
  const rules = getProcessingRules_();
  const perM = rules.filter(function (r) { return r.unit === "m"; }).map(function (r) { return r.unitPrice; });
  return {
    available_pleat_types: availableTypes,
    min_lot_note: "型により1着〜対応可",
    mold_fee_range_jpy: newFees.length ? [Math.min.apply(null, newFees), Math.max.apply(null, newFees)] : [0, 0],
    processing_fee_range_jpy_per_m: perM.length ? [Math.min.apply(null, perM), Math.max.apply(null, perM)] : [0, 0],
    lead_time_weeks: { standard: LEAD_TIME_STANDARD_WEEKS, custom_mold: LEAD_TIME_CUSTOM_MOLD_WEEKS },
  };
}

function buildShippingContext_() {
  const rateTable = getShippingRateTable_();
  const row2kg = rateTable.filter(function (r) { return r.maxKg === 2.0; })[0];
  const sampleRates = row2kg
    ? { zone_EU_2kg_jpy: row2kg.rates[2], zone_US_2kg_jpy: row2kg.rates[3], zone_AU_2kg_jpy: row2kg.rates[4] }
    : {};
  return {
    carrier: "DHL Express",
    sample_rates: sampleRates,
    note: "往復輸送。片道はお客様負担で日本へ送付",
  };
}

// ============================================================================
// ⑧ システムプロンプト(仕様書§4-1・§4B-1の全文をそのまま転記)
// ============================================================================

const SYSTEM_PROMPT_PROCESS_INQUIRY = `You are the inquiry-response engine for Ikuta Pleats Co., Ltd. (株式会社生田プリーツ), a pleating and sewing factory founded in 1976 in Saitama, Japan. The factory accepts small-lot pleating orders from overseas designers and brands.

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
2. When presenting the estimate, reproduce the itemized breakdown from calculated_estimate.line_items — every label_ja and amount_jpy exactly as given, one line per item — followed by the total. The Japanese yen amount is the binding price. Write the total as 「合計〇〇円(現在のレートで約△△米ドル)」 using calculated_estimate.total_jpy and calculated_estimate.fx.converted_total exactly as given — never compute, recompute, or adjust any amount yourself. Always add one sentence stating that payment is in Japanese yen and the converted amount is an indicative figure at today's rate.
3. NEVER promise delivery dates, discounts, or exclusivity.
4. NEVER auto-accept an order. Every reply ends with a next step that requires customer action or states that a formal quote will follow after internal confirmation.
5. If the inquiry involves fur, leather requiring CITES documentation, military/defense use, or counterfeit/replica of another brand's design, set flag "requires_owner_review" to true and generate only a holding reply ("we will get back to you"). In that case the replies array contains exactly one entry.
6. All replies are written in Japanese, regardless of the inquiry language. Write them so they translate cleanly: short sentences, no wordplay, no Japanese-only idioms. Write all numbers in Arabic numerals (算用数字), never kanji numerals.
7. Length: write so that the eventual translation fits the channel — email replies should translate to under 180 words, Instagram DM replies to under 90 words. As a guide, keep email drafts under 400 Japanese characters and DM drafts under 200.
8. Tone: warm, precise, craftsman-like. No exclamation marks except at most one. No excessive superlatives.

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
- internal_note_ja: 社員向けメモ。対応上の注意点があれば1〜2行、なければ空文字`;

const SYSTEM_PROMPT_TRANSLATE = `You are the outbound-translation engine for Ikuta Pleats Co., Ltd. (株式会社生田プリーツ), a Japanese pleating factory replying to overseas customers.

You receive a customer-service reply written and approved in Japanese. Translate it into the target language for sending to the customer. The Japanese author cannot read the target language at all, so your translation will be sent verbatim — accuracy is critical.

## Hard rules
1. Preserve every number exactly: prices, quantities, weeks, dates, percentages. Never convert currencies or units unless the Japanese text itself does.
2. Do not add, remove, or soften any commitment, condition, or request. The translation must carry exactly the same obligations as the Japanese text.
3. Natural business writing in the target language — not word-for-word literal, but faithful in content. Tone: warm, precise, craftsman-like.
4. Length limits: email body under 180 words, Instagram DM under 90 words. If the Japanese text is too long to fit, tighten the wording but NEVER drop facts, numbers, or requests. If it still cannot fit, set length_warning to true.
5. After translating, write back_translation_ja: an independent, faithful Japanese re-translation of YOUR translated text (not a copy of the input). The Japanese author will use it as their only way to verify what is being sent. If your translation deviates from the input anywhere, the back-translation must reveal it.
6. translator_note_ja: 1-2 sentences in Japanese, only if there is something the author should know (e.g. a phrase that has no direct equivalent, a culturally adjusted expression). Empty string otherwise.`;

// ============================================================================
// ⑨ structured outputs 用 JSON Schema(仕様書§4-3・§4B-3の全文をそのまま転記)
// ============================================================================

const PROCESS_INQUIRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["translation", "extraction", "risk", "replies", "internal_note_ja"],
  properties: {
    translation: {
      type: "object",
      additionalProperties: false,
      required: ["detected_language", "japanese_translation", "summary_ja"],
      properties: {
        detected_language: { type: "string" },
        japanese_translation: { type: "string" },
        summary_ja: { type: "string" },
      },
    },
    extraction: {
      type: "object",
      additionalProperties: false,
      required: [
        "sender_name", "sender_email", "country_guess", "fabric_type",
        "fabric_meters", "pleat_type_guess", "quantity_pieces",
        "deadline_mentioned", "budget_mentioned", "missing_fields",
      ],
      properties: {
        sender_name: { type: ["string", "null"] },
        sender_email: { type: ["string", "null"] },
        country_guess: { type: ["string", "null"] },
        fabric_type: { type: ["string", "null"] },
        fabric_meters: { type: ["number", "null"] },
        pleat_type_guess: { type: "string" },
        quantity_pieces: { type: ["number", "null"] },
        deadline_mentioned: { type: ["string", "null"] },
        budget_mentioned: { type: ["string", "null"] },
        missing_fields: { type: "array", items: { type: "string" } },
      },
    },
    risk: {
      type: "object",
      additionalProperties: false,
      required: ["requires_owner_review", "reason", "payment_risk_note"],
      properties: {
        requires_owner_review: { type: "boolean" },
        reason: { type: ["string", "null"] },
        payment_risk_note: { type: ["string", "null"] },
      },
    },
    replies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "subject_ja", "body_ja"],
        properties: {
          type: { type: "string", enum: ["quote", "info_request", "decline", "holding"] },
          subject_ja: { type: "string" },
          body_ja: { type: "string" },
        },
      },
    },
    internal_note_ja: { type: "string" },
  },
};

const TRANSLATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject_translated", "body_translated", "back_translation_ja", "translator_note_ja", "length_warning"],
  properties: {
    subject_translated: { type: "string" },
    body_translated: { type: "string" },
    back_translation_ja: { type: "string" },
    translator_note_ja: { type: "string" },
    length_warning: { type: "boolean" },
  },
};
