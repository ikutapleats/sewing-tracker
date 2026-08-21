// 日報の工程チェック（担当した工程だけ記録する）の単体テスト。
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/koteiStepPicked.test.js
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
const koteiStepPicked = eval("(" + extractFn("koteiStepPicked") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      期待: " + e + "\n      実際: " + a); }
}

console.log("[koteiStepPicked]");
eq("チェック済み・枚数1以上は記録する", koteiStepPicked({}, "s1", 3), true);
eq("チェックを外した工程は記録しない", koteiStepPicked({ s1: true }, "s1", 3), false);
eq("枚数0は記録しない（従来どおり）", koteiStepPicked({}, "s1", 0), false);
eq("枚数未入力(NaN)は記録しない（従来どおり）", koteiStepPicked({}, "s1", NaN), false);
eq("マイナス枚数は記録しない（従来どおり）", koteiStepPicked({}, "s1", -1), false);
eq("offMapが無くても動く", koteiStepPicked(undefined, "s1", 2), true);
eq("チェックを戻した(false)工程は記録する", koteiStepPicked({ s1: false }, "s1", 2), true);

// 保存側と同じ組み立て（統合入力 saveEntry の工程ループと同一アルゴリズム）。
// パーツ名は空欄なら直前行を継承する既存ルール。
function buildKoteiRecs(steps, qtyMap, offMap) {
  const recs = [];
  let curPart = "";
  steps.forEach(function (b) {
    if (b.part) curPart = b.part;
    const q = parseFloat(qtyMap[b.id]);
    if (!koteiStepPicked(offMap, b.id, q)) return;
    recs.push({
      id: "id_" + b.id, date: "2026-08-04", memberId: "m1", memberName: "みほ",
      partId: "P1", stepId: b.id, stepPart: curPart, stepAct: b.act || "",
      stepSec: parseInt(b.time, 10) || 0, qty: q,
      totalSec: 600, unitPrice: 1200, pleatsPrice: 200,
    });
  });
  return recs;
}

const steps = [
  { id: "s1", part: "前身頃", act: "ダーツ", time: "60" },
  { id: "s2", act: "見返し", time: "90" },
  { id: "s3", part: "後身頃", act: "裾", time: "120" },
  { id: "s4", act: "脇", time: "45" },
];
const allQty = { s1: "10", s2: "10", s3: "10", s4: "10" };

console.log("\n[パーツまとめ入力の組み立て]");
const all = buildKoteiRecs(steps, allQty, {});
eq("全チェックなら従来どおり全工程が記録される", all.map(function (r) { return r.stepId; }), ["s1", "s2", "s3", "s4"]);
eq("レコードのフィールド構成は従来と同一", Object.keys(all[0]).sort(),
  ["date", "id", "memberId", "memberName", "partId", "pleatsPrice", "qty", "stepAct", "stepPart", "stepSec", "stepId", "totalSec", "unitPrice"].sort());
eq("パーツ名の継承は変わらない", all.map(function (r) { return r.stepPart; }), ["前身頃", "前身頃", "後身頃", "後身頃"]);

const some = buildKoteiRecs(steps, allQty, { s2: true, s4: true });
eq("2工程を外すと外した分のレコードが作られない", some.map(function (r) { return r.stepId; }), ["s1", "s3"]);
eq("残った工程の中身は全チェック時と同じ", some, all.filter(function (r) { return r.stepId === "s1" || r.stepId === "s3"; }));
eq("全部外すと1件も作られない", buildKoteiRecs(steps, allQty, { s1: true, s2: true, s3: true, s4: true }).length, 0);
eq("チェックしても枚数が無ければ作られない", buildKoteiRecs(steps, {}, {}).length, 0);

// 本体のレコード生成箇所が、テストが前提とするフィールド構成のままかを見張る
console.log("\n[本体ソースのフィールド構成]");
const expectKeys = ["id", "date", "memberId", "memberName", "partId", "stepId", "stepPart", "stepAct", "stepSec", "qty", "totalSec", "unitPrice", "pleatsPrice"];
["newRecs.push({", "koteiRecs.push({"].forEach(function (marker) {
  const st = src.indexOf(marker);
  if (st < 0) { fail++; console.log("  NG  " + marker + " が見つかりません"); return; }
  const body = src.slice(st + marker.length, src.indexOf("});", st));
  const keys = (body.match(/(^|[\s,])([A-Za-z]+):/g) || []).map(function (m) { return m.replace(/[\s,:]/g, ""); });
  eq(marker + " のフィールド", keys, expectKeys);
});

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
