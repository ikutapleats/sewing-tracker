// 工程時間の訂正を過去記録へ反映（koteiResyncDiff）の単体テスト。
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/koteiResyncDiff.test.js
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "sewing-tracker.jsx"), "utf8");

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
// koteiResyncDiff は内部で parseKoteiTime を呼ぶため、先にグローバルへ用意しておく
global.parseKoteiTime = eval("(" + extractFn("parseKoteiTime") + ")");
const koteiResyncDiff = eval("(" + extractFn("koteiResyncDiff") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      期待: " + e + "\n      実際: " + a); }
}

console.log("[koteiResyncDiff]");

// (a) 変更した工程・2件の記録が食い違う → 1件の差分、recCount/qty/oldSec/newSecが正しい
const sheetA = { id: "sh1", partId: "P1", blocks: [
  { id: "s1", type: "step", part: "前身頃", act: "衿つくり", time: "38" },
] };
const recsA = [
  { id: "r1", partId: "P1", stepId: "s1", stepSec: 45, qty: 10 },
  { id: "r2", partId: "P1", stepId: "s1", stepSec: 45, qty: 14 },
];
const diffA = koteiResyncDiff(sheetA, recsA, null);
eq("(a) 1件の差分が検出される", diffA.length, 1);
eq("(a) name/oldSec/newSec/recCount/qty", { name: diffA[0].name, oldSec: diffA[0].oldSec, newSec: diffA[0].newSec, recCount: diffA[0].recCount, qty: diffA[0].qty },
  { name: "前身頃 衿つくり", oldSec: 45, newSec: 38, recCount: 2, qty: 24 });
eq("(a) oldSecQtyは実際の記録ごとの積算", diffA[0].oldSecQty, 45 * 10 + 45 * 14);
eq("(a) matchはpartIdとstepIdの組", diffA[0].match, { partId: "P1", stepId: "s1" });

// (b) 別品番の同名工程（同じstepId・同じ工程名）は絶対に混ざらない（最重要）
const sheetB = { id: "sh2", partId: "P2", blocks: [
  { id: "s1", type: "step", part: "前身頃", act: "衿つくり", time: "38" }, // sheetAと同じstepId・同じ表示名
] };
const recsB = recsA.concat([
  { id: "r3", partId: "P2", stepId: "s1", stepSec: 45, qty: 999 }, // 別品番。sheetAのdiffには絶対に入らない
]);
const diffA2 = koteiResyncDiff(sheetA, recsB, null);
eq("(b) 別品番の記録を混ぜてもP1側のqtyは変わらない", diffA2[0].qty, 24);
eq("(b) 別品番の記録を混ぜてもrecCountは変わらない", diffA2[0].recCount, 2);
const diffB = koteiResyncDiff(sheetB, recsB, null);
eq("(b) P2側はP2の記録だけを見る", { recCount: diffB[0].recCount, qty: diffB[0].qty }, { recCount: 1, qty: 999 });

// (c) onlyStepIds指定時は、対象外のstepは無視される
const sheetC = { id: "sh3", partId: "P3", blocks: [
  { id: "s1", type: "step", part: "前", act: "工程1", time: "38" },
  { id: "s2", type: "step", part: "前", act: "工程2", time: "72" },
] };
const recsC = [
  { id: "r1", partId: "P3", stepId: "s1", stepSec: 45, qty: 10 },
  { id: "r2", partId: "P3", stepId: "s2", stepSec: 60, qty: 10 },
];
const diffCAll = koteiResyncDiff(sheetC, recsC, null);
eq("(c) onlyStepIds無指定なら両方検出", diffCAll.map((d) => d.stepId).sort(), ["s1", "s2"]);
const diffCOnly = koteiResyncDiff(sheetC, recsC, ["s1"]);
eq("(c) onlyStepIds指定時は指定外を無視", diffCOnly.map((d) => d.stepId), ["s1"]);

// (d) すでに新秒数と一致している記録は除外される
const sheetD = { id: "sh4", partId: "P4", blocks: [{ id: "s1", type: "step", part: "", act: "工程", time: "38" }] };
const recsD = [
  { id: "r1", partId: "P4", stepId: "s1", stepSec: 38, qty: 5 }, // 既に一致→対象外
  { id: "r2", partId: "P4", stepId: "s1", stepSec: 45, qty: 5 }, // 食い違い
];
const diffD = koteiResyncDiff(sheetD, recsD, null);
eq("(d) 一致済みレコードは対象から外れる", diffD[0].recCount, 1);
eq("(d) 対象qtyも一致済み分を含まない", diffD[0].qty, 5);

// (e) 秒数が空欄・0の工程はGASも無視するのでスキップ
const sheetE = { id: "sh5", partId: "P5", blocks: [
  { id: "s1", type: "step", part: "", act: "空欄", time: "" },
  { id: "s2", type: "step", part: "", act: "ゼロ", time: "0" },
  { id: "s3", type: "step", part: "", act: "読めない表記", time: "a:1" }, // parseKoteiTimeがNaNを返す
] };
const recsE = [
  { id: "r1", partId: "P5", stepId: "s1", stepSec: 10, qty: 1 },
  { id: "r2", partId: "P5", stepId: "s2", stepSec: 10, qty: 1 },
  { id: "r3", partId: "P5", stepId: "s3", stepSec: 10, qty: 1 },
];
eq("(e) 空欄・0秒・NaNの工程は検出されない", koteiResyncDiff(sheetE, recsE, null).length, 0);

// (f) 記録ごとにstepSecがバラバラな場合はoldSecがnullでmin/maxが入る
const sheetF = { id: "sh6", partId: "P6", blocks: [{ id: "s1", type: "step", part: "", act: "混在", time: "50" }] };
const recsF = [
  { id: "r1", partId: "P6", stepId: "s1", stepSec: 40, qty: 3 },
  { id: "r2", partId: "P6", stepId: "s1", stepSec: 60, qty: 4 },
];
const diffF = koteiResyncDiff(sheetF, recsF, null);
eq("(f) 旧秒数がバラバラならoldSecはnull", diffF[0].oldSec, null);
eq("(f) oldSecMin/oldSecMax", { min: diffF[0].oldSecMin, max: diffF[0].oldSecMax }, { min: 40, max: 60 });

// (g) sketchブロックは無視される
const sheetG = { id: "sh7", partId: "P7", blocks: [
  { id: "sk1", type: "sketch", imgId: "img1" },
  { id: "s1", type: "step", part: "", act: "本体", time: "38" },
] };
const recsG = [{ id: "r1", partId: "P7", stepId: "s1", stepSec: 45, qty: 2 }];
const diffG = koteiResyncDiff(sheetG, recsG, null);
eq("(g) sketchブロックは検出対象に含まれない", diffG.map((d) => d.stepId), ["s1"]);

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
