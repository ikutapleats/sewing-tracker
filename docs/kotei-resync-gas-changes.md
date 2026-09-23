# GAS変更手順: 工程時間の訂正を過去記録へ反映(resyncKoteiRecords)

対象: sewing-tracker 用 GAS スクリプト(GASエディタ上で管理。このリポジトリには含まれない)
作業者: 生田さん(GASエディタで手動適用 → 「デプロイを管理」から既存デプロイを編集して再デプロイ)

**下記以外は一切変更しないこと。データ構造・既存アクションに触らない。**

## 1. doPost 内の他の action ブロックと並べて追加

```javascript
    // ── 工程時間の訂正を過去記録へ反映(stepSecのみ・承認済み機能)
    // updates: [{ match: {...}, newSec: number }] の配列。
    // matchのキーと値がすべて一致するkoteiRecordsのstepSecをnewSecに書き換える。
    if (action === "resyncKoteiRecords") {
      const lock = LockService.getScriptLock();
      lock.waitLock(15000);
      try {
        const sheet = getOrCreateSheet(SHEET_NAME);
        const data = readData(sheet);
        const updates = params.updates || [];
        const counts = [];
        updates.forEach(function(u) {
          let n = 0;
          data.koteiRecords.forEach(function(r) {
            let hit = true;
            for (const k in u.match) { if (r[k] !== u.match[k]) { hit = false; break; } }
            if (hit && typeof u.newSec === "number" && u.newSec > 0) { r.stepSec = u.newSec; n++; }
          });
          counts.push(n);
        });
        writeData(sheet, data);
        return makeResponse({ status: "saved", counts: counts });
      } finally { lock.releaseLock(); }
    }
```

フロントは match に必ず { partId, stepId } の組を渡す（GAS側は渡されたキーで機械的に絞るだけ）。

## データ構造

変更なし。既存レコードの stepSec 値を書き換えるだけ。

## デプロイ前後の確認

- フロント(Vercel)より先にGASをデプロイする(先にフロントが出ても反映ボタンがエラー表示になるだけで、記録は書き換わらない)
- 既存デプロイの編集で再デプロイ
- 工程表で秒数を変えて保存→ダイアログ→反映→該当記録の stepSec だけが変わること
- 別品番の同名工程が変わらないこと
