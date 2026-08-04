// ガントチャート（生産スケジュール）コアロジックの単体テスト
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/ganttCalc.test.js
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

// const 定義（COMPANY_CALENDAR_DEFAULTS）をオブジェクトリテラルとして抽出する
function extractConstObj(name) {
  const start = src.indexOf("const " + name + " = {");
  if (start < 0) throw new Error(name + " が見つかりません");
  let i = src.indexOf("{", start), open = i, depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return eval("(" + src.slice(open, i + 1) + ")");
}

/* eslint-disable no-eval */
const isWorkday = eval("(" + extractFn("isWorkday") + ")");
const addDaysStr = eval("(" + extractFn("addDaysStr") + ")");
// calcEndDate は isWorkday / addDaysStr に依存するため、3関数をまとめて同一スコープで評価する
const calcEndDate = eval(
  extractFn("addDaysStr") + "\n" + extractFn("isWorkday") + "\n" + extractFn("calcEndDate") + "\ncalcEndDate;"
);
const CAL = extractConstObj("COMPANY_CALENDAR_DEFAULTS");

let failed = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? "OK " : "NG ") + label + (ok ? "" : "  actual=" + JSON.stringify(actual) + " expected=" + JSON.stringify(expected)));
}

// 2026年の初期データは101日
eq("2026年の休業日は101日", CAL["2026"].length, 101);

// 稼働土曜（8/1, 8/8, 8/22, 8/29）は稼働日として数える
["2026-08-01", "2026-08-08", "2026-08-22", "2026-08-29"].forEach((d) =>
  eq(d + " は稼働日（稼働土曜）", isWorkday(d, CAL), true)
);

// お盆9連休（8/9〜16）は休業
["2026-08-09", "2026-08-10", "2026-08-13", "2026-08-16"].forEach((d) =>
  eq(d + " は休業日（お盆）", isWorkday(d, CAL), false)
);

// 11/3（文化の日）は稼働日で正しい
eq("2026-11-03 は稼働日（祝日ルール判定はしない）", isWorkday("2026-11-03", CAL), true);

// 開始日が稼働日なら1日目と数える
eq("8/3開始・稼働1日 → 8/3完了", calcEndDate("2026-08-03", 1, CAL), "2026-08-03");

// お盆（8/10〜16）をまたぐバーが休業日ぶん伸びる
eq("8/3開始・稼働12日 → お盆9連休をまたいで8/22完了", calcEndDate("2026-08-03", 12, CAL), "2026-08-22");
eq("8/5開始・稼働6日 → 8/18完了", calcEndDate("2026-08-05", 6, CAL), "2026-08-18");

// 開始日が休業日の場合は翌稼働日から数え始める
eq("8/10（休業）開始・稼働1日 → 8/17完了", calcEndDate("2026-08-10", 1, CAL), "2026-08-17");

// 未登録年は全日稼働扱い（画面側で警告を出す）
eq("2027年（未登録）は稼働扱い", isWorkday("2027-01-01", CAL), true);
eq("2027-03-02開始・稼働5日 → 3/6完了（全日稼働）", calcEndDate("2027-03-02", 5, CAL), "2027-03-06");

// 月・年またぎ
eq("addDaysStr 月またぎ", addDaysStr("2026-08-31", 1), "2026-09-01");
eq("addDaysStr 年またぎ", addDaysStr("2026-12-31", 1), "2027-01-01");

if (failed > 0) { console.error(failed + " 件失敗"); process.exit(1); }
console.log("全件OK");
