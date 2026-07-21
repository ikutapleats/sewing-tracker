/**
 * 生田プリーツ｜プリーツ加工 問い合わせ受信 バックエンド
 * ------------------------------------------------------------
 * フォーム(React/Vercel)からの POST を受け、
 *   1. 添付画像を Drive フォルダへ保存
 *   2. スプレッドシート「案件台帳」に1行追記
 *   3. 社内向け受付通知メールを送信（NOTIFY_EMAIL宛）
 *   4. お客様向け自動返信メールを送信（sender_email宛・必須）
 *   5.（任意・後付け）Anthropic API で返信案を生成
 * を行う。
 *
 * ■ 初期設定
 *   1. Google スプレッドシートを1つ用意し、そのIDを控える
 *   2. Drive に保存先フォルダを作り、そのIDを控える
 *   3. Apps Scriptエディタの「プロジェクトの設定」(歯車アイコン) > 「スクリプト プロパティ」で
 *      以下の2つを登録する（コードに直書きしない）
 *        - SHEET_ID        … ①のスプレッドシートID
 *        - DRIVE_FOLDER_ID … ②のDriveフォルダID
 *   4. デプロイ > 新しいデプロイ > 種類「ウェブアプリ」
 *        - 実行するユーザー: 自分
 *        - アクセスできるユーザー: 全員
 *      → 発行された /exec URL をフォームの ENDPOINT に貼る
 *   5. フォームから1件テスト送信し、台帳に行が増えることを確認
 *
 * ※ 本エンドポイントは公開フォームの受け口であり、フォーム側は
 *   no-cors の「投げっぱなし」送信で応答を読まない設計のため、
 *   認証トークンは付与しない（既存方針どおり）。
 *
 * ※ メール送信(MailApp)は権限承認済み（authorizeMailApp_ で承認済み）。
 */

// ===== 設定 =====
const SHEET_NAME = "案件台帳";
const ENABLE_AI_REPLY = false; // true にすると doPost 内で返信案生成を試みる（下部参照）
const NOTIFY_EMAIL = "ikuta@iquta.com"; // 社内向け受付通知の送信先

// 社内向け 問い合わせ閲覧ページ（通知メールに記載する）
const INQUIRY_VIEWER_URL = "https://script.google.com/a/macros/iquta.com/s/AKfycbyx59XeUZiaEMWy04cFY2bw3hTFAVWjR1Z0qv1zzP1Rmk7Ei-HhAM75dQhQ2ImD_V1S/exec";

// お客様向け 自動返信の署名に載せる会社サイトURL
const COMPANY_SITE_URL = "https://www.iqutapleats.com/";

// 台帳のヘッダー（spec 6章に対応）
const HEADERS = [
  "受付日時", "対応者", "チャネル", "送信者名", "メール", "電話", "所属",
  "プリーツ種類", "寸法(要約)", "流れ", "パターン", "生地", "生地幅", "数量",
  "裾上げ", "希望納期", "画像", "デザイン画", "要確認", "その他", "原文JSON", "返信案",
];

// スクリプト プロパティから設定値を読み出す。
// SHEET_ID / DRIVE_FOLDER_ID をコードに直書きしないための入口。
function getConfig_() {
  const p = PropertiesService.getScriptProperties();
  const sheetId = p.getProperty("SHEET_ID");
  const folderId = p.getProperty("DRIVE_FOLDER_ID");
  if (!sheetId || !folderId) throw new Error("スクリプトプロパティ SHEET_ID / DRIVE_FOLDER_ID を設定してください");
  return { sheetId: sheetId, folderId: folderId };
}

function doPost(e) {
  // postData が無い呼び出し（ブラウザからの直接アクセス等）を明示的に弾く
  if (!e || !e.postData || !e.postData.contents) {
    return json_({ ok: false, error: "empty" });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const inq = payload.inquiry || {};
    const s = inq.structured || {};

    // 0. メールアドレスは必須。空なら記録だけ残して弾く
    if (!inq.sender_email) {
      getSheet_().appendRow([
        Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm"),
        "", "ERROR", inq.sender_name || "", "", inq.phone || "", inq.organization || "",
        "", "", "", "", "", "", "", "", "", "", "", "要確認",
        "メールアドレス未入力のため自動返信不可", JSON.stringify(payload), "",
      ]);
      return json_({ ok: false, error: "sender_email required" });
    }

    // 1. 添付を Drive へ保存 → URL配列
    const folder = getSubfolder_(inq.sender_name || "unknown");
    const imageUrls = saveFiles_(folder, s.image_files);
    const designUrls = saveFiles_(folder, s.design_files);

    // 2. 寸法の要約テキスト化
    const dimText = summarizeDimensions_(s);

    // 3. 台帳へ追記
    const sheet = getSheet_();
    const now = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm");
    let reply = "";

    // 3b.（任意）返信案の生成。まずは無効。準備が整ったら ENABLE_AI_REPLY = true
    if (ENABLE_AI_REPLY) {
      try { reply = generateReply_(payload); } catch (err) { reply = "（返信案の生成に失敗: " + err + "）"; }
    }

    sheet.appendRow([
      now,
      "",                                   // 対応者（社員が手動）
      inq.channel || "web_form",
      inq.sender_name || "",
      inq.sender_email || "",
      inq.phone || "",
      inq.organization || "",
      s.pleat_type_label || s.pleat_type || "",
      dimText,
      s.flow_direction || "",
      s.pattern || "",
      s.fabric || "",
      s.fabric_width || "",
      s.quantity || "",
      [(s.hem_finish || []).join("・"), s.hem_finish_other].filter(Boolean).join(" / "),
      s.deadline || "",
      imageUrls.join("\n"),
      designUrls.join("\n"),
      "",                                   // 要確認フラグ（AI or 社員）
      s.note || "",
      JSON.stringify(payload),
      reply,
    ]);

    // 4. 社内向け受付通知メール（失敗しても問い合わせ自体の記録は成立させる）
    try {
      notifyNewInquiry_(inq, s);
      Logger.log("通知メール送信成功: " + NOTIFY_EMAIL);
    } catch (mailErr) {
      Logger.log("通知メール送信エラー: " + mailErr);
    }

    // 5. お客様向け自動返信メール（失敗しても記録・通知には影響しない）
    try {
      sendConfirmationToSender_(inq);
      Logger.log("自動返信送信成功: " + inq.sender_email);
    } catch (confirmErr) {
      Logger.log("自動返信エラー: " + confirmErr);
    }

    return json_({ ok: true });
  } catch (err) {
    // 失敗時も原文だけは記録して取りこぼしを防ぐ
    try {
      getSheet_().appendRow([
        Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm"),
        "", "ERROR", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "要確認",
        "受信処理でエラー: " + err, (e && e.postData && e.postData.contents) || "", "",
      ]);
    } catch (_) {}
    return json_({ ok: false, error: String(err) });
  }
}

// ===== ヘルパー =====

function getSheet_() {
  const ss = SpreadsheetApp.openById(getConfig_().sheetId);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getSubfolder_(name) {
  const parent = DriveApp.getFolderById(getConfig_().folderId);
  const label = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmm") + "_" + sanitize_(name);
  return parent.createFolder(label);
}

function saveFiles_(folder, files) {
  if (!files || !files.length) return [];
  return files.map(function (f) {
    if (!f || !f.data) return "";
    const bytes = Utilities.base64Decode(f.data);
    const blob = Utilities.newBlob(bytes, f.mime || "application/octet-stream", f.name || "file");
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  }).filter(Boolean);
}

function summarizeDimensions_(s) {
  const d = s.dimensions || {};
  const parts = [];
  const pair = function (label, obj) {
    if (!obj) return;
    const vals = Object.keys(obj).map(function (k) { return obj[k] ? k + ":" + obj[k] : ""; }).filter(Boolean);
    if (vals.length) parts.push(label + " " + vals.join(" "));
  };
  pair("ウエスト", d.waist);
  pair("裾", d.hem);
  if (d.length) parts.push("丈 " + d.length);
  if (s.multi_types && s.multi_types.length) parts.push("希望:" + s.multi_types.join("・"));
  if (s.multi_detail) parts.push(s.multi_detail);
  if (s.other_detail) parts.push(s.other_detail);
  return parts.join(" / ");
}

function sanitize_(x) {
  return String(x || "").replace(/[\\\/:*?"<>|\s]/g, "_").slice(0, 40);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ===== 社内向け 受付通知メール =====
function notifyNewInquiry_(inq, s) {
  const sheetUrl = "https://docs.google.com/spreadsheets/d/" + getConfig_().sheetId + "/edit";
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "【プリーツ問い合わせ】新規受付: " + (inq.sender_name || "名前未入力"),
    body:
      "新しい問い合わせが届きました。\n\n" +
      "送信者: " + (inq.sender_name || "") + "\n" +
      "メール: " + (inq.sender_email || "") + "\n" +
      "電話: " + (inq.phone || "") + "\n" +
      "所属: " + (inq.organization || "") + "\n" +
      "希望内容: " + (s.pleat_type_label || s.pleat_type || "") + "\n" +
      "希望納期: " + (s.deadline || "") + "\n\n" +
      "▼ 問い合わせ対応ページで確認:\n" + INQUIRY_VIEWER_URL + "\n\n" +
      "▼ 台帳(スプレッドシート)で確認:\n" + sheetUrl,
  });
}

// ===== お客様向け 自動返信メール =====
function sendConfirmationToSender_(inq) {
  MailApp.sendEmail({
    to: inq.sender_email,
    subject: "【生田プリーツ】お問い合わせを受け付けました",
    body:
      (inq.sender_name ? inq.sender_name + " 様\n\n" : "") +
      "この度はお問い合わせいただき、誠にありがとうございます。\n" +
      "お問い合わせ内容を受け付けました。\n\n" +
      "内容を確認のうえ、担当者よりあらためてご連絡いたします。\n" +
      "確認や見積もりのため、追加でお伺いすることがございます。\n" +
      "今しばらくお待ちくださいますようお願いいたします。\n\n" +
      "※このメールは自動送信です。心当たりのない場合は破棄してください。\n\n" +
      "-----\n" +
      "生田プリーツ株式会社\n" +
      COMPANY_SITE_URL + "\n",
  });
}

// ===== メール送信の権限承認用（手動実行専用）=====
function authorizeMailApp_() {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "【テスト】権限承認用メール",
    body: "このメールが届けば、MailAppの権限承認は正常に完了しています。",
  });
}

// ===== 返信案生成（任意・後付け）=====
// ENABLE_AI_REPLY = true でこの関数が doPost から呼ばれる。
// APIキーは スクリプトのプロパティ に ANTHROPIC_API_KEY として保存すること
// （プロジェクトの設定 > スクリプト プロパティ）。コードに直書きしない。
function generateReply_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
  if (!key) throw new Error("APIキー未設定");

  // ※ inquiry-app-spec の返信生成プロンプトをここに移植する。
  //   まずは要点の日本語要約だけを返す簡易版でも良い。
  const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: "あなたは生田プリーツの問い合わせ返信ドラフト作成担当。以下のJSONを読み、丁寧な日本語の返信案を1つだけ作る。決まっていない金額や納期は勝手に約束しない。",
      messages: [{ role: "user", content: JSON.stringify(payload.inquiry) }],
    }),
  });
  const data = JSON.parse(res.getContentText());
  return (data.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
}
