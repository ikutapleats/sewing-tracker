/**
 * 生田プリーツ｜プリーツ加工 問い合わせ 閲覧ページ（社内スタッフ用）
 * ------------------------------------------------------------
 * 「案件台帳」スプレッドシートの内容を、スタッフがスプレッドシートを
 * 直接開かなくても見やすいカード形式で確認できるようにする、閲覧専用ページ。
 *
 * ■ このファイルは独立したApps Scriptプロジェクトに配置すること
 *   受付側(pleats-form-receiver.gs、doPostを公開している)と同じプロジェクトに
 *   足すと、公開フォーム経由で知られているウェブアプリURLの延長線上に
 *   この閲覧ページのURLが推測されるリスクや、デプロイ管理が煩雑になる問題がある。
 *   そのため必ず別プロジェクトとして作成し、ウェブアプリのアクセス権は
 *   「自分のみ」に設定して認証を担保する（詳細は pleats-admin-deploy-guide.md）。
 *
 * ■ doPostは実装しない（閲覧専用。書き込みは受付側GASのみが行う）
 *
 * ■ 初期設定（スクリプト プロパティ）
 *   - SHEET_ID   … 受付台帳と同じスプレッドシートID（必須）
 *   - SHEET_NAME … シート名（省略時は既定値 "案件台帳" を使用）
 */

// シート名の既定値（受付側 pleats-form-receiver.gs の SHEET_NAME と揃える）
const DEFAULT_SHEET_NAME = "案件台帳";

// 台帳のヘッダー名（列の並び順が変わってもヘッダー名で参照するため、
// ここでの並び順そのものには依存しない。参照用の一覧として保持）
var EXPECTED_HEADERS = [
  "受付日時", "対応者", "チャネル", "送信者名", "メール", "電話", "所属",
  "プリーツ種類", "寸法(要約)", "流れ", "パターン", "生地", "生地幅", "数量",
  "裾上げ", "希望納期", "画像", "デザイン画", "要確認", "その他", "原文JSON", "返信案",
];

// ===== 設定読み出し =====
function getAdminConfig_() {
  const p = PropertiesService.getScriptProperties();
  const sheetId = p.getProperty("SHEET_ID");
  const sheetName = p.getProperty("SHEET_NAME") || DEFAULT_SHEET_NAME;
  if (!sheetId) throw new Error("スクリプトプロパティ SHEET_ID が未設定です。受付台帳と同じスプレッドシートIDを設定してください。");
  return { sheetId: sheetId, sheetName: sheetName };
}

// ===== 閲覧許可ゲート =====
// iquta.com ドメインのアカウントは全員許可。加えて、スクリプトプロパティ
// ALLOWED_EMAILS（カンマ/空白/改行区切り）に列挙したメール（Gmail等）も許可する。
// ※ Gmailなどドメイン外のアクセス者のメールを取得するには、ウェブアプリのデプロイを
//   「次のユーザーとして実行: ウェブアプリにアクセスしているユーザー」＋
//   「アクセスできるユーザー: Googleアカウントを持つ全員」にし、
//   台帳スプレッドシートを対象者に「閲覧者」で共有しておく必要がある（手順書参照）。
// コードに直接埋め込む許可メール（iquta.com 以外・Gmail等）。
// スクリプトプロパティ ALLOWED_EMAILS を設定すれば、この既定値に加えて許可される。
var ALLOWED_EMAILS_DEFAULT = ["ishii.hinata.iquta@gmail.com"];
function getAllowedEmails_() {
  var raw = PropertiesService.getScriptProperties().getProperty("ALLOWED_EMAILS") || "";
  var fromProp = raw.split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  var fromCode = ALLOWED_EMAILS_DEFAULT.map(function (x) { return String(x).trim().toLowerCase(); }).filter(Boolean);
  return fromCode.concat(fromProp);
}
// 許可ドメイン（このドメインのアカウントは全員許可）
var ALLOWED_DOMAIN = "@iquta.com";
function isViewerAllowed_(email) {
  if (!email) return false;
  email = String(email).trim().toLowerCase();
  // 末尾がドメインと一致すれば許可（slice の桁ずれを避け、末尾一致で厳密に判定）
  if (email.length >= ALLOWED_DOMAIN.length &&
      email.lastIndexOf(ALLOWED_DOMAIN) === email.length - ALLOWED_DOMAIN.length) {
    return true;
  }
  return getAllowedEmails_().indexOf(email) !== -1;
}
function buildDeniedHtml_(email) {
  var who = email ? escapeHtml_(email) : "（アカウント情報を取得できませんでした）";
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0;background:#FBF9F5;font-family:sans-serif;color:#26221C">' +
    '<div style="max-width:520px;margin:48px auto;padding:24px;border:1px solid #E2DCD0;border-radius:10px;background:#fff">' +
    '<h2 style="font-size:18px;margin:0 0 10px">閲覧権限がありません</h2>' +
    '<p style="font-size:14px;color:#555;line-height:1.9;margin:0">このアカウント（' + who + '）ではこのページを閲覧できません。<br>' +
    '会社（iquta.com）アカウント、または管理者に許可されたアカウントでログインしてください。</p>' +
    '<p style="font-size:12px;color:#999;line-height:1.7;margin:14px 0 0">閲覧を追加したい場合は、管理者がスクリプトプロパティ ALLOWED_EMAILS に対象メールを追加します。</p>' +
    '</div></body></html>';
}

// ===== エントリポイント（閲覧専用。doPostは実装しない）=====
function doGet(e) {
  var viewer = "";
  try { viewer = String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (x) { viewer = ""; }
  if (!isViewerAllowed_(viewer)) {
    return HtmlService.createHtmlOutput(buildDeniedHtml_(viewer))
      .setTitle("プリーツ問い合わせ 閲覧 - アクセス不可")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  try {
    const html = buildAdminHtml_();
    return HtmlService.createHtmlOutput(html)
      .setTitle("プリーツ問い合わせ 閲覧")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  } catch (err) {
    return HtmlService.createHtmlOutput(buildErrorHtml_(err))
      .setTitle("プリーツ問い合わせ 閲覧 - エラー")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
}

// ===== HTML組み立て =====
function buildAdminHtml_() {
  const cfg = getAdminConfig_();
  const ss = SpreadsheetApp.openById(cfg.sheetId);
  const sheet = ss.getSheetByName(cfg.sheetName);
  if (!sheet) {
    throw new Error('シート "' + cfg.sheetName + '" が見つかりません。SHEET_NAME の設定、または台帳の作成状況を確認してください。');
  }

  const values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) {
    return wrapPage_("<p class=\"empty\">台帳にデータがありません。</p>", 0);
  }

  const headers = values[0].map(function (h) { return String(h || "").trim(); });
  const dataRows = values.slice(1);

  // 新着順（受付日時の降順 = 台帳の下の行が新しいので、単純に逆順にする）
  const orderedRows = dataRows.slice().reverse();

  const cardsHtml = orderedRows
    .map(function (row) { return buildCardHtml_(headers, row); })
    .filter(Boolean)
    .join("\n");

  const body = cardsHtml || "<p class=\"empty\">台帳にデータがありません。</p>";
  return wrapPage_(body, orderedRows.length);
}

// 1行分のデータをヘッダー名で引けるオブジェクトに変換する
function rowToObj_(headers, row) {
  const obj = {};
  headers.forEach(function (h, i) {
    if (!h) return;
    obj[h] = row[i];
  });
  return obj;
}

function textOf_(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

// ===== カードHTML =====
function buildCardHtml_(headers, row) {
  const r = rowToObj_(headers, row);

  const receivedAt = textOf_(r["受付日時"]);
  const handler = textOf_(r["対応者"]);
  const channel = textOf_(r["チャネル"]);
  const senderName = textOf_(r["送信者名"]);
  const email = textOf_(r["メール"]);
  const phone = textOf_(r["電話"]);
  const org = textOf_(r["所属"]);
  const pleatType = textOf_(r["プリーツ種類"]);
  const dimSummary = textOf_(r["寸法(要約)"]);
  const flow = textOf_(r["流れ"]);
  const pattern = textOf_(r["パターン"]);
  const fabric = textOf_(r["生地"]);
  const fabricWidth = textOf_(r["生地幅"]);
  const quantity = textOf_(r["数量"]);
  const hem = textOf_(r["裾上げ"]);
  const deadline = textOf_(r["希望納期"]);
  const imageCol = textOf_(r["画像"]);
  const designCol = textOf_(r["デザイン画"]);
  const needsCheck = textOf_(r["要確認"]);
  const note = textOf_(r["その他"]);

  // 行全体が空（区切りだけの空行など）ならスキップ
  if (!receivedAt && !senderName && !pleatType && !imageCol && !designCol && !note) {
    return "";
  }

  const badges = [];
  if (pleatType) badges.push('<span class="badge badge-type">' + escapeHtml_(pleatType) + "</span>");
  if (needsCheck) badges.push('<span class="badge badge-warn">要確認: ' + escapeHtml_(needsCheck) + "</span>");

  const headerHtml =
    '<div class="card-head">' +
    '<div class="card-head-top">' +
    '<span class="received-at">' + escapeHtml_(receivedAt || "(受付日時未記録)") + "</span>" +
    (channel ? '<span class="channel">' + escapeHtml_(channel) + "</span>" : "") +
    "</div>" +
    '<div class="sender-name">' + escapeHtml_(senderName || "(送信者名未入力)") + "</div>" +
    (badges.length ? '<div class="badges">' + badges.join("") + "</div>" : "") +
    "</div>";

  const contactRows = [];
  if (email) contactRows.push(fieldRow_("メール", escapeHtml_(email)));
  if (phone) contactRows.push(fieldRow_("電話", escapeHtml_(phone)));
  if (org) contactRows.push(fieldRow_("所属", escapeHtml_(org)));
  if (handler) contactRows.push(fieldRow_("対応者", escapeHtml_(handler)));
  const contactHtml = contactRows.length
    ? '<div class="section"><div class="section-title">連絡先</div>' + contactRows.join("") + "</div>"
    : "";

  const detailRows = [];
  if (dimSummary) detailRows.push(fieldRow_("寸法(要約)", escapeHtml_(dimSummary)));
  if (flow) detailRows.push(fieldRow_("流れ", escapeHtml_(flow)));
  if (pattern) detailRows.push(fieldRow_("パターン", escapeHtml_(pattern)));
  if (fabric) detailRows.push(fieldRow_("生地", escapeHtml_(fabric)));
  if (fabricWidth) detailRows.push(fieldRow_("生地幅", escapeHtml_(fabricWidth)));
  if (quantity) detailRows.push(fieldRow_("数量", escapeHtml_(quantity)));
  if (hem) detailRows.push(fieldRow_("裾上げ", escapeHtml_(hem)));
  if (deadline) detailRows.push(fieldRow_("希望納期", escapeHtml_(deadline)));
  if (note) detailRows.push(fieldRow_("その他", escapeHtml_(note).replace(/\n/g, "<br>")));
  const detailHtml = detailRows.length
    ? '<div class="section"><div class="section-title">加工内容</div>' + detailRows.join("") + "</div>"
    : "";

  const imagesHtml = buildImagesSection_("画像", imageCol) + buildImagesSection_("デザイン画", designCol);

  return (
    '<article class="card">' +
    headerHtml +
    contactHtml +
    detailHtml +
    imagesHtml +
    "</article>"
  );
}

function fieldRow_(label, valueHtmlAlreadyEscaped) {
  return (
    '<div class="field">' +
    '<div class="field-label">' + escapeHtml_(label) + "</div>" +
    '<div class="field-value">' + valueHtmlAlreadyEscaped + "</div>" +
    "</div>"
  );
}

// 「画像」「デザイン画」列（複数URLが改行連結）をインライン画像として表示するHTMLを組み立てる
function buildImagesSection_(label, cellValue) {
  if (!cellValue) return "";
  const urls = cellValue
    .split("\n")
    .map(function (u) { return u.trim(); })
    .filter(Boolean);
  if (!urls.length) return "";

  const items = urls
    .map(function (url) { return buildImageItemHtml_(url); })
    .filter(Boolean);
  if (!items.length) return "";

  return (
    '<div class="section"><div class="section-title">' + escapeHtml_(label) + " (" + items.length + "枚)</div>" +
    '<div class="thumbs">' + items.join("") + "</div>" +
    "</div>"
  );
}

// 1件のURLからDrive画像のサムネイルHTMLを組み立てる。
// Driveドメイン以外・IDが抽出できないものは画像化せず、安全なテキストリンクとしてのみ表示する。
function buildImageItemHtml_(url) {
  const safeHref = escapeHtml_(url);

  if (!isDriveUrl_(url)) {
    // 想定外ドメインは画像化しない。http/https のみリンクとして許可する。
    if (/^https?:\/\//i.test(url)) {
      return '<a class="thumb thumb-fallback" href="' + safeHref + '" target="_blank" rel="noopener noreferrer">リンクを開く</a>';
    }
    return "";
  }

  const fileId = extractDriveFileId_(url);
  if (!fileId) {
    return '<a class="thumb thumb-fallback" href="' + safeHref + '" target="_blank" rel="noopener noreferrer">リンクを開く</a>';
  }

  const thumbUrl = "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w1000";
  return (
    '<a class="thumb" href="' + safeHref + '" target="_blank" rel="noopener noreferrer">' +
    '<img loading="lazy" src="' + escapeHtml_(thumbUrl) + '" alt="添付画像">' +
    "</a>"
  );
}

function isDriveUrl_(url) {
  return /^https:\/\/drive\.google\.com\//i.test(String(url || ""));
}

// Drive共有URLからファイルIDを抽出する。
// 例: https://drive.google.com/file/d/XXXXXXXXXXXXXXXXXXXXXXXXX/view?usp=drivesdk
function extractDriveFileId_(url) {
  const s = String(url || "");
  let m = s.match(/\/d\/([-\w]+)/);
  if (m && m[1]) return m[1];
  m = s.match(/[-\w]{25,}/);
  if (m && m[0]) return m[0];
  return "";
}

// ===== HTMLエスケープ（ストアドXSS対策。台帳の値は公開フォーム経由の入力のため必須）=====
function escapeHtml_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== ページ全体のラップ（デザインは pleats-form-app.jsx のブランドトークンに準拠）=====
function wrapPage_(bodyHtml, count) {
  const css =
    ":root{" +
    "--paper:#FBF9F5;--card:#FFFFFF;--ink:#26221C;--sub:#6E675B;" +
    "--line:#E2DCD0;--line-strong:#CFC7B7;--ai:#2C3E63;--ai-soft:#EAEEF5;--warn:#8A5A2B;" +
    "}" +
    "*{box-sizing:border-box;}" +
    "body{margin:0;background:var(--paper);color:var(--ink);" +
    "font-family:\"Hiragino Kaku Gothic ProN\",\"Yu Gothic\",\"Noto Sans JP\",sans-serif;" +
    "-webkit-font-smoothing:antialiased;}" +
    ".wrap{max-width:640px;margin:0 auto;padding:24px 16px 64px;}" +
    "h1{font-family:\"Hiragino Mincho ProN\",\"Yu Mincho\",serif;font-size:20px;" +
    "font-weight:600;margin:0 0 4px;color:var(--ink);}" +
    ".meta{font-size:13px;color:var(--sub);margin-bottom:20px;}" +
    ".meta .count{color:var(--ai);font-weight:600;}" +
    ".note{font-size:11px;color:var(--sub);margin-top:4px;}" +
    ".empty{color:var(--sub);font-size:14px;padding:32px 0;text-align:center;}" +
    ".card{background:var(--card);border:1px solid var(--line);border-radius:10px;" +
    "padding:18px;margin-bottom:16px;}" +
    ".card-head-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px;" +
    "font-size:12px;color:var(--sub);}" +
    ".channel{background:var(--paper);border:1px solid var(--line);border-radius:4px;" +
    "padding:1px 6px;}" +
    ".sender-name{font-size:18px;font-weight:600;margin-top:6px;color:var(--ink);}" +
    ".badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}" +
    ".badge{display:inline-block;font-size:12px;border-radius:999px;padding:3px 10px;" +
    "font-weight:600;}" +
    ".badge-type{background:var(--ai-soft);color:var(--ai);}" +
    ".badge-warn{background:#F7E9DD;color:var(--warn);}" +
    ".section{border-top:1px solid var(--line);margin-top:12px;padding-top:12px;}" +
    ".section-title{font-size:12px;color:var(--sub);font-weight:600;margin-bottom:8px;}" +
    ".field{display:flex;gap:10px;font-size:14px;line-height:1.6;padding:2px 0;}" +
    ".field-label{flex:0 0 88px;color:var(--sub);}" +
    ".field-value{flex:1;color:var(--ink);word-break:break-word;}" +
    ".thumbs{display:flex;flex-wrap:wrap;gap:8px;}" +
    ".thumb{display:block;width:110px;height:110px;border-radius:6px;overflow:hidden;" +
    "border:1px solid var(--line);background:var(--paper);}" +
    ".thumb img{width:100%;height:100%;object-fit:cover;display:block;}" +
    ".thumb-fallback{display:flex;align-items:center;justify-content:center;" +
    "font-size:12px;color:var(--ai);text-align:center;padding:4px;}";

  const html =
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>" + css + "</style></head><body>" +
    '<div class="wrap">' +
    "<h1>プリーツ加工 問い合わせ 閲覧</h1>" +
    '<div class="meta">件数: <span class="count">' + count + "</span> 件（新着順）" +
    '<div class="note">最新の状態を見るにはページを再読込してください。</div>' +
    "</div>" +
    bodyHtml +
    "</div>" +
    "</body></html>";
  return html;
}

// ===== エラーページ =====
function buildErrorHtml_(err) {
  const message = escapeHtml_(err && err.message ? err.message : String(err));
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\"><style>" +
    "body{font-family:sans-serif;background:#FBF9F5;color:#26221C;padding:32px;}" +
    ".box{max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2DCD0;" +
    "border-radius:10px;padding:24px;}" +
    "h1{font-size:16px;margin:0 0 12px;color:#8A5A2B;}" +
    "p{font-size:14px;line-height:1.7;}" +
    "</style></head><body>" +
    '<div class="box"><h1>設定エラー</h1><p>' + message + "</p>" +
    "<p>スクリプト プロパティに SHEET_ID（受付台帳と同じスプレッドシートID）が設定されているか確認してください。</p>" +
    "</div></body></html>"
  );
}
