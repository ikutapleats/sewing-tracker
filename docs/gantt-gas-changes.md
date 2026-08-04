# GAS変更手順: companyCalendar 保存対応(3行のみ)

対象: sewing-tracker 用 GAS スクリプト(GASエディタ上で管理。このリポジトリには含まれない)
作業者: 生田さん(GASエディタで手動適用 → 「デプロイを管理」から既存デプロイを編集して再デプロイ)

**下記の3箇所以外は一切変更しないこと。データ構造・既存アクションに触らない。**

## 1. doPost の action === "save" ブロック内

`koteiPhrases` を扱う行の直後に1行追加:

```javascript
if (incoming.companyCalendar && typeof incoming.companyCalendar === "object") current.companyCalendar = incoming.companyCalendar;
```

## 2. emptyData() の戻り値に追加

```javascript
companyCalendar: {}
```

## 3. readData() のデフォルト補完に1行追加

```javascript
if (!data.companyCalendar || typeof data.companyCalendar !== "object") data.companyCalendar = {};
```

## データ構造

```
companyCalendar: { "2026": ["2026-01-01", "2026-01-02", ...] }
```

年をキー、休業日の日付配列を値とするオブジェクト。
アプリ側(sewing-tracker.jsx)は 2026 年分の初期値(101日)を内蔵しているため、
GAS 側にデータが無くても動作する。設定画面で編集・保存すると上記キーで保存される。
