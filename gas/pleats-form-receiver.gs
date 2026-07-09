sheet.appendRow([...]);

// ここから追加
try {
  MailApp.sendEmail({
    to: "ikuta@iquta.com",
    subject: "【プリーツ問い合わせ】新規受付: " + (inq.sender_name || "名前未入力"),
    body:
      "新しい問い合わせが届きました。\n\n" +
      "送信者: " + (inq.sender_name || "") + "\n" +
      "メール: " + (inq.sender_email || "") + "\n" +
      "希望内容: " + (s.pleat_type_label || s.pleat_type || "") + "\n" +
      "希望納期: " + (s.deadline || "") + "\n\n" +
      "台帳で詳細を確認してください:\n" +
      "https://docs.google.com/spreadsheets/d/1o6erb43bYenC2sZfN3Un1zag6-hR6zeI5U8cOvmF2FA/edit",
  });
} catch (mailErr) {
  // 通知メール失敗は問い合わせ自体の記録失敗にしない
}
// ここまで追加

return json_({ ok: true });
