# GAS変更手順: mqSettings 保存対応(3行のみ)

対象: sewing-tracker 用 GAS スクリプト(GASエディタ上で管理。このリポジトリには含まれない)
作業者: 生田さん(GASエディタで手動適用 → 「デプロイを管理」から既存デプロイを編集して再デプロイ)

**下記の3箇所以外は一切変更しないこと。データ構造・既存アクションに触らない。**

## 1. doPost の action === "save" ブロック内

`companyCalendar` を扱う行の直後に1行追加:

```javascript
if (incoming.mqSettings && typeof incoming.mqSettings === "object") current.mqSettings = incoming.mqSettings;
```

## 2. emptyData() の戻り値に追加

```javascript
mqSettings: {}
```

(直前の項目の末尾にカンマが必要な場合は付けること)

## 3. readData() のデフォルト補完に1行追加

```javascript
if (!data.mqSettings || typeof data.mqSettings !== "object") data.mqSettings = {};
```

## データ構造

```
mqSettings: {
  viewCode: "任意の閲覧コード",
  teamWages: { "Aチーム": 1300, "Bチーム": 1250, "Cチーム": 1300, "サンプルチーム": 1500 },
  monthlyF: {}   // 段階2用。段階1では空のまま
}
```

**個人別の時給は絶対に入れない。** 全データが各端末に配信されるため、画面で隠してもデータとしては見えてしまう。

## デプロイ前後の確認

- デプロイ前にアプリ側を先に出しても壊れない(mqSettings が無ければ空として扱う)。ただしMQ設定の保存はGAS反映後でないと保存されない
- 反映後、MQ設定で時給を保存 → 再読み込みして値が残っていれば完了
