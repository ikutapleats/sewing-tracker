// koteiPartGroups の単体テスト（工程分析表 パーツ並べ替え）
// ビルド環境を導入しない方針のため、sewing-tracker.jsx から関数ソースを
// そのまま抽出して Node で実行する。実行: node tests/koteiPartGroups.test.js
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
const koteiPartGroups = eval("(" + extractFn("koteiPartGroups") + ")");

// movePart は blocks/setBlocks 等のクロージャに依存するため、ここでは
// 同じ入れ替えロジックを純粋関数として再現して並べ替え結果を検証する
// （本体 movePart と同一のアルゴリズム）。
function movePart(bs, gi, dir) {
  const groups = koteiPartGroups(bs);
  const gj = gi + dir;
  if (gi < 0 || gi >= groups.length || gj < 0 || gj >= groups.length) return bs;
  const lo = Math.min(gi, gj), hi = Math.max(gi, gj);
  const a = groups[lo], b = groups[hi];
  return bs.slice(0, a.start).concat(bs.slice(b.start, b.end), bs.slice(a.start, a.end), bs.slice(b.end));
}

let pass = 0, fail = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok  " + label); }
  else { fail++; console.log("  NG  " + label + "\n      expected: " + e + "\n      actual:   " + a); }
}
const ids = function (bs) { return bs.map(function (b) { return b.id; }); };
const parts = function (bs) { return koteiPartGroups(bs).map(function (g) { return g.part; }); };

console.log("[グループ化]");
// 先頭の孤立図＋3パーツ。縫製くくりには part 空欄の工程と図がぶら下がる。
const blocks = [
  { id: "k0", type: "sketch", img: "x" },          // 孤立図（先頭・直前工程なし）
  { id: "a1", type: "step", part: "準備", act: "裁断" },
  { id: "a2", type: "step", part: "準備", act: "印つけ" },
  { id: "af", type: "sketch", img: "x" },          // 準備の図
  { id: "b1", type: "step", part: "縫製", act: "縫う" },
  { id: "be", type: "step", part: "", act: "追加工程" }, // 空欄→縫製くくりに属する
  { id: "bf", type: "sketch", img: "x" },          // 縫製の図
  { id: "c1", type: "step", part: "仕上げ", act: "アイロン" },
];
eq("先頭の孤立ブロックは空パーツのくくりになる", parts(blocks), ["", "準備", "縫製", "仕上げ"]);
eq("くくりは連続範囲を覆う（start/end）",
  koteiPartGroups(blocks).map(function (g) { return [g.start, g.end]; }),
  [[0, 1], [1, 4], [4, 7], [7, 8]]);

console.log("[並べ替え]");
// 縫製（index2）を上へ：配下の工程・図がまるごと移動する
const up = movePart(blocks, 2, -1);
eq("縫製を上へ→ 未/縫製/準備/仕上げ", parts(up), ["", "縫製", "準備", "仕上げ"]);
eq("縫製くくりの中身が一緒に動く（取り残しなし）",
  ids(up), ["k0", "b1", "be", "bf", "a1", "a2", "af", "c1"]);
eq("ブロック総数は不変", up.length, blocks.length);

// 逆操作で元に戻る（隣接入れ替えは自分自身が逆操作）
const g2 = koteiPartGroups(up);
const backIdx = g2.map(function (g) { return g.part; }).indexOf("縫製");
eq("縫製を下へ戻すと元順に復帰", ids(movePart(up, backIdx, 1)), ids(blocks));

console.log("[境界]");
eq("先頭くくりの▲は何もしない", ids(movePart(blocks, 0, -1)), ids(blocks));
eq("末尾くくりの▼は何もしない",
  ids(movePart(blocks, koteiPartGroups(blocks).length - 1, 1)), ids(blocks));

console.log("[同名パーツの反復]");
// 同じパーツ名が離れて2回出るとくくりは2つ（連続runで判定）
const rep = [
  { id: "p1", type: "step", part: "準備" },
  { id: "q1", type: "step", part: "縫製" },
  { id: "p2", type: "step", part: "準備" },
];
eq("同名でも非連続なら別くくり", parts(rep), ["準備", "縫製", "準備"]);
eq("2つ目の準備(index2)を上へ", ids(movePart(rep, 2, -1)), ["p1", "p2", "q1"]);

console.log("\n結果: " + pass + " ok / " + fail + " NG");
process.exit(fail ? 1 : 0);
