// サンプル区分（作業区分「サンプル」）の単体テスト。
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/sampleStats.test.js
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
const kubunOf = eval("(" + extractFn("kubunOf") + ")");
const sampleTotalOf = eval("(" + extractFn("sampleTotalOf") + ")");
const koteiValue = eval("(" + extractFn("koteiValue") + ")");
const sampleValueMap = eval("(" + extractFn("sampleValueMap") + ")");
const sampleStatsOf = eval("(" + extractFn("sampleStatsOf") + ")");
const rateOf = eval("(" + extractFn("rateOf") + ")");
const memberPeriodStats = eval("(" + extractFn("memberPeriodStats") + ")");
const sampleMonthlyStats = eval("(" + extractFn("sampleMonthlyStats") + ")");

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      期待: " + e + "\n      実際: " + a); }
}
function near(label, actual, expected, eps) {
  const e = eps == null ? 1e-6 : eps;
  if (Math.abs(actual - expected) <= e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      期待: " + expected + "\n      実際: " + actual); }
}

// ── 1. 後方互換: kubunを持たない旧レコードは量産として扱われる ─────────────
console.log("[1. 後方互換]");
(function () {
  const parts = [
    { id: "P1", unitPrice: 3000, pleatsPrice: 0, qty: 100 }, // 工程表あり品番
    { id: "P2", unitPrice: 1000, pleatsPrice: 0, qty: 50 },  // 工程表なし品番
  ];
  const hasSheet = { P1: true };
  const records = [
    // otherHours内数あり。kubunキーは持たない（旧レコード）
    { id: "r1", memberId: "m1", partId: "P1", date: "2026-01-05", hours: 6, otherHours: 1 },
    { id: "r2", memberId: "m1", partId: "P2", date: "2026-01-06", hours: 2 }, // 工程表なし
  ];
  const koteiRecords = [
    { id: "k1", memberId: "m1", partId: "P1", date: "2026-01-05", stepSec: 60, qty: 100, totalSec: 600, unitPrice: 3000, pleatsPrice: 0 },
  ];
  const data = { records: records, koteiRecords: koteiRecords, parts: parts };
  const stats = memberPeriodStats(data, hasSheet, "m1", "2026-01-01", "2026-01-31");

  eq("kubunなしレコードは sampleH が 0", stats.sampleH, 0);
  eq("sampleRatio は 0", stats.sampleRatio, 0);
  eq("rate は massRate と一致する（サンプルなし）", stats.rate, stats.massRate);

  // 手計算での期待値（旧ロジックそのまま）
  const expHoursAll = 6 + 2;
  const expSheetH = 6; // P1のみ（工程表あり）
  const expNoSheetH = expHoursAll - expSheetH;
  const expOtherH = 1;
  const expValue = koteiValue(koteiRecords[0], parts);
  const expQty = 100;
  eq("hoursAll", stats.hoursAll, expHoursAll);
  eq("noSheetH", stats.noSheetH, expNoSheetH);
  eq("otherH", stats.otherH, expOtherH);
  near("value", stats.value, expValue);
  eq("qty", stats.qty, expQty);

  // 旧rateOfの計算（工程表あり時間・工程外除く・v>0の日のみ）と一致するか
  const oldH = Math.max(0, 6 - 1); // 5h
  const oldRate = expValue > 0 ? expValue / oldH : 0;
  near("rate は旧ロジックの計算と一致", stats.rate, oldRate);

  // 1a. 時間だけの日・生産価値だけの日は、どちらも1時間あたりの分母分子から除外される（人×日単位）
  const records2 = records.concat([
    { id: "r3", memberId: "m1", partId: "P1", date: "2026-01-07", hours: 4 }, // 時間だけの日（工程枚数なし）
  ]);
  const koteiRecords2 = koteiRecords.concat([
    Object.assign({}, koteiRecords[0], { id: "k2", date: "2026-01-08" }), // 生産価値だけの日（作業時間の記録がない）
  ]);
  const data2 = { records: records2, koteiRecords: koteiRecords2, parts: parts };
  const stats2 = memberPeriodStats(data2, hasSheet, "m1", "2026-01-01", "2026-01-31");
  near("時間だけの日・価値だけの日を除外した1時間あたり", stats2.rate, koteiValue(koteiRecords[0], parts) / 5);
})();

// ── 2. サンプル代の按分 ─────────────────────────────────────
console.log("\n[2. サンプル代の按分]");
(function () {
  const parts = [{ id: "S1", unitPrice: 12000, qty: 2, kind: "sample" }]; // T = 24000
  const records = [
    { id: "a", memberId: "mA", partId: "S1", date: "2026-01-01", hours: 3, kubun: "sample" },
    { id: "b", memberId: "mB", partId: "S1", date: "2026-01-02", hours: 5, kubun: "sample" },
  ];
  const svm = sampleValueMap(records, parts);
  near("Aの按分額 = 24000 * 3/8 = 9000", svm.a, 9000);
  near("Bの按分額 = 24000 * 5/8 = 15000", svm.b, 15000);
  near("按分額の合計はサンプル代合計と一致（誤差1e-6以内）", svm.a + svm.b, sampleTotalOf(parts[0]));

  // 3分割（1h,1h,1h・T=10000）
  const parts2 = [{ id: "S2", unitPrice: 10000, qty: 1 }]; // T=10000
  const records2 = [
    { id: "x", memberId: "m1", partId: "S2", date: "2026-02-01", hours: 1, kubun: "sample" },
    { id: "y", memberId: "m2", partId: "S2", date: "2026-02-01", hours: 1, kubun: "sample" },
    { id: "z", memberId: "m3", partId: "S2", date: "2026-02-01", hours: 1, kubun: "sample" },
  ];
  const svm2 = sampleValueMap(records2, parts2);
  near("3分割合計は誤差1e-6以内でTと一致", svm2.x + svm2.y + svm2.z, 10000);
  near("3分割それぞれ約3333.33", svm2.x, 10000 / 3, 1e-6);
  near("3分割それぞれ約3333.33(y)", svm2.y, 10000 / 3, 1e-6);
  near("3分割それぞれ約3333.33(z)", svm2.z, 10000 / 3, 1e-6);

  // 2b. 按分の分母は「品番の全期間・全日付」のサンプル記録から作る（月をまたいでもOK）
  const partsD = [{ id: "S", unitPrice: 8000, qty: 1 }]; // T=8000
  const recordsD = [
    { id: "a", memberId: "m1", partId: "S", date: "2026-10-01", hours: 2, kubun: "sample" },
    { id: "b", memberId: "m2", partId: "S", date: "2026-11-01", hours: 6, kubun: "sample" },
  ];
  const d2 = { records: recordsD, koteiRecords: [], parts: partsD };
  const statsD = memberPeriodStats(d2, {}, "m1", "2026-10-01", "2026-10-31");
  near("10月だけを見てもmの分母は全期間(2+6=8h)から按分される", statsD.value, 8000 * 2 / 8);

  // 2c. 奇数分割（7h/3h/0.5h・T=10000）でも合計は一致する
  const parts3 = [{ id: "S3", unitPrice: 10000, qty: 1 }];
  const records3 = [
    { id: "p", memberId: "m1", partId: "S3", date: "2026-03-01", hours: 7, kubun: "sample" },
    { id: "q", memberId: "m2", partId: "S3", date: "2026-03-01", hours: 3, kubun: "sample" },
    { id: "r", memberId: "m3", partId: "S3", date: "2026-03-01", hours: 0.5, kubun: "sample" },
  ];
  const svm3 = sampleValueMap(records3, parts3);
  near("奇数分割の合計は誤差1e-6以内でTと一致", svm3.p + svm3.q + svm3.r, 10000);

  // 2d. 文字列で入ってきた時間もNumberに寄せて按分する（保存経路のゆらぎ対策）
  const parts4 = [{ id: "S4", unitPrice: 800, qty: 1 }]; // T=800
  const records4 = [
    { id: "s", memberId: "m1", partId: "S4", date: "2026-04-01", hours: "3", kubun: "sample" },
    { id: "t", memberId: "m2", partId: "S4", date: "2026-04-01", hours: "5", kubun: "sample" },
  ];
  const svm4 = sampleValueMap(records4, parts4);
  near("文字列hoursでもAの取り分は300", svm4.s, 300);
  near("文字列hoursでもBの取り分は500", svm4.t, 500);
})();

// ── 3. 無償サンプル ─────────────────────────────────────
console.log("\n[3. 無償サンプル]");
(function () {
  const parts = [{ id: "F1", unitPrice: 8000, qty: 2, freeSample: true }];
  const hasSheet = {};
  const records = [
    { id: "f1", memberId: "m1", partId: "F1", date: "2026-01-10", hours: 4, kubun: "sample" },
  ];
  const svm = sampleValueMap(records, parts);
  eq("無償サンプルは単価>0でも按分額0円", svm.f1, 0);

  const roMass = rateOf([{ id: "dummy", memberId: "m1", partId: "MASSPART", date: "2026-01-10", hours: 4, otherHours: 0 }], [{ id: "kd", memberId: "m1", partId: "MASSPART", date: "2026-01-10", stepSec: 60, qty: 10, totalSec: 600, unitPrice: 1000, pleatsPrice: 0 }], [{ id: "MASSPART", unitPrice: 1000, pleatsPrice: 0 }], { MASSPART: true });
  const ro = rateOf(records, [], parts, hasSheet, svm);
  eq("無償サンプルの時間は分母に計上される", ro.sampleHours, 4);
  eq("無償サンプルの価値は0円", ro.sampleValue, 0);
  if (roMass.massRate > ro.rate) { pass++; console.log("  ok  無償サンプルを含めるとrateはmassRateより低くなる"); }
  else { fail++; console.log("  NG  無償サンプルを含めるとrateはmassRateより低くなる想定だが逆転"); }
})();

// ── 4. 量産＋サンプル混在 ─────────────────────────────────────
console.log("\n[4. 混在]");
(function () {
  const parts = [
    { id: "M1", unitPrice: 6000, pleatsPrice: 0 }, // 工程表あり量産品番
    { id: "S1", unitPrice: 9000, qty: 1 }, // サンプル（合計9000）
  ];
  const hasSheet = { M1: true };
  const records = [
    { id: "r1", memberId: "m1", partId: "M1", date: "2026-01-01", hours: 7, otherHours: 0 },
    { id: "r2", memberId: "m1", partId: "S1", date: "2026-01-02", hours: 3, kubun: "sample" },
  ];
  const koteiRecords = [
    { id: "k1", memberId: "m1", partId: "M1", date: "2026-01-01", stepSec: 60, qty: 70, totalSec: 600, unitPrice: 6000, pleatsPrice: 0 }, // v=60*70*(6000/600)=42000
  ];
  const data = { records: records, koteiRecords: koteiRecords, parts: parts };
  const stats = memberPeriodStats(data, hasSheet, "m1", "2026-01-01", "2026-01-31");
  near("massValue相当のkoteiValueが42000", koteiValue(koteiRecords[0], parts), 42000);
  near("rate = (42000+9000)/(7+3) = 5100", stats.rate, 51000 / 10);
  near("massRate = 42000/7 = 6000", stats.massRate, 6000);
})();

// ── 5. sampleMonthlyStats ─────────────────────────────────────
console.log("\n[5. sampleMonthlyStats]");
(function () {
  const parts = [
    { id: "S1", unitPrice: 10000, qty: 1 }, // T=10000
    { id: "S2", unitPrice: 5000, qty: 1 },  // T=5000
  ];
  const records = [
    { id: "a", memberId: "m1", memberName: "アリス", partId: "S1", date: "2026-10-05", hours: 2, kubun: "sample", sampleQty: 1 },
    { id: "b", memberId: "m2", memberName: "ボブ", partId: "S1", date: "2026-10-06", hours: 2, kubun: "sample", sampleQty: 0 },
    { id: "c", memberId: "m1", memberName: "アリス", partId: "S2", date: "2026-11-01", hours: 1, kubun: "sample", sampleQty: 0 }, // 別月
  ];
  const data = { records: records, koteiRecords: [], parts: parts };
  const oct = sampleMonthlyStats(data, "2026-10");
  eq("10月の時間 = 4h", oct.hours, 4);
  near("10月の価値 = T(10000)全額", oct.value, 10000);
  eq("10月の枚数 = 1", oct.qty, 1);
  near("hoursPerSample = 4/1 = 4", oct.hoursPerSample, 4);
  eq("byMemberにアリス・ボブが入る", Object.keys(oct.byMember).sort(), ["m1", "m2"]);
  near("アリスの時間は2h", oct.byMember.m1.hours, 2);

  const nov = sampleMonthlyStats(data, "2026-11");
  eq("11月は枚数0なのでhoursPerSampleはnull", nov.hoursPerSample, null);

  const empty = sampleMonthlyStats(data, "2026-12");
  eq("記録のない月は時間0・価値0・枚数0", [empty.hours, empty.value, empty.qty], [0, 0, 0]);
  eq("記録のない月はhoursPerSampleもnull", empty.hoursPerSample, null);
})();

// ── 6. ソート（member_stats と同じ並び替えロジックを実データで検証） ──────
console.log("\n[6. member_stats と同じ並び替えロジック]");
(function () {
  const hasSheet = { M1: true };
  const parts = [
    { id: "M1", unitPrice: 4000, pleatsPrice: 0 }, // 工程表あり量産品番
    { id: "S1", unitPrice: 8000, qty: 1 }, // T=8000
  ];
  const records = [
    // m1: サンプル多め・massRate中くらい
    { id: "r1", memberId: "m1", partId: "M1", date: "2026-01-01", hours: 4, otherHours: 0 },
    { id: "r2", memberId: "m1", partId: "S1", date: "2026-01-02", hours: 6, kubun: "sample" },
    // m2: サンプルなし・massRate最高
    { id: "r3", memberId: "m2", partId: "M1", date: "2026-01-01", hours: 2, otherHours: 0 },
    // m3: サンプル少なめ・massRate最低
    { id: "r4", memberId: "m3", partId: "M1", date: "2026-01-01", hours: 10, otherHours: 0 },
    { id: "r5", memberId: "m3", partId: "S1", date: "2026-01-02", hours: 2, kubun: "sample" },
  ];
  const koteiRecords = [
    { id: "k1", memberId: "m1", partId: "M1", date: "2026-01-01", stepSec: 60, qty: 40, totalSec: 600, unitPrice: 4000, pleatsPrice: 0 }, // v=4000*4=16000, massRate=4000
    { id: "k2", memberId: "m2", partId: "M1", date: "2026-01-01", stepSec: 60, qty: 30, totalSec: 600, unitPrice: 4000, pleatsPrice: 0 }, // v=4000*(2*?): 計算はkoteiValueで確認
    { id: "k3", memberId: "m3", partId: "M1", date: "2026-01-01", stepSec: 60, qty: 50, totalSec: 600, unitPrice: 4000, pleatsPrice: 0 },
  ];
  const data = { records: records, koteiRecords: koteiRecords, parts: parts };
  const svm = sampleValueMap(data.records, data.parts);
  const rows = ["m1", "m2", "m3"].map((mid) => Object.assign({ id: mid }, memberPeriodStats(data, hasSheet, mid, "2026-01-01", "2026-01-31", svm)));

  ["sampleH", "sampleRatio", "massRate"].forEach((k) => {
    const sorted = rows.slice().sort((x, y) => (y[k] || 0) - (x[k] || 0)).map((r) => r.id);
    const manual = rows.slice().map((r) => r.id);
    manual.sort(function (ai, bi) {
      const a = rows.find((r) => r.id === ai)[k] || 0;
      const b = rows.find((r) => r.id === bi)[k] || 0;
      return b - a;
    });
    eq(k + "は降順に並ぶ", sorted, manual);
  });
  // sampleHは m1(6h) > m3(2h) > m2(0h) のはず
  const bySampleH = rows.slice().sort((a, b) => (b.sampleH || 0) - (a.sampleH || 0)).map((r) => r.id);
  eq("sampleHの降順はm1,m3,m2", bySampleH, ["m1", "m3", "m2"]);
  // massRateは m2 > m1 > m3 のはず（時間あたりのkoteiValueが同じ単価・秒数で枚数だけ違うため）
  const byMassRate = rows.slice().sort((a, b) => (b.massRate || 0) - (a.massRate || 0)).map((r) => r.id);
  eq("massRateの降順はm2,m1,m3", byMassRate, ["m2", "m1", "m3"]);
})();

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
