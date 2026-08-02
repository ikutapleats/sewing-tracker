// 指示枚数（plan）ヘルパー＋裁断グリッドのロジック単体テスト。
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/saidanPlan.test.js
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
// emptyPlan/normPlan は PLAN_SIZES_DEFAULT を参照するので先に用意（本体と同値）。
const PLAN_SIZES_DEFAULT = ["XS", "S", "M", "L"];
const emptyPlan = eval("(" + extractFn("emptyPlan") + ")");
const normPlan = eval("(" + extractFn("normPlan") + ")");
const planTotal = eval("(" + extractFn("planTotal") + ")");
const planHasData = eval("(" + extractFn("planHasData") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      expected: " + e + "\n      actual:   " + a); }
}

console.log("[plan ヘルパー]");
eq("emptyPlan は4サイズ・1色", emptyPlan(), { sizes: ["XS","S","M","L"], colors: [{ name: "", counts: ["","","",""] }] });
eq("normPlan: 未定義は空plan", normPlan(undefined), emptyPlan());
eq("normPlan: counts をsizesに合わせて補正",
  normPlan({ sizes: ["S","M","L"], colors: [{ name: "白", counts: ["1","2"] }] }),
  { sizes: ["S","M","L"], colors: [{ name: "白", counts: ["1","2",""] }] });
eq("planTotal: 合計", planTotal({ sizes: ["S","M"], colors: [{ name: "白", counts: ["3","4"] }, { name: "黒", counts: ["1",""] }] }), 8);
eq("planHasData: 空はfalse", planHasData(emptyPlan()), false);
eq("planHasData: 色名だけでもtrue", planHasData({ sizes: ["S"], colors: [{ name: "白", counts: [""] }] }), true);
eq("planHasData: 枚数だけでもtrue", planHasData({ sizes: ["S"], colors: [{ name: "", counts: ["5"] }] }), true);

// ── 裁断グリッドのロジック（本体 saidan_report ブロックと同一の純粋計算を再現）──
console.log("[裁断グリッド ロジック]");
const num = (v) => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
const cellDone = (cell) => !!cell.done || (("" + (cell.n == null ? "" : cell.n)).trim() !== "");
const effCount = (cell, ins) => { const s = ("" + (cell.n == null ? "" : cell.n)).trim(); if (s !== "") return num(cell.n); return cell.done ? ins : 0; };

eq("未入力マスは未済・0枚", [cellDone({ n: "", done: false }), effCount({ n: "", done: false }, 10)], [false, 0]);
eq("チェックのみ→済み・指示数で計上", [cellDone({ n: "", done: true }), effCount({ n: "", done: true }, 10)], [true, 10]);
eq("実数入力→済み・実数で計上", [cellDone({ n: "7", done: false }), effCount({ n: "7", done: false }, 10)], [true, 7]);
eq("実数0入力も済み扱い・0枚", [cellDone({ n: "0", done: false }), effCount({ n: "0", done: false }, 10)], [true, 0]);

// グループ一括チェック（生地ごと・列ごと・行ごと・1マス）
function makePairs(colors, sizes) { const ps = []; colors.forEach((c) => sizes.forEach((s) => ps.push([c, s]))); return ps; }
function patchCells(cut, pairs, patch) {
  const nc = JSON.parse(JSON.stringify(cut));
  pairs.forEach((pr) => { const ck = pr[0], sk = pr[1]; nc[ck] = nc[ck] || {}; nc[ck][sk] = Object.assign({ n: "", done: false }, nc[ck][sk], patch); });
  return nc;
}
const colors = ["白", "黒"], sizes = ["S", "M"];
const getCell = (cut, ck, sk) => ((cut || {})[ck] || {})[sk] || { n: "", done: false };
const groupAllDone = (cut, pairs) => pairs.length > 0 && pairs.every((pr) => cellDone(getCell(cut, pr[0], pr[1])));

let cut = {};
const colPairs = colors.map((c) => [c, "S"]);          // S列を一括
cut = patchCells(cut, colPairs, { done: true });
eq("列一括チェックでS列が全済み", groupAllDone(cut, colPairs), true);
eq("M列は未済のまま", groupAllDone(cut, colors.map((c) => [c, "M"])), false);

const rowPairs = sizes.map((s) => ["白", s]);           // 白行を一括
cut = patchCells(cut, rowPairs, { done: true });
eq("行一括チェックで白行が全済み", groupAllDone(cut, rowPairs), true);

const allP = makePairs(colors, sizes);
cut = patchCells(cut, allP, { done: true });
eq("生地ごと一括で全マス済み", groupAllDone(cut, allP), true);
// 全済み→一括で外すと done=false（実数が無いマスは未済に戻る）
cut = patchCells(cut, allP, { done: false });
eq("生地ごと解除で全マス未済", groupAllDone(cut, allP), false);

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
