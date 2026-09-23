// groupByKey / ymLabel / sortMonthKeys の単体テスト
// （完了ボックス・サンプル管理の月別グループ表示で共用するヘルパー）
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/sampleMonthGroups.test.js
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
const groupByKey = eval("(" + extractFn("groupByKey") + ")");
const ymLabel = eval("(" + extractFn("ymLabel") + ")");
const sortMonthKeys = eval("(" + extractFn("sortMonthKeys") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      expected: " + e + "\n      actual:   " + a); }
}

const NO_DATE = "日付未設定";

console.log("[groupByKey]");
{
  const samples = [
    { id: "s1", createdAt: "2026-09-01" },
    { id: "s2", createdAt: "2026-09-15" },
    { id: "s3", createdAt: "2026-08-20" },
    { id: "s4", createdAt: "" },
    { id: "s5" }, // createdAt 未設定
  ];
  const groups = groupByKey(samples, (p) => (p.createdAt || "").slice(0, 7) || NO_DATE);
  eq("createdAt の年月でグループ化される", Object.keys(groups).sort(), ["2026-08", "2026-09", NO_DATE].sort());
  eq("2026-09 グループに s1,s2 が入る", groups["2026-09"].map((p) => p.id), ["s1", "s2"]);
  eq("2026-08 グループに s3 が入る", groups["2026-08"].map((p) => p.id), ["s3"]);
  eq("createdAt が空/未設定は「日付未設定」に入る", groups[NO_DATE].map((p) => p.id), ["s4", "s5"]);
}

console.log("[ymLabel]");
eq('ymLabel("2026-09") === "2026年9月"', ymLabel("2026-09"), "2026年9月");
eq('ymLabel("2026-01") === "2026年1月"', ymLabel("2026-01"), "2026年1月");
eq("ymLabel(日付未設定) はそのまま返る", ymLabel(NO_DATE), NO_DATE);

console.log("[sortMonthKeys]");
eq("新しい順に並び、日付未設定は最後",
  sortMonthKeys(["2026-07", "2026-09", "2026-08", NO_DATE], NO_DATE),
  ["2026-09", "2026-08", "2026-07", NO_DATE]);
eq("日付未設定キーが無ければ月だけ新しい順",
  sortMonthKeys(["2026-07", "2026-09", "2026-08"], NO_DATE),
  ["2026-09", "2026-08", "2026-07"]);
eq("空配列は空配列", sortMonthKeys([], NO_DATE), []);

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
