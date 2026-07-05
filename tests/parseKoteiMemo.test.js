// parseKoteiMemo の単体テスト（P1）
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/parseKoteiMemo.test.js
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "sewing-tracker.jsx"), "utf8");

// function 宣言を波かっこの対応で抽出する（Babel不要・単一ファイル維持のため）
function extractFn(name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error(name + " が見つかりません");
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

/* eslint-disable no-eval */
const parseKoteiMemo = eval("(" + extractFn("parseKoteiMemo") + ")");
const parseKoteiTime = eval("(" + extractFn("parseKoteiTime") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      expected: " + e + "\n      actual:   " + a); }
}
function row(part, act, time, note) { return { part: part, act: act, time: time, note: note || "" }; }

console.log("parseKoteiMemo 単体テスト");

// ── 区切り違い ──
console.log("[区切り]");
eq("半角|", parseKoteiMemo("見頃|脇はぎ|1:20"), [row("見頃", "脇はぎ", "1:20")]);
eq("全角｜", parseKoteiMemo("見頃｜脇はぎ｜1:20"), [row("見頃", "脇はぎ", "1:20")]);
eq("タブ", parseKoteiMemo("見頃\t脇はぎ\t1:20"), [row("見頃", "脇はぎ", "1:20")]);
eq("混在（行ごとに違う区切り）",
  parseKoteiMemo("見頃｜脇はぎ｜1:20\n袖|袖付け|2:05\nカフス\tカフス付け\t0:45"),
  [row("見頃", "脇はぎ", "1:20"), row("袖", "袖付け", "2:05"), row("カフス", "カフス付け", "0:45")]);
eq("区切り前後の空白はトリム", parseKoteiMemo("見頃 ｜ 脇はぎ ｜ 1:20"), [row("見頃", "脇はぎ", "1:20")]);

// ── 時間表記 ──
console.log("[時間]");
eq("1:32 はそのまま", parseKoteiMemo("見頃｜脇はぎ｜1:32"), [row("見頃", "脇はぎ", "1:32")]);
eq("1'32 → 1:32 に正規化", parseKoteiMemo("見頃｜脇はぎ｜1'32"), [row("見頃", "脇はぎ", "1:32")]);
eq("全角アポストロフィ 1’32 → 1:32", parseKoteiMemo("見頃｜脇はぎ｜1’32"), [row("見頃", "脇はぎ", "1:32")]);
eq("プライム 1′32 → 1:32", parseKoteiMemo("見頃｜脇はぎ｜1′32"), [row("見頃", "脇はぎ", "1:32")]);
eq("92（秒）はそのまま", parseKoteiMemo("見頃｜脇はぎ｜92"), [row("見頃", "脇はぎ", "92")]);
eq("全角数字・全角コロン １：３２ → 1:32", parseKoteiMemo("見頃｜脇はぎ｜１：３２"), [row("見頃", "脇はぎ", "1:32")]);
eq("時間空欄は空のまま", parseKoteiMemo("見頃｜脇はぎ｜"), [row("見頃", "脇はぎ", "")]);
eq("時間列なし（2列）も空のまま", parseKoteiMemo("見頃｜脇はぎ"), [row("見頃", "脇はぎ", "")]);
// 既存 parseKoteiTime との整合（値の解釈は既存関数に委ねる）
eq("parseKoteiTime('1:32')=92秒", parseKoteiTime("1:32"), 92);
eq("正規化後の 1'32 も92秒", parseKoteiTime(parseKoteiMemo("a｜b｜1'32")[0].time), 92);
eq("秒表記 92 も92秒", parseKoteiTime(parseKoteiMemo("a｜b｜92")[0].time), 92);

// ── パーツ継承 ──
console.log("[パーツ継承]");
eq("空欄は直前を継承",
  parseKoteiMemo("見頃｜脇はぎ｜1:20\n｜後中心はぎ｜1:05\n｜ロック｜0:40"),
  [row("見頃", "脇はぎ", "1:20"), row("見頃", "後中心はぎ", "1:05"), row("見頃", "ロック", "0:40")]);
eq("新しいパーツが出たら継承元が切り替わる",
  parseKoteiMemo("見頃｜脇はぎ｜1:20\n｜ロック｜0:40\n袖｜袖付け｜2:05\n｜袖口三巻き｜1:10"),
  [row("見頃", "脇はぎ", "1:20"), row("見頃", "ロック", "0:40"), row("袖", "袖付け", "2:05"), row("袖", "袖口三巻き", "1:10")]);
eq("先頭行がパーツ空欄なら空のまま", parseKoteiMemo("｜糸始末｜0:30"), [row("", "糸始末", "0:30")]);
eq("区切りの無い行は1列目＝パーツ扱い（見出し行として継承される）",
  parseKoteiMemo("見頃\n｜脇はぎ｜1:20"),
  [row("見頃", "", ""), row("見頃", "脇はぎ", "1:20")]);

// ── 空行 ──
console.log("[空行]");
eq("空行・空白のみの行は無視",
  parseKoteiMemo("\n見頃｜脇はぎ｜1:20\n\n   \n｜ロック｜0:40\n\n"),
  [row("見頃", "脇はぎ", "1:20"), row("見頃", "ロック", "0:40")]);
eq("CRLF改行も可", parseKoteiMemo("見頃｜脇はぎ｜1:20\r\n｜ロック｜0:40"),
  [row("見頃", "脇はぎ", "1:20"), row("見頃", "ロック", "0:40")]);
eq("空文字は空配列", parseKoteiMemo(""), []);
eq("null/undefined は空配列", parseKoteiMemo(null).concat(parseKoteiMemo(undefined)), []);

// ── その他 ──
console.log("[その他]");
eq("4列目以降は note へ（捨てない）",
  parseKoteiMemo("見頃｜脇はぎ｜1:20｜ステッチ幅注意"),
  [row("見頃", "脇はぎ", "1:20", "ステッチ幅注意")]);
eq("読めない時間もそのまま残す（リーダーが見直す）",
  parseKoteiMemo("見頃｜脇はぎ｜だいたい1分"),
  [row("見頃", "脇はぎ", "だいたい1分")]);

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
