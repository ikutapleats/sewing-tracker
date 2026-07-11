/**
 * 生田プリーツ｜プリーツ加工 問い合わせ受信 バックエンド
 * ------------------------------------------------------------
 * フォーム(React/GitHub Pages)からの POST を受け、
 *   1. 添付画像を Drive フォルダへ保存
 *   2. スプレッドシート「案件台帳」に1行追記
 *   3. 受付通知メールを送信
 *   4.（任意・後付け）Anthropic API で返信案を生成
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
 * ※ メール通知(notifyNewInquiry_)は MailApp の権限が必要。
 *   下記 doPost 冒頭の「一時的なテスト用」の行を使い、
 *   このファイルをエディタで開いた状態で doPost を手動実行すると
 *   権限承認ダイアログが出る。許可した後、その1行は必ず削除すること。
 */

// ===== 設定 =====
const SHEET_NAME = "案件台帳";
const ENABLE_AI_REPLY = false; // true にすると doPost 内で返信案生成を試みる（下部参照）
const NOTIFY_EMAIL = "ikuta@iquta.com, ishii.hinata.iquta@gmail.com"; // 受付通知の送信先（カンマ区切りで複数可）
// スタッフ閲覧ページ(pleats-admin)のウェブアプリURL。通知メールに載せる。
// スクリプトプロパティ ADMIN_VIEW_URL があればそちらを優先し、無ければこの既定値を使う。
// ※ iquta.com ドメイン限定(Googleログイン保護)のため、URL単体では社外からは開けない。
// ※ 閲覧ページを「Googleアカウントを持つ全員」に開いたため、ドメイン限定形
//   (/a/macros/iquta.com/…) ではなく汎用形 (/macros/s/…) を使う。こちらは
//   iquta.com・Gmail どちらのアカウントからも開ける。
const ADMIN_VIEW_URL_DEFAULT = "https://script.google.com/macros/s/AKfycbyx59XeUZiaEMWy04cFY2bw3hTFAVWjR1Z0qv1zzP1Rmk7Ei-HhAM75dQhQ2ImD_V1S/exec";

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
  // ↓↓↓ 一時的なテスト用（権限承認が終わったら、この1行は必ず削除する）↓↓↓
  // ↑↑↑ 一時的なテスト用 ↑↑↑

  // postData が無い呼び出し（ブラウザからの直接アクセス等）を明示的に弾く
  if (!e || !e.postData || !e.postData.contents) {
    return json_({ ok: false, error: "empty" });
  }

  try {
    const payload = JSON.parse(e.postData.contents);
    const inq = payload.inquiry || {};
    const s = inq.structured || {};

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

    // 4. 受付通知メール（社員向け。失敗しても問い合わせ自体の記録は成立させる）
    try {
      notifyNewInquiry_(inq, s);
      Logger.log("通知メール送信成功: " + NOTIFY_EMAIL);
    } catch (mailErr) {
      Logger.log("通知メール送信エラー: " + mailErr);
    }

    // 5. お問い合わせ者への自動返信（お礼＋数日中に連絡）。失敗しても記録は成立させる
    try {
      sendAutoReply_(inq);
      Logger.log("自動返信メール送信: " + (inq.sender_email || "(宛先なし)"));
    } catch (arErr) {
      Logger.log("自動返信メール送信エラー: " + arErr);
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
  if (d.pleat_size) parts.push("ひだ(山〜谷) " + d.pleat_size);
  if (s.sunray_angle) parts.push("扇形角度:" + s.sunray_angle);
  if (s.crystal_fade) parts.push("途中消し:" + s.crystal_fade);
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

// ===== 受付通知メール =====
function notifyNewInquiry_(inq, s) {
  const sheetUrl = "https://docs.google.com/spreadsheets/d/" + getConfig_().sheetId + "/edit";
  // スタッフ閲覧ページ(pleats-admin)のURL。スクリプトプロパティ ADMIN_VIEW_URL に
  // 設定されていれば通知メールに載せる(任意)。未設定なら台帳リンクのみ。
  const viewUrl = PropertiesService.getScriptProperties().getProperty("ADMIN_VIEW_URL") || ADMIN_VIEW_URL_DEFAULT;
  let links = "";
  if (viewUrl) {
    links += "スタッフ閲覧ページ（画像も同じ画面で確認できます）:\n" + viewUrl + "\n\n";
  }
  links += "台帳（スプレッドシート）で詳細を確認:\n" + sheetUrl;
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "【プリーツ問い合わせ】新規受付: " + (inq.sender_name || "名前未入力"),
    body:
      "新しい問い合わせが届きました。\n\n" +
      "送信者: " + (inq.sender_name || "") + "\n" +
      "メール: " + (inq.sender_email || "") + "\n" +
      "電話: " + (inq.phone || "") + "\n" +
      "所属: " + (inq.organization || "") + "\n" +
      (s.country ? "国: " + s.country + "\n" : "") +
      "希望内容: " + (s.pleat_type_label || s.pleat_type || "") + "\n" +
      "希望納期: " + (s.deadline || "") + "\n\n" +
      links,
  });
}

// ===== お問い合わせ者への自動返信 =====
// フォーム送信者本人へ、受付のお礼と「数日中に担当者から連絡」を自動返信する。
// 英語フォーム(channel = web_form_en)には英語、それ以外は日本語で送る。
function sendAutoReply_(inq) {
  const to = String((inq && inq.sender_email) || "").trim();
  if (!to || to.indexOf("@") === -1) return; // 宛先が無ければ送らない
  const isEn = (inq.channel || "") === "web_form_en";
  const name = String((inq && inq.sender_name) || "").trim();

  let subject, body, senderName;
  if (isEn) {
    senderName = "IQUTA PLEATS";
    subject = "[IQUTA PLEATS] We have received your inquiry";
    body =
      (name ? "Dear " + name + ",\n\n" : "Hello,\n\n") +
      "Thank you for your inquiry. We have received it, and a member of our team " +
      "will contact you within a few days.\n\n" +
      "* This is an automated confirmation. Please do not reply to this message.\n\n" +
      "IQUTA PLEATS (Ikuta Pleats Co., Ltd.)";
  } else {
    senderName = "生田プリーツ";
    subject = "【生田プリーツ】お問い合わせを受け付けました";
    body =
      (name ? name + " 様\n\n" : "") +
      "この度はお問い合わせいただき、ありがとうございます。\n" +
      "内容を受け付けました。数日中に担当者よりご連絡いたします。\n\n" +
      "※このメールは自動送信です。ご返信いただいてもお答えできない場合があります。\n\n" +
      "株式会社生田プリーツ";
  }

  MailApp.sendEmail({ to: to, subject: subject, body: body, name: senderName });
}

// ===== メール送信の権限承認用 =====
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
