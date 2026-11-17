# GAS変更手順: 品番一覧の読み取りアクション `listHinban`

対象: sewing-tracker 用 GAS スクリプト(GASエディタ上で管理。このリポジトリには含まれない)
作業者: 生田さん(GASエディタで手動適用 → 「デプロイを管理」から既存デプロイを編集して再デプロイ)
目的: 納品書アプリ(seikyu-kanri)が、品番欄の候補として生産管理の品番を**読むだけ**のための入口。

**下記の2箇所以外は一切変更しないこと。データ構造・既存アクション・フロント(sewing-tracker.jsx)には触らない。**
このアクションはシートに何も書き込まない(`readData()` で読むだけ)。

> 注意: この手順書は GAS 本体のコードを見ずに書いている。`readData()` という関数名は
> `docs/gantt-gas-changes.md` の記載に基づく。実際の関数名や `doGet` の形が違う場合は、
> 貼り付ける前に GAS のコード(`doGet` と `readData`)を Claude に見せて確認すること。

## 1. `doGet(e)` の先頭に分岐を1つ追加

`doGet` の最初の行(既存の `imgKotei` の分岐より前でよい)に追加する。
`action=listHinban` が付いていないアクセスは、これまでと全く同じ動きになる。

```javascript
// 納品書アプリ向け: 品番一覧(読み取り専用)。?action=listHinban のときだけ動く
if (e && e.parameter && e.parameter.action === "listHinban") {
  return ContentService.createTextOutput(JSON.stringify(listHinban_()))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 2. 関数 `listHinban_()` を追加(ファイルの末尾でよい)

```javascript
// 品番一覧(読み取り専用)。納品書アプリの品番候補に使う。
// 返す範囲: 進行中の全品番 + 完了日から12か月以内の品番。
// 返す項目は下に書いたものだけ。時間記録・時給・MQ設定などは返さない。
function listHinban_() {
  try {
    var data = readData();                       // 既存の読み込み関数をそのまま使う(書き込みなし)
    var tz = "Asia/Tokyo";
    var now = new Date();
    var cut = new Date(now.getTime());
    cut.setMonth(cut.getMonth() - 12);
    var cutoff = Utilities.formatDate(cut, tz, "yyyy-MM-dd");   // これ以降に完了した品番を含める

    // 客先(ブランド)ID → 名前
    var brandName = {};
    (data.brands || []).forEach(function (b) { if (b && b.id) brandName[b.id] = b.name || ""; });

    // 日付を "YYYY-MM-DD" にそろえる。シートから Date 型で返ってきた場合の保険(文字列ならそのまま先頭10文字)
    var ymd = function (v) {
      if (!v) return "";
      if (v instanceof Date) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
      return String(v).slice(0, 10);
    };

    var seen = {};                               // 同じIDの重複行は1件にまとめる(アプリ側の dedupById と同じ)
    var out = [];
    (data.parts || []).forEach(function (p) {
      if (!p || !p.id || seen[p.id]) return;
      seen[p.id] = true;
      var closedDate = ymd(p.closedAt);
      if (closedDate && closedDate < cutoff) return;            // 完了から12か月を超えた品番は返さない
      // 単価: 外注は販売単価(sellPrice)、それ以外は製品単価(unitPrice)。0・未入力は null
      var price = Number(p.assigneeType === "outsource" ? p.sellPrice : p.unitPrice) || 0;
      out.push({
        id: String(p.id),                        // 品番ID(登録時に決まり、編集しても変わらない)
        name: String(p.partNo || ""),            // 品番
        partName: String(p.partName || ""),      // 品名
        clientId: p.brandId ? String(p.brandId) : "",          // 客先(ブランド)ID
        client: p.brandId ? (brandName[p.brandId] || "") : "", // 客先名(生産管理側の表記のまま)
        qty: Number(p.qty) || 0,                 // 受注数量
        price: price > 0 ? price : null,
        closed: !!closedDate,                    // 完了済みか(closedAt の有無)
        closedDate: closedDate,                  // 完了日(無ければ "")
        kind: p.kind === "sample" ? "sample" : "",             // サンプル品番の目印
        deadline: ymd(p.deadline),               // 納期(候補の並び順用)
        createdAt: ymd(p.createdAt)              // 登録日(候補の並び順用)
      });
    });
    return {
      ok: true,
      updatedAt: Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      hinban: out
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
```

## 返す形(例)

```javascript
{ ok: true,
  updatedAt: "2026-11-17T09:00:00+09:00",
  hinban: [
    { id: "k3x9a2b", name: "AB-1234", partName: "プリーツスカート",
      clientId: "b7c1d2e", client: "バスク",
      qty: 120, price: 3800, closed: false, closedDate: "",
      kind: "", deadline: "2026-12-10", createdAt: "2026-11-01" }
  ] }
```

指示書(§3-1)からの追加項目と理由:

- `clientId` … 客先名は生産管理側で改名できるため、納品書アプリの対応表は客先IDをキーにする。
- `partName` … 品番と品名が別項目のため。候補行に表示し、明細の「内容」が空なら入れる。
- `kind` / `deadline` / `createdAt` … サンプルの目印と、候補の並び順(納期または登録が新しい順)用。

## デプロイ前後の確認

- デプロイ順序: **① この GAS → ② seikyu-kanri のフロント**(seikyu-kanri の GAS は変更不要の見込み)。
- **必ずこの GAS を先に反映すること。** 反映前の GAS は `?action=listHinban` を無視して全データ
  (時間記録・MQ設定を含む)を返すため、先に納品書アプリ側を出すと、納品書アプリを開くたびに
  全データを受け取ってしまう(画面には出ず保存もされないが、不要なデータが端末に届く)。
- 反映後、ブラウザで `(GASのURL)?action=listHinban` を開き、`{"ok":true,...}` で始まる文字が出れば完了。
- `(GASのURL)` だけを開いたとき(従来の読み込み)の内容が、反映前と変わらないこと。
- sewing-tracker アプリを開き、品番・記録がこれまでどおり全件表示されること。
