// 入力1回ぶんのまとまり（entryId）と、その復元・枚数修正の単体テスト。
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/koteiEntryGroups.test.js
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
const koteiEntryKey = eval("(" + extractFn("koteiEntryKey") + ")");
const koteiEntryGroups = eval("(" + extractFn("koteiEntryGroups") + ")");
const koteiStepGroups = eval("(" + extractFn("koteiStepGroups") + ")");
const koteiSheetSteps = eval("(" + extractFn("koteiSheetSteps") + ")");
const koteiStepPartMap = eval("(" + extractFn("koteiStepPartMap") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      期待: " + e + "\n      実際: " + a); }
}

function rec(o) {
  return Object.assign({ date: "2026-08-20", memberId: "m1", partId: "P1", stepPart: "前身頃", qty: 10 }, o);
}

console.log("[entryIdでまとめる]");
const withId = [
  rec({ id: "r1", entryId: "E1", stepId: "s1" }),
  rec({ id: "r2", entryId: "E1", stepId: "s2" }),
  rec({ id: "r3", entryId: "E2", stepId: "s3", stepPart: "後身頃", qty: 5 }),
];
const g1 = koteiEntryGroups(withId);
eq("entryIdごとに分かれる", g1.map(function (g) { return g.recs.length; }), [2, 1]);
eq("パーツ名がまとまりの見出しになる", g1.map(function (g) { return g.partLabel; }), ["前身頃", "後身頃"]);
eq("枚数が揃っていれば sameQty に出る", g1.map(function (g) { return g.sameQty; }), [10, 5]);

const mixedQty = koteiEntryGroups([
  rec({ id: "r1", entryId: "E1", stepId: "s1", qty: 10 }),
  rec({ id: "r2", entryId: "E1", stepId: "s2", qty: 5 }),
]);
eq("枚数がバラバラなら sameQty は null", mixedQty[0].sameQty, null);
eq("のべ枚数は合計になる", mixedQty[0].totalQty, 15);

const twoParts = koteiEntryGroups([
  rec({ id: "r1", entryId: "E1", stepId: "s1", stepPart: "前身頃" }),
  rec({ id: "r2", entryId: "E1", stepId: "s2", stepPart: "後身頃" }),
]);
eq("1回で2パーツ記録したら両方を見出しに出す", [twoParts.length, twoParts[0].partLabel], [1, "前身頃・後身頃"]);

console.log("\n[entryIdの無い過去のレコード（フォールバック）]");
const old = [
  rec({ id: "o1", stepId: "s1" }),
  rec({ id: "o2", stepId: "s2" }),
  rec({ id: "o3", stepId: "s3", qty: 5 }),          // 枚数が違う＝別の入力とみなす
  rec({ id: "o4", stepId: "s4", stepPart: "後身頃" }), // パーツが違う＝別の入力
  rec({ id: "o5", stepId: "s5", date: "2026-08-19" }), // 日付が違う＝別の入力
];
eq("日付+メンバー+品番+パーツ+枚数でまとまる",
  koteiEntryGroups(old).map(function (g) { return g.recs.map(function (r) { return r.id; }); }),
  [["o1", "o2"], ["o3"], ["o4"], ["o5"]]);
eq("entryIdがあるものと無いものは混ざらない",
  koteiEntryGroups([rec({ id: "a", entryId: "E1", stepId: "s1" }), rec({ id: "b", stepId: "s2" })]).length, 2);
eq("キーの形が別物になる", [koteiEntryKey(rec({ entryId: "E1" })).slice(0, 2), koteiEntryKey(rec({})).slice(0, 2)], ["e:", "f:"]);

console.log("\n[前回の続きの復元]");
// 工程表: 前身頃3工程 + 後身頃2工程（パーツ名は空欄なら直前を継承）
const sheets = [{ partId: "P1", blocks: [
  { id: "s1", type: "step", part: "前身頃", act: "a" },
  { id: "s2", type: "step", act: "b" },
  { id: "s3", type: "step", act: "c" },
  { id: "s4", type: "step", part: "後身頃", act: "d" },
  { id: "s5", type: "step", act: "e" },
  { id: "x1", type: "note" },
] }];
const steps = koteiSheetSteps(sheets, "P1");
eq("工程行だけ取り出す", steps.map(function (b) { return b.id; }), ["s1", "s2", "s3", "s4", "s5"]);
const partOf = koteiStepPartMap(steps);
eq("パーツ名を継承する", steps.map(function (b) { return partOf[b.id]; }), ["前身頃", "前身頃", "前身頃", "後身頃", "後身頃"]);
eq("パーツのくくり", koteiStepGroups(steps).map(function (g) { return g.part + ":" + g.steps.length; }), ["前身頃:3", "後身頃:2"]);

// 前回は前身頃の3工程のうち s1,s3 だけ担当した
const prev = koteiEntryGroups([rec({ id: "p1", entryId: "E9", stepId: "s1" }), rec({ id: "p2", entryId: "E9", stepId: "s3" })])[0];
// 画面の applyPrev と同じ組み立て
function restoreOff(g) {
  const inEntry = function (pn) { return g.parts.indexOf(pn || "") >= 0; };
  const recorded = {};
  g.recs.forEach(function (r) { recorded[r.stepId] = true; });
  const off = {};
  steps.forEach(function (b) { if (inEntry(partOf[b.id]) && !recorded[b.id]) off[b.id] = true; });
  return off;
}
eq("記録していなかった工程だけチェックが外れる", restoreOff(prev), { s2: true });
eq("前回触っていないパーツの工程は外さない（全チェックのまま）",
  Object.keys(restoreOff(prev)).filter(function (id) { return partOf[id] === "後身頃"; }), []);

console.log("\n[枚数修正の対象]");
// 画面の fixKoteiQty と同じ絞り込み・上書き
function applyFix(recs, ids, q) {
  return recs.map(function (r) { return ids.indexOf(r.id) >= 0 ? Object.assign({}, r, { qty: q }) : r; });
}
const before = [rec({ id: "r1", entryId: "E1", stepId: "s1" }), rec({ id: "r2", entryId: "E1", stepId: "s2" }), rec({ id: "r3", entryId: "E2", stepId: "s3" })];
const afterAll = applyFix(before, ["r1", "r2"], 8);
eq("まとまり全体の枚数が変わる", afterAll.map(function (r) { return r.id + ":" + r.qty; }), ["r1:8", "r2:8", "r3:10"]);
eq("枚数以外のフィールドは変わらない", Object.keys(afterAll[0]).sort(), Object.keys(before[0]).sort());
eq("1件だけの修正", applyFix(before, ["r2"], 3).map(function (r) { return r.qty; }), [10, 3, 10]);
// 途中で失敗 → 直った分だけ反映 → 同じ操作の再実行で残りも直る（冪等）
const halfway = applyFix(before, ["r1"], 8);
eq("途中失敗の状態", halfway.map(function (r) { return r.qty; }), [8, 10, 10]);
eq("同じ操作をもう一度で残りが直る", applyFix(halfway, ["r1", "r2"], 8).map(function (r) { return r.qty; }), [8, 8, 10]);

console.log("\n[本体ソースのフィールド構成]");
const expectKeys = ["id", "entryId", "date", "memberId", "memberName", "partId", "stepId", "stepPart", "stepAct", "stepSec", "qty", "totalSec", "unitPrice", "pleatsPrice"];
["newRecs.push({", "koteiRecs.push({"].forEach(function (marker) {
  const st = src.indexOf(marker);
  if (st < 0) { fail++; console.log("  NG  " + marker + " が見つかりません"); return; }
  const body = src.slice(st + marker.length, src.indexOf("});", st));
  const keys = (body.match(/(^|[\s,])([A-Za-z]+):/g) || []).map(function (m) { return m.replace(/[\s,:]/g, ""); });
  eq(marker + " のフィールド（entryIdだけが増えている）", keys, expectKeys);
});

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
