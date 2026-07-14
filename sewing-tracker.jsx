const { useState, useMemo, useEffect, useCallback, useRef } = React;

const GAS_URL = "https://script.google.com/macros/s/AKfycbxN7_GWK5xxPJm79eq2uvA1AIVRI6x_g0fD1HHng_Eyo51JEw5JVC3021iYYz_Y3yjxcw/exec";

const TEAMS = ["Aチーム", "Bチーム", "Cチーム", "サンプルチーム"];
const TEAM_COLORS = {
  "Aチーム": "#3b6fd4",
  "Bチーム": "#2a7a2a",
  "Cチーム": "#c25000",
  "サンプルチーム": "#7a2a7a",
};
const STATUSES = ["未着手", "裁断済み", "仕掛り中", "完了"];

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function genId() { return Math.random().toString(36).slice(2, 9); }
function fmt(d) { return d ? d.slice(5).replace("-", "/") : "—"; }
function diffDays(a, b) {
  if (!a || !b) return null;
  return Math.ceil((new Date(b) - new Date(a)) / 86400000);
}

const EMPTY_DATA = {
  parts: [], records: [], qtyRecords: [], members: [], vendors: [], brands: [], monthlyTargets: {}, saidanReports: [], koteiSheets: [], koteiRecords: [],
};

const INIT_UI = {
  screen: "home", selectedTeam: null, userRole: null,
  addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estMinPerUnit: "", deadline: "", status: "未着手", note: "", assignee: "未割当", assigneeType: "team", vendorId: "", sellPrice: "", vendorPrice: "", brandId: "", workMonth: today().slice(0, 7) },
  editPartForm: null,
  memberForm: { memberId: "", partId: "", hours: "", date: today() },
  qtyForm: { partId: "", qty: "", date: today() },
  addMemberForm: { name: "" }, addVendorForm: { name: "" },
  targetForm: { month: today().slice(0, 7), team: TEAMS[0], sales: "", members: "", workDays: "", hoursPerDay: "" },
  activePartId: null, masterFilter: "all", summaryMonth: today().slice(0, 7),
  editMemberId: null, editMemberName: "", editVendorId: null, editVendorName: "",
  editBrandId: null, editBrandName: "",
  addBrandForm: { name: "" },
  prevScreen: "master",
  dashFilter: "active",
  selectedBrandId: null,
  activeBrandId: null,
  activeMemberId: null,
  activeVendorId: null,
  calMonth: null,
  calSelectedDate: null,
  saidanPartId: null,
  saidanForm: null,
  dlMonth: null,
  dlSelectedDate: null,
  teamMonthTeam: null,
  teamMonthMonth: null,
  estPeople: 1,
  salesMonth: null,
  salesTeam: "all",
  salesSelectedDate: null,
  sampleForm: null,
  koteiPartId: null,
  koteiReturn: "part_detail",
  koteiSearch: "",
  koteiPhCat: "アイロン",
  koteiPhInput: "",
  koteiDrag: null,
  koteiPartsInput: "",
  koteiPartsDrag: null,
  kEntryMode: "hours",
  kEntryPartId: "",
  kEntryQty: {},
  kEntryOpen: {},
  vvAxis: "member",
  vvPeriod: "month",
  vvMonth: today().slice(0, 7),
  vvDay: today(),
  vvFrom: daysAgo(6), // 期間で見るの初期値: 過去1週間
  vvTo: today(),
  vvExpanded: {},
};

async function gasSave(data) {
  const json = JSON.stringify(data);
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "save", data: json }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("save failed: " + JSON.stringify(result));
}

// ── 保存失敗の安全網 ──
// 失敗した書き込みペイロードを端末(localStorage)に保持し（リロードしても消えない）、
// 「再試行」ボタン・起動時の自動再送で再送できるようにする。
// GASは応答が遅い/失敗に見えても書き込み自体は成功していることがあるため、再送で
// シートに二重行ができ得るが、読み込み時のID重複排除で画面・集計は正しく保たれる。
const PENDING_KEY = "iquta-pending-saves";
function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch (e) { return []; } }
function storePending(list) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) {} }
function pushPending(body) { const l = loadPending(); l.push({ body: body, ts: Date.now() }); storePending(l); try { window.dispatchEvent(new CustomEvent("iquta-pending")); } catch (e) {} }
async function gasPostRaw(body) {
  const res = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  const text = await res.text();
  let result = null;
  try { result = JSON.parse(text); } catch (e) {} // GASの302先がHTML等を返すことがある
  if (!result || result.status !== "saved") throw new Error((body.action || "save") + " failed: HTTP " + res.status + " " + text.slice(0, 120));
  return result;
}
// 同一IDのレコードを1件に（再送や過去の二重送信でシートに重複行があっても集計を壊さない）
function dedupById(arr) { const seen = {}; return (arr || []).filter(function (r) { if (!r || !r.id) return true; if (seen[r.id]) return false; seen[r.id] = true; return true; }); }

// ── 保存成功の最終判定 ──
// 書き込みの成否はGAS側で決まるが、応答は302リダイレクト経由で失われることがある
// （電波切れ・タブ退避・302先の非JSON応答）。IDはアプリ側で生成しているので、
// 応答が受け取れなかったときはサーバーのデータに該当IDが載ったかをGETで確認して判定する。
const ADD_LISTS = { addRecord: "records", addQtyRecord: "qtyRecords", addKoteiRecords: "koteiRecords" };
function bodyIds(body) {
  if (body.action === "addKoteiRecords") return (body.records || []).map(function (r) { return r && r.id; });
  return body.record && body.record.id ? [body.record.id] : [];
}
function idsOnServer(data, body) {
  const list = ADD_LISTS[body.action];
  if (!list) return false;
  const arr = (data && data[list]) || [];
  const ids = bodyIds(body);
  return ids.length > 0 && ids.every(function (id) { return arr.some(function (r) { return r && r.id === id; }); });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function gasAddSafe(body) {
  try { await gasPostRaw(body); return; }
  catch (err) {
    await sleep(1500); // 実行中のdoPost（1〜3秒）が書き終わるのを待ってから確認
    try { if (idsOnServer(await gasLoad(), body)) return; } catch (e) {} // 実は保存成功（応答だけ失われた）
    pushPending(body);
    throw err;
  }
}

async function gasAddRecord(record) {
  await gasAddSafe({ action: "addRecord", record: record });
}

async function gasDeleteRecord(recordId) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "deleteRecord", recordId }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("deleteRecord failed");
}

async function gasAddQtyRecord(record) {
  await gasAddSafe({ action: "addQtyRecord", record: record });
}

async function gasAddKoteiRecords(records) {
  await gasAddSafe({ action: "addKoteiRecords", records: records });
}

async function gasAddPart(part) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "addPart", part }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("addPart failed");
}

async function gasUpdatePart(part) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "updatePart", part }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("updatePart failed");
}

async function gasDeletePart(partId) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "deletePart", partId }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("deletePart failed");
}

async function gasUpsertItem(list, item) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "upsertItem", list, item }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("upsertItem failed: " + JSON.stringify(result));
}

async function gasDeleteItem(list, itemId) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "deleteItem", list, itemId }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("deleteItem failed: " + JSON.stringify(result));
}

async function gasSetTarget(month, team, value) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "setTarget", month, team, value }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("setTarget failed: " + JSON.stringify(result));
}

async function gasLoad() {
  const res = await fetch(GAS_URL);
  return await res.json();
}

// 生産価値 = 工程の実測秒数 × 枚数 × レート
// レート = 受注単価 ÷ 1着総工数（秒）。単価が無い品番は暫定レート 1秒=1円。
// 単価は品番（live）優先。総工数・単価は日報レコードにも写してあり、工程表が消えても壊れない。
function koteiValue(rec, parts) {
  const part = (parts || []).find(function (p) { return p.id === rec.partId; });
  const unit = part ? (part.unitPrice || 0) : (rec.unitPrice || 0);
  const total = rec.totalSec || 0;
  const rate = (unit > 0 && total > 0) ? unit / total : 1; // 暫定1秒1円
  return (rec.stepSec || 0) * (rec.qty || 0) * rate;
}

// 金額のカウントアップ演出（表示のみ）。値が変わったら前の値からスーッと伸びる。
function CountUpYen(p) {
  const [disp, setDisp] = useState(p.value);
  const prev = useRef(p.value);
  useEffect(() => {
    const from = prev.current, to = p.value;
    prev.current = to;
    if (from === to) return;
    const t0 = performance.now(), dur = 700;
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setDisp(from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.value]);
  return "¥" + Math.round(disp).toLocaleString();
}

function App() {
  const [data, setData] = useState(EMPTY_DATA);
  const [ui, setUi] = useState(INIT_UI);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveQueue = useRef(null);
  const savingRef = useRef(false);

  const set = (patch) => setUi((p) => Object.assign({}, p, patch));
  const setAP = (patch) => setUi((p) => Object.assign({}, p, { addPartForm: Object.assign({}, p.addPartForm, patch) }));
  const setEP = (patch) => setUi((p) => Object.assign({}, p, { editPartForm: Object.assign({}, p.editPartForm, patch) }));
  const setMF = (patch) => setUi((p) => Object.assign({}, p, { memberForm: Object.assign({}, p.memberForm, patch) }));
  const setQF = (patch) => setUi((p) => Object.assign({}, p, { qtyForm: Object.assign({}, p.qtyForm, patch) }));
  const setTF = (patch) => setUi((p) => Object.assign({}, p, { targetForm: Object.assign({}, p.targetForm, patch) }));
  const setKQ = (patch) => setUi((p) => Object.assign({}, p, { kEntryQty: Object.assign({}, p.kEntryQty, patch) }));

  useEffect(() => {
    gasLoad().then((d) => {
      const merged = Object.assign({}, EMPTY_DATA, d);
      if (!Array.isArray(merged.members)) merged.members = [];
      if (!Array.isArray(merged.vendors)) merged.vendors = [];
      if (!Array.isArray(merged.brands)) merged.brands = [];
      if (!Array.isArray(merged.parts)) merged.parts = [];
      if (!Array.isArray(merged.records)) merged.records = [];
      if (!Array.isArray(merged.qtyRecords)) merged.qtyRecords = [];
      if (!Array.isArray(merged.saidanReports)) merged.saidanReports = [];
      if (!Array.isArray(merged.koteiSheets)) merged.koteiSheets = [];
      if (!Array.isArray(merged.koteiRecords)) merged.koteiRecords = [];
      // 二重送信・再送でシートに重複行があっても、画面と集計はIDで1件に正規化する
      merged.records = dedupById(merged.records);
      merged.qtyRecords = dedupById(merged.qtyRecords);
      merged.koteiRecords = dedupById(merged.koteiRecords);
      setData(merged);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // 共通ヘッダーのロゴ（ホームへ戻る）を1箇所で受ける。未保存確認はHeader側で済ませてから飛んでくる。
  useEffect(() => {
    const goHome = () => setUi((p) => Object.assign({}, p, { screen: "home" }));
    window.addEventListener("iquta-home", goHome);
    return () => window.removeEventListener("iquta-home", goHome);
  }, []);

  // ── タブが再アクティブになったら最新データを取り直す（古い画面対策）
  const reloadData = useCallback(async () => {
    if (savingRef.current) return; // 保存中・保存待ちのときは触らない
    try {
      const d = await gasLoad();
      const merged = Object.assign({}, EMPTY_DATA, d);
      if (!Array.isArray(merged.members)) merged.members = [];
      if (!Array.isArray(merged.vendors)) merged.vendors = [];
      if (!Array.isArray(merged.brands)) merged.brands = [];
      if (!Array.isArray(merged.parts)) merged.parts = [];
      if (!Array.isArray(merged.records)) merged.records = [];
      if (!Array.isArray(merged.qtyRecords)) merged.qtyRecords = [];
      if (!Array.isArray(merged.saidanReports)) merged.saidanReports = [];
      if (!Array.isArray(merged.koteiSheets)) merged.koteiSheets = [];
      if (!Array.isArray(merged.koteiRecords)) merged.koteiRecords = [];
      // 二重送信・再送でシートに重複行があっても、画面と集計はIDで1件に正規化する
      merged.records = dedupById(merged.records);
      merged.qtyRecords = dedupById(merged.qtyRecords);
      merged.koteiRecords = dedupById(merged.koteiRecords);
      setData(merged);
    } catch (e) {}
  }, []);

  // ── 未送信キュー（保存失敗の安全網）──
  // 失敗ペイロードは localStorage に残っているので、リロードしても消えない。
  const [pendingN, setPendingN] = useState(loadPending().length);
  useEffect(() => {
    const onPending = () => setPendingN(loadPending().length);
    window.addEventListener("iquta-pending", onPending);
    return () => window.removeEventListener("iquta-pending", onPending);
  }, []);
  const retryingRef = useRef(false); // 再送の多重実行防止（連打・自動再送との競合で二重送信しない）
  const retryPending = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    try {
      let list = loadPending();
      if (list.length === 0) { setSaveError(false); return; }
      setSaving(true); setSaveError(false);
      // 再送の前にサーバーを確認し、実は保存済みだった分は再送しない（シートに二重行を作らない）
      try {
        const server = await gasLoad();
        list = list.filter((item) => !idsOnServer(server, item.body));
        storePending(list);
        setPendingN(list.length);
      } catch (e) {}
      const remain = [];
      for (const item of list) {
        try { await gasPostRaw(item.body); } catch (e) { console.error("resend failed", e); remain.push(item); }
      }
      storePending(remain);
      setPendingN(remain.length);
      setSaving(false);
      if (remain.length > 0) setSaveError(true);
      else reloadData(); // 全件送れたらサーバー状態を取り直す（万一の二重行はID重複排除で吸収）
    } finally { retryingRef.current = false; }
  }, [reloadData]);
  // 起動時: 前回失敗して残った未送信分を自動で再送する
  useEffect(() => { if (loadPending().length > 0) retryPending(); }, []); // eslint-disable-line

  useEffect(() => { savingRef.current = saving; }, [saving]);

  useEffect(() => {
    let last = 0;
    const onActive = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < 2000) return; // 連続発火を抑制
      last = now;
      reloadData();
    };
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
    return () => {
      document.removeEventListener("visibilitychange", onActive);
      window.removeEventListener("focus", onActive);
    };
  }, [reloadData]);

  const save = useCallback((nd) => {
    if (saveQueue.current) clearTimeout(saveQueue.current);
    setSaving(true);
    setSaveError(false);
    saveQueue.current = setTimeout(async () => {
      try {
        await gasSave(nd);
      } catch(e) {
        console.error("save error", e);
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    }, 800);
  }, []);

  function updateData(patch) {
    const nd = Object.assign({}, data, patch);
    setData(nd);
    save(nd);
  }

  // ローカル状態を更新しつつ、1件単位のGAS操作を呼ぶ（古いクライアントが全体を巻き戻さない）
  function applyLocal(patch, gasFn) {
    setData(Object.assign({}, data, patch));
    setSaving(true);
    setSaveError(false);
    gasFn().catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  const allSummary = useMemo(() => data.parts.map((part) => {
    const recs = data.records.filter((r) => r.partId === part.id);
    const totalHours = recs.reduce((a, r) => a + r.hours, 0);
    const totalSales = (part.unitPrice || 0) * (part.qty || 0);
    const hourlyRate = totalHours > 0 ? totalSales / totalHours : 0;
    const estHoursPerUnit = (part.estMinPerUnit || 0) / 60;
    const estTotalHours = estHoursPerUnit * (part.qty || 0);
    const progress = estTotalHours > 0 ? Math.min(totalHours / estTotalHours, 1) : null;
    const workerMap = {};
    for (const r of recs) workerMap[r.memberName] = (workerMap[r.memberName] || 0) + r.hours;
    const remainDays = diffDays(today(), part.deadline);
    const remainHours = estTotalHours - totalHours;
    const dailyNeeded = (remainDays && remainDays > 0 && remainHours > 0) ? remainHours / remainDays : null;
    const qtyRecs = (data.qtyRecords || []).filter((r) => r.partId === part.id);
    const completedQty = qtyRecs.reduce((a, r) => a + (r.qty || 0), 0);
    const remainQty = Math.max((part.qty || 0) - completedQty, 0);
    const qtyProgress = part.qty > 0 ? Math.min(completedQty / part.qty, 1) : null;
    const profit = part.assigneeType === "outsource" && part.sellPrice && part.vendorPrice
      ? (part.sellPrice - part.vendorPrice) * part.qty : null;
    const profitRate = profit !== null && part.sellPrice > 0
      ? ((part.sellPrice - part.vendorPrice) / part.sellPrice) * 100 : null;
    const vendorName = part.assigneeType === "outsource"
      ? ((data.vendors.find((v) => v.id === part.assignee) || {}).name || "未設定") : null;
    const brandName = (data.brands.find((b) => b.id === part.brandId) || {}).name || null;
    return Object.assign({}, part, { totalHours, totalSales, hourlyRate, estHoursPerUnit, estTotalHours, progress, workerMap, recs, remainDays, dailyNeeded, completedQty, remainQty, qtyProgress, profit, profitRate, vendorName, brandName });
  }), [data.parts, data.records, data.qtyRecords, data.vendors]);

  // 量産のみ（既存の集計・カレンダー類はこちらを使う）
  const partSummary = useMemo(() => allSummary.filter((p) => p.kind !== "sample"), [allSummary]);
  // サンプルのみ
  const sampleSummary = useMemo(() => allSummary.filter((p) => p.kind === "sample"), [allSummary]);

  const activePart = allSummary.find((p) => p.id === ui.activePartId);
  const teamParts = useMemo(() => {
    if (!ui.selectedTeam) return [];
    return partSummary.filter((p) => p.assigneeType === "team" && p.assignee === ui.selectedTeam && !p.closedAt);
  }, [partSummary, ui.selectedTeam]);

  const dashItems = useMemo(() => partSummary.filter((p) => !p.closedAt).sort((a, b) => {
    if (!a.deadline) return 1; if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  }), [partSummary]);

  const filteredMaster = useMemo(() => {
    if (ui.masterFilter === "all") return partSummary;
    if (ui.masterFilter === "未割当") return partSummary.filter((p) => !p.assignee || p.assignee === "未割当");
    if (ui.masterFilter === "外注") return partSummary.filter((p) => p.assigneeType === "outsource");
    return partSummary.filter((p) => p.assignee === ui.masterFilter);
  }, [partSummary, ui.masterFilter]);

  function addPart() {
    const f = ui.addPartForm;
    if (!f.partNo) return;
    const isOut = f.assigneeType === "outsource";
    const np = {
      id: genId(), partNo: f.partNo.trim(), partName: f.partName.trim(),
      unitPrice: parseFloat(f.unitPrice) || 0, qty: parseFloat(f.qty) || 0,
      estMinPerUnit: isOut ? 0 : (parseFloat(f.estMinPerUnit) || 0),
      deadline: f.deadline || null, status: f.status || "未着手", note: f.note.trim(),
      assignee: isOut ? f.vendorId : (f.assignee || "未割当"),
      assigneeType: f.assigneeType || "team",
      sellPrice: isOut ? (parseFloat(f.sellPrice) || 0) : 0,
      vendorPrice: isOut ? (parseFloat(f.vendorPrice) || 0) : 0,
      brandId: f.brandId || null,
      workMonth: f.workMonth || null,
      createdAt: today(), closedAt: null,
    };
    const nd = Object.assign({}, data, { parts: data.parts.concat([np]) });
    setData(nd);
    set({ addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estMinPerUnit: "", deadline: "", status: "未着手", note: "", assignee: "未割当", assigneeType: "team", vendorId: "", sellPrice: "", vendorPrice: "", brandId: "", workMonth: today().slice(0, 7) }, screen: "master" });
    setSaving(true); setSaveError(false);
    gasAddPart(np).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function savePart() {
    const f = ui.editPartForm;
    if (!f) return;
    const isOut = f.assigneeType === "outsource";
    const updatedPart = Object.assign({}, data.parts.find((p) => p.id === f.id), {
      partName: f.partName.trim(), unitPrice: parseFloat(f.unitPrice) || 0,
      qty: parseFloat(f.qty) || 0, estMinPerUnit: isOut ? 0 : (parseFloat(f.estMinPerUnit) || 0),
      deadline: f.deadline || null, status: f.status || "未着手", note: f.note.trim(),
      sellPrice: isOut ? (parseFloat(f.sellPrice) || 0) : 0,
      vendorPrice: isOut ? (parseFloat(f.vendorPrice) || 0) : 0,
      workMonth: f.workMonth || null, brandId: f.brandId || null,
    });
    const nd = Object.assign({}, data, { parts: data.parts.map((p) => p.id === f.id ? updatedPart : p) });
    setData(nd);
    set({ editPartForm: null, screen: "part_detail" });
    setSaving(true); setSaveError(false);
    gasUpdatePart(updatedPart).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function updatePartAssignee(id, assignee, assigneeType) {
    const updatedPart = Object.assign({}, data.parts.find((p) => p.id === id), { assignee, assigneeType });
    const nd = Object.assign({}, data, { parts: data.parts.map((p) => p.id === id ? updatedPart : p) });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasUpdatePart(updatedPart).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function closePart(id) {
    const updatedPart = Object.assign({}, data.parts.find((p) => p.id === id), { closedAt: today() });
    const nd = Object.assign({}, data, { parts: data.parts.map((p) => p.id === id ? updatedPart : p) });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasUpdatePart(updatedPart).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function reopenPart(id) {
    const updatedPart = Object.assign({}, data.parts.find((p) => p.id === id), { closedAt: null });
    const nd = Object.assign({}, data, { parts: data.parts.map((p) => p.id === id ? updatedPart : p) });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasUpdatePart(updatedPart).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function deletePart(id) {
    const nd = Object.assign({}, data, {
      parts: data.parts.filter((p) => p.id !== id),
      records: data.records.filter((r) => r.partId !== id),
      qtyRecords: (data.qtyRecords || []).filter((r) => r.partId !== id)
    });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasDeletePart(id).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function startEdit(part) {
    set({ editPartForm: { id: part.id, partName: part.partName || "", unitPrice: part.unitPrice || "", qty: part.qty || "", estMinPerUnit: part.estMinPerUnit || "", deadline: part.deadline || "", status: part.status || "未着手", note: part.note || "", sellPrice: part.sellPrice || "", vendorPrice: part.vendorPrice || "", assigneeType: part.assigneeType || "team", workMonth: part.workMonth || "", brandId: part.brandId || "" }, screen: "edit_part" });
  }

  function addRecord() {
    const f = ui.memberForm;
    const member = data.members.find((m) => m.id === f.memberId);
    if (!member || !f.partId || !f.hours) return;
    const newRecord = { id: genId(), partId: f.partId, memberId: f.memberId, memberName: member.name, hours: parseFloat(f.hours), date: f.date };
    const nd = Object.assign({}, data, { records: data.records.concat([newRecord]) });
    setData(nd);
    setMF({ hours: "" });
    setSaving(true); setSaveError(false);
    gasAddRecord(newRecord).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function deleteRecord(id) {
    const nd = Object.assign({}, data, { records: data.records.filter((r) => r.id !== id) });
    setData(nd);
    setSaving(true);
    setSaveError(false);
    gasDeleteRecord(id).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function addQtyRecord() {
    const f = ui.qtyForm;
    if (!f.partId || !f.qty) return;
    const newRecord = { id: genId(), partId: f.partId, qty: parseFloat(f.qty), date: f.date || today() };
    const nd = Object.assign({}, data, { qtyRecords: (data.qtyRecords || []).concat([newRecord]) });
    setData(nd);
    setQF({ qty: "", partId: "", date: today() });
    setSaving(true);
    setSaveError(false);
    gasAddQtyRecord(newRecord).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  // 生産価値の日報：選択中の品番の工程表から、枚数を入れた工程だけを一括追記
  function addKoteiRecords() {
    const partId = ui.kEntryPartId;
    const member = data.members.find((m) => m.id === ui.memberForm.memberId);
    if (!partId || !member) return;
    const sheet = (data.koteiSheets || []).find((s) => s.partId === partId);
    if (!sheet) return;
    const part = data.parts.find((p) => p.id === partId) || {};
    const date = ui.memberForm.date || today();
    const totalSec = sheet.totalSec || 0;
    const steps = (sheet.blocks || []).filter((b) => b.type === "step");
    let curPart = "";
    const newRecs = [];
    steps.forEach((b) => {
      if (b.part) curPart = b.part;
      const q = parseFloat((ui.kEntryQty || {})[b.id]);
      if (!q || q <= 0) return;
      newRecs.push({
        id: genId(), date: date, memberId: member.id, memberName: member.name,
        partId: partId, stepId: b.id, stepPart: curPart, stepAct: b.act || "",
        stepSec: parseKoteiTime(b.time), qty: q,
        totalSec: totalSec, unitPrice: part.unitPrice || 0,
      });
    });
    if (newRecs.length === 0) return;
    const nd = Object.assign({}, data, { koteiRecords: (data.koteiRecords || []).concat(newRecs) });
    setData(nd);
    set({ kEntryQty: {}, kEntryPartId: "" });
    setSaving(true); setSaveError(false);
    gasAddKoteiRecords(newRecs).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function deleteKoteiRecord(id) {
    const nd = Object.assign({}, data, { koteiRecords: (data.koteiRecords || []).filter((r) => r.id !== id) });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasDeleteItem("koteiRecords", id).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  // 統合入力：選択した品番について、時間（あれば）と工程の枚数（あれば）を1回で保存
  function saveEntry() {
    const f = ui.memberForm;
    const member = data.members.find((m) => m.id === f.memberId);
    if (!member || !f.partId) return;
    const date = f.date || today();
    let newRecord = null;
    const koteiRecs = [];
    // 時間
    if (f.hours && parseFloat(f.hours) > 0) {
      newRecord = { id: genId(), partId: f.partId, memberId: f.memberId, memberName: member.name, hours: parseFloat(f.hours), date: date };
    }
    // 工程の枚数（工程表がある品番のみ）
    const sheet = (data.koteiSheets || []).find((s) => s.partId === f.partId);
    if (sheet) {
      const part = data.parts.find((p) => p.id === f.partId) || {};
      const totalSec = sheet.totalSec || 0;
      const steps = (sheet.blocks || []).filter((b) => b.type === "step");
      let curPart = "";
      steps.forEach((b) => {
        if (b.part) curPart = b.part;
        const q = parseFloat((ui.kEntryQty || {})[b.id]);
        if (!q || q <= 0) return;
        koteiRecs.push({
          id: genId(), date: date, memberId: member.id, memberName: member.name,
          partId: f.partId, stepId: b.id, stepPart: curPart, stepAct: b.act || "",
          stepSec: parseKoteiTime(b.time), qty: q,
          totalSec: totalSec, unitPrice: part.unitPrice || 0,
        });
      });
    }
    if (!newRecord && koteiRecs.length === 0) return;
    let nd = data;
    if (newRecord) nd = Object.assign({}, nd, { records: nd.records.concat([newRecord]) });
    if (koteiRecs.length) nd = Object.assign({}, nd, { koteiRecords: (nd.koteiRecords || []).concat(koteiRecs) });
    setData(nd);
    setMF({ hours: "", partId: "" });
    set({ kEntryQty: {} });
    setSaving(true); setSaveError(false);
    const ps = [];
    if (newRecord) ps.push(gasAddRecord(newRecord));
    if (koteiRecs.length) ps.push(gasAddKoteiRecords(koteiRecs));
    Promise.all(ps).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
    // 記録後はヒーロー（今日の生産価値）へ滑らかにスクロール。フォームが畳まれた後の位置に合わせる
    setTimeout(() => {
      const el = document.getElementById("entry-hero");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function addMember() {
    const name = ui.addMemberForm.name.trim();
    if (!name) return;
    const m = { id: genId(), name };
    applyLocal({ members: data.members.concat([m]) }, () => gasUpsertItem("members", m));
    set({ addMemberForm: { name: "" } });
  }
  function deleteMember(id) { applyLocal({ members: data.members.filter((m) => m.id !== id) }, () => gasDeleteItem("members", id)); }
  function saveMemberName() {
    const name = ui.editMemberName.trim();
    if (!name) return;
    const updated = data.members.map((m) => m.id === ui.editMemberId ? Object.assign({}, m, { name }) : m);
    const item = updated.find((m) => m.id === ui.editMemberId);
    applyLocal({ members: updated }, () => gasUpsertItem("members", item));
    set({ editMemberId: null, editMemberName: "" });
  }

  function addVendor() {
    const name = ui.addVendorForm.name.trim();
    if (!name) return;
    const v = { id: genId(), name };
    applyLocal({ vendors: data.vendors.concat([v]) }, () => gasUpsertItem("vendors", v));
    set({ addVendorForm: { name: "" } });
  }
  function deleteVendor(id) { applyLocal({ vendors: data.vendors.filter((v) => v.id !== id) }, () => gasDeleteItem("vendors", id)); }
  function saveVendorName() {
    const name = ui.editVendorName.trim();
    if (!name) return;
    const updated = data.vendors.map((v) => v.id === ui.editVendorId ? Object.assign({}, v, { name }) : v);
    const item = updated.find((v) => v.id === ui.editVendorId);
    applyLocal({ vendors: updated }, () => gasUpsertItem("vendors", item));
    set({ editVendorId: null, editVendorName: "" });
  }

  function addBrand() {
    const name = ui.addBrandForm.name.trim();
    if (!name) return;
    const b = { id: genId(), name };
    applyLocal({ brands: (data.brands || []).concat([b]) }, () => gasUpsertItem("brands", b));
    set({ addBrandForm: { name: "" } });
  }
  function deleteBrand(id) { applyLocal({ brands: (data.brands || []).filter((b) => b.id !== id) }, () => gasDeleteItem("brands", id)); }
  function saveBrandName() {
    const name = ui.editBrandName.trim();
    if (!name) return;
    const updated = (data.brands || []).map((b) => b.id === ui.editBrandId ? Object.assign({}, b, { name }) : b);
    const item = updated.find((b) => b.id === ui.editBrandId);
    applyLocal({ brands: updated }, () => gasUpsertItem("brands", item));
    set({ editBrandId: null, editBrandName: "" });
  }

  const setSF = (patch) => setUi((p) => Object.assign({}, p, { saidanForm: Object.assign({}, p.saidanForm, patch) }));

  const SAIDAN_METHODS = ["CAM", "手裁断"];
  const SAIDAN_NEXT = ["Aチーム", "Bチーム", "Cチーム", "サンプルチーム", "外注"];
  const emptySaidanColors = () => [{ name: "", counts: ["","","","",""], inM: "", useM: "" }];

  function openSaidan(part) {
    const existing = (data.saidanReports || []).find((r) => r.partId === part.id);
    let form;
    if (existing) {
      form = Object.assign({}, existing);
    } else {
      form = {
        id: null, partId: part.id,
        date: today(), cutter: "", method: "CAM",
        fabric: "", lot: "",
        planned: part.qty || "", defect: "",
        ydSpec: "", ydReal: "",
        sizes: ["XS", "S", "M", "L", "LL"],
        colors: emptySaidanColors(),
        nextTeam: part.assignee && part.assigneeType === "team" ? part.assignee : "Aチーム",
        vendorName: "", note: "",
      };
    }
    set({ saidanPartId: part.id, saidanForm: form, screen: "saidan_report" });
  }

  function saveSaidan() {
    const f = ui.saidanForm;
    if (!f) return;
    // 使用mを自動計算して保存
    const fl = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
    const colors = (f.colors || []).map((c) => {
      const total = (c.counts || []).reduce((a, v) => a + (parseInt(v, 10) || 0), 0);
      const useM = fl(f.ydReal) * total;
      return Object.assign({}, c, { useM: useM > 0 ? useM.toFixed(2) : "" });
    });
    const list = (data.saidanReports || []).slice();
    let rec;
    if (f.id) {
      rec = Object.assign({}, f, { colors, updatedAt: today() });
      const idx = list.findIndex((r) => r.id === f.id);
      if (idx >= 0) list[idx] = rec;
      else list.push(rec);
    } else {
      rec = Object.assign({}, f, { colors, id: genId(), createdAt: today(), updatedAt: today() });
      const idx = list.findIndex((r) => r.partId === f.partId);
      if (idx >= 0) { rec = Object.assign(rec, { id: list[idx].id }); list[idx] = rec; }
      else list.push(rec);
    }
    applyLocal({ saidanReports: list }, () => gasUpsertItem("saidanReports", rec));
    set({ screen: "part_detail" });
  }

  function deleteSaidan(partId) {
    const rep = (data.saidanReports || []).find((r) => r.partId === partId);
    applyLocal({ saidanReports: (data.saidanReports || []).filter((r) => r.partId !== partId) }, () => rep ? gasDeleteItem("saidanReports", rep.id) : Promise.resolve());
  }

  function openKotei(part) {
    // 工程表がまだ無い品番は「白紙／テンプレ／メモ取込」を選ばせる（テンプレ0件でも白紙・メモ取込は選べる）
    const sheet = (data.koteiSheets || []).find(function (r) { return r.partId === part.id; });
    if (!sheet) { set({ koteiNewPartId: part.id, screen: "kotei_new_choice" }); return; }
    set({ koteiPartId: part.id, koteiReturn: "part_detail", screen: "kotei_edit" });
  }
  function saveKotei(rec) {
    const list = (data.koteiSheets || []).slice();
    const idx = list.findIndex((r) => r.id === rec.id);
    if (idx >= 0) list[idx] = rec; else list.push(rec);
    applyLocal({ koteiSheets: list }, () => gasUpsertItem("koteiSheets", rec));
  }
  function deleteKotei(id) {
    applyLocal({ koteiSheets: (data.koteiSheets || []).filter((r) => r.id !== id) }, () => gasDeleteItem("koteiSheets", id));
  }

  // ── 工程表テンプレ：partIdがnullの工程表＝テンプレ（既存画面はpartIdで引くため互いに干渉しない）
  function koteiTemplates() {
    return (data.koteiSheets || []).filter(function (r) { return !r.partId; });
  }

  // KoteiEditorに渡す共通コンテキスト（パーツ名・作業候補の辞書）を組み立てる
  function buildKoteiCtx() {
    const partList = (data.koteiParts && data.koteiParts.length) ? data.koteiParts : KOTEI_PARTS;
    const stdSet = {}; partList.forEach(function (p) { stdSet[p] = true; });
    const extraParts = [];
    const phraseCats = (data.koteiPhrases && Object.keys(data.koteiPhrases).length) ? data.koteiPhrases : KOTEI_PHRASE_CATS;
    const phSet = {}; Object.keys(phraseCats).forEach(function (c) { (phraseCats[c] || []).forEach(function (p) { phSet[p] = true; }); });
    const extraPhrases = [];
    (data.koteiSheets || []).forEach(function (s) { (s.blocks || []).forEach(function (b) {
      if (b.type === "step") {
        if (b.part && !stdSet[b.part] && extraParts.indexOf(b.part) < 0) extraParts.push(b.part);
        if (b.act) b.act.split(/[、・\n\s]+/).forEach(function (w) { w = w.trim(); if (w.length >= 2 && !phSet[w]) { phSet[w] = true; extraPhrases.push(w); } });
      }
    }); });
    return { partList: partList, extraParts: extraParts, phraseCats: phraseCats, extraPhrases: extraPhrases };
  }

  // テンプレから品番の工程表を作る：全工程をコピーして新しいIDを振る（テンプレ本体は変えない）
  function createSheetFromTemplate(tpl, partId) {
    const rec = Object.assign({}, tpl, {
      id: genId(),
      partId: partId,
      blocks: (tpl.blocks || []).map(function (b) { return Object.assign({}, b, { id: genId() }); }),
      updatedAt: today(),
    });
    delete rec.templateName;
    saveKotei(rec);
    set({ koteiPartId: partId, koteiReturn: "part_detail", screen: "kotei_edit", koteiNewPartId: null });
  }

  // 手書きメモの解析結果から品番の工程表を作る（P2）：行にIDを振ってそのままblocks化。
  // 清書・並べ替えはしない。保存は既存のsaveKotei（=既存upsertItem機構）に乗せる。
  function createSheetFromMemo(rows, partId) {
    const blocks = rows.map(function (r) { return { id: genId(), type: "step", part: r.part, act: r.act, time: r.time, note: r.note || "" }; });
    // parseKoteiTimeは読めないコロン表記（例 xx:yy）でNaNを返すため、合計はNaNガードする
    let tot = 0; blocks.forEach(function (b) { tot += parseKoteiTime(b.time) || 0; });
    const rec = { id: genId(), partId: partId, needle: "", unten: "", thread: "", headNote: "", targetPerDay: "", workMin: 420,
      sizes: ["XS", "S", "M", "L"], colors: [{ name: "", counts: ["", "", "", ""] }],
      blocks: blocks, totalSec: tot, designImgId: "", updatedAt: today() };
    saveKotei(rec);
    set({ koteiPartId: partId, koteiReturn: "part_detail", screen: "kotei_edit", koteiNewPartId: null });
  }

  // テンプレの全削除：partIdがnullの工程表だけを消す。品番の工程表・日報には一切触れない。
  // 旧形式のテンプレが残ってしまった時に、消して一括登録し直すための導線。
  function deleteAllTemplates() {
    const tpls = koteiTemplates();
    if (tpls.length === 0) return;
    applyLocal({ koteiSheets: (data.koteiSheets || []).filter(function (r) { return r.partId; }) }, function () {
      return tpls.reduce(function (p, t) { return p.then(function () { return gasDeleteItem("koteiSheets", t.id); }); }, Promise.resolve());
    });
  }

  // 標準9テンプレの一括登録（テンプレが1つも無い時だけ一覧にボタンが出る）
  function seedStandardTemplates() {
    const recs = STD_KOTEI_TEMPLATES.map(function (t) {
      return { id: genId(), partId: null, templateName: t.name,
        // 作業内容は実文で入れず、hint（グレーの例文）として持つ。入力すると消える。
        blocks: t.steps.map(function (s) { return { id: genId(), type: "step", part: s[0], act: "", hint: s[1], time: "", note: "" }; }),
        totalSec: 0, updatedAt: today() };
    });
    const list = (data.koteiSheets || []).concat(recs);
    // GASへは1件ずつ順番に送る（既存のupsertItemに乗せる・同時多発の書き込みを避ける）
    applyLocal({ koteiSheets: list }, function () {
      return recs.reduce(function (p, r) { return p.then(function () { return gasUpsertItem("koteiSheets", r); }); }, Promise.resolve());
    });
  }

  function printSaidan(form) {
    const f = form;
    const part = data.parts.find((x) => x.id === f.partId) || {};
    const brandName = ((data.brands || []).find((b) => b.id === part.brandId) || {}).name || "";
    const num = (v) => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
    const fl = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
    const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const sizes = f.sizes || ["", "", "", "", ""];
    const colTotals = [0,0,0,0,0];
    let grand = 0, sumIn = 0, sumUse = 0;
    const rows = (f.colors || []).map((c) => {
      let rt = 0;
      (c.counts || []).forEach((v, i) => { const n = num(v); rt += n; colTotals[i] += n; });
      grand += rt;
      const inM = fl(c.inM), useM = fl(c.useM), rem = inM - useM;
      sumIn += inM; sumUse += useM;
      const cells = (c.counts || []).map((v) => "<td class='c'>" + (num(v) || "") + "</td>").join("");
      return "<tr><td class='cn'>" + esc(c.name) + "</td>" + cells +
        "<td class='rt'>" + (rt || "") + "</td>" +
        "<td class='m'>" + (inM ? inM.toFixed(1) : "") + "</td>" +
        "<td class='m'>" + (useM ? useM.toFixed(1) : "") + "</td>" +
        "<td class='m rem'>" + (inM || useM ? rem.toFixed(1) : "") + "</td></tr>";
    }).join("");
    const sumRem = sumIn - sumUse;
    const good = Math.max(0, grand - num(f.defect));
    const diff = grand - num(f.planned);
    const ydDiff = fl(f.ydReal) - fl(f.ydSpec);
    const nextLabel = f.nextTeam === "外注" ? ("外注" + (f.vendorName ? "（" + f.vendorName + "）" : "")) : (f.nextTeam || "");
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>裁断報告書 ${esc(part.partNo || "")}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:11pt;color:#1a1a1a;padding:12mm 14mm;max-width:210mm}
h1{font-size:15pt;font-weight:700;margin-bottom:6mm;border-bottom:2px solid #1a1a1a;padding-bottom:2mm}
.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4mm 8mm;margin-bottom:6mm}
.meta-item label{font-size:8pt;color:#888;display:block;margin-bottom:1mm}
.meta-item .val{font-size:11pt;font-weight:600}
table{width:100%;border-collapse:collapse;margin-bottom:5mm;font-size:10pt}
th,td{border:1px solid #ccc;padding:2mm 3mm;text-align:center}
th{background:#f0eeea;font-weight:700;font-size:9pt}
td.cn{text-align:left;font-weight:600}
td.rt{font-weight:700;background:#f5f4f0}
td.m{font-size:9pt}
td.rem{color:${sumRem < 0 ? "#c00" : "#1a1a1a"}}
.sum-row td{background:#e8e6e0;font-weight:700}
.totals{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-bottom:5mm}
.tbox{background:#f5f4f0;border-radius:6px;padding:3mm 4mm}
.tbox label{font-size:8pt;color:#888;display:block;margin-bottom:1mm}
.tbox .val{font-size:13pt;font-weight:700}
.tbox .val.alert{color:#c00}
.note{border:1px solid #ccc;border-radius:4px;padding:3mm;min-height:12mm;font-size:10pt}
.footer{display:flex;justify-content:space-between;font-size:9pt;color:#888;margin-top:6mm;border-top:1px solid #ddd;padding-top:2mm}
@media print{body{padding:8mm 10mm}button{display:none}}
</style></head><body>
<h1>裁断報告書</h1>
<div class="meta">
  <div class="meta-item"><label>品番</label><div class="val">${esc(part.partNo || "")}</div></div>
  <div class="meta-item"><label>品名</label><div class="val">${esc(part.partName || "—")}</div></div>
  <div class="meta-item"><label>ブランド・客先</label><div class="val">${esc(brandName || "—")}</div></div>
  <div class="meta-item"><label>裁断日</label><div class="val">${esc(f.date || "")}</div></div>
  <div class="meta-item"><label>裁断者</label><div class="val">${esc(f.cutter || "")}</div></div>
  <div class="meta-item"><label>裁断方法</label><div class="val">${esc(f.method || "")}</div></div>
  <div class="meta-item"><label>生地名</label><div class="val">${esc(f.fabric || "—")}</div></div>
  <div class="meta-item"><label>ロット番号</label><div class="val">${esc(f.lot || "—")}</div></div>
  <div class="meta-item"><label>次工程</label><div class="val">${esc(nextLabel)}</div></div>
</div>
<table>
  <tr><th>カラー</th>${sizes.map((s) => "<th>" + esc(s) + "</th>").join("")}<th>計</th><th>入荷m</th><th>使用m</th><th>残布m</th></tr>
  ${rows}
  <tr class="sum-row"><td>合計</td>${colTotals.map((n) => "<td>" + (n || "") + "</td>").join("")}<td>${grand || ""}</td><td>${sumIn ? sumIn.toFixed(1) : ""}</td><td>${sumUse ? sumUse.toFixed(1) : ""}</td><td class="rem">${sumIn || sumUse ? (sumRem).toFixed(1) : ""}</td></tr>
</table>
<div class="totals">
  <div class="tbox"><label>予定枚数</label><div class="val">${num(f.planned) || "—"}枚</div></div>
  <div class="tbox"><label>裁断合計</label><div class="val">${grand || "—"}枚</div></div>
  <div class="tbox"><label>不良・ロス</label><div class="val ${num(f.defect) > 0 ? "alert" : ""}">${num(f.defect) || 0}枚</div></div>
  <div class="tbox"><label>良品数</label><div class="val">${good || "—"}枚${diff !== 0 ? "<span style='font-size:9pt;color:" + (diff > 0 ? "#2a7a2a" : "#c00") + "'>（" + (diff > 0 ? "+" : "") + diff + "）</span>" : ""}</div></div>
  <div class="tbox"><label>客先指定用尺</label><div class="val">${fl(f.ydSpec) ? fl(f.ydSpec).toFixed(2) + "m" : "—"}</div></div>
  <div class="tbox"><label>実用尺</label><div class="val">${fl(f.ydReal) ? fl(f.ydReal).toFixed(2) + "m" : "—"}</div></div>
  <div class="tbox"><label>用尺差</label><div class="val ${ydDiff > 0 ? "alert" : ""}">${fl(f.ydSpec) || fl(f.ydReal) ? (ydDiff > 0 ? "+" : "") + ydDiff.toFixed(2) + "m" : "—"}</div></div>
  <div class="tbox"><label>残布合計</label><div class="val">${sumIn || sumUse ? sumRem.toFixed(1) + "m" : "—"}</div></div>
</div>
${f.note ? "<div style='margin-bottom:4mm'><div style='font-size:9pt;color:#888;margin-bottom:1mm'>特記事項・申し送り</div><div class='note'>" + esc(f.note) + "</div></div>" : ""}
<div class="footer"><span>株式会社生田プリーツ</span><span>出力: ${today()}</span></div>
<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250)}<\/script>
</body></html>`;
    let frame = document.getElementById("saidan-print-frame");
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = document.createElement("iframe");
    frame.id = "saidan-print-frame";
    frame.setAttribute("style", "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;");
    document.body.appendChild(frame);
    const d = frame.contentWindow.document;
    d.open(); d.write(html); d.close();
  }

  function openSampleNew() {
    set({ sampleForm: { id: null, partNo: "", partName: "", brandId: "", qty: "", samplePrice: "", actualHours: "", massEstMin: "", assignee: "サンプルチーム", tantousha: "", note: "", workMonth: today().slice(0, 7), deadline: "", closedAt: null }, screen: "sample_edit" });
  }

  function openSampleEdit(part) {
    set({ sampleForm: { id: part.id, partNo: part.partNo || "", partName: part.partName || "", brandId: part.brandId || "", qty: part.qty || "", samplePrice: part.unitPrice || "", actualHours: part.actualHours || "", massEstMin: part.massEstMin || "", assignee: part.assignee || "サンプルチーム", tantousha: part.tantousha || "", note: part.note || "", workMonth: part.workMonth || today().slice(0, 7), deadline: part.deadline || "", closedAt: part.closedAt || null }, screen: "sample_edit" });
  }

  function saveSample() {
    const f = ui.sampleForm;
    if (!f.partNo) return;
    if (f.id) {
      const updated = Object.assign({}, data.parts.find((p) => p.id === f.id), {
        partNo: f.partNo.trim(), partName: f.partName.trim(), brandId: f.brandId || null,
        qty: parseFloat(f.qty) || 0, unitPrice: parseFloat(f.samplePrice) || 0,
        actualHours: parseFloat(f.actualHours) || 0, massEstMin: parseFloat(f.massEstMin) || 0,
        assignee: f.assignee || "サンプルチーム", tantousha: (f.tantousha || "").trim(), note: f.note.trim(),
        workMonth: f.workMonth || null, deadline: f.deadline || null,
      });
      const nd = Object.assign({}, data, { parts: data.parts.map((p) => p.id === f.id ? updated : p) });
      setData(nd);
      set({ sampleForm: null, screen: "sample_list" });
      setSaving(true); setSaveError(false);
      gasUpdatePart(updated).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
    } else {
      const np = {
        id: genId(), kind: "sample", partNo: f.partNo.trim(), partName: f.partName.trim(),
        brandId: f.brandId || null, qty: parseFloat(f.qty) || 0, unitPrice: parseFloat(f.samplePrice) || 0,
        actualHours: parseFloat(f.actualHours) || 0, massEstMin: parseFloat(f.massEstMin) || 0,
        estMinPerUnit: 0, assignee: f.assignee || "サンプルチーム", assigneeType: "team", tantousha: (f.tantousha || "").trim(),
        note: f.note.trim(), workMonth: f.workMonth || null, deadline: f.deadline || null,
        status: "未着手", sellPrice: 0, vendorPrice: 0, createdAt: today(), closedAt: null,
      };
      const nd = Object.assign({}, data, { parts: data.parts.concat([np]) });
      setData(nd);
      set({ sampleForm: null, screen: "sample_list" });
      setSaving(true); setSaveError(false);
      gasAddPart(np).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
    }
  }

  function toggleSampleDone(part) {
    const updated = Object.assign({}, part, { closedAt: part.closedAt ? null : today() });
    const nd = Object.assign({}, data, { parts: data.parts.map((p) => p.id === part.id ? updated : p) });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasUpdatePart(updated).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function deleteSample(id) {
    const nd = Object.assign({}, data, { parts: data.parts.filter((p) => p.id !== id) });
    setData(nd);
    setSaving(true); setSaveError(false);
    gasDeletePart(id).catch((e) => { console.error(e); setSaveError(true); }).finally(() => setSaving(false));
  }

  function saveTarget() {
    const f = ui.targetForm;
    if (!f.month || !f.team) return;
    const value = {
      sales: parseFloat(f.sales) || 0,
      members: parseFloat(f.members) || 0,
      workDays: parseFloat(f.workDays) || 0,
      hoursPerDay: parseFloat(f.hoursPerDay) || 0,
    };
    const nt = Object.assign({}, data.monthlyTargets);
    nt[f.month] = Object.assign({}, nt[f.month] || {});
    nt[f.month][f.team] = value;
    applyLocal({ monthlyTargets: nt }, () => gasSetTarget(f.month, f.team, value));
    setTF({ sales: "", members: "", workDays: "", hoursPerDay: "" });
  }

  function downloadCSV() {
    let csv = "\uFEFF品番,品名,担当,数量,完成枚数,残り枚数,納期,総作業時間,売上,時間単価,ステータス,登録日,完了日\n";
    partSummary.forEach((p) => {
      const assignee = p.assigneeType === "outsource" ? "外注:" + (p.vendorName || "?") : (p.assignee || "未割当");
      csv += [p.partNo, p.partName || "", assignee, p.qty, p.completedQty, p.remainQty, p.deadline || "", p.totalHours.toFixed(1), Math.round(p.totalSales), p.totalHours > 0 ? Math.round(p.hourlyRate) : "", p.status || "", p.createdAt || "", p.closedAt || ""].join(",") + "\n";
    });
    csv += "\n\nメンバー別作業記録\n氏名,品番,日付,作業時間\n";
    data.records.forEach((r) => {
      const part = data.parts.find((p) => p.id === r.partId);
      csv += [r.memberName, part ? part.partNo : "?", r.date, r.hours].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "作業実績_" + today() + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function exportToSheet() {
    const month = ui.summaryMonth;
    fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: "report", month: month, data: data }) })
      .then((res) => res.json()).then(() => alert("スプレッドシートに出力しました！\nGoogleスプレッドシートの「月次レポート」シートを確認してください。"))
      .catch(() => alert("出力に失敗しました。"));
  }

  if (loading) return React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, fontFamily: "'Hiragino Sans', sans-serif" } },
    React.createElement("div", { style: st.spinner }),
    React.createElement("div", { style: { color: "#aaa", fontSize: 14 } }, "読み込み中...")
  );

  const SI = () => React.createElement("div", { style: { position: "fixed", bottom: 16, right: 16, zIndex: 100 } },
    saving && React.createElement("div", { style: st.saveBadge }, "保存中..."),
    // 未送信キューがあるときはボタン化: タップで再送（入力内容は端末に保持されているので消えない）
    !saving && pendingN > 0 && React.createElement("button", { style: Object.assign({}, st.saveBadge, { background: "var(--aka)", border: "none", cursor: "pointer" }), onClick: retryPending }, "保存失敗 - 未送信" + pendingN + "件を再試行"),
    !saving && pendingN === 0 && saveError && React.createElement("div", { style: Object.assign({}, st.saveBadge, { background: "var(--aka)" }) }, "保存失敗 - もう一度お試しください")
  );

  if (ui.screen === "home") {
    const unassigned = partSummary.filter((p) => (!p.assignee || p.assignee === "未割当") && !p.closedAt).length;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "iquta生産管理" }),
      React.createElement(Body, null,
        React.createElement(BigBtn, { label: "集計・仕事量管理", sub: "全体・チーム別の実績と予算", onClick: () => set({ screen: "summary" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "納期カレンダー", sub: "品番ごとの納品予定日を一覧", onClick: () => set({ screen: "deadline_calendar", dlMonth: today().slice(0, 7) }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "売上カレンダー", sub: "日ごとの完成売上を全体・チーム別で確認", onClick: () => set({ screen: "sales_calendar", salesMonth: today().slice(0, 7), salesTeam: "all" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "ダッシュボード", sub: "納期・進捗を一目で確認", onClick: () => set({ screen: "dashboard" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "ブランド別仕事一覧", sub: "客先ごとの納品前・納品済みを確認", onClick: () => set({ screen: "brand_jobs", selectedBrandId: null }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "サンプル管理", sub: "サンプル作成の記録・実働時間・サンプル代", onClick: () => set({ screen: "sample_list" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "工程分析表", sub: "品番ごとの工程・時間・図を一覧／作成・印刷", onClick: () => set({ screen: "kotei_list", koteiSearch: "" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "生産価値", sub: "人・日・品番ごとの時間と生産価値を振り返る", onClick: () => set({ screen: "value_view", vvAxis: "member", vvPeriod: "month", vvMonth: today().slice(0, 7), vvExpanded: {} }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { label: "品番マスター", sub: "全品番の登録・割当管理" + (unassigned > 0 ? "　未割当 " + unassigned + "件" : ""), onClick: () => set({ screen: "master", masterFilter: "all" }) }),
        React.createElement(Spacer, { h: 12 }),
        React.createElement(Divider, { label: "チームを選ぶ" }),
        TEAMS.map((team) => {
          const cnt = partSummary.filter((p) => p.assignee === team && !p.closedAt).length;
          return React.createElement("div", { key: team, style: { marginBottom: 12 } },
            React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
              React.createElement(TeamBadge, { team }),
              cnt > 0 && React.createElement("span", { style: { fontSize: 11, color: "#aaa" } }, cnt + "品番進行中")
            ),
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              React.createElement(RoleBtn, { label: "リーダー", onClick: () => set({ selectedTeam: team, userRole: "leader", screen: "team_leader" }) }),
              React.createElement(RoleBtn, { label: "メンバー", onClick: () => set({ selectedTeam: team, userRole: "member", screen: "member_entry", memberForm: { memberId: "", partId: "", hours: "", date: today() } }) })
            )
          );
        }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(Divider, { label: "管理設定" }),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 8 } },
          React.createElement(QuickBtn, { label: "メンバー管理", onClick: () => set({ screen: "member_mgmt" }) }),
          React.createElement(QuickBtn, { label: "外注先管理", onClick: () => set({ screen: "vendor_mgmt" }) })
        ),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement(QuickBtn, { label: "ブランド管理", onClick: () => set({ screen: "brand_mgmt" }) })
        )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "master") {
    const filters = ["all", "未割当"].concat(TEAMS).concat(["外注"]);
    const unassigned = partSummary.filter((p) => (!p.assignee || p.assignee === "未割当") && !p.closedAt);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番マスター", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("button", { style: st.dashedBtn, onClick: () => set({ screen: "add_part" }) }, "＋ 新しい品番を登録する"),
        unassigned.length > 0 && React.createElement("div", { style: { background: "#fdf6f6", border: "1px solid #f0dbdb", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--aka)", fontWeight: 600 } }, "担当未割当の品番が " + unassigned.length + " 件あります"),
        React.createElement("div", { style: st.filterRow }, filters.map((f) => React.createElement("button", { key: f, style: Object.assign({}, st.filterBtn, ui.masterFilter === f ? st.filterBtnActive : {}), onClick: () => set({ masterFilter: f }) }, f === "all" ? "全体" : f))),
        React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 12 } }, filteredMaster.length + "件"),
        filteredMaster.length === 0 && React.createElement(Empty, null, "品番がありません"),
        filteredMaster.map((p) => React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left" }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "master" }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } },
            React.createElement("div", null, React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, p.partNo), p.partName && React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, p.partName)),
            React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" } },
              React.createElement(Badge, { part: p }),
              React.createElement(AssigneeBadge, { part: p, vendors: data.vendors }),
              React.createElement("span", { style: { color: "#ccc" } }, "›")
            )
          ),
          p.qtyProgress !== null && React.createElement("div", { style: { marginBottom: 8 } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 3 } },
              React.createElement("span", null, "完成 " + p.completedQty + "枚 / " + p.qty + "枚"),
              React.createElement("span", { style: { color: p.remainQty === 0 ? "var(--iquta-d)" : "var(--soft)" } }, "残り " + p.remainQty + "枚")
            ),
            React.createElement(ProgressBar, { value: p.qtyProgress, color: p.remainQty === 0 ? "var(--iquta-d)" : "var(--iquta)" })
          ),
          React.createElement("div", { style: { display: "flex", gap: 8, fontSize: 12, color: "#aaa", flexWrap: "wrap" } },
            p.brandName && React.createElement("span", { style: { color: "#888", fontWeight: 600 } }, "🏷 " + p.brandName),
            p.workMonth && React.createElement("span", { style: { color: "var(--iquta)", fontWeight: 600 } }, p.workMonth.replace("-", "年") + "月仕掛り"),
            React.createElement("span", null, p.qty + "枚"),
            p.deadline && React.createElement("span", { style: { color: p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "#c25000" : "#aaa" } }, "納期: " + fmt(p.deadline) + (p.remainDays !== null ? "（あと" + p.remainDays + "日）" : "")),
            p.status && React.createElement("span", null, p.status)
          )
        ))
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "add_part") {
    const f = ui.addPartForm;
    const isOut = f.assigneeType === "outsource";
    const estHoursPerUnit = (parseFloat(f.estMinPerUnit) || 0) / 60;
    const estTotal = (!isOut && f.unitPrice && f.qty && f.estMinPerUnit) ? { sales: parseFloat(f.unitPrice) * parseFloat(f.qty), hours: estHoursPerUnit * parseFloat(f.qty) } : null;
    const profit = (isOut && f.sellPrice && f.vendorPrice && f.qty) ? (parseFloat(f.sellPrice) - parseFloat(f.vendorPrice)) * parseFloat(f.qty) : null;
    const ready = f.partNo;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番を登録", back: () => set({ screen: "master" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品番 ＊" }, React.createElement("input", { style: st.input, placeholder: "例: A-2024-001", value: f.partNo, onChange: (e) => setAP({ partNo: e.target.value }) })),
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, placeholder: "例: プリーツスカート", value: f.partName, onChange: (e) => setAP({ partName: e.target.value }) })),
          React.createElement(FormRow, { label: "ブランド（客先名）" },
            (data.brands || []).length === 0
              ? React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                  React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "ブランドが未登録です"),
                  React.createElement("button", { style: Object.assign({}, st.ghostBtn, { fontSize: 11 }), onClick: () => set({ screen: "brand_mgmt" }) }, "登録する →")
                )
              : React.createElement("select", { style: st.input, value: f.brandId, onChange: (e) => setAP({ brandId: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択しない"),
                  (data.brands || []).map((b) => React.createElement("option", { key: b.id, value: b.id }, b.name))
                )
          ),
          React.createElement(FormRow, { label: "仕掛り月 ＊" },
            React.createElement("input", { style: st.input, type: "month", value: f.workMonth, onChange: (e) => setAP({ workMonth: e.target.value }) }),
            React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 4 } }, "月次集計・目標の基準月になります")
          ),
          React.createElement(FormRow, { label: "ステータス" }, React.createElement("select", { style: st.input, value: f.status, onChange: (e) => setAP({ status: e.target.value }) }, STATUSES.map((s) => React.createElement("option", { key: s }, s)))),
          React.createElement(FormRow, { label: "数量（枚）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 50", value: f.qty, onChange: (e) => setAP({ qty: e.target.value }) })),
          React.createElement(FormRow, { label: "納期（任意）" }, React.createElement("input", { style: st.input, type: "date", value: f.deadline, onChange: (e) => setAP({ deadline: e.target.value }) })),
          React.createElement(FormRow, { label: "担当" },
            React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 } },
              React.createElement("button", { style: Object.assign({}, st.assignBtn, f.assigneeType === "team" && f.assignee === "未割当" ? st.assignBtnActive : {}), onClick: () => setAP({ assigneeType: "team", assignee: "未割当" }) }, "未割当"),
              TEAMS.map((t) => React.createElement("button", { key: t, style: Object.assign({}, st.assignBtn, f.assigneeType === "team" && f.assignee === t ? st.assignBtnActive : {}), onClick: () => setAP({ assigneeType: "team", assignee: t }) }, t)),
              React.createElement("button", { style: Object.assign({}, st.assignBtn, f.assigneeType === "outsource" ? st.assignBtnActive : {}), onClick: () => setAP({ assigneeType: "outsource" }) }, "外注")
            ),
            f.assigneeType === "outsource" && (data.vendors.length === 0
              ? React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "外注先が登録されていません")
              : React.createElement("select", { style: st.input, value: f.vendorId, onChange: (e) => setAP({ vendorId: e.target.value }) },
                  React.createElement("option", { value: "" }, "外注先を選択"),
                  data.vendors.map((v) => React.createElement("option", { key: v.id, value: v.id }, v.name))
                ))
          ),
          !isOut && React.createElement("div", null,
            React.createElement(FormRow, { label: "製品単価（円）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3000", value: f.unitPrice, onChange: (e) => setAP({ unitPrice: e.target.value }) })),
            React.createElement(FormRow, { label: "1着あたりの見積もり時間（分）" },
              React.createElement("input", { style: st.input, type: "number", placeholder: "例: 45", min: "0", step: "1", value: f.estMinPerUnit, onChange: (e) => setAP({ estMinPerUnit: e.target.value }) }),
              f.estMinPerUnit && React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 4 } }, "→ " + estHoursPerUnit.toFixed(2) + "h/着")
            )
          ),
          isOut && React.createElement("div", null,
            React.createElement(FormRow, { label: "販売単価（円）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 5000", value: f.sellPrice, onChange: (e) => setAP({ sellPrice: e.target.value }) })),
            React.createElement(FormRow, { label: "外注単価（円）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3000", value: f.vendorPrice, onChange: (e) => setAP({ vendorPrice: e.target.value }) }))
          ),
          React.createElement(FormRow, { label: "備考" }, React.createElement("input", { style: st.input, placeholder: "メモなど", value: f.note, onChange: (e) => setAP({ note: e.target.value }) })),
          estTotal && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: "#f0f8f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "合計売上予定"), React.createElement("b", null, "¥" + Math.round(estTotal.sales).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "総見積もり時間"), React.createElement("b", null, estTotal.hours.toFixed(1) + "h")),
            estTotal.hours > 0 && React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "目標時間単価"), React.createElement("b", { style: { color: "var(--iquta-d)" } }, "¥" + Math.round(estTotal.sales / estTotal.hours).toLocaleString() + "/h"))
          ),
          profit !== null && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: profit >= 0 ? "#f0f8f0" : "#fff0f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "売上合計"), React.createElement("b", null, "¥" + Math.round(parseFloat(f.sellPrice) * parseFloat(f.qty)).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "外注費合計"), React.createElement("b", null, "¥" + Math.round(parseFloat(f.vendorPrice) * parseFloat(f.qty)).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "利益"), React.createElement("b", { style: { color: profit >= 0 ? "var(--iquta-d)" : "#c00" } }, "¥" + Math.round(profit).toLocaleString()))
          ),
          React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: addPart }, "登録する")
        )
      )
    );
  }

  if (ui.screen === "edit_part" && ui.editPartForm) {
    const f = ui.editPartForm;
    const isOut = f.assigneeType === "outsource";
    const estHoursPerUnit = (parseFloat(f.estMinPerUnit) || 0) / 60;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番を編集", back: () => set({ screen: "part_detail", editPartForm: null }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, value: f.partName, onChange: (e) => setEP({ partName: e.target.value }) })),
          React.createElement(FormRow, { label: "ブランド（客先名）" },
            (data.brands || []).length === 0
              ? React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "ブランド未登録（ホーム→ブランド管理から登録）")
              : React.createElement("select", { style: st.input, value: f.brandId || "", onChange: (e) => setEP({ brandId: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択しない"),
                  (data.brands || []).map((b) => React.createElement("option", { key: b.id, value: b.id }, b.name))
                )
          ),
          React.createElement(FormRow, { label: "仕掛り月" },
            React.createElement("input", { style: st.input, type: "month", value: f.workMonth || "", onChange: (e) => setEP({ workMonth: e.target.value }) })
          ),
          React.createElement(FormRow, { label: "ステータス" }, React.createElement("select", { style: st.input, value: f.status, onChange: (e) => setEP({ status: e.target.value }) }, STATUSES.map((s) => React.createElement("option", { key: s }, s)))),
          React.createElement(FormRow, { label: "数量（枚）" }, React.createElement("input", { style: st.input, type: "number", value: f.qty, onChange: (e) => setEP({ qty: e.target.value }) })),
          React.createElement(FormRow, { label: "納期" }, React.createElement("input", { style: st.input, type: "date", value: f.deadline || "", onChange: (e) => setEP({ deadline: e.target.value }) })),
          !isOut && React.createElement("div", null,
            React.createElement(FormRow, { label: "製品単価（円）" }, React.createElement("input", { style: st.input, type: "number", value: f.unitPrice, onChange: (e) => setEP({ unitPrice: e.target.value }) })),
            React.createElement(FormRow, { label: "1着あたりの見積もり時間（分）" },
              React.createElement("input", { style: st.input, type: "number", min: "0", step: "1", value: f.estMinPerUnit, onChange: (e) => setEP({ estMinPerUnit: e.target.value }) }),
              f.estMinPerUnit && React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 4 } }, "→ " + estHoursPerUnit.toFixed(2) + "h/着")
            )
          ),
          isOut && React.createElement("div", null,
            React.createElement(FormRow, { label: "販売単価（円）" }, React.createElement("input", { style: st.input, type: "number", value: f.sellPrice, onChange: (e) => setEP({ sellPrice: e.target.value }) })),
            React.createElement(FormRow, { label: "外注単価（円）" }, React.createElement("input", { style: st.input, type: "number", value: f.vendorPrice, onChange: (e) => setEP({ vendorPrice: e.target.value }) }))
          ),
          React.createElement(FormRow, { label: "備考" }, React.createElement("input", { style: st.input, value: f.note, onChange: (e) => setEP({ note: e.target.value }) })),
          React.createElement("button", { style: st.primaryBtn, onClick: savePart }, "保存する")
        )
      )
    );
  }

  if (ui.screen === "part_detail" && activePart) {
    const p = activePart;
    const isOut = p.assigneeType === "outsource";
    const estRate = p.estTotalHours > 0 ? p.totalSales / p.estTotalHours : null;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: p.partNo, back: () => set({ screen: ui.prevScreen || "master" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
          React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
            React.createElement(Badge, { part: p }),
            React.createElement(AssigneeBadge, { part: p, vendors: data.vendors }),
            p.status && React.createElement(StatusBadge, { status: p.status })
          ),
          React.createElement("button", { style: st.editBtn, onClick: () => startEdit(p) }, "✏️ 編集")
        ),
        p.partName && React.createElement("div", { style: { fontSize: 15, color: "#555", marginBottom: 4 } }, p.partName),
        p.brandName && React.createElement("div", { style: { fontSize: 13, color: "#888", fontWeight: 600, marginBottom: 12 } }, "🏷 " + p.brandName),
        !p.partName && p.brandName && React.createElement("div", { style: { height: 0 } }),
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px" }) },
          React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 8 } }, "担当を変更する"),
          React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            React.createElement("button", { style: Object.assign({}, st.assignBtn, (!p.assignee || p.assignee === "未割当") ? st.assignBtnActive : {}), onClick: () => updatePartAssignee(p.id, "未割当", "team") }, "未割当"),
            TEAMS.map((t) => React.createElement("button", { key: t, style: Object.assign({}, st.assignBtn, p.assignee === t && p.assigneeType === "team" ? st.assignBtnActive : {}), onClick: () => updatePartAssignee(p.id, t, "team") }, t)),
            data.vendors.map((v) => React.createElement("button", { key: v.id, style: Object.assign({}, st.assignBtn, p.assignee === v.id && p.assigneeType === "outsource" ? st.assignBtnActive : {}), onClick: () => updatePartAssignee(p.id, v.id, "outsource") }, "外注: " + v.name))
          )
        ),
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px", marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 13 } },
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "仕掛り月"), React.createElement("div", { style: { fontWeight: 700, color: p.workMonth ? "var(--iquta)" : "var(--faint)" } }, p.workMonth ? p.workMonth.replace("-", "年") + "月" : "未設定")),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "登録日"), React.createElement("div", { style: { fontWeight: 700 } }, fmt(p.createdAt))),
            p.deadline && React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "納期"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#aaa" : (p.remainDays <= 3 ? "#c00" : "#c25000") } }, fmt(p.deadline))),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "完了日"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "var(--iquta-d)" : "var(--faint)" } }, p.closedAt ? fmt(p.closedAt) : ((p.status || "未着手") === "未着手" ? "裁断前" : "進行中")))
          ),
          p.deadline && !p.closedAt && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: p.remainDays <= 3 ? "#c00" : "#888" } }, "納期まであと ", React.createElement("b", null, p.remainDays), " 日")
        ),
        p.qtyProgress !== null && React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "📦 完成枚数"),
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, p.completedQty + "枚 / " + p.qty + "枚")
          ),
          React.createElement(ProgressBar, { value: p.qtyProgress, color: p.remainQty === 0 ? "var(--iquta-d)" : "var(--iquta)" }),
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginTop: 6 } },
            React.createElement("span", null, Math.round(p.qtyProgress * 100) + "% 完了"),
            React.createElement("span", { style: { color: p.remainQty === 0 ? "var(--iquta-d)" : "var(--aka)", fontWeight: 700 } }, "残り " + p.remainQty + "枚")
          ),
          (data.qtyRecords || []).filter((r) => r.partId === p.id).length > 0 && React.createElement("div", { style: { marginTop: 10, borderTop: "1px solid #f0eeea", paddingTop: 10 } },
            React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 6 } }, "入力履歴"),
            (data.qtyRecords || []).filter((r) => r.partId === p.id).slice().sort((a, b) => a.date.localeCompare(b.date)).map((r) => React.createElement("div", { key: r.id, style: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555", marginBottom: 4 } },
              React.createElement("span", null, r.date.slice(5).replace("-", "/")),
              React.createElement("span", { style: { fontWeight: 700 } }, "+" + r.qty + "枚")
            ))
          )
        ),
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "総数量", value: p.qty + "枚" }),
          isOut ? React.createElement(SBox, { label: "外注先", value: p.vendorName || "未設定" }) : React.createElement(SBox, { label: "製品単価", value: "¥" + (p.unitPrice || 0).toLocaleString() }),
          isOut ? React.createElement(SBox, { label: "見込み利益", value: p.profit !== null ? "¥" + Math.round(p.profit).toLocaleString() : "—", dark: p.profit > 0 }) : React.createElement(SBox, { label: "総売上", value: "¥" + Math.round(p.totalSales).toLocaleString() }),
          isOut ? React.createElement(SBox, { label: "利益率", value: p.profitRate !== null ? p.profitRate.toFixed(1) + "%" : "—" }) : React.createElement(SBox, { label: "総作業時間", value: p.totalHours.toFixed(1) + "h" })
        ),
        !isOut && (p.estMinPerUnit > 0) && React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 16 }) },
          React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 10 } }, "⏱ 見積もりベースの試算"),
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } },
            React.createElement("div", { style: { background: "#f5f4f0", borderRadius: 10, padding: "10px 12px", textAlign: "center" } },
              React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "1着あたり見積もり"),
              React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, p.estMinPerUnit + "分"),
              React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginTop: 2 } }, "= " + p.estHoursPerUnit.toFixed(2) + "h/着")
            ),
            React.createElement("div", { style: { background: "#f5f4f0", borderRadius: 10, padding: "10px 12px", textAlign: "center" } },
              React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "見積もり総時間"),
              React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, p.estTotalHours.toFixed(1) + "h"),
              React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginTop: 2 } }, (p.qty || 0) + "枚ぶん")
            )
          ),
          (() => {
            const perHour = p.estHoursPerUnit > 0 ? (p.unitPrice || 0) / p.estHoursPerUnit : 0;
            const perDay8 = perHour * 8;
            const piecesPerDay = p.estHoursPerUnit > 0 ? 8 / p.estHoursPerUnit : 0;
            const people = Math.max(1, parseInt(ui.estPeople, 10) || 1);
            const teamPerDay = perDay8 * people;
            const teamPieces = piecesPerDay * people;
            return React.createElement("div", null,
              React.createElement("div", { style: { background: "#14555a", color: "#fff", borderRadius: 10, padding: "12px 16px", marginBottom: 8 } },
                React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginBottom: 4 } }, "見積もり通りなら 1人・1日8時間で"),
                React.createElement("div", { style: { fontSize: 22, fontWeight: 700 } }, "¥" + Math.round(perDay8).toLocaleString()),
                React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 4 } },
                  "時間単価 ¥" + Math.round(perHour).toLocaleString() + "/h　・　1日 約" + piecesPerDay.toFixed(1) + "着"
                )
              ),
              React.createElement("div", { style: { background: "#0f3d40", color: "#fff", borderRadius: 10, padding: "12px 16px" } },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } },
                  React.createElement("span", { style: { fontSize: 12, opacity: 0.7 } }, "この品番に"),
                  React.createElement("input", {
                    style: { width: 56, textAlign: "center", padding: "6px 4px", borderRadius: 8, border: "none", fontSize: 15, fontWeight: 700 },
                    type: "number", min: "1", value: ui.estPeople,
                    onChange: (e) => set({ estPeople: e.target.value })
                  }),
                  React.createElement("span", { style: { fontSize: 12, opacity: 0.7 } }, "人で取り組むと 1日")
                ),
                React.createElement("div", { style: { fontSize: 26, fontWeight: 700 } }, "¥" + Math.round(teamPerDay).toLocaleString()),
                React.createElement("div", { style: { fontSize: 11, opacity: 0.7, marginTop: 4 } },
                  "1日 約" + teamPieces.toFixed(1) + "着　・　" + (p.qty > 0 && teamPieces > 0 ? "全" + p.qty + "枚で約" + Math.ceil(p.qty / teamPieces) + "日" : "")
                )
              )
            );
          })()
        ),
        !isOut && p.progress !== null && React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "⏱ 時間進捗"),
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, Math.round(p.progress * 100) + "%")
          ),
          React.createElement(ProgressBar, { value: p.progress }),
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginTop: 4 } },
            React.createElement("span", null, "実績 " + p.totalHours.toFixed(1) + "h"),
            React.createElement("span", null, "見積もり " + p.estTotalHours.toFixed(1) + "h（" + (p.estMinPerUnit || 0) + "分/着）")
          )
        ),
        !isOut && React.createElement("div", { style: Object.assign({}, st.rateBox, { background: p.closedAt ? "var(--iquta-d)" : "var(--iquta-bg)", color: p.closedAt ? "#fff" : "var(--ink)", marginBottom: 16 }) },
          React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, p.closedAt ? "時間あたり売上（確定）" : "現時点の時間あたり売上"),
          React.createElement("div", { style: { fontSize: 28, fontWeight: 700 } }, p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "—"),
          estRate && p.totalHours > 0 && React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 4 } }, "目標: ¥" + Math.round(estRate).toLocaleString() + "/h ",
            React.createElement("span", { style: { color: p.hourlyRate >= estRate ? "#7dff7d" : "#ffaaaa" } }, p.hourlyRate >= estRate ? "▲ 目標超え" : "▼ 目標未達")
          )
        ),
        p.note && React.createElement("div", { style: Object.assign({}, st.card, { fontSize: 13, color: "#555", marginBottom: 16 }) }, "📝 " + p.note),
        !isOut && React.createElement("div", null,
          React.createElement(SectionLabel, null, "縫製士別 作業時間"),
          React.createElement("div", { style: st.card },
            Object.keys(p.workerMap).length === 0 && React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "まだ記録がありません"),
            Object.entries(p.workerMap).map(([worker, hours]) => {
              const pct = p.totalHours > 0 ? (hours / p.totalHours) * 100 : 0;
              return React.createElement("div", { key: worker, style: { marginBottom: 14 } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 4 } },
                  React.createElement("span", { style: { fontSize: 13 } }, worker),
                  React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, hours.toFixed(1) + "h")
                ),
                React.createElement(ProgressBar, { value: pct / 100 })
              );
            })
          ),
          React.createElement(SectionLabel, null, "作業明細"),
          p.recs.length === 0 && React.createElement(Empty, null, "まだ記録がありません"),
          (() => {
            const byDate = {};
            p.recs.forEach((r) => {
              if (!byDate[r.date]) byDate[r.date] = [];
              byDate[r.date].push(r);
            });
            return Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).map(([date, recs]) => {
              const dayTotal = recs.reduce((a, r) => a + r.hours, 0);
              return React.createElement("div", { key: date, style: { background: "#fff", borderRadius: 10, padding: "10px 14px", marginBottom: 8, boxShadow: "0 1px 3px rgba(0,0,0,.04)" } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
                  React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "#555" } }, date.slice(5).replace("-", "/") + "（" + ["日","月","火","水","木","金","土"][new Date(date).getDay()] + "）"),
                  React.createElement("span", { style: { fontSize: 12, color: "#aaa" } }, "計 " + dayTotal.toFixed(1) + "h")
                ),
                React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } },
                  recs.map((r) =>
                    React.createElement("div", { key: r.id, style: { background: "#f5f4f0", borderRadius: 20, padding: "4px 12px", fontSize: 12, display: "flex", gap: 6, alignItems: "center" } },
                      React.createElement("span", { style: { fontWeight: 600 } }, r.memberName),
                      React.createElement("span", { style: { color: "var(--iquta)", fontWeight: 700 } }, r.hours + "h")
                    )
                  )
                )
              );
            });
          })()
        ),
        !p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { marginTop: 20 }), onClick: () => { closePart(p.id); set({ screen: "master" }); } }, "この品番を完了にする"),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#14555a", marginTop: 8 }), onClick: () => openSaidan(p) }, "✂️ 裁断報告書" + ((data.saidanReports || []).find((r) => r.partId === p.id) ? "　（登録済み）" : "")),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "var(--iquta)", marginTop: 8 }), onClick: () => openKotei(p) }, "工程分析表" + ((data.koteiSheets || []).find((r) => r.partId === p.id) ? "　（登録済み）" : "")),
        p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777", marginTop: 16 }), onClick: () => reopenPart(p.id) }, "再開する"),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#fff0f0", color: "#c00", marginTop: 8 }), onClick: () => { if (window.confirm("この品番を削除しますか？")) { deletePart(p.id); set({ screen: "master" }); } } }, "削除する")
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "dashboard") {
    const isDelivered = ui.dashFilter === "delivered";
    const baseItems = isDelivered
      ? partSummary.filter((p) => p.closedAt)
      : partSummary.filter((p) => !p.closedAt);
    const sortedItems = baseItems.slice().sort((a, b) => {
      if (!a.deadline) return 1; if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
    const urgent = sortedItems.filter((p) => !isDelivered && p.remainDays !== null && p.remainDays <= 3);
    const caution = sortedItems.filter((p) => !isDelivered && p.remainDays !== null && p.remainDays > 3 && p.remainDays <= 7);
    const normal = sortedItems.filter((p) => isDelivered || p.remainDays === null || p.remainDays > 7);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "ダッシュボード", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16 } },
          React.createElement("button", {
            style: Object.assign({}, st.filterBtn, { flex: 1, padding: "10px", fontSize: 13, fontWeight: 700 }, !isDelivered ? st.filterBtnActive : {}),
            onClick: () => set({ dashFilter: "active" })
          }, "📦 納品前"),
          React.createElement("button", {
            style: Object.assign({}, st.filterBtn, { flex: 1, padding: "10px", fontSize: 13, fontWeight: 700 }, isDelivered ? Object.assign({}, st.filterBtnActive, { background: "var(--iquta-d)", borderColor: "var(--iquta-d)" }) : {}),
            onClick: () => set({ dashFilter: "delivered" })
          }, "✅ 納品済み")
        ),
        React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 16 } }, "本日: " + today() + "　" + (isDelivered ? "納品済み" : "進行中") + ": " + sortedItems.length + "件"),
        !isDelivered && urgent.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#fff0f0", color: "#c00", borderColor: "#ffcccc" }) }, "🔴 緊急 — 納期まで3日以内"),
          urgent.map((p) => React.createElement(DashCard, { key: p.id, item: p, vendors: data.vendors, level: "red", onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "dashboard" }) }))
        ),
        !isDelivered && caution.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#fffbf0", color: "#b07000", borderColor: "#ffe599" }) }, "🟡 要注意 — 納期まで7日以内"),
          caution.map((p) => React.createElement(DashCard, { key: p.id, item: p, vendors: data.vendors, level: "yellow", onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "dashboard" }) }))
        ),
        normal.length > 0 && React.createElement("div", null,
          !isDelivered && React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "var(--iquta-bg)", color: "var(--iquta)", borderColor: "var(--line)" }) }, "余裕あり"),
          normal.map((p) => React.createElement(DashCard, { key: p.id, item: p, vendors: data.vendors, level: isDelivered ? "done" : "green", onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "dashboard" }) }))
        ),
        sortedItems.length === 0 && React.createElement(Empty, null, isDelivered ? "納品済みの品番がありません" : "進行中の品番がありません")
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "team_leader") {
    const myOpen = teamParts;
    const myDone = partSummary.filter((p) => p.assignee === ui.selectedTeam && p.assigneeType === "team" && p.closedAt);
    const qf = ui.qtyForm;
    const qfReady = qf.partId && qf.qty;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: ui.selectedTeam + "　リーダー", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 12, color: "var(--iquta)" } }, "今日の完成枚数を入力"),
          React.createElement(FormRow, { label: "品番を選ぶ" },
            myOpen.length === 0
              ? React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "進行中の品番がありません")
              : React.createElement("select", { style: st.input, value: qf.partId, onChange: (e) => setQF({ partId: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択してください"),
                  myOpen.map((p) => React.createElement("option", { key: p.id, value: p.id }, p.partNo + (p.partName ? " (" + p.partName + ")" : "")))
                )
          ),
          React.createElement(FormRow, { label: "完成枚数" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 10", min: "0", value: qf.qty, onChange: (e) => setQF({ qty: e.target.value }) })),
          React.createElement(FormRow, { label: "日付" }, React.createElement("input", { style: st.input, type: "date", value: qf.date, onChange: (e) => setQF({ date: e.target.value }) })),
          React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: qfReady ? 1 : 0.35 }), disabled: !qfReady, onClick: addQtyRecord }, "記録する")
        ),
        React.createElement(SectionLabel, null, "進行中の品番"),
        myOpen.length === 0 && React.createElement(Empty, null, "進行中の品番はありません"),
        myOpen.map((p) => React.createElement(PartCard, { key: p.id, p, onDetail: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "team_leader" }), onClose: () => closePart(p.id) })),
        React.createElement(SectionLabel, null, "完了済み"),
        myDone.length === 0 && React.createElement(Empty, null, "完了済みの品番はありません"),
        myDone.map((p) => React.createElement(PartCard, { key: p.id, p, done: true, onDetail: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "team_leader" }), onReopen: () => reopenPart(p.id) }))
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "member_entry") {
    const f = ui.memberForm;
    const selSheet = f.partId ? (data.koteiSheets || []).find((s) => s.partId === f.partId) : null;
    const selSteps = selSheet ? (selSheet.blocks || []).filter((b) => b.type === "step") : [];
    // パーツごとにグループ化（印刷と同じ継承ルール）
    const kGroups = []; let kg = null;
    selSteps.forEach((b) => {
      if (b.part) { if (!kg || kg.part !== b.part) { kg = { part: b.part, steps: [] }; kGroups.push(kg); } }
      else { if (!kg) { kg = { part: "—", steps: [] }; kGroups.push(kg); } }
      kg.steps.push(b);
    });
    const setGroupQty = (steps, v) => { const patch = {}; steps.forEach((s) => { patch[s.id] = v; }); setKQ(patch); };
    // 全工程に上から通し番号
    const stepNo = {}; selSteps.forEach((b, i) => { stepNo[b.id] = i + 1; });
    // 案1：その人がその品番で過去に入力した工程（＝いつもの持ち場）。今も存在する工程だけ。
    const usualIds = {};
    if (f.memberId && f.partId) {
      (data.koteiRecords || []).forEach((r) => { if (r.memberId === f.memberId && r.partId === f.partId) usualIds[r.stepId] = true; });
    }
    const usualSteps = selSteps.filter((b) => usualIds[b.id]);
    const toggleOpen = (key) => set({ kEntryOpen: Object.assign({}, ui.kEntryOpen, { [key]: !ui.kEntryOpen[key] }) });
    // 工程1行（番号＋作業内容＋時間＋枚数）
    const stepRow = (s) => React.createElement("div", { key: s.id, style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
      React.createElement("div", { style: { width: 26, textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--faint)", flex: "none", fontVariantNumeric: "tabular-nums" } }, stepNo[s.id]),
      React.createElement("div", { style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, s.act || "（無題の工程）"),
        React.createElement("div", { style: { fontSize: 10, color: "var(--faint)" } }, (s.part ? s.part + "　" : "") + fmtKoteiTime(parseKoteiTime(s.time)))
      ),
      React.createElement("input", { style: { width: 60, textAlign: "center", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 4px", fontSize: 15, background: "var(--paper)", color: "var(--iquta)", fontWeight: 700 }, type: "number", min: "0", placeholder: "枚", value: (ui.kEntryQty || {})[s.id] || "", onChange: (e) => setKQ({ [s.id]: e.target.value }) })
    );
    const hasQty = Object.keys(ui.kEntryQty || {}).some((id) => parseFloat((ui.kEntryQty || {})[id]) > 0);
    // 作業時間は必須項目。時間を入れるまで枚数入力を出さず（忘れ防止の導線）、記録するも時間必須。
    const hoursOk = !!(f.hours && parseFloat(f.hours) > 0);
    const ready = f.memberId && f.partId && hoursOk;

    // 本日・本人の記録
    const myRecs = f.memberId ? data.records.filter((r) => r.memberId === f.memberId && r.date === f.date) : [];
    const myKotei = f.memberId ? (data.koteiRecords || []).filter((r) => r.memberId === f.memberId && r.date === f.date) : [];
    const dayHours = myRecs.reduce((a, r) => a + (r.hours || 0), 0);
    const dayValue = myKotei.reduce((a, r) => a + koteiValue(r, data.parts), 0);
    const myMemberName = (data.members.find((m) => m.id === f.memberId) || {}).name || "";

    return React.createElement(Shell, null,
      // ヘッダーの「記録」は最下部の記録するボタンと同じsaveEntryを呼ぶ（入口2つ・処理1つ）
      React.createElement(Header, { title: ui.selectedTeam + "　作業記録", back: () => set({ screen: "home" }), actions: [{ label: "記録", onClick: saveEntry, primary: true, disabled: !ready }] }),
      React.createElement(Body, null,
        data.members.length === 0
          ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#aaa", padding: 24 }) }, "メンバーが登録されていません。", React.createElement("br"), "ホーム→メンバー管理から登録してください。")
          : React.createElement("div", null,
              React.createElement("div", { style: st.card },
                React.createElement(FormRow, { label: "日付" }, React.createElement("input", { style: st.input, type: "date", value: f.date, onChange: (e) => setMF({ date: e.target.value }) })),
                React.createElement(FormRow, { label: "自分の名前" }, React.createElement("select", { style: st.input, value: f.memberId, onChange: (e) => setMF({ memberId: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択してください"),
                  data.members.map((m) => React.createElement("option", { key: m.id, value: m.id }, m.name))
                ))
              ),

              React.createElement("div", { style: st.card },
                React.createElement(FormRow, { label: "品番を選ぶ" },
                  teamParts.length === 0
                    ? React.createElement("div", { style: { color: "#bbb", fontSize: 13, padding: "8px 0" } }, "進行中の品番がありません")
                    : React.createElement("select", { style: st.input, value: f.partId, onChange: (e) => { setMF({ partId: e.target.value }); set({ kEntryQty: {} }); } },
                        React.createElement("option", { value: "" }, "選択してください"),
                        teamParts.map((p) => React.createElement("option", { key: p.id, value: p.id }, p.partNo + (p.partName ? " (" + p.partName + ")" : "")))
                      )
                ),
                f.partId && React.createElement(FormRow, { label: "作業時間（h）＊必須" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3.5", min: "0", step: "0.5", value: f.hours, onChange: (e) => setMF({ hours: e.target.value }) })),
                // 作業時間を入れるまで工程枚数の入力は出さない（必須項目の入力忘れ防止・案内文は出さない）
                f.partId && selSheet && hoursOk && React.createElement("div", null,
                  usualSteps.length > 0 && React.createElement("div", { style: { background: "var(--iquta-bg)", borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: "1px solid var(--line)" } },
                    React.createElement("div", { style: { fontSize: 12, color: "var(--iquta)", fontWeight: 700, marginBottom: 8 } }, "最近やった工程"),
                    // パーツごとに区切る：作業はパーツ単位で進む＝同パーツは同枚数・パーツが違えば枚数が変わることが
                    // 多いため、まとめ入力（既存setGroupQty流用）もパーツ単位に付ける。一括後の個別上書きは従来どおり。
                    (function () {
                      const partOf = {}; let curP = "—";
                      selSteps.forEach((b) => { if (b.part) curP = b.part; partOf[b.id] = curP; });
                      const ugs = []; const ugIdx = {};
                      usualSteps.forEach((s) => { const pn = partOf[s.id] || "—"; if (!(pn in ugIdx)) { ugIdx[pn] = ugs.length; ugs.push({ part: pn, steps: [] }); } ugs[ugIdx[pn]].steps.push(s); });
                      return ugs.map((g, gi) => React.createElement("div", { key: gi, style: gi > 0 ? { borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 4 } : null },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" } },
                          React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "var(--iquta)" } }, g.part + "（" + g.steps.length + "工程）"),
                          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
                            React.createElement("span", { style: { fontSize: 11, color: "var(--soft)" } }, "まとめて"),
                            React.createElement("input", { style: { width: 60, textAlign: "center", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 4px", fontSize: 14, background: "#fff" }, type: "number", min: "0", placeholder: "枚", onChange: (e) => setGroupQty(g.steps, e.target.value) }),
                            React.createElement("span", { style: { fontSize: 11, color: "var(--soft)" } }, "枚")
                          )
                        ),
                        g.steps.map((s) => stepRow(s))
                      ));
                    })()
                  ),
                  React.createElement("div", { style: { fontSize: 11, color: "var(--soft)", margin: "4px 0 8px" } }, "すべての工程（パーツ名をタップで開く）"),
                  kGroups.length === 0 && React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "この品番の工程表に工程がありません"),
                  kGroups.map((grp, gi) => {
                    const gkey = "g" + gi;
                    const gopen = !!ui.kEntryOpen[gkey];
                    const gfilled = grp.steps.filter((s) => parseFloat((ui.kEntryQty || {})[s.id]) > 0).length;
                    return React.createElement("div", { key: gi, style: { background: "#f5f4f0", borderRadius: 10, marginBottom: 8, overflow: "hidden" } },
                      React.createElement("button", { style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px", background: "none", border: "none", cursor: "pointer" }, onClick: () => toggleOpen(gkey) },
                        React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--iquta)" } }, grp.part + "（" + grp.steps.length + "工程）"),
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                          gfilled > 0 && React.createElement("span", { style: { fontSize: 11, color: "var(--iquta)", fontWeight: 700, background: "var(--iquta-bg)", borderRadius: 10, padding: "2px 8px" } }, gfilled + "件入力済"),
                          React.createElement("span", { style: { color: "#999", fontSize: 13 } }, gopen ? "▼" : "▶")
                        )
                      ),
                      gopen && React.createElement("div", { style: { padding: "0 12px 10px" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginBottom: 8 } },
                          React.createElement("span", { style: { fontSize: 11, color: "var(--soft)" } }, "まとめて"),
                          React.createElement("input", { style: { width: 60, textAlign: "center", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 4px", fontSize: 14, background: "#fff" }, type: "number", min: "0", placeholder: "枚", onChange: (e) => setGroupQty(grp.steps, e.target.value) }),
                          React.createElement("span", { style: { fontSize: 11, color: "var(--soft)" } }, "枚")
                        ),
                        grp.steps.map((s) => stepRow(s))
                      )
                    );
                  })
                ),
                f.partId && !selSheet && React.createElement("div", { style: { fontSize: 11, color: "#bbb", margin: "4px 0 8px" } }, "この品番は工程表がないため、時間のみ記録します"),
                f.partId && React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: saveEntry }, "記録する")
              )
            ),

        // 名前を選んだら常に表示（記録0でも昨日までの1週間が見え、"昨日の自分"を意識してから仕事に入れる）
        f.memberId && React.createElement("div", null,
          // ── 作業記録ヒーロー（iqutaモック）: 今日の生産価値を青の大きな数字で主役に ──
          React.createElement("div", { id: "entry-hero", style: { textAlign: "center", padding: "24px 8px 4px", scrollMarginTop: 64 } },
            myMemberName && React.createElement("div", { style: { fontSize: 13, color: "var(--soft)", letterSpacing: ".04em" } }, myMemberName + "さん"),
            React.createElement("div", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".2em", marginTop: 14 } }, "今日の生産価値"),
            React.createElement("div", { style: { fontSize: 46, fontWeight: 800, color: "var(--iquta)", letterSpacing: "-.02em", lineHeight: 1.05, marginTop: 4, fontVariantNumeric: "tabular-nums" } }, React.createElement(CountUpYen, { value: dayValue })),
            React.createElement("div", { style: { fontSize: 13, color: "var(--soft)", marginTop: 10, letterSpacing: ".02em" } }, myKotei.reduce(function (a, r) { return a + (r.qty || 0); }, 0) + "枚 ・ " + dayHours.toFixed(1) + "時間"),
            dayValue > 0 && React.createElement("div", { style: { display: "inline-block", marginTop: 14, fontSize: 13, fontWeight: 700, color: "var(--iquta)", background: "var(--iquta-bg)", borderRadius: 20, padding: "7px 16px", letterSpacing: ".03em" } }, "その調子！")
          ),
          // ── 襞グラフ（直近1週間・金額/枚数トグル）──
          (function () {
            const mode = ui.heroMode === "qty" ? "qty" : "yen";
            const week = [];
            for (let i = 6; i >= 0; i--) {
              const d = new Date((f.date || today()) + "T00:00:00");
              d.setDate(d.getDate() - i);
              const ds = d.toISOString().slice(0, 10);
              const recs = (data.koteiRecords || []).filter(function (r) { return r.memberId === f.memberId && r.date === ds; });
              week.push({ ds: ds, label: i === 0 ? (ds === today() ? "今日" : ds.slice(5).replace("-", "/")) : "日月火水木金土"[d.getDay()],
                yen: recs.reduce(function (a, r) { return a + koteiValue(r, data.parts); }, 0),
                qty: recs.reduce(function (a, r) { return a + (r.qty || 0); }, 0) });
            }
            const maxV = Math.max.apply(null, week.map(function (w) { return mode === "yen" ? w.yen : w.qty; }).concat([1]));
            const togBtn = function (on) { return { border: "none", background: on ? "#fff" : "none", color: on ? "var(--iquta)" : "var(--soft)", fontSize: 12, fontWeight: 700, padding: "5px 13px", borderRadius: 7, cursor: "pointer", boxShadow: on ? "0 1px 3px rgba(43,92,230,.12)" : "none" }; };
            return React.createElement("div", { style: { padding: "8px 4px 6px", marginBottom: 10 } },
              React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 } },
                React.createElement("div", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".2em" } }, "直近1週間"),
                React.createElement("div", { style: { display: "inline-flex", background: "var(--iquta-bg)", borderRadius: 9, padding: 2 } },
                  React.createElement("button", { style: togBtn(mode === "yen"), onClick: function () { set({ heroMode: "yen" }); } }, "金額"),
                  React.createElement("button", { style: togBtn(mode === "qty"), onClick: function () { set({ heroMode: "qty" }); } }, "枚数")
                )
              ),
              React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: 6, height: 116 } },
                week.map(function (w, i) {
                  const v = mode === "yen" ? w.yen : w.qty;
                  const isToday = i === 6;
                  const h = Math.max(2, Math.round(92 * v / maxV));
                  const vLabel = mode === "yen" ? (v >= 1000 ? "¥" + (Math.round(v / 100) / 10) + "k" : (v ? "¥" + Math.round(v) : "")) : (v || "");
                  return React.createElement("div", { key: w.ds, style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" } },
                    React.createElement("div", { style: { fontSize: 9, color: isToday ? "var(--iquta)" : "var(--faint)", fontWeight: isToday ? 700 : 400, marginBottom: 4, whiteSpace: "nowrap" } }, vLabel),
                    React.createElement("div", { style: { width: "100%", maxWidth: 15, height: h, borderRadius: "4px 4px 0 0", background: isToday ? "linear-gradient(180deg,#4f7ef0,var(--iquta))" : "#dbe4fb" } }),
                    React.createElement("div", { style: { fontSize: 11, color: isToday ? "var(--iquta)" : "var(--faint)", fontWeight: isToday ? 700 : 400, marginTop: 8 } }, w.label)
                  );
                })
              )
            );
          })(),
          myRecs.length > 0 && React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".14em", marginBottom: 6, fontWeight: 600 } }, "時間"),
            myRecs.map((r) => { const part = data.parts.find((x) => x.id === r.partId); return React.createElement("div", { key: r.id, style: st.recRow }, React.createElement("span", { style: { fontSize: 13, fontWeight: 700, flex: 1 } }, part ? part.partNo : "?"), React.createElement("span", { style: { fontSize: 13, color: "#555" } }, r.hours + "h"), React.createElement("button", { style: st.deleteBtn, onClick: () => deleteRecord(r.id) }, "✕")); })
          ),
          myKotei.length > 0 && React.createElement("div", { style: { marginTop: 10 } },
            React.createElement("div", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".14em", marginBottom: 6, fontWeight: 600 } }, "生産価値"),
            myKotei.slice().sort((a, b) => koteiValue(b, data.parts) - koteiValue(a, data.parts)).map((r) => {
              const part = data.parts.find((p) => p.id === r.partId);
              return React.createElement("div", { key: r.id, style: Object.assign({}, st.recRow, { alignItems: "flex-start" }) },
                React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                  React.createElement("div", { style: { fontSize: 13, fontWeight: 700 } }, (part ? part.partNo : "?") + "　" + (r.stepPart || "")),
                  React.createElement("div", { style: { fontSize: 12, color: "#777", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, (r.stepAct || "") + " ×" + r.qty + "枚")
                ),
                React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "var(--iquta)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } }, "¥" + Math.round(koteiValue(r, data.parts)).toLocaleString()),
                React.createElement("button", { style: st.deleteBtn, onClick: () => deleteKoteiRecord(r.id) }, "✕")
              );
            })
          )
        )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "value_view") {
    const inPeriod = (d) => ui.vvPeriod === "day" ? d === ui.vvDay
      : ui.vvPeriod === "range" ? ((d || "") >= ui.vvFrom && (d || "") <= ui.vvTo)
      : (d || "").slice(0, 7) === ui.vvMonth;
    const recs = data.records.filter((r) => inPeriod(r.date));
    const kers = (data.koteiRecords || []).filter((r) => inPeriod(r.date));
    const yen = (v) => "¥" + Math.round(v).toLocaleString();
    const partLabel = (id) => { const p = data.parts.find((x) => x.id === id); return p ? (p.partNo + (p.partName ? " " + p.partName : "")) : "（削除済み品番）"; };
    const memberLabel = (id) => (data.members.find((m) => m.id === id) || {}).name || "（不明）";
    const toggle = (k) => set({ vvExpanded: Object.assign({}, ui.vvExpanded, { [k]: !ui.vvExpanded[k] }) });

    let primKey, primLabel, secKey, secLabel;
    if (ui.vvAxis === "member") { primKey = (r) => r.memberId; primLabel = memberLabel; secKey = (r) => r.partId; secLabel = partLabel; }
    else if (ui.vvAxis === "date") { primKey = (r) => r.date; primLabel = (d) => d; secKey = (r) => r.memberId; secLabel = memberLabel; }
    else { primKey = (r) => r.partId; primLabel = partLabel; secKey = (r) => r.memberId; secLabel = memberLabel; }

    const prim = {};
    const ensure = (m, k) => { if (!m[k]) m[k] = { hours: 0, value: 0, sub: {} }; return m[k]; };
    const ensureSub = (p, k) => { if (!p.sub[k]) p.sub[k] = { hours: 0, value: 0 }; return p.sub[k]; };
    recs.forEach((r) => { const p = ensure(prim, primKey(r)); p.hours += (r.hours || 0); ensureSub(p, secKey(r)).hours += (r.hours || 0); });
    kers.forEach((r) => { const p = ensure(prim, primKey(r)); const v = koteiValue(r, data.parts); p.value += v; ensureSub(p, secKey(r)).value += v; });

    let primKeys = Object.keys(prim);
    if (ui.vvAxis === "date") primKeys.sort((a, b) => b.localeCompare(a));
    else primKeys.sort((a, b) => String(primLabel(a)).localeCompare(String(primLabel(b)), "ja"));

    const totHours = primKeys.reduce((a, k) => a + prim[k].hours, 0);
    const totValue = primKeys.reduce((a, k) => a + prim[k].value, 0);

    // 期間全体の日平均（記録がある日で割る。休みの日を混ぜて平均を薄めない）
    const dayTotals = {};
    kers.forEach((r) => { dayTotals[r.date] = (dayTotals[r.date] || 0) + koteiValue(r, data.parts); });
    const recDaysAll = Object.keys(dayTotals).filter((d) => dayTotals[d] > 0).length;

    // ── 人ごとの日別棒グラフ（金額のみ・表示専用）──
    // 記録がない日も高さ0の棒として必ず並べ、休み・記録漏れ・生産の谷が見えるようにする。
    // 92日を超える期間（過去1年など）は月別に集計する。
    const dstr = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const periodDays = () => {
      let from, to;
      if (ui.vvPeriod === "month") {
        from = ui.vvMonth + "-01";
        to = ui.vvMonth + "-" + String(new Date(+ui.vvMonth.slice(0, 4), +ui.vvMonth.slice(5, 7), 0).getDate()).padStart(2, "0");
      } else { from = ui.vvFrom; to = ui.vvTo; }
      if (!from || !to || from > to) return [];
      const out = [];
      const d = new Date(from + "T00:00:00");
      for (let i = 0; i < 400; i++) {
        const ds = dstr(d);
        if (ds > to) break;
        out.push(ds);
        d.setDate(d.getDate() + 1);
      }
      return out;
    };
    const memberGraph = (pk) => {
      if (ui.vvAxis !== "member" || ui.vvPeriod === "day") return null;
      const days = periodDays();
      if (days.length < 2) return null;
      const byDay = {};
      kers.forEach((r) => { if (r.memberId === pk) byDay[r.date] = (byDay[r.date] || 0) + koteiValue(r, data.parts); });
      const monthly = days.length > 92;
      let bars;
      if (monthly) {
        const m = {}; const order = [];
        days.forEach((ds) => { const k = ds.slice(0, 7); if (!(k in m)) { m[k] = 0; order.push(k); } m[k] += (byDay[ds] || 0); });
        bars = order.map((k) => ({ label: String(+k.slice(5, 7)) + "月", v: m[k], weekend: false }));
      } else {
        bars = days.map((ds) => {
          const dt = new Date(ds + "T00:00:00");
          return { label: String(+ds.slice(8, 10)), youbi: "日月火水木金土"[dt.getDay()], v: byDay[ds] || 0, weekend: dt.getDay() === 0 || dt.getDay() === 6 };
        });
      }
      const total = bars.reduce((a, b) => a + b.v, 0);
      const workedDays = Object.keys(byDay).filter((ds) => byDay[ds] > 0).length;
      const avg = workedDays > 0 ? total / workedDays : 0;
      // この人の期間内の作業時間。工程表がない品番の時間は入れない
      // （生産価値が計算されない時間で割ると「1時間あたり」が実際より低く出るため）
      const hasSheet = {};
      (data.koteiSheets || []).forEach((s) => { hasSheet[s.partId] = true; });
      const hoursSum = recs.reduce((a, r) => a + (r.memberId === pk && hasSheet[r.partId] ? (r.hours || 0) : 0), 0);
      const maxV = Math.max.apply(null, bars.map((b) => b.v).concat([1]));
      const few = bars.length <= 10;
      const scroll = bars.length > 40;
      const compact = (v) => v <= 0 ? "0" : v < 10000 ? Math.round(v / 1000) + "千" : (Math.round(v / 1000) / 10) + "万";
      return React.createElement("div", { style: { padding: "12px 0 4px" } },
        React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" } },
          React.createElement("div", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".14em", fontWeight: 600 } }, monthly ? "月別の生産価値" : "日別の生産価値"),
          React.createElement("div", { style: { fontSize: 12, color: "var(--soft)" } }, "合計 ", React.createElement("b", { style: { color: "var(--iquta)" } }, yen(total))),
          React.createElement("div", { style: { fontSize: 12, color: "var(--soft)" } }, "日平均 ", React.createElement("b", { style: { color: "var(--iquta)" } }, yen(avg)), "（記録" + workedDays + "日）"),
          hoursSum > 0 && React.createElement("div", { style: { fontSize: 12, color: "var(--soft)" } }, "1時間あたり ", React.createElement("b", { style: { color: "var(--iquta)" } }, yen(total / hoursSum)), "（工程表あり " + hoursSum.toFixed(1) + "h）")
        ),
        React.createElement("div", { style: { overflowX: scroll ? "auto" : "visible", WebkitOverflowScrolling: "touch" } },
          React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: bars.length > 16 ? 2 : 5, height: 106, minWidth: scroll ? bars.length * 9 : 0 } },
            bars.map((b, i) => {
              const h = b.v > 0 ? Math.max(3, Math.round(72 * b.v / maxV)) : 2;
              const showLabel = bars.length <= 16 || i % 5 === 0 || i === bars.length - 1;
              return React.createElement("div", { key: i, style: { flex: scroll ? "none" : 1, width: scroll ? 7 : "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 3, minWidth: 0 } },
                few && React.createElement("div", { style: { fontSize: 9, color: b.v > 0 ? "var(--iquta)" : "transparent", fontWeight: 700, whiteSpace: "nowrap" } }, compact(b.v)),
                React.createElement("div", { style: { width: "100%", maxWidth: 26, height: h, borderRadius: "3px 3px 0 0", background: b.v > 0 ? (b.weekend ? "var(--faint)" : "var(--iquta)") : "var(--line)" } }),
                React.createElement("div", { style: { fontSize: 8.5, color: b.weekend ? "var(--faint)" : "var(--soft)", whiteSpace: "nowrap", visibility: showLabel ? "visible" : "hidden" } }, b.label + (few && b.youbi ? "(" + b.youbi + ")" : ""))
              );
            })
          )
        )
      );
    };

    const axisBtn = (key, label) => React.createElement("button", { key: key, style: Object.assign({}, st.filterBtn, ui.vvAxis === key ? st.filterBtnActive : {}), onClick: () => set({ vvAxis: key, vvExpanded: {} }) }, label);

    const headRow = React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "0 16px 6px", fontSize: 10, color: "#aaa" } },
      React.createElement("div", { style: { flex: 1 } }, ui.vvAxis === "member" ? "名前" : ui.vvAxis === "date" ? "日付" : "品番"),
      React.createElement("div", { style: { width: 56, textAlign: "right" } }, "時間"),
      React.createElement("div", { style: { width: 90, textAlign: "right" } }, "生産価値"),
      React.createElement("div", { style: { width: 14 } }, "")
    );

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "💴 生産価値", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,

        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 10 } },
          React.createElement("button", { style: Object.assign({}, st.filterBtn, { flex: 1, padding: "9px", fontWeight: 700 }, ui.vvPeriod === "month" ? st.filterBtnActive : {}), onClick: () => set({ vvPeriod: "month", vvExpanded: {} }) }, "月で見る"),
          React.createElement("button", { style: Object.assign({}, st.filterBtn, { flex: 1, padding: "9px", fontWeight: 700 }, ui.vvPeriod === "day" ? st.filterBtnActive : {}), onClick: () => set({ vvPeriod: "day", vvExpanded: {} }) }, "日で見る"),
          React.createElement("button", { style: Object.assign({}, st.filterBtn, { flex: 1, padding: "9px", fontWeight: 700 }, ui.vvPeriod === "range" ? st.filterBtnActive : {}), onClick: () => set({ vvPeriod: "range", vvExpanded: {} }) }, "期間で見る")
        ),
        ui.vvPeriod === "month"
          ? React.createElement("input", { style: Object.assign({}, st.input, { marginBottom: 10 }), type: "month", value: ui.vvMonth, onChange: (e) => set({ vvMonth: e.target.value, vvExpanded: {} }) })
          : ui.vvPeriod === "day"
          ? React.createElement("input", { style: Object.assign({}, st.input, { marginBottom: 10 }), type: "date", value: ui.vvDay, onChange: (e) => set({ vvDay: e.target.value, vvExpanded: {} }) })
          : React.createElement("div", { style: { marginBottom: 10 } },
              React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 8 } },
                React.createElement("button", { style: st.filterBtn, onClick: () => set({ vvFrom: daysAgo(6), vvTo: today(), vvExpanded: {} }) }, "過去1週間"),
                React.createElement("button", { style: st.filterBtn, onClick: () => set({ vvFrom: daysAgo(29), vvTo: today(), vvExpanded: {} }) }, "過去1ヶ月"),
                React.createElement("button", { style: st.filterBtn, onClick: () => set({ vvFrom: daysAgo(364), vvTo: today(), vvExpanded: {} }) }, "過去1年")
              ),
              React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } },
                React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, minWidth: 0 }), type: "date", value: ui.vvFrom, onChange: (e) => set({ vvFrom: e.target.value, vvExpanded: {} }) }),
                React.createElement("span", { style: { color: "var(--soft)", flex: "none" } }, "〜"),
                React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, minWidth: 0 }), type: "date", value: ui.vvTo, onChange: (e) => set({ vvTo: e.target.value, vvExpanded: {} }) })
              )
            ),

        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } },
          axisBtn("member", "人ごと"), axisBtn("date", "日ごと"), axisBtn("part", "品番ごと")
        ),

        React.createElement("div", { style: { background: "var(--iquta)", color: "#fff", borderRadius: 12, padding: "14px 18px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" } },
          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 2 } }, "この期間の合計"),
            React.createElement("div", { style: { fontSize: 24, fontWeight: 700 } }, yen(totValue)),
            ui.vvPeriod !== "day" && recDaysAll > 0 && React.createElement("div", { style: { fontSize: 11, opacity: 0.75, marginTop: 3 } }, "日平均 " + yen(totValue / recDaysAll) + "（記録" + recDaysAll + "日）"),
            totHours > 0 && React.createElement("div", { style: { fontSize: 11, opacity: 0.75, marginTop: 2 } }, "1時間あたり " + yen(totValue / totHours))
          ),
          React.createElement("div", { style: { fontSize: 13, opacity: 0.8 } }, totHours.toFixed(1) + "h")
        ),

        primKeys.length === 0
          ? React.createElement(Empty, null, "この期間の記録はありません")
          : React.createElement("div", null,
              headRow,
              primKeys.map((pk) => {
                const o = prim[pk];
                const exp = !!ui.vvExpanded[pk];
                const subKeys = Object.keys(o.sub).sort((a, b) => o.sub[b].value - o.sub[a].value);
                return React.createElement("div", { key: pk },
                  React.createElement("button", { style: Object.assign({}, st.summaryCard, { textAlign: "left", marginBottom: exp ? 0 : 10 }), onClick: () => toggle(pk) },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                      React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, ui.vvAxis === "date" ? (primLabel(pk).slice(5).replace("-", "/") + "（" + ["日","月","火","水","木","金","土"][new Date(primLabel(pk)).getDay()] + "）") : primLabel(pk)),
                      React.createElement("div", { style: { width: 56, textAlign: "right", fontSize: 13, color: "#555" } }, o.hours.toFixed(1) + "h"),
                      React.createElement("div", { style: { width: 90, textAlign: "right", fontSize: 15, fontWeight: 700, color: "var(--iquta)", fontVariantNumeric: "tabular-nums" } }, yen(o.value)),
                      React.createElement("span", { style: { width: 14, textAlign: "center", color: "#ccc" } }, exp ? "▼" : "▶")
                    )
                  ),
                  exp && React.createElement("div", { style: { background: "#fff", borderRadius: "0 0 12px 12px", margin: "0 0 10px", padding: "2px 14px 10px", border: "1px solid var(--line-soft)", borderTop: "none" } },
                    memberGraph(pk),
                    subKeys.map((sk) => {
                      // ── 3階層目（工程明細）: 品番行をタップで開閉。既存koteiRecordsを絞るだけ・金額はkoteiValue流用 ──
                      const dkey = pk + "|" + sk;
                      const dexp = !!ui.vvExpanded[dkey];
                      const details = kers.filter((r) => primKey(r) === pk && secKey(r) === sk).slice().sort((a, b) => (a.date || "").localeCompare(b.date || ""));
                      // 品番でグループ化（人ごと/品番ごとの軸では自ずと1品番。日ごと軸では複数品番になり得る）
                      const dgroups = []; const gIdx = {};
                      details.forEach((r) => { const k = r.partId || "?"; if (!(k in gIdx)) { gIdx[k] = dgroups.length; dgroups.push({ partId: k, rows: [] }); } dgroups[gIdx[k]].rows.push(r); });
                      return React.createElement("div", { key: sk },
                        React.createElement("button", { style: { width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 0", background: "none", border: "none", borderTop: "1px solid var(--line-soft)", cursor: "pointer", textAlign: "left" }, onClick: () => toggle(dkey) },
                          React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, secLabel(sk)),
                          React.createElement("div", { style: { width: 56, textAlign: "right", fontSize: 12, color: "var(--soft)" } }, o.sub[sk].hours.toFixed(1) + "h"),
                          React.createElement("div", { style: { width: 90, textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--iquta)", fontVariantNumeric: "tabular-nums" } }, yen(o.sub[sk].value)),
                          React.createElement("span", { style: { width: 14, textAlign: "center", color: "var(--faint)", fontSize: 11 } }, dexp ? "▼" : "▶")
                        ),
                        dexp && React.createElement("div", { style: { padding: "0 0 10px 10px" } },
                          details.length === 0
                            ? React.createElement("div", { style: { fontSize: 12, color: "var(--soft)", background: "var(--iquta-bg)", borderRadius: 8, padding: "9px 12px", lineHeight: 1.6 } }, "この品番は工程表が未登録のため、生産価値が計算されていません（時間のみの記録です）")
                            : dgroups.map((g, gi) => React.createElement("div", { key: gi },
                                (dgroups.length > 1 || ui.vvAxis === "date") && React.createElement("div", { style: { fontSize: 10.5, color: "var(--iquta)", fontWeight: 700, letterSpacing: ".04em", padding: "5px 0 2px" } }, partLabel(g.partId)),
                                g.rows.map((r) => React.createElement("div", { key: r.id, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid var(--line-soft)" } },
                                  React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                                    React.createElement("div", { style: { fontSize: 12.5, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, r.stepAct || "（無題の工程）"),
                                    (r.stepPart || ui.vvPeriod === "month") && React.createElement("div", { style: { fontSize: 10, color: "var(--faint)" } }, (ui.vvPeriod === "month" && r.date ? r.date.slice(5).replace("-", "/") + "　" : "") + (r.stepPart || ""))
                                  ),
                                  React.createElement("div", { style: { width: 52, textAlign: "right", fontSize: 12, color: "var(--soft)", fontVariantNumeric: "tabular-nums", flex: "none" } }, "×" + r.qty + "枚"),
                                  React.createElement("div", { style: { width: 90, textAlign: "right", fontSize: 12.5, fontWeight: 700, color: "var(--iquta)", fontVariantNumeric: "tabular-nums", flex: "none" } }, yen(koteiValue(r, data.parts)))
                                ))
                              ))
                        )
                      );
                    })
                  )
                );
              })
            )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "summary") {
    const sm = ui.summaryMonth;
    const monthParts = partSummary.filter((p) => p.workMonth === sm);
    const allMonths = Array.from(new Set(partSummary.map((p) => p.workMonth).filter(Boolean))).sort().reverse();

    const mTotalQty = monthParts.reduce((a, p) => a + (p.qty || 0), 0);
    const mCompletedQty = monthParts.reduce((a, p) => a + p.completedQty, 0);
    const mTotalSales = monthParts.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalSales, 0);
    const mTotalHours = monthParts.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalHours, 0);
    const mTotalProfit = monthParts.filter((p) => p.assigneeType === "outsource" && p.profit !== null).reduce((a, p) => a + p.profit, 0);
    const mOutsourceSales = monthParts.filter((p) => p.assigneeType === "outsource").reduce((a, p) => a + (p.sellPrice || 0) * (p.qty || 0), 0);
    const mHourlyRate = mTotalHours > 0 ? mTotalSales / mTotalHours : 0;
    const mPlannedSales = monthParts.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "集計・仕事量管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,

        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px", marginBottom: 12 }) },
          React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 8 } }, "仕掛り月を選択"),
          React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 } },
            allMonths.map((m) => React.createElement("button", {
              key: m,
              style: Object.assign({}, st.filterBtn, sm === m ? st.filterBtnActive : {}),
              onClick: () => set({ summaryMonth: m })
            }, m.replace("-", "年") + "月"))
          ),
          React.createElement("input", { style: Object.assign({}, st.input, { marginTop: 4 }), type: "month", value: sm, onChange: (e) => set({ summaryMonth: e.target.value }) })
        ),

        monthParts.length === 0
          ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#bbb", padding: 24 }) },
              sm.replace("-", "年") + "月の仕掛り品番はありません"
            )
          : React.createElement("div", null,

              React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 8 } },
                sm.replace("-", "年") + "月仕掛り — " + monthParts.length + "品番"
              ),

              React.createElement("div", { style: { background: "var(--iquta)", borderRadius: 12, padding: "16px 18px", marginBottom: 12, color: "#fff" } },
                React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, "この月の予定売上合計（社内・単価×数量）"),
                React.createElement("div", { style: { fontSize: 28, fontWeight: 700 } }, "¥" + Math.round(mPlannedSales).toLocaleString()),
                React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 6, borderTop: "1px solid #444", paddingTop: 8 } },
                  "外注 売上 ¥" + Math.round(mOutsourceSales).toLocaleString() + "　/　利益 ¥" + Math.round(mTotalProfit).toLocaleString()
                )
              ),

              React.createElement("div", { style: st.grid2 },
                React.createElement(SBox, { label: "総枚数", value: mTotalQty.toLocaleString() + "枚" }),
                React.createElement(SBox, { label: "完成枚数", value: mCompletedQty.toLocaleString() + "枚" }),
                React.createElement(SBox, { label: "社内 売上実績", value: "¥" + Math.round(mTotalSales).toLocaleString() }),
                React.createElement(SBox, { label: "時間単価（実績）", value: mTotalHours > 0 ? "¥" + Math.round(mHourlyRate).toLocaleString() + "/h" : "—" })
              ),

              React.createElement(SectionLabel, null, "チーム別 予定 / 割当 / 実績"),
              TEAMS.map((team) => {
                const tParts = monthParts.filter((p) => p.assignee === team && p.assigneeType === "team");
                const tHours = tParts.reduce((a, p) => a + p.totalHours, 0);
                const tSales = tParts.reduce((a, p) => a + p.totalSales, 0);
                const tQty = tParts.reduce((a, p) => a + (p.qty || 0), 0);
                const tCompletedQty = tParts.reduce((a, p) => a + p.completedQty, 0);
                const tAssignedHours = tParts.reduce((a, p) => a + (p.estTotalHours || 0), 0);
                const tRate = tHours > 0 ? tSales / tHours : 0;
                const tPlannedSales = tParts.reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);
                const tRealSales = tParts.reduce((a, p) => a + (p.unitPrice || 0) * (p.completedQty || 0), 0);
                const salesProgress = tPlannedSales > 0 ? Math.min(tRealSales / tPlannedSales, 1) : null;
                if (tParts.length === 0) return null;
                return React.createElement("div", { key: team, style: st.monthlyCard },
                  React.createElement("button", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0 }, onClick: () => set({ screen: "team_month", teamMonthTeam: team, teamMonthMonth: sm }) },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                      React.createElement(TeamBadge, { team, small: true }),
                      React.createElement("span", { style: { fontSize: 11, color: "var(--iquta)" } }, "品番を見る ›")
                    ),
                    React.createElement("span", { style: { fontSize: 12, color: "#aaa" } }, tParts.length + "品番 / " + tQty + "枚")
                  ),

                  React.createElement("div", { style: { background: "var(--iquta)", borderRadius: 10, padding: "14px 16px", marginBottom: 12, color: "#fff" } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                      React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: 10, opacity: 0.55, marginBottom: 2 } }, "予定売上（目標）"),
                        React.createElement("div", { style: { fontSize: 22, fontWeight: 700 } }, "¥" + Math.round(tPlannedSales).toLocaleString())
                      ),
                      React.createElement("div", { style: { textAlign: "right" } },
                        React.createElement("div", { style: { fontSize: 10, opacity: 0.55, marginBottom: 2 } }, "達成（完成分）"),
                        React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: salesProgress !== null && salesProgress >= 1 ? "#7dff7d" : "#fff" } }, "¥" + Math.round(tRealSales).toLocaleString())
                      )
                    ),
                    salesProgress !== null && React.createElement("div", { style: { marginTop: 8 } },
                      React.createElement(ProgressBar, { value: salesProgress, color: salesProgress >= 1 ? "#7dff7d" : "var(--iquta)" })
                    )
                  ),

                  React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 } },
                    React.createElement("div", { style: { background: "#f0f4ff", borderRadius: 10, padding: "10px 12px", textAlign: "center" } },
                      React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "見込み時間"),
                      React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--iquta)" } },
                        tAssignedHours > 0 ? tAssignedHours.toFixed(0) + "h" : "—"
                      )
                    ),
                    React.createElement("div", { style: { background: "#f0f8f0", borderRadius: 10, padding: "10px 12px", textAlign: "center" } },
                      React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "実績時間"),
                      React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "var(--iquta-d)" } },
                        tHours > 0 ? tHours.toFixed(1) + "h" : "—"
                      ),
                      tHours > 0 && React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginTop: 2 } },
                        "¥" + Math.round(tRate).toLocaleString() + "/h"
                      )
                    )
                  ),

                  React.createElement("div", null,
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
                      React.createElement("span", null, "完成枚数"),
                      React.createElement("span", { style: { fontWeight: 700 } }, tCompletedQty + "枚 / " + tQty + "枚")
                    ),
                    React.createElement(ProgressBar, { value: tQty > 0 ? tCompletedQty / tQty : 0, color: "var(--iquta-d)" })
                  )
                );
              }),

              monthParts.some((p) => p.assigneeType === "outsource") && React.createElement("div", null,
                React.createElement(SectionLabel, null, "外注 サマリー"),
                React.createElement("button", { style: Object.assign({}, st.monthlyCard, { width: "100%", border: "none", textAlign: "left", cursor: "pointer", display: "block" }), onClick: () => set({ screen: "team_month", teamMonthTeam: "__outsource__", teamMonthMonth: sm }) },
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
                    React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "🏢 外注品番を見る"),
                    React.createElement("span", { style: { fontSize: 11, color: "var(--iquta)" } }, "一覧 ›")
                  ),
                  React.createElement("div", { style: st.grid2 },
                    React.createElement(SBox, { label: "外注品番数", value: monthParts.filter((p) => p.assigneeType === "outsource").length + "件" }),
                    React.createElement(SBox, { label: "売上合計", value: "¥" + Math.round(mOutsourceSales).toLocaleString() }),
                    React.createElement(SBox, { label: "利益合計", value: "¥" + Math.round(mTotalProfit).toLocaleString(), dark: mTotalProfit > 0 }),
                    React.createElement(SBox, { label: "利益率", value: mOutsourceSales > 0 ? Math.round(mTotalProfit / mOutsourceSales * 100) + "%" : "—" })
                  )
                )
              ),

              React.createElement(SectionLabel, null, "品番一覧"),
              monthParts.map((p) => React.createElement("button", {
                key: p.id,
                style: Object.assign({}, st.summaryCard, { textAlign: "left" }),
                onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "summary" })
              },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                  React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.kind === "sample" ? "✂ " : "") + p.partNo + (p.partName ? " " + p.partName : "")),
                    p.brandName && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "🏷 " + p.brandName)
                  ),
                  React.createElement("div", { style: { textAlign: "right", fontSize: 12, color: "#aaa" } },
                    React.createElement(Badge, { part: p }),
                    React.createElement("div", { style: { marginTop: 4 } }, p.assigneeType === "outsource" ? ("外注 / 利益¥" + (p.profit !== null ? Math.round(p.profit).toLocaleString() : "—")) : (p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "未記録"))
                  )
                )
              ))
            ),

        React.createElement(Spacer, { h: 16 }),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement("button", { style: Object.assign({}, st.quickBtn, { color: "var(--iquta)" }), onClick: downloadCSV }, "CSVダウンロード"),
          React.createElement("button", { style: Object.assign({}, st.quickBtn, { background: "var(--iquta)", color: "#fff" }), onClick: exportToSheet }, "スプレッドシートに出力")
        )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "member_mgmt") {
    const am = ui.activeMemberId;
    const activeMember = data.members.find((m) => m.id === am);

    if (am && activeMember) {
      const calMonth = ui.calMonth || today().slice(0, 7);
      const memberRecs = data.records.filter((r) => r.memberId === am);
      const monthRecs = memberRecs.filter((r) => r.date && r.date.slice(0, 7) === calMonth);

      const dayMap = {};
      monthRecs.forEach((r) => {
        if (!dayMap[r.date]) dayMap[r.date] = [];
        const part = data.parts.find((p) => p.id === r.partId);
        dayMap[r.date].push({ ...r, part });
      });

      const [year, month] = calMonth.split("-").map(Number);
      const firstDay = new Date(year, month - 1, 1).getDay();
      const daysInMonth = new Date(year, month, 0).getDate();
      const totalHours = memberRecs.reduce((a, r) => a + r.hours, 0);
      const monthHours = monthRecs.reduce((a, r) => a + r.hours, 0);

      const prevMonth = month === 1 ? year - 1 + "-12" : year + "-" + String(month - 1).padStart(2, "0");
      const nextMonth = month === 12 ? year + 1 + "-01" : year + "-" + String(month + 1).padStart(2, "0");
      const isCurrentMonth = calMonth === today().slice(0, 7);

      const days = [];
      for (let i = 0; i < firstDay; i++) days.push(null);
      for (let d = 1; d <= daysInMonth; d++) days.push(d);

      const todayStr = today();

      return React.createElement(Shell, null,
        React.createElement(Header, { title: activeMember.name, back: () => set({ activeMemberId: null, calMonth: null }) }),
        React.createElement(Body, null,

          React.createElement("div", { style: st.grid2 },
            React.createElement(SBox, { label: "累計作業時間", value: totalHours.toFixed(1) + "h" }),
            React.createElement(SBox, { label: calMonth.replace("-", "年") + "月の作業時間", value: monthHours > 0 ? monthHours.toFixed(1) + "h" : "—" })
          ),

          React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } },
            React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ calMonth: prevMonth }) }, "‹"),
            React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, year + "年" + month + "月"),
            React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16, opacity: isCurrentMonth ? 0.3 : 1 }), disabled: isCurrentMonth, onClick: () => !isCurrentMonth && set({ calMonth: nextMonth }) }, "›")
          ),

          React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: "12px", boxShadow: "0 1px 4px rgba(0,0,0,.06)", marginBottom: 16 } },
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 } },
              ["日", "月", "火", "水", "木", "金", "土"].map((d, i) =>
                React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "var(--iquta)" : "#aaa", padding: "4px 0" } }, d)
              )
            ),
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 } },
              days.map((d, i) => {
                if (!d) return React.createElement("div", { key: "empty-" + i });
                const dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
                const recs = dayMap[dateStr] || [];
                const dayHours = recs.reduce((a, r) => a + r.hours, 0);
                const isToday = dateStr === todayStr;
                const dow = (firstDay + d - 1) % 7;
                const hasWork = recs.length > 0;
                return React.createElement("div", {
                  key: "day-" + i,
                  style: {
                    minHeight: 52, borderRadius: 8, padding: "4px 3px",
                    background: isToday ? "var(--iquta)" : hasWork ? "var(--iquta-bg)" : "var(--paper)",
                    border: isToday ? "none" : hasWork ? "1px solid #c8d8ff" : "1px solid #f0eeea",
                    cursor: hasWork ? "pointer" : "default",
                  },
                  onClick: () => hasWork && set({ calSelectedDate: dateStr })
                },
                  React.createElement("div", { style: { textAlign: "center", fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? "#fff" : dow === 0 ? "#c00" : dow === 6 ? "var(--iquta)" : "#555", marginBottom: 2 } }, d),
                  hasWork && React.createElement("div", { style: { textAlign: "center" } },
                    React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: isToday ? "#7df" : "var(--iquta)" } }, dayHours.toFixed(1) + "h"),
                    recs.length > 1 && React.createElement("div", { style: { fontSize: 9, color: isToday ? "#adf" : "#aaa" } }, recs.length + "件")
                  )
                );
              })
            )
          ),

          ui.calSelectedDate && ui.calSelectedDate.slice(0, 7) === calMonth
            ? React.createElement("div", null,
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
                  React.createElement("div", { style: st.sectionLabel }, ui.calSelectedDate.slice(5).replace("-", "/") + " の作業"),
                  React.createElement("button", { style: st.ghostBtn, onClick: () => set({ calSelectedDate: null }) }, "✕")
                ),
                (dayMap[ui.calSelectedDate] || []).map((r) =>
                  React.createElement("div", { key: r.id, style: Object.assign({}, st.recRow, { background: "#f0f4ff" }) },
                    React.createElement("div", { style: { flex: 1 } },
                      React.createElement("div", { style: { fontSize: 13, fontWeight: 700 } }, r.part ? r.part.partNo : "削除済み"),
                      r.part && r.part.partName && React.createElement("div", { style: { fontSize: 11, color: "#888" } }, r.part.partName)
                    ),
                    React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "var(--iquta)" } }, r.hours + "h")
                  )
                )
              )
            : monthRecs.length > 0 && React.createElement("div", null,
                React.createElement(SectionLabel, null, "今月の作業一覧（日付をタップで絞り込み）"),
                Object.entries(dayMap).sort((a, b) => b[0].localeCompare(a[0])).map(([date, recs]) =>
                  React.createElement("div", { key: date, style: { marginBottom: 10 } },
                    React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 4 } },
                      date.slice(5).replace("-", "/") + "（" + ["日","月","火","水","木","金","土"][new Date(date).getDay()] + "）"
                    ),
                    recs.map((r) =>
                      React.createElement("div", { key: r.id, style: st.recRow },
                        React.createElement("div", { style: { flex: 1 } },
                          React.createElement("div", { style: { fontSize: 13, fontWeight: 700 } }, r.part ? r.part.partNo : "削除済み"),
                          r.part && r.part.partName && React.createElement("div", { style: { fontSize: 11, color: "#888" } }, r.part.partName)
                        ),
                        React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, r.hours + "h")
                      )
                    )
                  )
                )
              )
        ),
        React.createElement(SI)
      );
    }

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "メンバー管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "新しいメンバーを追加" },
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              React.createElement("input", { style: Object.assign({}, st.input, { flex: 1 }), placeholder: "名前を入力", value: ui.addMemberForm.name, onChange: (e) => set({ addMemberForm: { name: e.target.value } }) }),
              React.createElement("button", { style: st.inlineBtn, onClick: addMember }, "追加")
            )
          )
        ),
        React.createElement(SectionLabel, null, "メンバー一覧（" + data.members.length + "人）　タップで作業履歴を確認"),
        data.members.length === 0 && React.createElement(Empty, null, "メンバーがいません"),
        data.members.map((m) => {
          const mHours = data.records.filter((r) => r.memberId === m.id).reduce((a, r) => a + r.hours, 0);
          const mParts = new Set(data.records.filter((r) => r.memberId === m.id).map((r) => r.partId)).size;
          return React.createElement("div", { key: m.id, style: Object.assign({}, st.memberRow, { flexWrap: "wrap", gap: 6 }) },
            ui.editMemberId === m.id
              ? React.createElement(React.Fragment, null,
                  React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editMemberName, onChange: (e) => set({ editMemberName: e.target.value }) }),
                  React.createElement("button", { style: st.inlineBtn, onClick: saveMemberName }, "保存"),
                  React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editMemberId: null }) }, "取消")
                )
              : React.createElement(React.Fragment, null,
                  React.createElement("button", { style: { flex: 1, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }, onClick: () => set({ activeMemberId: m.id }) },
                    React.createElement("div", { style: { fontSize: 14, fontWeight: 600 } }, m.name),
                    mHours > 0 && React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } }, "累計 " + mHours.toFixed(1) + "h　" + mParts + "品番")
                  ),
                  React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editMemberId: m.id, editMemberName: m.name }) }, "編集"),
                  React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteMember(m.id) }, "削除")
                )
          );
        })
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "vendor_mgmt") return React.createElement(Shell, null,
    React.createElement(Header, { title: "外注先管理", back: () => set({ screen: "home" }) }),
    React.createElement(Body, null,
      React.createElement("div", { style: st.card },
        React.createElement(FormRow, { label: "新しい外注先を追加" },
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("input", { style: Object.assign({}, st.input, { flex: 1 }), placeholder: "会社名を入力", value: ui.addVendorForm.name, onChange: (e) => set({ addVendorForm: { name: e.target.value } }) }),
            React.createElement("button", { style: st.inlineBtn, onClick: addVendor }, "追加")
          )
        )
      ),
      React.createElement(SectionLabel, null, "外注先一覧（" + data.vendors.length + "社）　タップで売上・利益・進捗を確認"),
      data.vendors.length === 0 && React.createElement(Empty, null, "外注先がいません"),
      data.vendors.map((v) => React.createElement("div", { key: v.id, style: st.memberRow },
        ui.editVendorId === v.id
          ? React.createElement(React.Fragment, null, React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editVendorName, onChange: (e) => set({ editVendorName: e.target.value }) }), React.createElement("button", { style: st.inlineBtn, onClick: saveVendorName }, "保存"), React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editVendorId: null }) }, "取消"))
          : React.createElement(React.Fragment, null,
              React.createElement("button", { style: { flex: 1, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0, fontSize: 14, fontWeight: 600 }, onClick: () => set({ activeVendorId: v.id, screen: "vendor_detail" }) }, v.name),
              React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editVendorId: v.id, editVendorName: v.name }) }, "編集"),
              React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteVendor(v.id) }, "削除")
            )
      ))
    ),
    React.createElement(SI)
  );

  if (ui.screen === "vendor_detail" && ui.activeVendorId) {
    const vid = ui.activeVendorId;
    const vendor = data.vendors.find((v) => v.id === vid);
    if (!vendor) { set({ activeVendorId: null, screen: "vendor_mgmt" }); return null; }
    const vparts = partSummary.filter((p) => p.assigneeType === "outsource" && p.assignee === vid && p.closedAt);
    const sale = (p) => (p.sellPrice || 0) * (p.qty || 0);
    const cost = (p) => (p.vendorPrice || 0) * (p.qty || 0);
    const totSale = vparts.reduce((a, p) => a + sale(p), 0);
    const totCost = vparts.reduce((a, p) => a + cost(p), 0);
    const totProfit = vparts.reduce((a, p) => a + (p.profit || 0), 0);
    const totRate = totSale > 0 ? totProfit / totSale * 100 : 0;

    const byMonth = {};
    vparts.forEach((p) => { const m = p.workMonth || "未設定"; if (!byMonth[m]) byMonth[m] = []; byMonth[m].push(p); });
    const months = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
    const monthLabel = (m) => m === "未設定" ? "仕掛り月 未設定" : (m.replace("-", "年") + "月");

    return React.createElement(Shell, null,
      React.createElement(Header, { title: vendor.name, back: () => set({ activeVendorId: null, screen: "vendor_mgmt" }) }),
      React.createElement(Body, null,

        React.createElement("div", { style: { fontSize: 11, color: "#999", marginBottom: 10 } }, "※「完了（納品済み）」を押した品番のみ集計しています"),

        vparts.length === 0
          ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#bbb", padding: 24 }) }, "完了した品番がありません")
          : React.createElement("div", null,

              React.createElement("div", { style: { background: "var(--iquta)", color: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, "本体に残る利益（完了品番）"),
                React.createElement("div", { style: { fontSize: 28, fontWeight: 700, color: totProfit >= 0 ? "#7dff7d" : "#ff8a8a" } }, "¥" + Math.round(totProfit).toLocaleString()),
                React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 6, borderTop: "1px solid #444", paddingTop: 8 } },
                  "売上 ¥" + Math.round(totSale).toLocaleString() + "　/　外注費 ¥" + Math.round(totCost).toLocaleString() + "　/　利益率 " + (totSale > 0 ? totRate.toFixed(1) + "%" : "—")
                )
              ),
              React.createElement("div", { style: st.grid2 },
                React.createElement(SBox, { label: "完了品番数", value: vparts.length + "件" }),
                React.createElement(SBox, { label: "売上合計", value: "¥" + Math.round(totSale).toLocaleString() })
              ),

              React.createElement(SectionLabel, null, "月ごと"),
              months.map((m) => {
                const list = byMonth[m].slice().sort((a, b) => { if (!a.deadline) return 1; if (!b.deadline) return -1; return a.deadline.localeCompare(b.deadline); });
                const mSale = list.reduce((a, p) => a + sale(p), 0);
                const mCost = list.reduce((a, p) => a + cost(p), 0);
                const mProfit = list.reduce((a, p) => a + (p.profit || 0), 0);
                const mRate = mSale > 0 ? mProfit / mSale * 100 : 0;
                const mQty = list.reduce((a, p) => a + (p.qty || 0), 0);
                const mDone = list.filter((p) => p.closedAt).length;
                const mCompleted = list.reduce((a, p) => a + p.completedQty, 0);
                return React.createElement("div", { key: m, style: st.monthlyCard },
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
                    React.createElement("span", { style: { fontSize: 14, fontWeight: 700 } }, monthLabel(m)),
                    React.createElement("span", { style: { fontSize: 12, color: "#aaa" } }, list.length + "品番 / " + mQty + "枚")
                  ),
                  React.createElement("div", { style: { background: "#0f3d40", color: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 10 } },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                      React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: 10, opacity: 0.6, marginBottom: 2 } }, "利益"),
                        React.createElement("div", { style: { fontSize: 20, fontWeight: 700 } }, "¥" + Math.round(mProfit).toLocaleString())
                      ),
                      React.createElement("div", { style: { textAlign: "right", fontSize: 11, opacity: 0.85 } },
                        React.createElement("div", null, "売上 ¥" + Math.round(mSale).toLocaleString()),
                        React.createElement("div", null, "外注費 ¥" + Math.round(mCost).toLocaleString()),
                        React.createElement("div", null, "利益率 " + (mSale > 0 ? mRate.toFixed(1) + "%" : "—"))
                      )
                    )
                  ),
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 10 } },
                    React.createElement("span", null, "完了 " + list.length + "品番・" + mQty + "枚"),
                    React.createElement("span", null, "")
                  ),
                  list.map((p) => React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left", marginBottom: 8, borderLeft: "3px solid " + (p.closedAt ? "var(--iquta-d)" : (p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "var(--aka)" : "var(--line)")) }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "vendor_detail" }) },
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
                      React.createElement("div", null,
                        React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.kind === "sample" ? "✂ " : "") + p.partNo + (p.partName ? " " + p.partName : "")),
                        p.brandName && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "🏷 " + p.brandName)
                      ),
                      React.createElement("div", { style: { textAlign: "right" } },
                        p.closedAt
                          ? React.createElement("div", { style: { fontSize: 11, color: "#2a7a2a", fontWeight: 700 } }, "納品済み " + fmt(p.closedAt))
                          : (p.deadline && React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: p.remainDays <= 3 ? "#c00" : p.remainDays <= 7 ? "#c25000" : "#aaa" } }, "あと" + p.remainDays + "日")),
                        React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } }, "利益 ¥" + (p.profit !== null ? Math.round(p.profit).toLocaleString() : "—"))
                      )
                    ),
                    React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 4 } },
                      p.qty + "枚　売上¥" + Math.round(sale(p)).toLocaleString() + "　外注費¥" + Math.round(cost(p)).toLocaleString()
                    )
                  ))
                );
              })
            )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "brand_mgmt") return React.createElement(Shell, null,
    React.createElement(Header, { title: "ブランド管理（客先名）", back: () => set({ screen: "home" }) }),
    React.createElement(Body, null,
      React.createElement("div", { style: st.card },
        React.createElement(FormRow, { label: "新しいブランドを追加" },
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("input", { style: Object.assign({}, st.input, { flex: 1 }), placeholder: "ブランド・メーカー名", value: ui.addBrandForm.name, onChange: (e) => set({ addBrandForm: { name: e.target.value } }) }),
            React.createElement("button", { style: st.inlineBtn, onClick: addBrand }, "追加")
          )
        )
      ),
      React.createElement(SectionLabel, null, "ブランド一覧（" + (data.brands || []).length + "件）　タップで品番ごとの時間単価を確認"),
      (data.brands || []).length === 0 && React.createElement(Empty, null, "ブランドが登録されていません"),
      (data.brands || []).map((b) => {
        const bp = partSummary.filter((p) => p.brandId === b.id && p.assigneeType !== "outsource" && p.closedAt);
        const sales = bp.reduce((a, p) => a + p.totalSales, 0);
        const hrs = bp.reduce((a, p) => a + p.totalHours, 0);
        const rate = hrs > 0 ? sales / hrs : null;
        return React.createElement("div", { key: b.id, style: st.memberRow },
          ui.editBrandId === b.id
            ? React.createElement(React.Fragment, null, React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editBrandName, onChange: (e) => set({ editBrandName: e.target.value }) }), React.createElement("button", { style: st.inlineBtn, onClick: saveBrandName }, "保存"), React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editBrandId: null }) }, "取消"))
            : React.createElement(React.Fragment, null,
                React.createElement("button", { style: { flex: 1, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0 }, onClick: () => set({ activeBrandId: b.id, screen: "brand_detail" }) },
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 600 } }, b.name),
                  React.createElement("div", { style: { fontSize: 11, color: rate !== null ? "#2a7a2a" : "#bbb", marginTop: 2, fontWeight: 700 } }, rate !== null ? "時間単価 ¥" + Math.round(rate).toLocaleString() + "/h" : "実績なし")
                ),
                React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editBrandId: b.id, editBrandName: b.name }) }, "編集"),
                React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteBrand(b.id) }, "削除")
              )
        );
      }),
      (function () {
        const bp = partSummary.filter((p) => !p.brandId && p.assigneeType !== "outsource" && p.closedAt);
        if (bp.length === 0) return null;
        const sales = bp.reduce((a, p) => a + p.totalSales, 0);
        const hrs = bp.reduce((a, p) => a + p.totalHours, 0);
        const rate = hrs > 0 ? sales / hrs : null;
        return React.createElement("button", { style: Object.assign({}, st.memberRow, { width: "100%", border: "none", cursor: "pointer", background: "#f5f4f0" }), onClick: () => set({ activeBrandId: "__none__", screen: "brand_detail" }) },
          React.createElement("div", { style: { flex: 1, textAlign: "left" } },
            React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: "#888" } }, "（ブランド未設定）"),
            React.createElement("div", { style: { fontSize: 11, color: rate !== null ? "#2a7a2a" : "#bbb", marginTop: 2, fontWeight: 700 } }, rate !== null ? "時間単価 ¥" + Math.round(rate).toLocaleString() + "/h" : "実績なし")
          ),
          React.createElement("span", { style: { color: "#ccc" } }, "›")
        );
      })()
    ),
    React.createElement(SI)
  );

  if (ui.screen === "brand_detail" && ui.activeBrandId) {
    const bid = ui.activeBrandId;
    const isNone = bid === "__none__";
    const brand = isNone ? { name: "（ブランド未設定）" } : (data.brands || []).find((b) => b.id === bid);
    if (!brand) { set({ activeBrandId: null, screen: "brand_mgmt" }); return null; }
    const bparts = partSummary.filter((p) => (isNone ? !p.brandId : p.brandId === bid) && p.closedAt);
    const inHouse = bparts.filter((p) => p.assigneeType !== "outsource");
    const outParts = bparts.filter((p) => p.assigneeType === "outsource");

    const totSales = inHouse.reduce((a, p) => a + p.totalSales, 0);
    const totHours = inHouse.reduce((a, p) => a + p.totalHours, 0);
    const totRate = totHours > 0 ? totSales / totHours : null;
    const outProfit = outParts.reduce((a, p) => a + (p.profit || 0), 0);

    const byMonth = {};
    bparts.forEach((p) => { const m = p.workMonth || "未設定"; if (!byMonth[m]) byMonth[m] = []; byMonth[m].push(p); });
    const months = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
    const monthLabel = (m) => m === "未設定" ? "仕掛り月 未設定" : (m.replace("-", "年") + "月");

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "🏷 " + brand.name, back: () => set({ activeBrandId: null, screen: "brand_mgmt" }) }),
      React.createElement(Body, null,

        React.createElement("div", { style: { fontSize: 11, color: "#999", marginBottom: 10 } }, "※「完了（納品済み）」を押した品番のみ集計しています"),

        bparts.length === 0
          ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#bbb", padding: 24 }) }, "完了した品番がありません")
          : React.createElement("div", null,

              React.createElement("div", { style: { background: "var(--iquta)", color: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 12 } },
                React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, "自社縫製の時間単価（売上 ÷ 作業時間／完了品番）"),
                React.createElement("div", { style: { fontSize: 28, fontWeight: 700, color: "#7dff7d" } }, totRate !== null ? "¥" + Math.round(totRate).toLocaleString() + "/h" : "—"),
                React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 6, borderTop: "1px solid #444", paddingTop: 8 } },
                  "社内 売上 ¥" + Math.round(totSales).toLocaleString() + "　/　作業 " + totHours.toFixed(1) + "h" + (outParts.length ? "　/　外注利益 ¥" + Math.round(outProfit).toLocaleString() : "")
                )
              ),
              React.createElement("div", { style: st.grid2 },
                React.createElement(SBox, { label: "完了品番数", value: bparts.length + "件" }),
                React.createElement(SBox, { label: "社内 売上合計", value: "¥" + Math.round(totSales).toLocaleString() })
              ),

              React.createElement(SectionLabel, null, "月ごと・品番ごとの時間単価"),
              months.map((m) => {
                const list = byMonth[m].slice().sort((a, b) => { if (!a.deadline) return 1; if (!b.deadline) return -1; return a.deadline.localeCompare(b.deadline); });
                const mIn = list.filter((p) => p.assigneeType !== "outsource");
                const mSales = mIn.reduce((a, p) => a + p.totalSales, 0);
                const mHours = mIn.reduce((a, p) => a + p.totalHours, 0);
                const mRate = mHours > 0 ? mSales / mHours : null;
                return React.createElement("div", { key: m, style: st.monthlyCard },
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } },
                    React.createElement("span", { style: { fontSize: 14, fontWeight: 700 } }, monthLabel(m)),
                    React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: mRate !== null ? "#2a7a2a" : "#bbb" } }, mRate !== null ? "¥" + Math.round(mRate).toLocaleString() + "/h" : "実績なし")
                  ),
                  list.map((p) => {
                    const isOut = p.assigneeType === "outsource";
                    return React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left", marginBottom: 8 }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "brand_detail" }) },
                      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
                        React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                          React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.kind === "sample" ? "✂ " : "") + p.partNo + (p.partName ? " " + p.partName : "")),
                          React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, (isOut ? "外注: " + (p.vendorName || "?") : (p.assignee || "未割当")) + "　" + p.qty + "枚" + (p.closedAt ? "　✅納品済み" : ""))
                        ),
                        React.createElement("div", { style: { textAlign: "right" } },
                          isOut
                            ? React.createElement(React.Fragment, null,
                                React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "#0f3d4a" } }, "利益 ¥" + (p.profit !== null ? Math.round(p.profit).toLocaleString() : "—")),
                                React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } }, p.profitRate !== null ? "利益率 " + p.profitRate.toFixed(1) + "%" : "")
                              )
                            : React.createElement(React.Fragment, null,
                                React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: p.totalHours > 0 ? "#2a7a2a" : "#bbb" } }, p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "実績なし"),
                                React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } }, "売上¥" + Math.round(p.totalSales).toLocaleString() + "・" + p.totalHours.toFixed(1) + "h")
                              )
                        )
                      )
                    );
                  })
                );
              })
            )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "brand_jobs") {
    const brands = data.brands || [];
    const sb = ui.selectedBrandId;
    const selectedBrand = brands.find((b) => b.id === sb);

    if (!sb) {
      const brandCounts = {};
      partSummary.forEach((p) => {
        if (!p.brandId) return;
        if (!brandCounts[p.brandId]) brandCounts[p.brandId] = { active: 0, done: 0 };
        if (p.closedAt) brandCounts[p.brandId].done++;
        else brandCounts[p.brandId].active++;
      });
      const noBrandActive = partSummary.filter((p) => !p.brandId && !p.closedAt).length;
      const noBrandDone = partSummary.filter((p) => !p.brandId && p.closedAt).length;

      return React.createElement(Shell, null,
        React.createElement(Header, { title: "ブランド別仕事一覧", back: () => set({ screen: "home" }) }),
        React.createElement(Body, null,
          brands.length === 0
            ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#aaa", padding: 24 }) },
                "ブランドが登録されていません。",
                React.createElement("br"),
                React.createElement("button", { style: Object.assign({}, st.ghostBtn, { marginTop: 12 }), onClick: () => set({ screen: "brand_mgmt" }) }, "🏷️ ブランドを登録する")
              )
            : React.createElement("div", null,
                React.createElement(SectionLabel, null, "ブランドを選ぶ"),
                brands.map((b) => {
                  const cnt = brandCounts[b.id] || { active: 0, done: 0 };
                  return React.createElement("button", {
                    key: b.id,
                    style: Object.assign({}, st.bigBtn, { marginBottom: 10, background: "#fff", color: "#1a1a1a", border: "1px solid #e0deda", justifyContent: "space-between" }),
                    onClick: () => set({ selectedBrandId: b.id })
                  },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
                      React.createElement("span", { style: { fontSize: 20 } }, "🏷️"),
                      React.createElement("div", { style: { textAlign: "left" } },
                        React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, b.name),
                        React.createElement("div", { style: { fontSize: 11, color: "#999", marginTop: 2 } },
                          cnt.active > 0 ? "納品前 " + cnt.active + "件" : "納品前なし",
                          cnt.done > 0 ? "　納品済み " + cnt.done + "件" : ""
                        )
                      )
                    ),
                    React.createElement("span", { style: { color: "#ccc", fontSize: 18 } }, "›")
                  );
                }),
                (noBrandActive > 0 || noBrandDone > 0) && React.createElement("button", {
                  style: Object.assign({}, st.bigBtn, { marginBottom: 10, background: "#f5f4f0", color: "#888", border: "1px solid #e0deda", justifyContent: "space-between" }),
                  onClick: () => set({ selectedBrandId: "__none__" })
                },
                  React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } },
                    React.createElement("span", { style: { fontSize: 20 } }, "📋"),
                    React.createElement("div", { style: { textAlign: "left" } },
                      React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, "ブランド未設定"),
                      React.createElement("div", { style: { fontSize: 11, color: "#999", marginTop: 2 } },
                        noBrandActive > 0 ? "納品前 " + noBrandActive + "件" : "",
                        noBrandDone > 0 ? "　納品済み " + noBrandDone + "件" : ""
                      )
                    )
                  ),
                  React.createElement("span", { style: { color: "#ccc", fontSize: 18 } }, "›")
                )
              )
        ),
        React.createElement(SI)
      );
    }

    const isNone = sb === "__none__";
    const filtered = isNone
      ? partSummary.filter((p) => !p.brandId)
      : partSummary.filter((p) => p.brandId === sb);
    const activeList = filtered.filter((p) => !p.closedAt).sort((a, b) => {
      if (!a.deadline) return 1; if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
    const doneList = filtered.filter((p) => p.closedAt).sort((a, b) =>
      (b.closedAt || "").localeCompare(a.closedAt || "")
    );

    const activeSales = activeList.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalSales, 0);
    const activeHours = activeList.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalHours, 0);
    const doneSales = doneList.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalSales, 0);

    return React.createElement(Shell, null,
      React.createElement(Header, {
        title: isNone ? "ブランド未設定" : selectedBrand ? selectedBrand.name : "",
        back: () => set({ selectedBrandId: null })
      }),
      React.createElement(Body, null,

        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "納品前 品番数", value: activeList.length + "件" }),
          React.createElement(SBox, { label: "納品済み 品番数", value: doneList.length + "件" }),
          React.createElement(SBox, { label: "納品前 売上合計", value: "¥" + Math.round(activeSales).toLocaleString() }),
          React.createElement(SBox, { label: "納品済み 売上合計", value: "¥" + Math.round(doneSales).toLocaleString(), dark: true })
        ),

        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 8 } },
          React.createElement("div", { style: { background: "#fff3e0", color: "#c25000", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20 } }, "📦 納品前　" + activeList.length + "件")
        ),
        activeList.length === 0
          ? React.createElement(Empty, null, "納品前の品番はありません")
          : activeList.map((p) => React.createElement("button", {
              key: p.id,
              style: Object.assign({}, st.summaryCard, { textAlign: "left", borderLeft: "3px solid " + (p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "#c25000" : "#e0deda") }),
              onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "brand_jobs" })
            },
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.kind === "sample" ? "✂ " : "") + p.partNo + (p.partName ? " " + p.partName : "")),
                  p.workMonth && React.createElement("div", { style: { fontSize: 11, color: "var(--iquta)", marginTop: 2 } }, p.workMonth.replace("-", "年") + "月仕掛り")
                ),
                React.createElement("div", { style: { textAlign: "right" } },
                  p.deadline && React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: p.remainDays <= 3 ? "#c00" : p.remainDays <= 7 ? "#c25000" : "#aaa" } },
                    "あと" + p.remainDays + "日"
                  ),
                  p.deadline && React.createElement("div", { style: { fontSize: 11, color: "#aaa" } }, "納期 " + fmt(p.deadline))
                )
              ),
              p.qtyProgress !== null && React.createElement("div", { style: { marginBottom: 6 } },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
                  React.createElement("span", null, "完成 " + p.completedQty + "枚 / " + p.qty + "枚"),
                  React.createElement("span", { style: { color: p.remainQty === 0 ? "#2a7a2a" : "#888", fontWeight: 700 } }, "残り " + p.remainQty + "枚")
                ),
                React.createElement(ProgressBar, { value: p.qtyProgress })
              ),
              React.createElement("div", { style: { display: "flex", gap: 8, fontSize: 11, color: "#aaa" } },
                React.createElement(AssigneeBadge, { part: p, vendors: data.vendors }),
                p.totalHours > 0 && React.createElement("span", null, "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h")
              )
            )),

        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 20 } },
          React.createElement("div", { style: { background: "#e8f5e8", color: "#2a7a2a", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20 } }, "✅ 納品済み　" + doneList.length + "件")
        ),
        doneList.length === 0
          ? React.createElement(Empty, null, "納品済みの品番はありません")
          : doneList.map((p) => React.createElement("button", {
              key: p.id,
              style: Object.assign({}, st.summaryCard, { textAlign: "left", opacity: 0.8, borderLeft: "3px solid #2a7a2a" }),
              onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "brand_jobs" })
            },
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "#555" } }, p.partNo + (p.partName ? " " + p.partName : "")),
                  p.workMonth && React.createElement("div", { style: { fontSize: 11, color: "var(--iquta)", marginTop: 2 } }, p.workMonth.replace("-", "年") + "月仕掛り")
                ),
                React.createElement("div", { style: { textAlign: "right" } },
                  React.createElement("div", { style: { fontSize: 11, color: "#2a7a2a", fontWeight: 700 } }, "完了 " + fmt(p.closedAt)),
                  p.totalHours > 0 && React.createElement("div", { style: { fontSize: 11, color: "#aaa" } }, "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h")
                )
              ),
              React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 6 } },
                React.createElement(AssigneeBadge, { part: p, vendors: data.vendors }),
                React.createElement("span", { style: { fontSize: 11, color: "#aaa" } }, p.qty + "枚")
              )
            ))
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "team_month" && ui.teamMonthTeam && ui.teamMonthMonth) {
    const tm = ui.teamMonthTeam;
    const mm = ui.teamMonthMonth;
    const isOutView = tm === "__outsource__";
    const tmParts = (isOutView
      ? partSummary.filter((p) => p.assigneeType === "outsource" && p.workMonth === mm)
      : partSummary.filter((p) => p.assignee === tm && p.assigneeType === "team" && p.workMonth === mm))
      .sort((a, b) => {
        if (!a.deadline) return 1; if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
      });
    const tmActive = tmParts.filter((p) => !p.closedAt);
    const tmDone = tmParts.filter((p) => p.closedAt);
    const tmPlannedSales = isOutView
      ? tmParts.reduce((a, p) => a + (p.sellPrice || 0) * (p.qty || 0), 0)
      : tmParts.reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);
    const tmProfit = tmParts.reduce((a, p) => a + (p.profit || 0), 0);
    const tmQty = tmParts.reduce((a, p) => a + (p.qty || 0), 0);
    const tmCompletedQty = tmParts.reduce((a, p) => a + p.completedQty, 0);

    const renderPart = (p) => React.createElement("button", {
      key: p.id,
      style: Object.assign({}, st.summaryCard, { textAlign: "left", opacity: p.closedAt ? 0.75 : 1, borderLeft: "3px solid " + (p.closedAt ? "var(--iquta-d)" : (p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "var(--aka)" : "var(--line)")) }),
      onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "team_month" })
    },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.kind === "sample" ? "✂ " : "") + p.partNo + (p.partName ? " " + p.partName : "")),
          isOutView && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "外注: " + (p.vendorName || "?")),
          p.brandName && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "🏷 " + p.brandName)
        ),
        React.createElement("div", { style: { textAlign: "right" } },
          p.closedAt
            ? React.createElement("div", { style: { fontSize: 11, color: "#2a7a2a", fontWeight: 700 } }, "完了 " + fmt(p.closedAt))
            : (p.deadline && React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: p.remainDays <= 3 ? "#c00" : p.remainDays <= 7 ? "#c25000" : "#aaa" } }, "あと" + p.remainDays + "日")),
          p.deadline && React.createElement("div", { style: { fontSize: 11, color: "#aaa" } }, "納期 " + fmt(p.deadline))
        )
      ),
      isOutView
        ? React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 4 } },
            p.qty + "枚　売上¥" + Math.round((p.sellPrice || 0) * (p.qty || 0)).toLocaleString() + "　利益¥" + (p.profit !== null ? Math.round(p.profit).toLocaleString() : "—")
          )
        : (p.qtyProgress !== null && React.createElement("div", { style: { marginTop: 6 } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
              React.createElement("span", null, "完成 " + p.completedQty + "枚 / " + p.qty + "枚"),
              React.createElement("span", null, "¥" + Math.round((p.unitPrice || 0) * (p.qty || 0)).toLocaleString())
            ),
            React.createElement(ProgressBar, { value: p.qtyProgress, color: p.remainQty === 0 ? "var(--iquta-d)" : "var(--iquta)" })
          ))
    );

    return React.createElement(Shell, null,
      React.createElement(Header, { title: (isOutView ? "外注" : tm) + "　" + mm.replace("-", "年") + "月", back: () => set({ screen: "summary" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "品番数", value: tmParts.length + "件" }),
          isOutView
            ? React.createElement(SBox, { label: "利益合計", value: "¥" + Math.round(tmProfit).toLocaleString(), dark: true })
            : React.createElement(SBox, { label: "予定売上", value: "¥" + Math.round(tmPlannedSales).toLocaleString(), dark: true }),
          React.createElement(SBox, { label: "総枚数", value: tmQty + "枚" }),
          isOutView
            ? React.createElement(SBox, { label: "売上合計", value: "¥" + Math.round(tmPlannedSales).toLocaleString() })
            : React.createElement(SBox, { label: "完成枚数", value: tmCompletedQty + "枚" })
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 8 } },
          React.createElement("div", { style: { background: "#fff3e0", color: "#c25000", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20 } }, "📦 進行中　" + tmActive.length + "件")
        ),
        tmActive.length === 0 ? React.createElement(Empty, null, "進行中の品番はありません") : tmActive.map(renderPart),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 20 } },
          React.createElement("div", { style: { background: "#e8f5e8", color: "#2a7a2a", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20 } }, "✅ 完了　" + tmDone.length + "件")
        ),
        tmDone.length === 0 ? React.createElement(Empty, null, "完了済みの品番はありません") : tmDone.map(renderPart)
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "sales_calendar") {
    const sMonth = ui.salesMonth || today().slice(0, 7);
    const sTeam = ui.salesTeam || "all";
    const [year, month] = sMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const prevMonth = month === 1 ? (year - 1) + "-12" : year + "-" + String(month - 1).padStart(2, "0");
    const nextMonth = month === 12 ? (year + 1) + "-01" : year + "-" + String(month + 1).padStart(2, "0");

    const salesByDate = {};
    (data.qtyRecords || []).forEach((r) => {
      if (!r.date || r.date.slice(0, 7) !== sMonth) return;
      const part = data.parts.find((p) => p.id === r.partId);
      if (!part || part.kind === "sample") return;
      if (sTeam !== "all") {
        if (part.assigneeType !== "team" || part.assignee !== sTeam) return;
      }
      const sale = (part.unitPrice || 0) * (r.qty || 0);
      if (!salesByDate[r.date]) salesByDate[r.date] = { sales: 0, qty: 0, items: [] };
      salesByDate[r.date].sales += sale;
      salesByDate[r.date].qty += (r.qty || 0);
      salesByDate[r.date].items.push({ part, qty: r.qty, sale, team: part.assignee });
    });
    data.parts.forEach((part) => {
      if (part.kind !== "sample" || !part.closedAt) return;
      if (part.closedAt.slice(0, 7) !== sMonth) return;
      if (sTeam !== "all" && part.assignee !== sTeam) return;
      const sale = (part.unitPrice || 0) * (part.qty || 0);
      const d = part.closedAt;
      if (!salesByDate[d]) salesByDate[d] = { sales: 0, qty: 0, items: [] };
      salesByDate[d].sales += sale;
      salesByDate[d].qty += (part.qty || 0);
      salesByDate[d].items.push({ part, qty: part.qty, sale, team: part.assignee, isSample: true });
    });

    const monthSales = Object.values(salesByDate).reduce((a, d) => a + d.sales, 0);
    const monthQty = Object.values(salesByDate).reduce((a, d) => a + d.qty, 0);

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    const todayStr = today();

    const maxDaySales = Math.max(1, ...Object.values(salesByDate).map((d) => d.sales));

    const fmtMan = (v) => {
      if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + "万";
      return Math.round(v / 1000) + "千";
    };

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "💰 売上カレンダー", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,

        React.createElement("div", { style: st.filterRow },
          React.createElement("button", { style: Object.assign({}, st.filterBtn, sTeam === "all" ? st.filterBtnActive : {}), onClick: () => set({ salesTeam: "all", salesSelectedDate: null }) }, "社内全体"),
          TEAMS.map((t) => React.createElement("button", { key: t, style: Object.assign({}, st.filterBtn, sTeam === t ? st.filterBtnActive : {}), onClick: () => set({ salesTeam: t, salesSelectedDate: null }) }, t))
        ),

        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } },
          React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ salesMonth: prevMonth, salesSelectedDate: null }) }, "‹"),
          React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, year + "年" + month + "月"),
          React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ salesMonth: nextMonth, salesSelectedDate: null }) }, "›")
        ),

        React.createElement("div", { style: { background: "var(--iquta)", color: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 12 } },
          React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, (sTeam === "all" ? "社内全体" : sTeam) + "　" + month + "月の完成売上"),
          React.createElement("div", { style: { fontSize: 28, fontWeight: 700 } }, "¥" + Math.round(monthSales).toLocaleString()),
          React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 4 } }, "完成 " + monthQty.toLocaleString() + "枚")
        ),

        React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: "10px", boxShadow: "0 1px 4px rgba(0,0,0,.06)", marginBottom: 16 } },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 } },
            ["日","月","火","水","木","金","土"].map((d, i) =>
              React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "var(--iquta)" : "#aaa", padding: "4px 0" } }, d)
            )
          ),
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 } },
            days.map((d, i) => {
              if (!d) return React.createElement("div", { key: "e" + i, style: { minHeight: 56 } });
              const dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
              const dd = salesByDate[dateStr];
              const isToday = dateStr === todayStr;
              const dow = (firstDay + d - 1) % 7;
              const intensity = dd ? dd.sales / maxDaySales : 0;
              return React.createElement("div", {
                key: "d" + i,
                style: {
                  minHeight: 56, borderRadius: 6, padding: "3px 2px",
                  background: dd ? "rgba(20,85,90," + (0.12 + intensity * 0.5) + ")" : (isToday ? "#fff8e0" : "#fafafa"),
                  border: isToday ? "2px solid #ffd060" : "1px solid #f0eeea",
                  cursor: dd ? "pointer" : "default",
                },
                onClick: () => dd && set({ salesSelectedDate: dateStr })
              },
                React.createElement("div", { style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: dow === 0 ? "#c00" : dow === 6 ? "var(--iquta)" : "#555" } }, d),
                dd && React.createElement("div", { style: { textAlign: "center", marginTop: 2 } },
                  React.createElement("div", { style: { fontSize: 10, fontWeight: 700, color: intensity > 0.6 ? "#fff" : "#14555a" } }, "¥" + fmtMan(dd.sales)),
                  React.createElement("div", { style: { fontSize: 9, color: intensity > 0.6 ? "#cde" : "#888" } }, dd.qty + "枚")
                )
              );
            })
          )
        ),

        ui.salesSelectedDate && salesByDate[ui.salesSelectedDate] && React.createElement("div", null,
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
            React.createElement("div", { style: st.sectionLabel }, ui.salesSelectedDate.slice(5).replace("-", "/") + " の完成売上"),
            React.createElement("button", { style: st.ghostBtn, onClick: () => set({ salesSelectedDate: null }) }, "✕")
          ),
          React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px", marginBottom: 12 }) },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
              React.createElement("span", { style: { fontSize: 13, color: "#888" } }, "合計"),
              React.createElement("span", { style: { fontSize: 20, fontWeight: 700 } }, "¥" + Math.round(salesByDate[ui.salesSelectedDate].sales).toLocaleString())
            )
          ),
          salesByDate[ui.salesSelectedDate].items.slice().sort((a, b) => b.sale - a.sale).map((it, idx) =>
            React.createElement("button", { key: idx, style: Object.assign({}, st.summaryCard, { textAlign: "left" }), onClick: () => set({ activePartId: it.part.id, screen: "part_detail", prevScreen: "sales_calendar" }) },
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, it.part.partNo + (it.part.partName ? " " + it.part.partName : "")),
                  React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } },
                    (it.team || "未割当") + "　" + (it.isSample ? "✂️サンプル " : "") + it.qty + "枚 × ¥" + (it.part.unitPrice || 0).toLocaleString()
                  )
                ),
                React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "#14555a" } }, "¥" + Math.round(it.sale).toLocaleString())
              )
            )
          )
        ),

        !ui.salesSelectedDate && monthSales === 0 && React.createElement(Empty, null, "この月の完成記録はありません")
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "sample_list") {
    const samples = sampleSummary.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const active = samples.filter((p) => !p.closedAt);
    const done = samples.filter((p) => p.closedAt);
    const totalSamplePrice = samples.reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);
    const doneSamplePrice = done.reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);

    const renderSample = (p) => React.createElement("div", { key: p.id, style: Object.assign({}, st.card, { padding: "14px 16px", marginBottom: 10, opacity: p.closedAt ? 0.8 : 1 }) },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, p.partNo + (p.partName ? " " + p.partName : "")),
          p.brandName && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "🏷 " + p.brandName)
        ),
        p.closedAt
          ? React.createElement("span", { style: { background: "#e8f5e8", color: "#2a7a2a", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, "完了")
          : React.createElement("span", { style: { background: "#fff3e0", color: "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, "作成中")
      ),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 } },
        React.createElement("div", { style: { background: "#f5f4f0", borderRadius: 8, padding: "8px", textAlign: "center" } },
          React.createElement("div", { style: { fontSize: 10, color: "#aaa" } }, "枚数"),
          React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.qty || 0) + "枚")
        ),
        React.createElement("div", { style: { background: "#f5f4f0", borderRadius: 8, padding: "8px", textAlign: "center" } },
          React.createElement("div", { style: { fontSize: 10, color: "#aaa" } }, "実働"),
          React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.actualHours || 0) + "h")
        ),
        React.createElement("div", { style: { background: "#f5f4f0", borderRadius: 8, padding: "8px", textAlign: "center" } },
          React.createElement("div", { style: { fontSize: 10, color: "#aaa" } }, "サンプル代"),
          React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "#14555a" } }, "¥" + Math.round((p.unitPrice || 0) * (p.qty || 0)).toLocaleString())
        )
      ),
      (p.massEstMin > 0) && React.createElement("div", { style: { fontSize: 12, color: "#555", background: "#eef4ff", borderRadius: 8, padding: "8px 10px", marginBottom: 10 } },
        "📋 量産時の見積もり時間: ", React.createElement("b", null, p.massEstMin + "分/着"), "（このサンプルから算出）"
      ),
      React.createElement("div", { style: { display: "flex", gap: 8 } },
        React.createElement("button", { style: Object.assign({}, st.ghostBtn, { flex: 1 }), onClick: () => openSampleEdit(p) }, "✏️ 編集"),
        React.createElement("button", { style: Object.assign({}, st.ghostBtn, { flex: 1, color: p.closedAt ? "#777" : "#2a7a2a" }), onClick: () => toggleSampleDone(p) }, p.closedAt ? "作成中に戻す" : "✓ 完了にする"),
        React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => { if (window.confirm("削除しますか？")) deleteSample(p.id); } }, "削除")
      )
    );

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "✂️ サンプル管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("button", { style: st.dashedBtn, onClick: openSampleNew }, "＋ 新しいサンプルを登録する"),
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "サンプル件数", value: samples.length + "件" }),
          React.createElement(SBox, { label: "完了 サンプル代", value: "¥" + Math.round(doneSamplePrice).toLocaleString(), dark: true })
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 8 } },
          React.createElement("div", { style: { background: "#fff3e0", color: "#c25000", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20 } }, "✂️ 作成中　" + active.length + "件")
        ),
        active.length === 0 ? React.createElement(Empty, null, "作成中のサンプルはありません") : active.map(renderSample),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, marginTop: 20 } },
          React.createElement("div", { style: { background: "#e8f5e8", color: "#2a7a2a", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20 } }, "✅ 完了　" + done.length + "件")
        ),
        done.length === 0 ? React.createElement(Empty, null, "完了したサンプルはありません") : done.map(renderSample)
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "sample_edit" && ui.sampleForm) {
    const f = ui.sampleForm;
    const setSampleF = (patch) => set({ sampleForm: Object.assign({}, f, patch) });
    const actualPerUnit = (parseFloat(f.qty) > 0 && parseFloat(f.actualHours) > 0) ? (parseFloat(f.actualHours) * 60 / parseFloat(f.qty)) : 0;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: f.id ? "サンプルを編集" : "サンプルを登録", back: () => set({ screen: "sample_list", sampleForm: null }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品番 ＊" }, React.createElement("input", { style: st.input, placeholder: "例: SP-2026-001", value: f.partNo, onChange: (e) => setSampleF({ partNo: e.target.value }) })),
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, placeholder: "例: タックブラウス", value: f.partName, onChange: (e) => setSampleF({ partName: e.target.value }) })),
          React.createElement(FormRow, { label: "ブランド（客先名）" },
            (data.brands || []).length === 0
              ? React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "ブランド未登録")
              : React.createElement("select", { style: st.input, value: f.brandId || "", onChange: (e) => setSampleF({ brandId: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択しない"),
                  (data.brands || []).map((b) => React.createElement("option", { key: b.id, value: b.id }, b.name))
                )
          ),
          React.createElement(FormRow, { label: "仕掛り月" }, React.createElement("input", { style: st.input, type: "month", value: f.workMonth || "", onChange: (e) => setSampleF({ workMonth: e.target.value }) })),
          React.createElement(FormRow, { label: "納期" }, React.createElement("input", { style: st.input, type: "date", value: f.deadline || "", onChange: (e) => setSampleF({ deadline: e.target.value }) })),
          React.createElement(FormRow, { label: "枚数" }, React.createElement("input", { style: st.input, type: "number", min: "0", placeholder: "例: 2", value: f.qty, onChange: (e) => setSampleF({ qty: e.target.value }) })),
          React.createElement(FormRow, { label: "サンプル代（円・1着あたり）" }, React.createElement("input", { style: st.input, type: "number", min: "0", placeholder: "例: 8000", value: f.samplePrice, onChange: (e) => setSampleF({ samplePrice: e.target.value }) })),
          React.createElement(FormRow, { label: "実働時間（h・合計）" }, React.createElement("input", { style: st.input, type: "number", min: "0", step: "0.5", placeholder: "例: 6", value: f.actualHours, onChange: (e) => setSampleF({ actualHours: e.target.value }) })),
          React.createElement(FormRow, { label: "量産時の見積もり時間（分/着）" },
            React.createElement("input", { style: st.input, type: "number", min: "0", placeholder: "例: 45", value: f.massEstMin, onChange: (e) => setSampleF({ massEstMin: e.target.value }) }),
            actualPerUnit > 0 && React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 4 } }, "参考: このサンプルの実働は1着あたり約" + actualPerUnit.toFixed(0) + "分")
          ),
          React.createElement(FormRow, { label: "担当（チーム / 外注先）" },
            React.createElement("select", { style: st.input, value: f.assignee, onChange: (e) => setSampleF({ assignee: e.target.value }) },
              React.createElement("optgroup", { label: "社内チーム" },
                TEAMS.map((t) => React.createElement("option", { key: t, value: t }, t))
              ),
              data.vendors.length > 0 && React.createElement("optgroup", { label: "外注先" },
                data.vendors.map((v) => React.createElement("option", { key: v.id, value: v.name }, "外注: " + v.name))
              )
            )
          ),
          React.createElement(FormRow, { label: "担当者名" },
            (data.members || []).length === 0
              ? React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "メンバー未登録")
              : React.createElement("select", { style: st.input, value: f.tantousha || "", onChange: (e) => setSampleF({ tantousha: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択しない"),
                  (data.members || []).map((m) => React.createElement("option", { key: m.id, value: m.name }, m.name))
                )
          ),
          React.createElement(FormRow, { label: "備考" }, React.createElement("input", { style: st.input, value: f.note, onChange: (e) => setSampleF({ note: e.target.value }) })),
          (parseFloat(f.samplePrice) > 0 && parseFloat(f.qty) > 0) && React.createElement("div", { style: { background: "#f0f8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between" } },
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, "サンプル代合計"),
            React.createElement("b", null, "¥" + Math.round(parseFloat(f.samplePrice) * parseFloat(f.qty)).toLocaleString())
          ),
          React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: f.partNo ? 1 : 0.35 }), disabled: !f.partNo, onClick: saveSample }, "保存する")
        )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "deadline_calendar") {
    const dlMonth = ui.dlMonth || today().slice(0, 7);
    const [year, month] = dlMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const prevMonth = month === 1 ? (year - 1) + "-12" : year + "-" + String(month - 1).padStart(2, "0");
    const nextMonth = month === 12 ? (year + 1) + "-01" : year + "-" + String(month + 1).padStart(2, "0");

    const dlByDate = {};
    partSummary.forEach((p) => {
      if (!p.deadline || p.deadline.slice(0, 7) !== dlMonth) return;
      if (!dlByDate[p.deadline]) dlByDate[p.deadline] = [];
      dlByDate[p.deadline].push(p);
    });
    sampleSummary.forEach((p) => {
      if (!p.deadline || p.deadline.slice(0, 7) !== dlMonth) return;
      if (!dlByDate[p.deadline]) dlByDate[p.deadline] = [];
      dlByDate[p.deadline].push(p);
    });
    const monthDlCount = Object.values(dlByDate).reduce((a, arr) => a + arr.length, 0);
    const dlPlannedSales = Object.values(dlByDate).reduce((a, arr) => a + arr.reduce((b, p) => {
      const sale = p.assigneeType === "outsource" ? (p.sellPrice || 0) * (p.qty || 0) : (p.unitPrice || 0) * (p.qty || 0);
      return b + sale;
    }, 0), 0);

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    const todayStr = today();

    const teamColor = (p) => {
      if (p.kind === "sample") return "#7a2a7a";
      if (p.assigneeType === "outsource") return "#888";
      return TEAM_COLORS[p.assignee] || "#bbb";
    };

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "📅 納期カレンダー", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,

        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } },
          React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ dlMonth: prevMonth, dlSelectedDate: null }) }, "‹"),
          React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, year + "年" + month + "月　納期 " + monthDlCount + "件"),
          React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ dlMonth: nextMonth, dlSelectedDate: null }) }, "›")
        ),

        monthDlCount > 0 && React.createElement("div", { style: { background: "#1a1a1a", color: "#fff", borderRadius: 10, padding: "12px 16px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" } },
          React.createElement("span", { style: { fontSize: 12, opacity: 0.6 } }, "この月納期の予定売上合計"),
          React.createElement("span", { style: { fontSize: 20, fontWeight: 700 } }, "¥" + Math.round(dlPlannedSales).toLocaleString())
        ),

        React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: 11 } },
          TEAMS.map((t) => React.createElement("div", { key: t, style: { display: "flex", alignItems: "center", gap: 4 } },
            React.createElement("div", { style: { width: 10, height: 10, borderRadius: 3, background: TEAM_COLORS[t] } }),
            React.createElement("span", { style: { color: "#888" } }, t)
          )),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4 } },
            React.createElement("div", { style: { width: 10, height: 10, borderRadius: 3, background: "#888" } }),
            React.createElement("span", { style: { color: "#888" } }, "外注")
          ),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4 } },
            React.createElement("div", { style: { width: 10, height: 10, borderRadius: 3, background: "#7a2a7a" } }),
            React.createElement("span", { style: { color: "#888" } }, "✂ サンプル")
          )
        ),

        React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: "10px", boxShadow: "0 1px 4px rgba(0,0,0,.06)", marginBottom: 16 } },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 } },
            ["日","月","火","水","木","金","土"].map((d, i) =>
              React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "var(--iquta)" : "#aaa", padding: "4px 0" } }, d)
            )
          ),
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 } },
            days.map((d, i) => {
              if (!d) return React.createElement("div", { key: "e" + i, style: { minHeight: 64 } });
              const dateStr = year + "-" + String(month).padStart(2, "0") + "-" + String(d).padStart(2, "0");
              const items = dlByDate[dateStr] || [];
              const isToday = dateStr === todayStr;
              const dow = (firstDay + d - 1) % 7;
              return React.createElement("div", {
                key: "d" + i,
                style: {
                  minHeight: 64, borderRadius: 6, padding: "3px 2px",
                  background: isToday ? "#fff8e0" : "#fafafa",
                  border: isToday ? "2px solid #ffd060" : "1px solid #f0eeea",
                  cursor: items.length > 0 ? "pointer" : "default",
                  overflow: "hidden",
                },
                onClick: () => items.length > 0 && set({ dlSelectedDate: dateStr })
              },
                React.createElement("div", { style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: dow === 0 ? "#c00" : dow === 6 ? "var(--iquta)" : "#555", marginBottom: 2 } }, d),
                items.slice(0, 3).map((p) =>
                  React.createElement("div", { key: p.id, style: {
                    background: teamColor(p) + (p.closedAt ? "30" : "20"),
                    borderLeft: "3px solid " + teamColor(p),
                    borderRadius: 3, padding: "1px 3px", marginBottom: 2,
                    fontSize: 9, lineHeight: 1.2,
                    color: p.closedAt ? "#aaa" : "#333",
                    textDecoration: p.closedAt ? "line-through" : "none",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  } }, (p.kind === "sample" ? "✂" : "") + p.partNo)
                ),
                items.length > 3 && React.createElement("div", { style: { fontSize: 9, color: "#aaa", textAlign: "center" } }, "他" + (items.length - 3) + "件")
              );
            })
          )
        ),

        ui.dlSelectedDate && dlByDate[ui.dlSelectedDate] && React.createElement("div", null,
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
            React.createElement("div", { style: st.sectionLabel }, ui.dlSelectedDate.slice(5).replace("-", "/") + " 納期の品番"),
            React.createElement("button", { style: st.ghostBtn, onClick: () => set({ dlSelectedDate: null }) }, "✕")
          ),
          dlByDate[ui.dlSelectedDate].map((p) =>
            React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left", borderLeft: "4px solid " + teamColor(p) }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "deadline_calendar" }) },
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, (p.kind === "sample" ? "✂ " : "") + p.partNo + (p.partName ? " " + p.partName : "")),
                  React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } },
                    (p.assigneeType === "outsource" ? "外注: " + (p.vendorName || "?") : (p.assignee || "未割当")) + "　" + p.qty + "枚"
                  )
                ),
                React.createElement(Badge, { part: p })
              )
            )
          )
        ),

        !ui.dlSelectedDate && monthDlCount === 0 && React.createElement(Empty, null, year + "年" + month + "月が納期の品番はありません")
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "saidan_report" && ui.saidanForm) {
    const f = ui.saidanForm;
    const part = data.parts.find((p) => p.id === f.partId) || {};
    const fl = (v) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
    const num = (v) => { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
    const grand = (f.colors || []).reduce((a, c) => a + (c.counts || []).reduce((b, v) => b + num(v), 0), 0);
    const good = Math.max(0, grand - num(f.defect));

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "✂️ 裁断報告書", back: () => set({ screen: "part_detail" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { fontSize: 13, color: "#555", marginBottom: 12 } },
          part.partNo + (part.partName ? " " + part.partName : "")
        ),

        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "裁断日" }, React.createElement("input", { style: st.input, type: "date", value: f.date || today(), onChange: (e) => setSF({ date: e.target.value }) })),
          React.createElement(FormRow, { label: "裁断者" }, React.createElement("input", { style: st.input, placeholder: "氏名", value: f.cutter || "", onChange: (e) => setSF({ cutter: e.target.value }) })),
          React.createElement(FormRow, { label: "裁断方法" },
            React.createElement("div", { style: { display: "flex", gap: 8 } },
              SAIDAN_METHODS.map((m) => React.createElement("button", { key: m, style: Object.assign({}, st.assignBtn, f.method === m ? st.assignBtnActive : {}), onClick: () => setSF({ method: m }) }, m))
            )
          ),
          React.createElement(FormRow, { label: "生地名" }, React.createElement("input", { style: st.input, placeholder: "例: 40番ツイル", value: f.fabric || "", onChange: (e) => setSF({ fabric: e.target.value }) })),
          React.createElement(FormRow, { label: "ロット番号" }, React.createElement("input", { style: st.input, placeholder: "例: L2406-01", value: f.lot || "", onChange: (e) => setSF({ lot: e.target.value }) }))
        ),

        React.createElement("div", { style: st.card },
          React.createElement("div", { style: { fontSize: 12, fontWeight: 700, marginBottom: 10 } }, "サイズ名（編集可）"),
          React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 4 } },
            (f.sizes || ["XS","S","M","L","LL"]).map((s, i) =>
              React.createElement("input", { key: i, style: Object.assign({}, st.input, { textAlign: "center", padding: "8px 4px" }), value: s, onChange: (e) => { const sizes = [...(f.sizes || ["XS","S","M","L","LL"])]; sizes[i] = e.target.value; setSF({ sizes }); } })
            )
          )
        ),

        React.createElement("div", { style: st.card },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
            React.createElement("div", { style: { fontSize: 12, fontWeight: 700 } }, "カラー別数量"),
            React.createElement("button", { style: st.inlineBtn, onClick: () => setSF({ colors: [...(f.colors || []), { name: "", counts: ["","","","",""], inM: "", useM: "" }] }) }, "+ カラー追加")
          ),
          (f.colors || []).map((c, ci) => {
            const rowTotal = (c.counts || []).reduce((a, v) => a + num(v), 0);
            const useM = fl(f.ydReal) * rowTotal;
            return React.createElement("div", { key: ci, style: { background: "#f5f4f0", borderRadius: 10, padding: "12px", marginBottom: 10 } },
              React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 8, alignItems: "center" } },
                React.createElement("input", { style: Object.assign({}, st.input, { flex: 1 }), placeholder: "カラー名", value: c.name, onChange: (e) => { const colors = f.colors.map((x, i) => i === ci ? Object.assign({}, x, { name: e.target.value }) : x); setSF({ colors }); } }),
                React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => setSF({ colors: f.colors.filter((_, i) => i !== ci) }) }, "✕")
              ),
              React.createElement("div", { style: { display: "flex", gap: 4, marginBottom: 8 } },
                (c.counts || []).map((v, si) =>
                  React.createElement("div", { key: si, style: { flex: 1, textAlign: "center" } },
                    React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 3 } }, (f.sizes || [])[si] || ""),
                    React.createElement("input", { style: Object.assign({}, st.input, { textAlign: "center", padding: "8px 4px" }), type: "number", min: "0", value: v, onChange: (e) => { const colors = f.colors.map((x, i) => { if (i !== ci) return x; const counts = [...(x.counts || [])]; counts[si] = e.target.value; return Object.assign({}, x, { counts }); }); setSF({ colors }); } })
                  )
                )
              ),
              React.createElement("div", { style: { display: "flex", gap: 8, fontSize: 12 } },
                React.createElement("span", { style: { color: "#555" } }, "小計: " + (rowTotal || 0) + "枚"),
                React.createElement("span", { style: { color: "#aaa" } }, "｜"),
                React.createElement(FormRow, { label: "入荷m" },
                  React.createElement("input", { style: Object.assign({}, st.input, { padding: "6px 8px" }), type: "number", step: "0.1", placeholder: "0.0", value: c.inM, onChange: (e) => { const colors = f.colors.map((x, i) => i === ci ? Object.assign({}, x, { inM: e.target.value }) : x); setSF({ colors }); } })
                ),
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "使用m（自動）"),
                  React.createElement("div", { style: Object.assign({}, st.input, { background: "#e8e6e0", color: "#555", padding: "6px 8px" }) }, useM > 0 ? useM.toFixed(2) : "—")
                )
              )
            );
          })
        ),

        React.createElement("div", { style: st.card },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 } },
            React.createElement(FormRow, { label: "客先指定用尺（m）" }, React.createElement("input", { style: st.input, type: "number", step: "0.01", placeholder: "0.00", value: f.ydSpec || "", onChange: (e) => setSF({ ydSpec: e.target.value }) })),
            React.createElement(FormRow, { label: "実用尺（m）" }, React.createElement("input", { style: st.input, type: "number", step: "0.01", placeholder: "0.00", value: f.ydReal || "", onChange: (e) => setSF({ ydReal: e.target.value }) }))
          ),
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 } },
            React.createElement(SBox, { label: "裁断合計", value: grand + "枚" }),
            React.createElement(FormRow, { label: "不良・ロス数" }, React.createElement("input", { style: st.input, type: "number", min: "0", placeholder: "0", value: f.defect || "", onChange: (e) => setSF({ defect: e.target.value }) })),
            React.createElement(SBox, { label: "良品数", value: good + "枚" })
          )
        ),

        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "次工程チーム" },
            React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              SAIDAN_NEXT.map((t) => React.createElement("button", { key: t, style: Object.assign({}, st.assignBtn, f.nextTeam === t ? st.assignBtnActive : {}), onClick: () => setSF({ nextTeam: t }) }, t))
            ),
            f.nextTeam === "外注" && React.createElement("input", { style: Object.assign({}, st.input, { marginTop: 8 }), placeholder: "外注先名を入力", value: f.vendorName || "", onChange: (e) => setSF({ vendorName: e.target.value }) })
          ),
          React.createElement(FormRow, { label: "特記事項・申し送り" }, React.createElement("textarea", { style: Object.assign({}, st.input, { minHeight: 70, resize: "vertical", fontFamily: "inherit" }), value: f.note || "", onChange: (e) => setSF({ note: e.target.value }) }))
        ),

        React.createElement("button", { style: st.primaryBtn, onClick: saveSaidan }, "保存する"),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#14555a", marginTop: 8 }), onClick: () => printSaidan(f) }, "🖨 印刷 / PDF保存"),
        f.id && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#fff0f0", color: "#c00", marginTop: 8 }), onClick: () => { if (window.confirm("この裁断報告書を削除しますか？")) { deleteSaidan(f.partId); set({ screen: "part_detail" }); } } }, "削除する")
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "kotei_parts") {
    const plist = (data.koteiParts && data.koteiParts.length) ? data.koteiParts : KOTEI_PARTS;
    const commitP = function (arr) { const nd = Object.assign({}, data, { koteiParts: arr }); applyLocal({ koteiParts: arr }, () => gasSave(nd)); };
    const addP = function () { const w = (ui.koteiPartsInput || "").trim(); if (!w) return; if (plist.indexOf(w) < 0) commitP(plist.concat([w])); set({ koteiPartsInput: "" }); };
    const delP = function (w) { commitP(plist.filter(function (x) { return x !== w; })); };
    const reorderP = function (from, to) { if (from == null || from === to) return; const arr = plist.slice(); const item = arr.splice(from, 1)[0]; arr.splice(to, 0, item); commitP(arr); };
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "パーツ名の編集", back: () => set({ screen: "kotei_list" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { fontSize: 12, color: "#888", marginBottom: 12 } }, "工程表で選ぶパーツ名を、追加・削除・並べ替えできます。ドラッグで順番を変えられます（PC）。ここで変えた内容は全員・全工程表に反映されます。"),
        React.createElement("button", { style: { width: "100%", border: "1px solid #d9d5c8", background: "#fff", color: "#555", borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 700, marginBottom: 12 }, onClick: function () { if (window.confirm("パーツ名の候補を標準の並び（" + KOTEI_PARTS.length + "件）に戻しますか？\n自分で追加した名前は消えますが、工程表で使用中の名前は候補に残り続けます。")) { commitP(KOTEI_PARTS.slice()); } } }, "↺ 標準の並びに戻す"),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16 } },
          React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, marginBottom: 0 }), placeholder: "追加するパーツ名", value: ui.koteiPartsInput, onChange: (e) => set({ koteiPartsInput: e.target.value }), onKeyDown: function (e) { if (e.key === "Enter") addP(); } }),
          React.createElement("button", { style: { border: "none", background: "#0f3d4a", color: "#fff", borderRadius: 8, padding: "0 18px", fontSize: 14, fontWeight: 700 }, onClick: addP }, "追加")
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
          plist.map(function (w, i) { return React.createElement("div", {
            key: w, draggable: true,
            onDragStart: function (e) { e.dataTransfer.effectAllowed = "move"; set({ koteiPartsDrag: i }); },
            onDragOver: function (e) { e.preventDefault(); },
            onDrop: function (e) { e.preventDefault(); reorderP(ui.koteiPartsDrag, i); set({ koteiPartsDrag: null }); },
            onDragEnd: function () { set({ koteiPartsDrag: null }); },
            style: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (ui.koteiPartsDrag === i ? "#0f3d4a" : "#d9d5c8"), borderRadius: 16, padding: "6px 6px 6px 8px", fontSize: 13, cursor: "grab", background: ui.koteiPartsDrag === i ? "var(--iquta-bg)" : "#fff" }
          },
            React.createElement("span", { style: { color: "#bbb", fontSize: 13, cursor: "grab", userSelect: "none" } }, "⠿"),
            w,
            React.createElement("button", { style: { border: "none", background: "none", color: "#c0271d", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }, onClick: () => delP(w) }, "✕")
          ); })
        )
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "kotei_phrases") {
    const cats = (data.koteiPhrases && Object.keys(data.koteiPhrases).length) ? data.koteiPhrases : KOTEI_PHRASE_CATS;
    const catKeys = Object.keys(cats);
    const cur = (ui.koteiPhCat && cats[ui.koteiPhCat]) ? ui.koteiPhCat : catKeys[0];
    const list = cats[cur] || [];
    const commit = function (newCats) { const nd = Object.assign({}, data, { koteiPhrases: newCats }); applyLocal({ koteiPhrases: newCats }, () => gasSave(nd)); };
    const addPhrase = function () { const w = (ui.koteiPhInput || "").trim(); if (!w) return; const nc = JSON.parse(JSON.stringify(cats)); if ((nc[cur] || []).indexOf(w) < 0) nc[cur] = (nc[cur] || []).concat([w]); commit(nc); set({ koteiPhInput: "" }); };
    const delPhrase = function (w) { const nc = JSON.parse(JSON.stringify(cats)); nc[cur] = (nc[cur] || []).filter(function (x) { return x !== w; }); commit(nc); };
    const reorder = function (from, to) { if (from == null || from === to) return; const nc = JSON.parse(JSON.stringify(cats)); const arr = nc[cur]; const item = arr.splice(from, 1)[0]; arr.splice(to, 0, item); commit(nc); };
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "作業候補の編集", back: () => set({ screen: "kotei_list" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { fontSize: 12, color: "#888", marginBottom: 12 } }, "分類を選んで、作業の言葉を追加・削除できます。ここで変えた候補は、全員・全工程表に反映されます。"),
        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" } },
          catKeys.map(function (c) { return React.createElement("button", { key: c, style: { border: "1px solid " + (cur === c ? "#0f3d4a" : "#d9d5c8"), background: cur === c ? "#0f3d4a" : "#fff", color: cur === c ? "#fff" : "#555", borderRadius: 14, padding: "6px 16px", fontSize: 13, fontWeight: 700 }, onClick: () => set({ koteiPhCat: c }) }, c); })
        ),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16 } },
          React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, marginBottom: 0 }), placeholder: "「" + cur + "」に追加する言葉", value: ui.koteiPhInput, onChange: (e) => set({ koteiPhInput: e.target.value }), onKeyDown: function (e) { if (e.key === "Enter") addPhrase(); } }),
          React.createElement("button", { style: { border: "none", background: "#0f3d4a", color: "#fff", borderRadius: 8, padding: "0 18px", fontSize: 14, fontWeight: 700 }, onClick: addPhrase }, "追加")
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
          list.map(function (w, i) { return React.createElement("div", {
            key: w, draggable: true,
            onDragStart: function (e) { e.dataTransfer.effectAllowed = "move"; set({ koteiDrag: i }); },
            onDragOver: function (e) { e.preventDefault(); },
            onDrop: function (e) { e.preventDefault(); reorder(ui.koteiDrag, i); set({ koteiDrag: null }); },
            onDragEnd: function () { set({ koteiDrag: null }); },
            style: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (ui.koteiDrag === i ? "#0f3d4a" : "#d9d5c8"), borderRadius: 16, padding: "6px 6px 6px 8px", fontSize: 13, cursor: "grab", background: ui.koteiDrag === i ? "var(--iquta-bg)" : "#fff" }
          },
            React.createElement("span", { style: { color: "#bbb", fontSize: 13, cursor: "grab", userSelect: "none" } }, "⠿"),
            w,
            React.createElement("button", { style: { border: "none", background: "none", color: "#c0271d", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }, onClick: () => delPhrase(w) }, "✕")
          ); })
        ),
        list.length === 0 && React.createElement(Empty, null, "この分類の候補はまだありません")
      ),
      React.createElement(SI)
    );
  }

  // ── 標準工程表テンプレの管理画面：雛形そのものの編集・登録・削除だけを行う。
  //    品番の工程表はここからは作れない（品番詳細 → 📐工程分析表 → テンプレ選択、の一方向のみ）。
  if (ui.screen === "kotei_templates") {
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "標準工程表テンプレ", back: () => set({ screen: "kotei_list" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { fontSize: 12, color: "#888", marginBottom: 12 } }, "新しい品番の工程表を作るときの雛形です。品番詳細の「📐 工程分析表」から、ここにあるテンプレを選んでコピーして使います。ここを直しても、コピー済みの品番の工程表は変わりません。"),

        // ── 標準工程表テンプレ：品番に紐づかない骨格。新品番はここからコピーして作る（P1/P3）
        React.createElement("div", { style: { background: "#fff", border: "1px solid #d9d5c8", borderRadius: 10, padding: 12, marginBottom: 12 } },
          // 見出しをトグルに：普段は閉じていて、押すと9本のリストが開く（工程管理画面のノイズを減らす）
          React.createElement("button", { style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", padding: 0, cursor: "pointer", marginBottom: ui.tplOpen ? 8 : 0 }, onClick: () => set({ tplOpen: !ui.tplOpen }) },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "#0f3d4a" } }, "📋 標準工程表テンプレ（" + koteiTemplates().length + "件）"),
            React.createElement("span", { style: { fontSize: 13, color: "#0f3d4a" } }, ui.tplOpen ? "▼ 閉じる" : "▶ 開く")
          ),
          ui.tplOpen && koteiTemplates().length === 0 && React.createElement("button", { style: { width: "100%", border: "1px dashed #0f3d4a", background: "#eef3f4", color: "#0f3d4a", borderRadius: 8, padding: 12, fontSize: 13, fontWeight: 700, marginBottom: 8 }, onClick: () => { if (window.confirm("標準テンプレ9本（スカート2種・パンツ・シャツ・ブラウス・ワンピース2種・ジャケット2種）を一括登録しますか？")) seedStandardTemplates(); } }, "📥 標準9テンプレを一括登録"),
          ui.tplOpen && koteiTemplates().map((t) => {
            const n = (t.blocks || []).filter((b) => b.type === "step").length;
            return React.createElement("div", { key: t.id, style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 } },
              React.createElement("button", { style: { flex: 1, textAlign: "left", border: "1px solid #e0deda", background: "#faf9f7", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700, color: "#333" }, onClick: () => set({ koteiTplId: t.id, koteiPartId: null, screen: "kotei_edit" }) }, (t.templateName || "無題") + "（" + n + "工程）"),
              React.createElement("button", { style: { border: "1px solid #e0deda", background: "#fff", borderRadius: 8, padding: "10px 10px", fontSize: 12 }, onClick: () => { const nm = window.prompt("テンプレ名", t.templateName || ""); if (nm) saveKotei(Object.assign({}, t, { templateName: nm, updatedAt: today() })); } }, "✏️")
            );
          }),
          ui.tplOpen && React.createElement("button", { style: { width: "100%", border: "1px solid #d9d5c8", background: "#fff", color: "#555", borderRadius: 8, padding: 10, fontSize: 12, fontWeight: 700, marginTop: 2 }, onClick: () => { const nm = window.prompt("新しいテンプレの名前", ""); if (!nm) return; const rec = { id: genId(), partId: null, templateName: nm, blocks: [], totalSec: 0, updatedAt: today() }; saveKotei(rec); set({ koteiTplId: rec.id, koteiPartId: null, screen: "kotei_edit" }); } }, "＋ 新しいテンプレを作る"),
          ui.tplOpen && koteiTemplates().length > 0 && React.createElement("button", { style: { width: "100%", border: "1px solid #e0b0b0", background: "#fff", color: "#c00", borderRadius: 8, padding: 9, fontSize: 11, fontWeight: 700, marginTop: 6 }, onClick: () => { if (window.confirm("テンプレ " + koteiTemplates().length + " 件をすべて削除します。\n品番の工程表・作業記録・売上には影響しません。\n削除後は「標準9テンプレを一括登録」で入れ直せます。よろしいですか？")) deleteAllTemplates(); } }, "🗑 テンプレをすべて削除（品番の工程表は消えません）")
        ),
      ),
      React.createElement(SI)
    );
  }

  // ── 工程表の新規作成方法を選ぶ（白紙 or 標準テンプレからコピー）
  if (ui.screen === "kotei_new_choice" && ui.koteiNewPartId) {
    const part = data.parts.find((p) => p.id === ui.koteiNewPartId);
    if (!part) { return null; }
    const tpls = koteiTemplates();
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "工程表を作る", back: () => set({ screen: "part_detail", koteiNewPartId: null }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 12 }) },
          React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, part.partNo),
          part.partName && React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, part.partName)
        ),
        React.createElement("button", { style: { width: "100%", border: "1px solid #d9d5c8", background: "#fff", borderRadius: 10, padding: 14, fontSize: 14, fontWeight: 700, color: "#333", marginBottom: 8, textAlign: "left" }, onClick: () => set({ koteiPartId: part.id, koteiReturn: "part_detail", screen: "kotei_edit", koteiNewPartId: null }) }, "白紙から作る"),
        React.createElement("button", { style: { width: "100%", border: "1px solid #d9d5c8", background: "#fff", borderRadius: 10, padding: 14, fontSize: 14, fontWeight: 700, color: "#333", marginBottom: 14, textAlign: "left" }, onClick: () => set({ screen: "kotei_import" }) }, "メモから取り込む（書き起こしを貼り付け）"),
        tpls.length > 0 && React.createElement(SectionLabel, null, "標準テンプレからコピーして作る"),
        tpls.length > 0 && React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 8 } }, "全工程がコピーされます。コピー後に工程の抜き差し・時間記入をしてください。テンプレ本体は変わりません。"),
        tpls.map((t) => {
          const n = (t.blocks || []).filter((b) => b.type === "step").length;
          return React.createElement("button", { key: t.id, style: { width: "100%", border: "1px solid var(--line)", background: "var(--iquta-bg)", borderRadius: 10, padding: 14, fontSize: 14, fontWeight: 700, color: "var(--iquta)", marginBottom: 8, textAlign: "left" }, onClick: () => createSheetFromTemplate(t, part.id) }, (t.templateName || "無題") + "（" + n + "工程）");
        })
      ),
      React.createElement(SI)
    );
  }

  // ── 手書きメモ取り込み（P2）：kotei_new_choiceの3択目から入る。確定でcreateSheetFromMemoへ ──
  if (ui.screen === "kotei_import" && ui.koteiNewPartId) {
    const part = data.parts.find((p) => p.id === ui.koteiNewPartId);
    if (!part) { return null; }
    return React.createElement(KoteiMemoImport, {
      part: part,
      onConfirm: (rows) => createSheetFromMemo(rows, part.id),
      back: () => set({ screen: "kotei_new_choice" }),
      SI: SI,
    });
  }

  if (ui.screen === "kotei_list") {
    const q = (ui.koteiSearch || "").trim();
    const withKotei = (data.koteiSheets || []).map(function (s) {
      const p = data.parts.find(function (x) { return x.id === s.partId; });
      return p ? { sheet: s, part: p } : null;
    }).filter(Boolean);
    const filtered = (q ? withKotei.filter(function (o) { return (o.part.partNo || "").indexOf(q) >= 0 || (o.part.partName || "").indexOf(q) >= 0; }) : withKotei)
      .sort(function (a, b) { return (b.sheet.updatedAt || "").localeCompare(a.sheet.updatedAt || ""); });
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "📐 工程分析表", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("button", { style: { width: "100%", border: "1px solid var(--line)", background: "#fff", color: "var(--iquta)", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 700, marginBottom: 8 }, onClick: () => set({ screen: "kotei_phrases" }) }, "作業候補（アイロン・ミシン・その他）を編集"),
        React.createElement("button", { style: { width: "100%", border: "1px solid var(--line)", background: "#fff", color: "var(--iquta)", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 700, marginBottom: 8 }, onClick: () => set({ screen: "kotei_parts" }) }, "パーツ名を編集"),
        React.createElement("button", { style: { width: "100%", border: "1px solid var(--line)", background: "#fff", color: "var(--iquta)", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 700, marginBottom: 12 }, onClick: () => set({ screen: "kotei_templates" }) }, "標準工程表テンプレを編集"),
        React.createElement("input", { style: Object.assign({}, st.input, { marginBottom: 12 }), placeholder: "品番・品名で検索", value: ui.koteiSearch, onChange: (e) => set({ koteiSearch: e.target.value }) }),
        React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 12 } }, filtered.length + "件"),
        filtered.length === 0 && React.createElement(Empty, null, q ? "該当する工程表がありません" : "まだ工程表がありません（品番詳細の「工程分析表」から作成できます）"),
        filtered.map(function (o) {
          const steps = (o.sheet.blocks || []).filter(function (b) { return b.type === "step"; }).length;
          const figs = (o.sheet.blocks || []).filter(function (b) { return b.type === "sketch"; }).length;
          const brand = ((data.brands || []).find(function (b) { return b.id === o.part.brandId; }) || {}).name || "";
          return React.createElement("button", { key: o.sheet.id, style: Object.assign({}, st.summaryCard, { textAlign: "left" }), onClick: () => set({ koteiPartId: o.part.id, koteiReturn: "kotei_list", screen: "kotei_edit" }) },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
              React.createElement("div", null,
                React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, o.part.partNo + (o.part.partName ? " " + o.part.partName : "")),
                brand && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "🏷 " + brand)
              ),
              React.createElement("div", { style: { textAlign: "right", fontSize: 12, color: "#888" } },
                React.createElement("div", { style: { fontWeight: 700, color: "var(--iquta)", fontSize: 15, fontVariantNumeric: "tabular-nums" } }, fmtKoteiTime(o.sheet.totalSec || 0)),
                React.createElement("div", { style: { marginTop: 2 } }, steps + "工程" + (figs ? " ・ 図" + figs : ""))
              )
            )
          );
        })
      ),
      React.createElement(SI)
    );
  }

  // ── 標準工程表テンプレの編集：品番に紐づかない工程表を既存KoteiEditorでそのまま開く。
  //    エディタは無改修。擬似的なpartを渡し、保存時にpartId:nullへ戻すラッパーで吸収する。
  if (ui.screen === "kotei_edit" && ui.koteiTplId) {
    const tpl = (data.koteiSheets || []).find((r) => r.id === ui.koteiTplId && !r.partId);
    if (!tpl) { return null; }
    const kctx = buildKoteiCtx();
    const pseudoPart = { id: "TEMPLATE", partNo: "📋 " + (tpl.templateName || "無題テンプレ"), partName: "標準工程表テンプレ", brandId: null };
    return React.createElement(KoteiEditor, {
      key: tpl.id, part: pseudoPart, sheet: tpl, brandName: "", extraParts: kctx.extraParts, extraPhrases: kctx.extraPhrases, phraseCats: kctx.phraseCats, partList: kctx.partList,
      onSave: (rec) => saveKotei(Object.assign({}, rec, { partId: null, templateName: tpl.templateName })),
      onDelete: deleteKotei,
      back: () => set({ screen: "kotei_templates", koteiTplId: null }),
      SI: SI,
    });
  }

  if (ui.screen === "kotei_edit" && ui.koteiPartId) {
    const part = data.parts.find((p) => p.id === ui.koteiPartId);
    if (!part) { return null; }
    const sheet = (data.koteiSheets || []).find((r) => r.partId === part.id) || null;
    const brandName = ((data.brands || []).find((b) => b.id === part.brandId) || {}).name || "";
    const kctx = buildKoteiCtx();
    const partList = kctx.partList, extraParts = kctx.extraParts, phraseCats = kctx.phraseCats, extraPhrases = kctx.extraPhrases;
    return React.createElement(KoteiEditor, {
      key: part.id, part: part, sheet: sheet, brandName: brandName, extraParts: extraParts, extraPhrases: extraPhrases, phraseCats: phraseCats, partList: partList,
      onSave: saveKotei, onDelete: deleteKotei,
      back: () => set({ screen: ui.koteiReturn || "part_detail", koteiPartId: null }),
      SI: SI,
    });
  }

  return null;
}

function Shell(p) { return React.createElement("div", { style: st.root }, p.children); }
// 共通ヘッダー（モック .app-header）：ロゴ左寄せ＋右にサブ情報、細い青罫で締める。全画面がこれを使う（DRY）。
// タイトル中の絵文字はここで一括除去（憲法: カラフルな絵文字アイコン廃止）。
function stripEmoji(s) { try { return ("" + (s || "")).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}️]/gu, "").trim(); } catch (e) { return s; } }
// ロゴ＝ホームへ戻るボタン。画面が dirty（未保存判定・関数か真偽値）を渡している場合は
// 確認ダイアログを1回挟む（入力途中の誤タップでデータが消える事故を防ぐ）。変更がなければ即移動。
// 遷移自体は全画面共通のイベントで App が1箇所で受ける（各画面の呼び出しは無変更でDRY）。
function goHomeFromHeader(dirty) {
  const isDirty = typeof dirty === "function" ? dirty() : !!dirty;
  if (isDirty && !window.confirm("保存していません。ホームへ移動しますか？")) return;
  window.dispatchEvent(new CustomEvent("iquta-home"));
}
function Header(p) {
  // actions: その画面に保存/印刷などの機能があるときだけ渡す（[{label, onClick, primary}]）
  return React.createElement("div", { style: st.header },
    React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 20px", borderBottom: "1px solid var(--line)", maxWidth: 680, margin: "0 auto", boxSizing: "border-box", minHeight: 46 } },
      React.createElement("button", { style: { background: "none", border: "none", padding: "4px 4px 4px 0", cursor: "pointer", display: "block", flex: "none" }, title: "ホームへ戻る", onClick: function () { goHomeFromHeader(p.dirty); } },
        React.createElement("img", { src: "iquta-logo.png", alt: "iquta（ホームへ）", style: { height: 20, display: "block" } })
      ),
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
        p.sub && React.createElement("span", { style: { fontSize: 12, color: "var(--soft)", letterSpacing: "0.04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, stripEmoji(p.sub)),
        (p.actions || []).map(function (a, i) {
          const base = a.primary
            ? { background: "var(--iquta)", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }
            : { background: "#fff", color: "var(--iquta)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flex: "none" };
          return React.createElement("button", {
            key: i,
            style: a.disabled ? Object.assign({}, base, { opacity: 0.4, cursor: "default" }) : base,
            disabled: !!a.disabled,
            onClick: a.disabled ? undefined : a.onClick,
          }, a.label);
        })
      )
    ),
    React.createElement("div", { style: { padding: "14px 20px 14px", maxWidth: 680, margin: "0 auto", boxSizing: "border-box" } },
      p.back && React.createElement("button", { style: st.backBtn, onClick: p.back }, "‹ 戻る"),
      p.title && React.createElement("div", { style: st.headerTitle }, stripEmoji(p.title))
    )
  );
}
function Body(p) { return React.createElement("div", { style: st.body }, p.children); }
function Spacer(p) { return React.createElement("div", { style: { height: p.h || 8 } }); }
function Divider(p) { return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" } }, React.createElement("div", { style: { flex: 1, height: 1, background: "var(--line)" } }), React.createElement("span", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".14em", fontWeight: 600 } }, p.label), React.createElement("div", { style: { flex: 1, height: 1, background: "var(--line)" } })); }
// iquta憲法: 絵文字アイコン廃止。文字＋シェブロンの白面リスト（枠は細い青罫）
function BigBtn(p) {
  return React.createElement("button", { style: st.bigBtn, onClick: p.onClick },
    React.createElement("div", { style: { textAlign: "left", flex: 1, minWidth: 0 } },
      React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--ink)", letterSpacing: ".01em" } }, p.label),
      React.createElement("div", { style: { fontSize: 11, color: "var(--soft)", marginTop: 3, letterSpacing: ".02em" } }, p.sub)
    ),
    React.createElement("span", { style: { color: "var(--faint)", fontSize: 14, flex: "none" } }, "›")
  );
}
function RoleBtn(p) { return React.createElement("button", { style: st.roleBtn, onClick: p.onClick }, React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "var(--iquta)" } }, p.label)); }
function QuickBtn(p) { return React.createElement("button", { style: st.quickBtn, onClick: p.onClick }, p.label); }
function TeamBadge(p) { const c = TEAM_COLORS[p.team] || "#888"; return React.createElement("span", { style: { background: c + "18", color: c, fontSize: p.small ? 11 : 13, padding: p.small ? "2px 8px" : "4px 12px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44", display: "inline-block" } }, p.team); }
function AssigneeBadge(p) {
  const part = p.part; const vendors = p.vendors;
  if (!part.assignee || part.assignee === "未割当") return React.createElement("span", { style: { background: "#f0f0f0", color: "#aaa", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, "未割当");
  if (part.assigneeType === "outsource") { const v = vendors.find((v) => v.id === part.assignee); return React.createElement("span", { style: { background: "#88888818", color: "#555", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid #88888844" } }, "外注: " + (v ? v.name : "?")); }
  const c = TEAM_COLORS[part.assignee] || "#888";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44" } }, part.assignee);
}
// iquta憲法: ステータスは青の濃淡で段階を表す（未着手=淡 → 完了=濃）
function StatusBadge(p) {
  const colors = { "未着手": "#9aa6c4", "裁断済み": "#6d8fe0", "仕掛り中": "#1e5ad7", "完了": "#1745ae" };
  const c = colors[p.status] || "#9aa6c4";
  return React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 5, background: c + "14", color: c, fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" } },
    React.createElement("span", { style: { width: 6, height: 6, borderRadius: 99, background: "currentColor", flex: "none" } }),
    p.status);
}
function SectionLabel(p) { return React.createElement("div", { style: st.sectionLabel }, p.children); }
function Empty(p) { return React.createElement("div", { style: st.empty }, p.children); }
function FormRow(p) { return React.createElement("div", { style: { marginBottom: 14 } }, React.createElement("div", { style: { fontSize: 11, color: "#888", marginBottom: 4 } }, p.label), p.children); }
function SBox(p) { return React.createElement("div", { style: Object.assign({}, st.sBox, { background: p.dark ? "#1a1a1a" : "#fff" }) }, React.createElement("div", { style: { fontSize: 10, color: p.dark ? "#777" : "#aaa", marginBottom: 5 } }, p.label), React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: p.dark ? "#fff" : "#1a1a1a" } }, p.value)); }
function Badge(p) {
  if (p.part) {
    if (p.part.closedAt) return React.createElement("span", { style: { background: "#e8f5e8", color: "#2a7a2a", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" } }, "完了");
    const status = p.part.status || "未着手";
    if (status === "完了") return React.createElement("span", { style: { background: "#e8f5e8", color: "#2a7a2a", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" } }, "完了");
    if (status === "未着手") return React.createElement("span", { style: { background: "#f0eeea", color: "#999", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" } }, "裁断前");
    return React.createElement("span", { style: { background: "#fff3e0", color: "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" } }, "進行中");
  }
  const done = p.type === "done";
  return React.createElement("span", { style: { background: done ? "#e8f5e8" : "#fff3e0", color: done ? "#2a7a2a" : "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, whiteSpace: "nowrap" } }, done ? "完了" : "進行中");
}
function ProgressBar(p) { const pct = Math.min(Math.max(p.value || 0, 0), 1) * 100; const c = p.color || (pct >= 100 ? "#2a7a2a" : "var(--iquta)"); return React.createElement("div", { style: st.barBg }, React.createElement("div", { style: Object.assign({}, st.barFill, { width: pct + "%", background: c }) })); }
function DashCard(p) {
  const item = p.item; const colors = { red: "#c00", yellow: "#b07000", green: "#2a7a2a", done: "#666" }; const c = colors[p.level] || "#666";
  const isOut = item.assigneeType === "outsource";
  const aLabel = isOut ? ("外注: " + (item.vendorName || "?")) : (item.assignee || "未割当");
  return React.createElement("button", { style: Object.assign({}, st.dashCard, { borderLeft: "4px solid " + c }), onClick: p.onClick },
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, item.partNo + (item.partName ? " (" + item.partName + ")" : "")),
        item.brandName && React.createElement("div", { style: { fontSize: 11, color: "#888", fontWeight: 600, marginTop: 2 } }, "🏷 " + item.brandName),
        React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } }, aLabel + (item.status ? " ／ " + item.status : ""))
      ),
      React.createElement("div", { style: { textAlign: "right" } },
        p.level === "done"
          ? React.createElement("div", { style: { fontSize: 12, color: "#2a7a2a", fontWeight: 700 } }, "✅ 完了")
          : item.deadline && React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: c } }, "あと" + item.remainDays + "日"),
        item.deadline && React.createElement("div", { style: { fontSize: 11, color: "#aaa" } }, "納期: " + item.deadline.slice(5).replace("-", "/"))
      )
    ),
    item.qtyProgress !== null && React.createElement("div", { style: { marginTop: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } }, React.createElement("span", null, "完成 " + item.completedQty + "枚 / " + item.qty + "枚"), React.createElement("span", { style: { color: c, fontWeight: 700 } }, "残り " + item.remainQty + "枚")),
      React.createElement(ProgressBar, { value: item.qtyProgress, color: c })
    )
  );
}
function PartCard(p) {
  const part = p.p;
  return React.createElement("div", { style: Object.assign({}, st.leaderCard, { opacity: p.done ? 0.75 : 1 }) },
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } },
      React.createElement("div", null,
        React.createElement("div", { style: Object.assign({}, st.partNoText, { color: p.done ? "#777" : "#1a1a1a" }) }, part.partNo, part.partName && React.createElement("span", { style: { fontSize: 12, color: "#aaa", fontWeight: 400, marginLeft: 6 } }, part.partName)),
        React.createElement("div", { style: st.partMeta }, p.done ? "完了日: " + fmt(part.closedAt) : "¥" + (part.unitPrice || 0).toLocaleString() + " × " + part.qty + "枚"),
        part.deadline && !p.done && React.createElement("div", { style: { fontSize: 11, color: part.remainDays <= 3 ? "#c00" : part.remainDays <= 7 ? "#c25000" : "#aaa", marginTop: 4 } }, "納期: " + fmt(part.deadline) + "（あと" + part.remainDays + "日）")
      ),
      React.createElement("button", { style: st.detailLink, onClick: p.onDetail }, "詳細 ›")
    ),
    !p.done && part.qtyProgress !== null && React.createElement("div", { style: { marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 3 } }, React.createElement("span", null, "完成 " + part.completedQty + "枚 / " + part.qty + "枚"), React.createElement("span", { style: { color: part.remainQty === 0 ? "#2a7a2a" : "#888", fontWeight: 700 } }, "残り " + part.remainQty + "枚")),
      React.createElement(ProgressBar, { value: part.qtyProgress, color: part.remainQty === 0 ? "#2a7a2a" : "var(--iquta)" })
    ),
    React.createElement("div", { style: Object.assign({}, st.statsRow, { background: p.done ? "#eeecea" : "#f5f4f0" }) },
      React.createElement("span", null, "累計 "), React.createElement("b", null, part.totalHours.toFixed(1) + "h"),
      React.createElement("span", { style: { color: "#ddd" } }, "｜"),
      React.createElement("span", { style: { color: p.done ? "#2a7a2a" : "#555", fontWeight: p.done ? 700 : 400 } }, part.totalHours > 0 ? "¥" + Math.round(part.hourlyRate).toLocaleString() + "/h" : "—", p.done ? " 確定" : "")
    ),
    !p.done && React.createElement("button", { style: st.closeBtn, onClick: p.onClose }, "この品番を完了にする"),
    p.done && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777" }), onClick: p.onReopen }, "再開する")
  );
}

// iqutaデザイン: 白地＋iquta青の2色。区切りは細い青罫(--line/--line-soft)。影は使わない。
// 色は必ず :root のCSS変数を var() で参照する（青の微調整は styleEl の1箇所で済む）。
const st = {
  // overflowXは"hidden"にしない: 祖先のoverflow-x:hiddenはposition:stickyを無効化するため、
  // "clip"（スクロールコンテナを作らない）＋html/body側のoverflow-x:hiddenで横はみ出しを防ぐ。
  root: { fontFamily: "'Inter','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif", background: "#fff", minHeight: "100vh", maxWidth: 680, width: "100%", margin: "0 auto", paddingBottom: 48, overflowX: "clip", boxSizing: "border-box", color: "var(--ink)" },
  header: { background: "rgba(255,255,255,.94)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", color: "var(--ink)", padding: 0, position: "sticky", top: 0, zIndex: 10, borderBottom: "1px solid var(--line)" },
  headerTitle: { fontSize: 22, fontWeight: 500, color: "var(--iquta)", letterSpacing: "0.01em" },
  backBtn: { background: "none", border: "none", color: "var(--iquta)", opacity: 0.7, fontSize: 12, fontWeight: 600, letterSpacing: "0.03em", padding: "0 0 8px", cursor: "pointer", display: "block" },
  body: { padding: "20px 16px", maxWidth: 680, width: "100%", margin: "0 auto", boxSizing: "border-box" },
  bigBtn: { display: "flex", alignItems: "center", gap: 16, width: "100%", background: "#fff", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 12, padding: "16px 18px", cursor: "pointer", marginBottom: 0 },
  roleBtn: { display: "flex", alignItems: "center", gap: 8, flex: 1, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", cursor: "pointer", justifyContent: "center" },
  quickBtn: { flex: 1, background: "#fff", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--ink)" },
  editBtn: { background: "var(--iquta-soft)", border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", color: "var(--iquta)", fontWeight: 600, whiteSpace: "nowrap" },
  dashedBtn: { display: "block", width: "100%", background: "#fff", border: "2px dashed var(--line)", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 600, color: "var(--iquta)", cursor: "pointer", marginBottom: 16 },
  card: { background: "#fff", borderRadius: 12, padding: "18px", marginBottom: 18, border: "1px solid var(--line-soft)" },
  sectionLabel: { fontSize: 10.5, color: "var(--iquta)", fontWeight: 600, letterSpacing: "0.16em", marginBottom: 8, marginTop: 18 },
  empty: { textAlign: "center", color: "#b9c3dc", fontSize: 13, padding: "18px 0" },
  input: { width: "100%", maxWidth: "100%", minWidth: 0, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", fontSize: 15, boxSizing: "border-box", outline: "none", color: "var(--ink)", WebkitAppearance: "none", appearance: "none", display: "block" },
  primaryBtn: { width: "100%", background: "var(--iquta)", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  inlineBtn: { background: "var(--iquta)", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  ghostBtn: { background: "none", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "var(--soft)" },
  assignBtn: { background: "#fff", border: "1px solid var(--line)", borderRadius: 20, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "var(--soft)" },
  assignBtnActive: { background: "var(--iquta)", color: "#fff", border: "1px solid var(--iquta)" },
  filterRow: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  filterBtn: { background: "#fff", border: "1px solid var(--line)", borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "var(--soft)" },
  filterBtnActive: { background: "var(--iquta)", color: "#fff", border: "1px solid var(--iquta)" },
  previewBox: { borderRadius: 8, padding: "12px 14px", marginBottom: 12 },
  previewRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--soft)", marginBottom: 4 },
  leaderCard: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 12, border: "1px solid var(--line-soft)" },
  partNoText: { fontSize: 16, fontWeight: 700 },
  partMeta: { fontSize: 11, color: "var(--soft)", marginTop: 2 },
  cellLabel: { fontSize: 10, color: "var(--soft)", marginBottom: 2 },
  detailLink: { background: "none", border: "none", color: "var(--iquta)", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  statsRow: { display: "flex", gap: 10, fontSize: 13, color: "var(--soft)", borderRadius: 8, padding: "8px 12px", marginBottom: 10 },
  closeBtn: { width: "100%", background: "var(--iquta)", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  recRow: { background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--line-soft)" },
  memberRow: { background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line-soft)" },
  deleteBtn: { background: "none", border: "none", color: "#b9c3dc", fontSize: 16, cursor: "pointer", padding: "4px 8px" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
  sBox: { borderRadius: 12, padding: "14px", border: "1px solid var(--line-soft)" },
  summaryCard: { display: "block", width: "100%", background: "#fff", border: "1px solid var(--line-soft)", borderRadius: 12, padding: "16px", marginBottom: 10, cursor: "pointer" },
  monthlyCard: { background: "#fff", borderRadius: 12, padding: "18px", marginBottom: 14, border: "1px solid var(--line-soft)" },
  rateBox: { borderRadius: 14, padding: "18px 20px", marginBottom: 16 },
  barBg: { background: "var(--iquta-soft)", borderRadius: 4, height: 6, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4, transition: "width 0.4s" },
  saveBadge: { background: "var(--iquta)", color: "#fff", fontSize: 12, padding: "8px 14px", borderRadius: 20, boxShadow: "0 2px 8px rgba(43,92,230,.25)", marginBottom: 8 },
  spinner: { width: 32, height: 32, border: "3px solid var(--iquta-soft)", borderTop: "3px solid var(--iquta)", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  alertBanner: { fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8, border: "1px solid", marginBottom: 8, marginTop: 8 },
  dashCard: { display: "block", width: "100%", background: "#fff", border: "1px solid var(--line-soft)", borderRadius: 12, padding: "16px", marginBottom: 10, cursor: "pointer", textAlign: "left" },
};

const styleEl = document.createElement("style");
// iqutaデザイン憲法: 色は白とiqutaブルーの2色（警告の赤--akaのみ例外）。
// モックの :root をそのまま移植。--iquta のみコーポレートサイト実測値（本文青 #1e5ad7）に合わせ済み。
// 青の微調整はこの1箇所で済むように、画面側は必ず var() 参照で使う。
styleEl.textContent =
  ":root{--white:#ffffff;--paper:#fbfcfe;--iquta:#1e5ad7;--iquta-d:#1745ae;--iquta-bg:#eef3fe;--iquta-soft:#eef3fe;--ink:#1b2333;--soft:#7f8aa3;--faint:#b3bccf;--line:#e6ecfa;--line-soft:#f0f4fd;--aka:#d0433f}" +
  "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(styleEl);


// ===================== 工程分析表（KoteiEditor） =====================
// ===================== 標準工程表テンプレ（初期シード9本） =====================
// 一般的な縫製工程の骨格。言葉と章立ては自社の手書き工程表に準拠（準備→芯→パーツ別→組立→まとめ）。
// 時間・寸法・作業内容は入れない：作業内容はグレーの例文（hint）で示し、品番へコピーした後にリーダーが記入する。
const STD_KOTEI_TEMPLATES = [
  { name: "スカート（ファスナー・ベルト）", steps: [
    ["準備", "ネーム類仮止め（原産国・ブランド・サイズ・センタク）"],
    ["芯", "芯貼り（ベルト）・伸止め貼り（ファスナー位置）"],
    ["後スカート", "ダーツぬい・アイロン"],
    ["後スカート", "後中心はぎ・ロック・割りアイロン"],
    ["後スカート", "コンシールファスナー付け"],
    ["後スカート", "ベンツ作り"],
    ["前スカート", "ダーツぬい・アイロン"],
    ["組立", "脇はぎ・ロック・割りアイロン"],
    ["ベルト", "ベルト作り（折りアイロン・端ぬい・返しアイロン）"],
    ["ベルト", "ベルト地ぬい・コバSt."],
    ["裾", "裾ロック・折りアイロン・裾St."],
    ["まとめ", "カギホック付け・糸ループ・まとめ出し"],
  ]},
  { name: "スカート（ゴムウエスト）", steps: [
    ["準備", "ネーム類仮止め・ゴムカット"],
    ["ベルト", "ホール位置 部分芯貼り→ホールあけ"],
    ["ベルト", "折りアイロン"],
    ["ベルト", "脇はぎ（ゴム通し口あける）・割りアイロン・ゴム口St."],
    ["ポケット", "袋ぬい・St.・アイロン"],
    ["スカート", "脇はぎ・ロック（ポケット口あける）"],
    ["スカート", "ポケット付け・割りアイロン・ポケット口St.・カンヌキ"],
    ["組立", "ベルト地ぬい"],
    ["組立", "ベルトコバSt.（ゴム通しながら）"],
    ["組立", "ゴム止めSt.（重ねる）・脇ゴム押さえSt."],
    ["裾", "裾三つ巻きSt.・アイロン"],
    ["まとめ", "ゴム口閉じ・まとめ出し"],
  ]},
  { name: "パンツ", steps: [
    ["準備", "ネーム類仮止め"],
    ["芯", "芯貼り（ベルト・前立て）・ポケット口伸止め貼り"],
    ["ポケット", "袋ぬい・周りロック・アイロン"],
    ["前パンツ", "脇ポケット付け（切込み→裏コバSt.→ぬいしろ仮止め）"],
    ["前パンツ", "タック・ダーツぬい"],
    ["後パンツ", "ダーツぬい・アイロン"],
    ["後パンツ", "後ろポケット作り（玉縁）"],
    ["前立て", "ファスナー付け（前立てSt.）"],
    ["組立", "脇・股下はぎ・ロック・後高アイロン"],
    ["組立", "股ぐり2重ぬい・ロック"],
    ["ベルト", "ベルト作り・ベルトループ作り"],
    ["ベルト", "ベルト地ぬい・コバSt.・ループ付け"],
    ["裾", "裾折りアイロン・裾St."],
    ["まとめ", "ホック・ボタン付け・カンヌキ・まとめ出し"],
  ]},
  { name: "シャツ（台衿・長袖）", steps: [
    ["準備", "ネーム類仮止め"],
    ["芯", "芯貼り（表衿・台衿・カフス・前立て）"],
    ["衿", "表衿 周囲ぬい・角カット・返しアイロン・コバSt."],
    ["衿", "台衿仮止め・台衿周囲ぬい・返しアイロン"],
    ["カフス", "折りアイロン・周囲ぬい・返しアイロン"],
    ["前身頃", "前立て作り"],
    ["後身頃", "ヨークはさみ込み・コバSt."],
    ["組立", "肩 折り伏せぬい・コバSt."],
    ["袖", "ケンボロ付け"],
    ["組立", "袖付け（折り伏せ）・コバSt."],
    ["組立", "袖下〜脇 折り伏せぬい・コバSt."],
    ["組立", "カフスはさみ込みコバSt."],
    ["組立", "衿付け 地ぬい・1周コバSt."],
    ["裾", "裾三つ巻きSt."],
    ["まとめ", "ホール印・ボタン印付け・ボタン付け・まとめ出し"],
  ]},
  { name: "ブラウス", steps: [
    ["準備", "ネーム類仮止め"],
    ["芯", "芯貼り（衿・カフス）"],
    ["衿", "周囲ぬい・角カット・返しアイロン"],
    ["カフス", "折りアイロン・端ぬい・返しアイロン"],
    ["袖", "袖口あき作り（スリット・イッテコイ）・タック取り"],
    ["前身頃", "前立て作り（三つ折りアイロン・St.）"],
    ["後身頃", "CBはぎ・タック中ぬい・アイロン"],
    ["組立", "肩 折り伏せ地ぬい・コバSt."],
    ["組立", "袖付け 折り伏せ・コバSt."],
    ["組立", "袖下〜脇 折り伏せ・コバSt."],
    ["組立", "カフスはさみ込みコバSt."],
    ["組立", "衿付け 地ぬい・1周コバSt."],
    ["裾", "裾三つ巻きSt.・アイロン"],
    ["まとめ", "ホール印・ボタン印付け・ボタン付け・まとめ出し"],
  ]},
  { name: "ワンピース（裏なし）", steps: [
    ["準備", "ネーム類仮止め"],
    ["芯", "伸止め貼り（衿ぐり・肩・ポケット口）・見返し芯貼り"],
    ["ポケット", "袋ぬい・ケバカット・アイロン"],
    ["身頃", "ダーツ・切替はぎ・アイロン"],
    ["身頃", "裾折りアイロン・ポケット付け"],
    ["組立", "肩入れ・ロック・アイロン"],
    ["見返し", "端始末（ロック）・衿ぐり地ぬい・切込み・裏コバSt."],
    ["袖", "袖下はぎ・袖口始末"],
    ["組立", "袖付け・身頃高ロック・コバSt."],
    ["組立", "脇入れ（ポケット注意）・ロック・アイロン"],
    ["組立", "コンシールファスナー付け（後中心）"],
    ["裾", "裾St.・アイロン"],
    ["まとめ", "ホール・ボタン付け・まとめ出し"],
  ]},
  { name: "ワンピース（裏付き）", steps: [
    ["準備", "ネーム類仮止め"],
    ["芯", "見返し芯貼り・伸止め貼り（衿ぐり・袖ぐり・ウエスト）"],
    ["身頃", "ダーツ・切替はぎ・割りアイロン"],
    ["スカート", "はぎ（ファスナー部分あける）・割りアイロン・裾始末"],
    ["組立", "ウエストはぎ・ロック・アイロン"],
    ["見返し", "はぎ・割りアイロン・端始末"],
    ["裏地", "裏身頃・裏スカートはぎ・ロック・キセアイロン"],
    ["裏地", "見返しと裏地はぎ・裾三つ巻き"],
    ["組立", "コンシールファスナー付け"],
    ["組立", "裏地ファスナー付け（ずらす）"],
    ["組立", "衿ぐり1周ぬい・切込み・裏コバSt."],
    ["組立", "袖ぐりぬい・裏コバSt.（袖付きは袖付けに置換）"],
    ["裾", "表裾St.・アイロン"],
    ["まとめ", "ホール・ボタン付け・糸ループ・まとめ出し"],
  ]},
  { name: "ジャケット（裏なし）", steps: [
    ["準備", "ネーム類仮止め"],
    ["芯", "芯貼り（見返し・衿・前立て・玉縁布・裾）・伸止め貼り（肩線・袖ぐり・衿ぐり）"],
    ["前身頃", "玉縁ポケット作り（口布付け・切込み・袋ぬい・カンヌキ）"],
    ["前身頃", "裾折り・ポケット位置印"],
    ["後身頃", "ヨーク・タックとめ・はさみ込み"],
    ["見返し", "端始末（バインダー・ロック）"],
    ["衿", "表裏ぬい・返しアイロン・コバSt."],
    ["袖", "外袖・内袖はぎ・袖口三つ折りSt."],
    ["組立", "肩・脇入れ・ロック・アイロン"],
    ["組立", "袖付け・身頃高ロック・アイロン"],
    ["組立", "前端ぬい・返しアイロン・コバSt."],
    ["組立", "衿付け 地ぬい・落としコバSt."],
    ["裾", "裾St.・返しアイロン"],
    ["まとめ", "ホール・釦付け・まとめ出し"],
  ]},
  { name: "ジャケット（裏付き・総裏）", steps: [
    ["準備", "ネーム類仮止め・見返しロック"],
    ["芯", "芯貼り（地衿・表衿・見返し・袖口・身頃裾）・伸止め貼り（返り線・前端・衿ぐり・袖ぐり・肩線）"],
    ["前身頃", "ポケット作り（玉縁・口布・袋ぬい・カンヌキ）"],
    ["前身頃", "裾芯貼り・返り線・裾折り"],
    ["後身頃", "CBはぎ・割りアイロン"],
    ["衿", "地衿・表衿作り・周りぬい・角カット・返しアイロン"],
    ["袖", "外袖・内袖はぎ（表・裏）・袖口ぬい・中とじ・袖口アイロン"],
    ["裏身頃", "CBぬい・キセアイロン・見返しとはぎ・ネーム付け"],
    ["裏身頃", "肩はぎ・脇はぎ・アイロン"],
    ["組立", "肩・脇入れ・割りアイロン"],
    ["組立", "前端ぬい・角カット・返しアイロン"],
    ["組立", "衿付け 地ぬい・ぬいしろ割り・整えアイロン"],
    ["組立", "袖付け・中とじ"],
    ["組立", "裾・袖裏はぎ・ひっくり返してアイロン・とじ"],
    ["まとめ", "ホール・釦付け（力釦）・ラペル千鳥・裾千鳥・まとめ出し"],
  ]},
];

// パーツ名の標準候補：手書き工程表7冊から実際に使われている呼び方を抽出し、
// 作業の流れ順（下ごしらえ→小物→衿袖→身頃→スカート/パンツ→裏地→組立・仕上げ）に並べた。
// ここに無い名前も、工程表で一度使えば候補に自動追加される（extraParts機構）。
const KOTEI_PARTS = [
  // 下ごしらえ
  "準備", "芯", "伸止め",
  // 小さいパーツ
  "ポケット", "ポケット袋", "フラップ", "ループ", "ヒモ", "ベルト", "肩ベルト",
  // 衿・袖まわり
  "衿", "衿吊り", "カフス", "袖", "表袖", "裏袖",
  // 身頃まわり
  "ヨーク", "前立て", "見返し", "前身頃", "後身頃", "上身頃", "下身頃", "身頃",
  // スカート・パンツ
  "スカート", "表スカート", "裏スカート", "パンツ", "フリル", "プリーツ布",
  // 裏地
  "裏地", "裏身頃",
  // 組立・仕上げ
  "組立", "裾", "まとめ", "その他",
];
const KOTEI_PHRASE_CATS = {
  "アイロン": ["割りアイロン","方倒しアイロン","キセアイロン","キセ","高アイロン","上高アイロン","中心高アイロン","後高アイロン","後高0.5cmキセアイロン","裾アイロン","返しアイロン","ケンボロアイロン"],
  "ミシン": ["脇はぎ","見返し脇はぎ","後中心はぎ","見返しとはぎ","身頃とスカートはぎ","CB見返しはぎ","2枚はぎ","3枚はぎ","外袖と内袖はぎ","つなぎ合わせ","ロック","イッテコイロック","見返しロック","下側ロック始末","中ぬい","本ぬい","周りぬい","袋ぬい","外表でぬい","仮どめ","タックとめ","ゴムとめ","釦とめ","三角どめ","ぬいどめ","三巻き","裾三巻き","スリット三巻り","コバST","裏コバST","ステッチ","シャーリング位置ぬい"],
  "その他": ["糸始末","たたきつけ","ギャザー入れ","ホールあけ","ホール印","ネーム付け","ブランドネームたたきつけ","センタクネーム仮どめ","矢羽に切り込み","ケバカット","パイピング","ケンボロ口折り","ケンボロ付け","伸止め貼り","芯貼り","口布折り"]
};
// K_INK/K_TIME/K_NOTE はcanvasのペン色にも使うためhex必須（iquta実測青・--akaと同値に調整済み）。
// K_PART/K_PARTBG/K_LINE は画面専用なので :root のCSS変数を参照（印刷CSSはリテラル色のため不変）。
const K_INK = "#1b2333", K_TIME = "#1e5ad7", K_NOTE = "#d0433f", K_PART = "var(--iquta)", K_PARTBG = "var(--iquta-bg)", K_LINE = "var(--line)";

function parseKoteiTime(s) {
  if (!s) return 0; s = ("" + s).trim();
  if (s.indexOf(":") >= 0) { const a = s.split(":"); return (parseInt(a[0] || 0, 10) * 60) + (parseInt(a[1] || 0, 10)); }
  return parseInt(s, 10) || 0;
}
function fmtKoteiTime(sec) { sec = Math.round(sec || 0); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

// ── 手書きメモ取り込み（P1）：書き起こしテキスト → 工程行の配列 ──
// 形式は1行1工程「パーツ | 作業内容 | 時間」。区切りは 全角｜/半角|/タブ を許容。
// ・パーツ空欄は直前行を継承（先頭行が空欄なら空のまま）
// ・時間は 1:32 / 1'32 / 92(秒) を許容。1'32 や全角数字は parseKoteiTime が読める表記に
//   直すだけで、値そのものは変えない（清書・並べ替え・補完はしない。最終見直しはリーダー）
// ・空行は無視。4列目以降は note に入れる（黙って捨てない）
// ・区切りの無い行は1列目＝パーツ扱い（見出し行として継承元になる）
// 戻り値は { part, act, time, note } の配列。id採番(genId)は取り込み確定側で行う。
function parseKoteiMemo(text) {
  const rows = [];
  let prevPart = "";
  ("" + (text || "")).split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    const f = line.split(/[｜|\t]/).map(function (s) { return s.trim(); });
    const part = f[0] || prevPart;
    prevPart = part;
    let time = f[2] || "";
    time = time.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[：’'′]/g, ":");
    rows.push({ part: part, act: f[1] || "", time: time, note: f.length > 3 ? f.slice(3).join(" ").trim() : "" });
  });
  return rows;
}
function lastKoteiToken(t) { const m = ("" + (t || "")).split(/[\n、・\s]/); return m[m.length - 1]; }
function koteiCircNum(n) { return (n >= 1 && n <= 20) ? String.fromCharCode(0x2460 + n - 1) : ("(" + n + ")"); }
function koteiParenNum(n) { return "(" + n + ")"; }
function compressDataURL(dataURL, cb) {
  try {
    const img = new Image();
    img.onload = function () {
      const maxW = 720;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const cx = c.getContext("2d");
      cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, w, h);
      cx.drawImage(img, 0, 0, w, h);
      cb(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = function () { cb(dataURL); };
    img.src = dataURL;
  } catch (e) { cb(dataURL); }
}
function uploadKoteiImage(dataUrl) {
  return fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: "saveKoteiImage", dataUrl: dataUrl }) })
    .then(function (r) { return r.json(); })
    .then(function (r) { if (r.status !== "saved") throw new Error("img upload failed"); return r.id; });
}
function fetchKoteiImage(id) {
  return fetch(GAS_URL + "?imgKotei=" + encodeURIComponent(id)).then(function (r) { return r.text(); });
}

// ── 手書きメモ取り込み画面（P2）：貼付 → プレビュー → 確定 ──
// AIの書き起こしテキスト（1行1工程「パーツ｜作業内容｜時間」）を貼り付けて下書きを作る。
// ここでは清書・補完はしない。確定後は既存の工程表エディタで最終見直しする前提。
function KoteiMemoImport(props) {
  const part = props.part, SI = props.SI;
  const [text, setText] = useState("");
  const rows = parseKoteiMemo(text);
  let tot = 0, noTime = 0, badTime = 0, unsure = 0;
  rows.forEach(function (r) {
    const s = parseKoteiTime(r.time);
    tot += s || 0; // 読めないコロン表記はNaNになるためガード
    if (!r.time) noTime++; else if (!s) badTime++;
    // 書き起こしルールでAIは読めない字を「？」と書くため、要見直し行として数える
    if ((r.part + r.act + r.time + r.note).indexOf("？") >= 0 || (r.part + r.act + r.time + r.note).indexOf("?") >= 0) unsure++;
  });
  return React.createElement(Shell, null,
    React.createElement(Header, { title: "メモから取り込む", back: props.back, dirty: function () { return text.trim() !== ""; } }),
    React.createElement(Body, null,
      React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 12 }) },
        React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, part.partNo),
        part.partName && React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, part.partName)
      ),
      React.createElement(SectionLabel, null, "書き起こしテキストを貼り付け"),
      React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 8, lineHeight: 1.7 } },
        "1行1工程「パーツ｜作業内容｜時間」。区切りは ｜ / | / タブ。パーツ空欄は直前を継承。",
        React.createElement("br"),
        "時間は 1:32 / 1'32 / 92（秒）どれでも可・空欄可。時間はそのまま取り込みます（確定後に見直し）。"
      ),
      React.createElement("textarea", {
        style: Object.assign({}, st.input, { minHeight: 180, fontSize: 13, lineHeight: 1.8, fontFamily: "inherit", marginBottom: 12 }),
        placeholder: "見頃｜脇はぎ｜1:20\n｜ロック｜0:40\n袖｜袖付け｜92",
        value: text, onChange: function (e) { setText(e.target.value); },
      }),
      rows.length > 0 && React.createElement(React.Fragment, null,
        React.createElement(SectionLabel, null, "プレビュー"),
        React.createElement("div", { style: { display: "flex", gap: 12, fontSize: 12, color: "#555", marginBottom: 8, flexWrap: "wrap" } },
          React.createElement("span", null, rows.length + "工程"),
          React.createElement("span", { style: { color: K_TIME, fontWeight: 700 } }, "合計 " + fmtKoteiTime(tot)),
          noTime > 0 && React.createElement("span", { style: { color: "#aaa" } }, "時間未記入 " + noTime + "件"),
          badTime > 0 && React.createElement("span", { style: { color: K_NOTE, fontWeight: 700 } }, "読めない時間 " + badTime + "件"),
          unsure > 0 && React.createElement("span", { style: { color: "#c25000", fontWeight: 700 } }, "「？」あり " + unsure + "件")
        ),
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "6px 12px", marginBottom: 12 }) },
          rows.map(function (r, i) {
            const sec = parseKoteiTime(r.time);
            const bad = r.time && !sec;
            return React.createElement("div", { key: i, style: { display: "flex", alignItems: "baseline", gap: 8, padding: "7px 0", borderBottom: i < rows.length - 1 ? "1px solid #f0eee8" : "none", fontSize: 13 } },
              React.createElement("span", { style: { flex: "0 0 auto", minWidth: 52, fontSize: 11, fontWeight: 700, color: K_PART, background: K_PARTBG, borderRadius: 4, padding: "2px 6px", textAlign: "center" } }, r.part || "—"),
              React.createElement("span", { style: { flex: 1, color: r.act ? "#1a1a1a" : "#ccc" } }, r.act || "（作業内容なし）", r.note && React.createElement("span", { style: { fontSize: 11, color: K_NOTE, marginLeft: 6 } }, r.note)),
              React.createElement("span", { style: { flex: "0 0 auto", fontWeight: 700, color: bad ? K_NOTE : K_TIME } }, r.time || "—", !bad && sec > 0 && r.time.indexOf(":") < 0 && React.createElement("span", { style: { fontSize: 10, color: "#aaa", fontWeight: 400 } }, " =" + fmtKoteiTime(sec)))
            );
          })
        ),
        React.createElement("button", { style: st.primaryBtn, onClick: function () { props.onConfirm(rows); } }, "この内容で工程表の下書きを作る"),
        React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 8, textAlign: "center" } }, "確定後、工程表エディタが開きます。時間・並び順はそこで見直せます。")
      ),
      rows.length === 0 && text.trim() !== "" && React.createElement(Empty, null, "読み取れる行がありません")
    ),
    React.createElement(SI)
  );
}

function KoteiEditor(props) {
  const part = props.part, sheet = props.sheet;
  const [needle, setNeedle] = useState((sheet && sheet.needle) || "");
  const [unten, setUnten] = useState((sheet && sheet.unten) || "");
  const [thread, setThread] = useState((sheet && sheet.thread) || "");
  const [headNote, setHeadNote] = useState((sheet && sheet.headNote) || "");
  const [targetPerDay, setTargetPerDay] = useState((sheet && sheet.targetPerDay) || "");
  const [workMin, setWorkMin] = useState((sheet && sheet.workMin) || 420);
  const [sizes, setSizes] = useState((sheet && sheet.sizes) || ["XS", "S", "M", "L"]);
  const [colors, setColors] = useState((sheet && sheet.colors) || [{ name: "", counts: ["", "", "", ""] }]);
  const [blocks, setBlocks] = useState(function () {
    if (sheet && sheet.blocks && sheet.blocks.length) return sheet.blocks;
    return [{ id: genId(), type: "step", part: "準備", act: "", time: "", note: "" }];
  });
  const [suggCat, setSuggCat] = useState("アイロン");
  const [histPhrases, setHistPhrases] = useState(props.extraPhrases || []);
  const [activeSugg, setActiveSugg] = useState(null);
  const [modalId, setModalId] = useState(null);
  const [tool, setTool] = useState("ink");
  const [imgData, setImgData] = useState({});
  const [uploading, setUploading] = useState(false);
  const [recId, setRecId] = useState(null); // 音声入力中のblock
  // 図・写真モーダルの「写真調整モード」：写真を選んだら即焼き付けず、
  // ドラッグ移動・拡大縮小・回転してから「決定」で確定する（デザイン画と同じ操作感）
  const [photoAdj, setPhotoAdj] = useState(false);
  const pAdj = useRef({ img: null, snapImg: null, scale: 1, x: 0, y: 0, rot: 0, drag: false, last: null });
  const canvasRef = useRef(null);
  const draw = useRef({ drawing: false, last: null, color: K_INK, erase: false, penOnly: true, ctx: null });

  // ── 工程表トップのデザイン画 ──
  const [designImgId, setDesignImgId] = useState((sheet && sheet.designImgId) || "");
  const [designOpen, setDesignOpen] = useState(false);
  const designCanvasRef = useRef(null);
  const dView = useRef({ img: null, scale: 1, x: 0, y: 0, rot: 0, drag: false, last: null });
  function redrawDesign() {
    const cv = designCanvasRef.current; const v = dView.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height);
    if (v.img) {
      ctx.translate(cv.width / 2 + v.x, cv.height / 2 + v.y);
      ctx.rotate(v.rot * Math.PI / 180);
      const iw = v.img.width * v.scale, ih = v.img.height * v.scale;
      ctx.drawImage(v.img, -iw / 2, -ih / 2, iw, ih);
    }
  }
  function onDesignFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = function () {
      const im = new Image();
      im.onload = function () {
        const cv = designCanvasRef.current; const v = dView.current;
        v.img = im; v.rot = 0; v.x = 0; v.y = 0;
        v.scale = Math.min(cv.width / im.width, cv.height / im.height);
        redrawDesign();
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  }
  function dDown(e) { const v = dView.current; v.drag = true; v.last = { x: e.clientX, y: e.clientY }; }
  function dMove(e) { const v = dView.current; if (!v.drag) return; const cv = designCanvasRef.current; const r = cv.getBoundingClientRect(); const sx = cv.width / r.width, sy = cv.height / r.height; v.x += (e.clientX - v.last.x) * sx; v.y += (e.clientY - v.last.y) * sy; v.last = { x: e.clientX, y: e.clientY }; redrawDesign(); }
  function dUp() { dView.current.drag = false; }
  function dZoom(fac) { dView.current.scale *= fac; redrawDesign(); }
  function dRotate() { const v = dView.current; v.rot = (v.rot + 90) % 360; redrawDesign(); }
  function saveDesign() {
    const cv = designCanvasRef.current;
    if (!cv || !dView.current.img) { setDesignOpen(false); return; }
    const raw = cv.toDataURL("image/jpeg", 0.85);
    compressDataURL(raw, function (out) {
      setUploading(true);
      uploadKoteiImage(out).then(function (fid) {
        setImgData(function (m) { const n = Object.assign({}, m); n[fid] = out; return n; });
        setDesignImgId(fid);
        setDesignOpen(false);
      }).catch(function () { window.alert("デザイン画の保存に失敗しました。通信を確認してください。"); }).finally(function () { setUploading(false); });
    });
  }
  function renderDesignModal() {
    return React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,20,20,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 } },
      React.createElement("div", { style: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 420, padding: 14 } },
        React.createElement("div", { style: { fontSize: 14, fontWeight: 700, marginBottom: 6 } }, "デザイン画を貼る"),
        React.createElement("div", { style: { fontSize: 11, color: "#888", marginBottom: 10 } }, "写真や画像を選び、ドラッグで移動・ボタンで拡大縮小して枠に収めてください。枠の中だけが保存されます。"),
        React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 10 } },
          React.createElement("canvas", { ref: designCanvasRef, width: 600, height: 800, style: { width: 210, height: 280, border: "1px solid " + K_LINE, borderRadius: 8, touchAction: "none", background: "#fff" }, onPointerDown: dDown, onPointerMove: dMove, onPointerUp: dUp, onPointerLeave: dUp })
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 12 } },
          React.createElement("label", { style: mTool }, "📷 写真/画像を選ぶ", React.createElement("input", { type: "file", accept: "image/*", style: { display: "none" }, onChange: onDesignFile })),
          React.createElement("button", { style: mTool, onClick: function () { dZoom(1.15); } }, "＋拡大"),
          React.createElement("button", { style: mTool, onClick: function () { dZoom(0.87); } }, "－縮小"),
          React.createElement("button", { style: mTool, onClick: dRotate }, "⟳ 回転")
        ),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement("button", { style: { flex: 1, border: "1px solid " + K_LINE, background: "#fff", color: "#555", borderRadius: 8, padding: "11px" }, onClick: function () { if (!uploading) setDesignOpen(false); } }, "閉じる"),
          designImgId && React.createElement("button", { style: { border: "1px solid #f0caca", background: "#fff0f0", color: "#c00", borderRadius: 8, padding: "11px 14px" }, onClick: function () { setDesignImgId(""); setDesignOpen(false); } }, "削除"),
          React.createElement("button", { style: { flex: 1, border: "1px solid " + K_PART, background: uploading ? "#888" : K_PART, color: "#fff", borderRadius: 8, padding: "11px", fontWeight: 700 }, onClick: function () { if (!uploading) saveDesign(); } }, uploading ? "保存中…" : "保存")
        )
      )
    );
  }

  // 最後にカーソルを置いた工程のID（図の差し込み位置に使う）。blurでは消さない：
  // 「入力→ボタンを押す」の間にフォーカスは外れるため、消すと常に末尾追加になってしまう。
  const lastFocusRef = useRef(null);
  function patchBlock(id, patch) { setBlocks(function (bs) { return bs.map(function (b) { return b.id === id ? Object.assign({}, b, patch) : b; }); }); }
  function addStep(afterId) {
    setBlocks(function (bs) {
      const st = { id: genId(), type: "step", part: "", act: "", time: "", note: "" };
      // afterId指定＝各行の「＋ 工程」から。その行の直後に挿入。未指定なら従来通り末尾。
      const at = bs.findIndex(function (b) { return b.id === afterId; });
      if (at < 0) return bs.concat([st]);
      const arr = bs.slice();
      arr.splice(at + 1, 0, st);
      return arr;
    });
  }
  function addSketch(afterId) {
    setBlocks(function (bs) {
      const sk = { id: genId(), type: "sketch", img: "", caption: "", size: "s" };
      // afterId指定＝各行の「＋ 図・写真」から。未指定なら最後にカーソルを置いた工程の直後、
      // カーソル履歴も無ければ従来通り末尾。
      const at = bs.findIndex(function (b) { return b.id === (afterId || lastFocusRef.current); });
      if (at < 0) return bs.concat([sk]);
      const arr = bs.slice();
      arr.splice(at + 1, 0, sk);
      return arr;
    });
  }
  // 各ブロック行の下端に置く控えめな挿入ボタン（件2・件3）。押した行の直後に入る。
  // 図・写真の行にも置く：末尾が図のとき、後ろに工程を足す導線が消えないように。
  function insertRow(id) {
    const insBtn = { border: "1px solid var(--line)", background: "#fff", color: "var(--iquta)", borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 600, letterSpacing: ".02em" };
    return React.createElement("div", { className: "kstepPad", style: { display: "flex", gap: 8, marginTop: 12, paddingLeft: 36 } },
      React.createElement("button", { style: insBtn, onClick: function () { addStep(id); } }, "＋ 工程"),
      React.createElement("button", { style: insBtn, onClick: function () { addSketch(id); } }, "＋ 図・写真")
    );
  }
  function move(id, dir) { setBlocks(function (bs) { const i = bs.findIndex(function (b) { return b.id === id; }); const j = i + dir; if (j < 0 || j >= bs.length) return bs; const c = bs.slice(); const t = c[i]; c[i] = c[j]; c[j] = t; return c; }); }
  function del(id) { if (!window.confirm("このブロックを削除しますか？")) return; setBlocks(function (bs) { return bs.filter(function (b) { return b.id !== id; }); }); }
  function learn(p) { p = ("" + (p || "")).trim(); if (p.length < 2) return; setHistPhrases(function (ps) { return ps.indexOf(p) >= 0 ? ps : [p].concat(ps); }); }

  const numK = function (v) { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
  function setSizeAt(i, v) { setSizes(function (ss) { const c = ss.slice(); c[i] = v; return c; }); }
  function addSize() { setSizes(function (ss) { return ss.concat([""]); }); setColors(function (cs) { return cs.map(function (c) { return Object.assign({}, c, { counts: (c.counts || []).concat([""]) }); }); }); }
  function removeSize(i) { setSizes(function (ss) { return ss.filter(function (_, k) { return k !== i; }); }); setColors(function (cs) { return cs.map(function (c) { return Object.assign({}, c, { counts: (c.counts || []).filter(function (_, k) { return k !== i; }) }); }); }); }
  function addColor() { setColors(function (cs) { return cs.concat([{ name: "", thread: "", counts: sizes.map(function () { return ""; }) }]); }); }
  function removeColor(ci) { setColors(function (cs) { return cs.filter(function (_, k) { return k !== ci; }); }); }
  function setColorName(ci, v) { setColors(function (cs) { return cs.map(function (c, k) { return k === ci ? Object.assign({}, c, { name: v }) : c; }); }); }
  function setColorThread(ci, v) { setColors(function (cs) { return cs.map(function (c, k) { return k === ci ? Object.assign({}, c, { thread: v }) : c; }); }); }
  function setCount(ci, si, v) { setColors(function (cs) { return cs.map(function (c, k) { if (k !== ci) return c; const counts = (c.counts || []).slice(); counts[si] = v; return Object.assign({}, c, { counts: counts }); }); }); }

  const colTotals = sizes.map(function (_, si) { return colors.reduce(function (a, c) { return a + numK((c.counts || [])[si]); }, 0); });
  const grandQty = colTotals.reduce(function (a, n) { return a + n; }, 0);

  function renderQtyTable() {
    const cell = { border: "1px solid " + K_LINE, padding: 0, textAlign: "center" };
    const inCell = { width: "100%", border: "none", textAlign: "center", padding: "7px 2px", fontSize: 13, background: "transparent", color: K_INK, boxSizing: "border-box" };
    return React.createElement("div", { style: { marginTop: 12 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 } },
        React.createElement("span", { style: { fontSize: 10, color: "var(--faint)", letterSpacing: ".1em", fontWeight: 600 } }, "色 × サイズ別 枚数"),
        React.createElement("div", { style: { display: "flex", gap: 6 } },
          React.createElement("button", { style: { border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "var(--iquta)", fontWeight: 600 }, onClick: addColor }, "＋色"),
          React.createElement("button", { style: { border: "1px solid var(--line)", background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, color: "var(--iquta)", fontWeight: 600 }, onClick: addSize }, "＋サイズ")
        )
      ),
      React.createElement("div", { style: { overflowX: "auto" } },
        React.createElement("table", { style: { borderCollapse: "collapse", fontSize: 13, minWidth: "100%" } },
          React.createElement("thead", null,
            React.createElement("tr", null,
              React.createElement("th", { style: Object.assign({}, cell, { background: K_PARTBG, color: K_PART, padding: "6px 8px", minWidth: 64 }) }, "色名"),
              React.createElement("th", { style: Object.assign({}, cell, { background: K_PARTBG, color: K_PART, padding: "6px 8px", minWidth: 64 }) }, "糸色"),
              sizes.map(function (s, i) {
                return React.createElement("th", { key: i, style: Object.assign({}, cell, { background: K_PARTBG, minWidth: 54 }) },
                  React.createElement("input", { style: Object.assign({}, inCell, { color: K_PART, fontWeight: 700 }), value: s, onChange: function (e) { setSizeAt(i, e.target.value); } }),
                  sizes.length > 1 && React.createElement("button", { style: { border: "none", background: "none", color: "#c99", fontSize: 10, cursor: "pointer", padding: 0 }, onClick: function () { removeSize(i); } }, "削除")
                );
              }),
              React.createElement("th", { style: Object.assign({}, cell, { background: "var(--paper)", color: "var(--iquta)", padding: "6px 8px" }) }, "計"),
              React.createElement("th", { style: Object.assign({}, cell, { background: K_PARTBG, width: 30 }) }, "")
            )
          ),
          React.createElement("tbody", null,
            colors.map(function (c, ci) {
              const rowTotal = (c.counts || []).reduce(function (a, v) { return a + numK(v); }, 0);
              return React.createElement("tr", { key: ci },
                React.createElement("td", { style: cell }, React.createElement("input", { style: Object.assign({}, inCell, { fontWeight: 700, minWidth: 56 }), placeholder: "色名", value: c.name, onChange: function (e) { setColorName(ci, e.target.value); } })),
                React.createElement("td", { style: cell }, React.createElement("input", { style: Object.assign({}, inCell, { minWidth: 56 }), placeholder: "糸色", value: c.thread || "", onChange: function (e) { setColorThread(ci, e.target.value); } })),
                sizes.map(function (_, si) {
                  return React.createElement("td", { key: si, style: cell }, React.createElement("input", { style: inCell, type: "number", inputMode: "numeric", value: (c.counts || [])[si] || "", onChange: function (e) { setCount(ci, si, e.target.value); } }));
                }),
                React.createElement("td", { style: Object.assign({}, cell, { background: "var(--paper)", fontWeight: 700, padding: "0 8px", fontVariantNumeric: "tabular-nums" }) }, rowTotal || ""),
                React.createElement("td", { style: cell }, colors.length > 1 && React.createElement("button", { style: { border: "none", background: "none", color: K_NOTE, fontSize: 14, cursor: "pointer", padding: "0 4px" }, onClick: function () { removeColor(ci); } }, "✕"))
              );
            }),
            React.createElement("tr", null,
              React.createElement("td", { style: Object.assign({}, cell, { background: "var(--iquta-bg)", color: "var(--iquta)", fontWeight: 700, padding: "6px 8px" }) }, "合計"),
              React.createElement("td", { style: Object.assign({}, cell, { background: "var(--iquta-bg)" }) }, ""),
              colTotals.map(function (n, i) { return React.createElement("td", { key: i, style: Object.assign({}, cell, { background: "var(--iquta-bg)", color: "var(--iquta)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }) }, n || ""); }),
              React.createElement("td", { style: Object.assign({}, cell, { background: "var(--iquta)", color: "#fff", fontWeight: 700, padding: "0 8px", fontVariantNumeric: "tabular-nums" }) }, grandQty || ""),
              React.createElement("td", { style: Object.assign({}, cell, { background: "var(--iquta-bg)" }) }, "")
            )
          )
        )
      )
    );
  }

  const summary = useMemo(function () {
    let tot = 0; const map = {}; let curPart = null;
    blocks.forEach(function (b) {
      if (b.type === "step") {
        const s = parseKoteiTime(b.time); tot += s;
        if (b.part) curPart = b.part;
        const k = curPart || "(未設定)";
        if (!map[k]) map[k] = { n: 0, s: 0 };
        map[k].n++; map[k].s += s;
      }
    });
    return { tot: tot, map: map };
  }, [blocks]);

  function buildRec() {
    return { id: (sheet && sheet.id) || genId(), partId: part.id, needle: needle, unten: unten, thread: thread, headNote: headNote, targetPerDay: targetPerDay, workMin: workMin, sizes: sizes, colors: colors, blocks: blocks, totalSec: summary.tot, designImgId: designImgId, updatedAt: today() };
  }
  // 最下部: 保存して閉じる（従来どおり一覧へ戻る）
  function handleSave() { props.onSave(buildRec()); props.back(); }
  // ヘッダー: 一時保存（保存して画面に留まり、入力を続けられる）。
  // 保存後は未保存判定の基準を現在値に更新（この後ロゴでホームへ移動しても余計な確認を出さない）。
  function handleSaveStay() { props.onSave(buildRec()); initialSnap.current = editSnap(); }

  // 未保存判定（既存stateのスナップショット比較）: 開いた時点の編集対象を丸ごと控えておき、
  // ヘッダーのロゴ（ホームへ）押下時に現在値と比較する。新しい状態管理は増やさない。
  function editSnap() { return JSON.stringify([blocks, needle, unten, thread, headNote, targetPerDay, workMin, sizes, colors, designImgId]); }
  const initialSnap = useRef(null);
  if (initialSnap.current === null) initialSnap.current = editSnap();
  function isDirty() { return editSnap() !== initialSnap.current; }

  function doPrint() {
    const need = blocks.filter(function (b) { return b.type === "sketch" && b.imgId && !imgData[b.imgId]; }).map(function (b) { return b.imgId; });
    if (designImgId && !imgData[designImgId]) need.push(designImgId);
    if (need.length === 0) { openPrintWindow(imgData); return; }
    setUploading(true);
    Promise.all(need.map(function (id) { return fetchKoteiImage(id).then(function (d) { return { id: id, d: d }; }).catch(function () { return { id: id, d: "" }; }); }))
      .then(function (arr) { const m = Object.assign({}, imgData); arr.forEach(function (o) { if (o.d) m[o.id] = o.d; }); setImgData(m); setUploading(false); openPrintWindow(m); })
      .catch(function () { setUploading(false); openPrintWindow(imgData); });
  }

  function openPrintWindow(imgMap) {
    const esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
    const num = function (v) { const x = parseInt(v, 10); return isNaN(x) ? 0 : x; };
    let tbl = "";
    const hasQty = colors.some(function (c) { return c.name || (c.counts || []).some(function (v) { return v; }); });
    if (hasQty) {
      const colT = sizes.map(function (_, si) { return colors.reduce(function (a, c) { return a + num((c.counts || [])[si]); }, 0); });
      const grand = colT.reduce(function (a, n) { return a + n; }, 0);
      tbl = '<table class="qty"><tr><th>色名</th><th>糸色</th>' + sizes.map(function (s) { return "<th>" + esc(s) + "</th>"; }).join("") + '<th>計</th></tr>' +
        colors.map(function (c) { const rt = (c.counts || []).reduce(function (a, v) { return a + num(v); }, 0); return "<tr><td class='cn'>" + esc(c.name) + "</td><td class='cn'>" + esc(c.thread || "") + "</td>" + (c.counts || []).map(function (v) { return "<td>" + (num(v) || "") + "</td>"; }).join("") + "<td class='rt'>" + (rt || "") + "</td></tr>"; }).join("") +
        "<tr class='sum'><td>合計</td><td></td>" + colT.map(function (n) { return "<td>" + (n || "") + "</td>"; }).join("") + "<td>" + (grand || "") + "</td></tr></table>";
    }
    const wmap = { s: "34mm", m: "58mm", l: "100%" };
    const groups = []; let g = null;
    blocks.forEach(function (b) {
      if (b.type === "step" && b.part) {
        if (!g || g.part !== b.part) { g = { part: b.part, items: [], sec: 0, memo: b.gmemo || "" }; groups.push(g); }
        g.items.push(b); g.sec += parseKoteiTime(b.time);
      } else {
        if (!g) { g = { part: "", items: [], sec: 0, memo: "" }; groups.push(g); }
        g.items.push(b); if (b.type === "step") g.sec += parseKoteiTime(b.time);
      }
    });
    const circNum = function (n) { var s = ""; n = n - 1; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
    let figSeq = 0; const figNoMap = {}; const stepNoMap = {}; const stepFigs = {}; const figAssigned = {}; let lastStepId = null;
    let stepSeq = 0; const stepSeqMap = {};
    blocks.forEach(function (b) {
      if (b.type === "step") { lastStepId = b.id; stepSeq++; stepSeqMap[b.id] = stepSeq; }
      else if (b.type === "sketch" && (b.imgId || b.img)) { figSeq++; figNoMap[b.id] = figSeq; if (lastStepId) { if (!stepNoMap[lastStepId]) stepNoMap[lastStepId] = []; stepNoMap[lastStepId].push(figSeq); if (!stepFigs[lastStepId]) stepFigs[lastStepId] = []; stepFigs[lastStepId].push(b); figAssigned[b.id] = true; } }
    });
    const figItemHtml = function (b, src) {
      const sz = (b.size === "m" || b.size === "l") ? b.size : "s";
      return '<div class="figitem sz-' + sz + '"><img src="' + src + '">' + ((figNoMap[b.id] || b.caption) ? '<div class="fmeta">' + (figNoMap[b.id] ? '<span class="fnofig">' + circNum(figNoMap[b.id]) + '</span>' : '') + (b.caption ? '<div class="cap">' + esc(b.caption) + '</div>' : '') + '</div>' : '') + '</div>';
    };
    let proc = "";
    groups.forEach(function (grp) {
      let txt = '<div class="phead"><span class="pname">' + esc(grp.part || "—") + '</span><span class="psum">' + fmtKoteiTime(grp.sec) + '</span>' + (grp.memo ? '<span class="pmemo">' + esc(grp.memo) + '</span>' : '') + '</div>';
      let orphan = "";
      grp.items.forEach(function (b) {
        if (b.type === "step") {
          const sn = stepNoMap[b.id] ? ' <span class="stepno">' + stepNoMap[b.id].map(circNum).join("") + '</span>' : '';
          let rowText = '<div class="prow"><span class="time">' + esc(b.time || "") + '</span><span class="act">' + '(' + stepSeqMap[b.id] + ') ' + esc(b.act || "") + sn + '</span></div>' + (b.note ? '<div class="note">⚠ ' + esc(b.note) + '</div>' : '');
          let figHtml = "";
          (stepFigs[b.id] || []).forEach(function (fb) { const fsrc = fb.imgId ? imgMap[fb.imgId] : fb.img; if (fsrc) figHtml += figItemHtml(fb, fsrc); });
          txt += figHtml ? '<div class="stepwithfig"><div class="swtext">' + rowText + '</div><div class="swfig">' + figHtml + '</div></div>' : rowText;
        } else if (!figAssigned[b.id]) {
          const src = b.imgId ? imgMap[b.imgId] : b.img;
          if (src) orphan += figItemHtml(b, src);
        }
      });
      if (orphan) txt += '<div class="orphanfig">' + orphan + '</div>';
      proc += '<div class="pgroup">' + txt + '</div>';
    });
    const bodyHtml = '<div class="proc">' + proc + '</div>';
    // 集計（画面の renderSummary と同じ内容）を工程表の最後に小さく載せる
    const srows = Object.keys(summary.map).map(function (p) { const o = summary.map[p]; return { p: p, n: o.n, s: o.s, pct: summary.tot ? Math.round(o.s / summary.tot * 100) : 0 }; });
    const sumHtml = '<div class="sumwrap"><div class="sumhead">集計　1着 総工数 <b>' + fmtKoteiTime(summary.tot) + '</b>　　1日実働 ' + (workMin || 0) + '分</div>' +
      '<div class="sumcols">' +
      '<table class="sum1">' + [3, 4, 5].map(function (ppl) { const per = summary.tot / 60 / ppl; const day = per ? workMin / per : 0; return '<tr><td class="pp">' + ppl + '人</td><td>1着 ' + per.toFixed(1) + '分</td><td>1日 ' + day.toFixed(1) + '着</td></tr>'; }).join('') + '</table>' +
      '<table class="sum2"><tr><th>パーツ</th><th>工程</th><th>合計</th><th>比</th></tr>' +
      srows.map(function (r) { return '<tr><td class="pn">' + esc(r.p) + '</td><td>' + r.n + '</td><td>' + fmtKoteiTime(r.s) + '</td><td>' + r.pct + '%</td></tr>'; }).join('') +
      '</table></div></div>';
    const designSrc = imgMap[designImgId];
    const designHtml = designSrc ? '<div class="design"><img src="' + designSrc + '"></div>' : '';
    const commentHtml = headNote ? '<div class="hnote"><div class="ht">注意事項・コメント</div>' + esc(headNote).replace(/\n/g, '<br>') + '</div>' : '';
    const html = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>工程分析表 ' + esc(part.partNo || "") + '</title><style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      "body{font-family:'Hiragino Sans','Noto Sans JP',sans-serif;font-size:9pt;color:#1a1a1a;padding:6mm 7mm;line-height:1.3;-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
      '.head{display:flex;gap:6mm;flex-wrap:wrap;align-items:baseline;border-bottom:2px solid #1a1a1a;padding-bottom:2mm;margin-bottom:3mm}' +
      '.head .big{font-size:14pt;font-weight:700}.head .m{font-size:10pt;color:#555}.head .tt{font-size:14pt;font-weight:700;color:#1558d6}' +
      'table.qty{border-collapse:collapse;font-size:9.5pt;margin-bottom:3mm}' +
      'table.qty th,table.qty td{border:1px solid #aaa;padding:1mm 2.5mm;text-align:center}' +
      'table.qty th{background:#e4ecef}table.qty td.cn{text-align:left;font-weight:700}table.qty td.rt{font-weight:700;background:#f5f4f0}table.qty tr.sum td{background:#e8e6e0;font-weight:700}' +
      '.proc{column-count:2;column-gap:5mm}.pgroup{break-inside:avoid;margin-bottom:1.5mm}.stepwithfig{display:flex;gap:1.5mm;align-items:flex-start;break-inside:avoid;margin:0.2mm 0}.swtext{flex:1;min-width:0}.swfig{flex:none;width:28mm;display:flex;flex-direction:column;gap:1mm}.orphanfig{display:flex;flex-wrap:wrap;gap:2mm;margin-top:1mm}.orphanfig .figitem{width:28mm}' +
      '.phead{font-weight:700;color:#0f3d4a;background:#e4ecef;padding:0.5mm 1.5mm;font-size:9pt;margin:0 0 0.5mm;display:flex;gap:2mm;align-items:center}.phead .fno{color:#1558d6;font-weight:700;flex:none}.phead .pname{flex:none}.phead .psum{color:#1f7a4d;font-size:8.5pt;font-weight:700;border:1px solid #1f7a4d;padding:0 1.5mm;background:#fff;flex:none}.phead .pmemo{color:#333;font-size:8pt;font-weight:400;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stepno{color:#6a3d9a;border:0.3mm solid #6a3d9a;border-radius:1mm;font-weight:700;font-size:5.5pt;padding:0 0.6mm;background:#efe8f7}.fnofig{color:#6a3d9a;border:0.3mm solid #6a3d9a;border-radius:1mm;font-weight:700;font-size:5.5pt;padding:0 0.6mm;background:#efe8f7;align-self:flex-start}' +
      '.prow{display:flex;gap:2mm;font-size:8.5pt;padding:0.2mm 0;align-items:baseline}.prow .time{color:#1558d6;font-weight:700;width:11mm;flex:none;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.prow .act{flex:1}' +
      '.note{color:#c0271d;font-size:7.5pt;padding:0 0 0.4mm 13mm}' +
      '.figitem{display:flex;flex-direction:column;gap:0.4mm;width:100%;align-items:flex-start}.figitem img{display:block}.figitem.sz-s img{width:12mm}.figitem.sz-m img{width:18mm}.figitem.sz-l img{width:26mm}.fmeta{width:100%;display:flex;flex-direction:row;gap:1mm;align-items:flex-start}.figitem .cap{flex:1;min-width:0;font-size:7pt;color:#666;line-height:1.2;word-break:break-word}' +
      '.topbar{display:flex;gap:4mm;align-items:flex-start;margin-bottom:2mm}.topmain{flex:1;min-width:0}' +
      '.design{flex:none;width:30mm;border:1px solid #bbb;border-radius:1mm;overflow:hidden}.design img{display:block;width:100%;max-height:38mm;object-fit:cover}' +
      '.qtywrap{display:flex;gap:4mm;align-items:flex-start;margin-bottom:0}' +
      '.hnote{flex:1;border:1px solid #ccc;border-radius:1mm;padding:2mm 3mm;font-size:8.5pt;line-height:1.4;min-width:0;font-weight:700;color:#c0271d}.hnote .ht{font-size:8pt;color:#888;margin-bottom:1mm;font-weight:700}' +
      '.footer{margin-top:4mm;border-top:1px solid #ddd;padding-top:1.5mm;font-size:8pt;color:#888;display:flex;justify-content:space-between}' +
      '.sumwrap{margin-top:3mm;border-top:1px solid #ddd;padding-top:1.5mm;break-inside:avoid;page-break-inside:avoid}' +
      '.sumhead{font-size:8.5pt;font-weight:700;color:#0f3d4a;margin-bottom:1mm}.sumhead b{color:#1558d6}' +
      '.sumcols{display:flex;gap:4mm;align-items:flex-start;flex-wrap:wrap}' +
      'table.sum1,table.sum2{border-collapse:collapse;font-size:7.5pt;break-inside:avoid;page-break-inside:avoid}' +
      'table.sum1 td,table.sum2 th,table.sum2 td{border:1px solid #bbb;padding:0.5mm 2mm;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      'table.sum1 td.pp{font-weight:700;background:#f5f4f0}' +
      'table.sum2 th{background:#e4ecef;color:#0f3d4a}table.sum2 td.pn{text-align:left}' +
      '@media print{body{padding:6mm 8mm}}' +
      '</style></head><body>' + '<div class="topbar"><div class="topmain">' +
      '<div class="head"><span class="big">' + esc(part.partNo || "") + '</span>' +
      (part.partName ? '<span class="m">' + esc(part.partName) + '</span>' : '') +
      (props.brandName ? '<span class="m">🏷 ' + esc(props.brandName) + '</span>' : '') +
      '<span class="tt">1着 ' + fmtKoteiTime(summary.tot) + '</span>' +
      (targetPerDay ? '<span class="m">1日目標 ' + esc(targetPerDay) + '着</span>' : '') +
      (unten ? '<span class="m">運針(3c間) ' + esc(unten) + '</span>' : '') +
      (thread ? '<span class="m">糸番手 ' + esc(thread) + '</span>' : '') +
      '</div>' + '<div class="qtywrap">' + tbl + commentHtml + '</div></div>' + designHtml + '</div>' + bodyHtml + sumHtml +
      '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250)}<\/script></body></html>';
    let frame = document.getElementById("kotei-print-frame");
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
    frame = document.createElement("iframe");
    frame.id = "kotei-print-frame";
    frame.setAttribute("style", "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;");
    document.body.appendChild(frame);
    const d = frame.contentWindow.document;
    d.open(); d.write(html); d.close();
  }

  useEffect(function () {
    const ids = blocks.filter(function (b) { return b.type === "sketch" && b.imgId && !imgData[b.imgId]; }).map(function (b) { return b.imgId; });
    if (ids.length === 0) return;
    ids.forEach(function (id) {
      fetchKoteiImage(id).then(function (d) { if (d) setImgData(function (m) { const n = Object.assign({}, m); n[id] = d; return n; }); }).catch(function () {});
    });
  }, [blocks]);

  useEffect(function () {
    if (modalId == null) return;
    const blk = blocks.find(function (b) { return b.id === modalId; });
    const cv = canvasRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    draw.current.ctx = ctx; draw.current.drawing = false;
    pAdj.current.img = null; pAdj.current.snapImg = null; setPhotoAdj(false); // 開き直しで調整モード解除
    const src0 = blk ? (blk.imgId ? imgData[blk.imgId] : blk.img) : "";
    if (src0) { const im = new Image(); im.onload = function () { ctx.drawImage(im, 0, 0, w, h); }; im.src = src0; }
  }, [modalId, imgData]);

  // デザイン画：保存済み画像の取り込み
  useEffect(function () {
    if (designImgId && !imgData[designImgId]) {
      fetchKoteiImage(designImgId).then(function (d) { if (d) setImgData(function (m) { const n = Object.assign({}, m); n[designImgId] = d; return n; }); }).catch(function () {});
    }
  }, [designImgId]);
  // デザイン画モーダルを開いたら、既存画像があれば初期表示
  useEffect(function () {
    if (!designOpen) return;
    const v = dView.current; v.drag = false;
    setTimeout(function () {
      const cv = designCanvasRef.current; if (!cv) return;
      const src = imgData[designImgId];
      if (src) {
        const im = new Image();
        im.onload = function () { v.img = im; v.rot = 0; v.x = 0; v.y = 0; v.scale = Math.min(cv.width / im.width, cv.height / im.height); redrawDesign(); };
        im.src = src;
      } else { v.img = null; redrawDesign(); }
    }, 30);
  }, [designOpen]);

  function allowDraw(e) { return !draw.current.penOnly || e.pointerType === "pen" || e.pointerType === "mouse"; }
  function pDown(e) {
    // 写真調整モード中はペン・指どちらでも写真のドラッグ移動
    const v = pAdj.current;
    if (v.img) { v.drag = true; v.last = { x: e.clientX, y: e.clientY }; return; }
    if (!allowDraw(e)) return; const d = draw.current; d.drawing = true; const r = e.currentTarget.getBoundingClientRect(); d.last = { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function pMove(e) {
    const v = pAdj.current;
    if (v.img) {
      if (!v.drag) return;
      v.x += e.clientX - v.last.x; v.y += e.clientY - v.last.y;
      v.last = { x: e.clientX, y: e.clientY };
      redrawPhotoAdj(); return;
    }
    const d = draw.current; if (!d.drawing || !allowDraw(e) || !d.ctx) return;
    const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const ctx = d.ctx;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (d.erase) { ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = 26; }
    else { ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = d.color; ctx.lineWidth = 1.6 + ((e.pressure || 0.5) * 4); }
    ctx.beginPath(); ctx.moveTo(d.last.x, d.last.y); ctx.lineTo(x, y); ctx.stroke(); d.last = { x: x, y: y };
  }
  function pUp() { draw.current.drawing = false; pAdj.current.drag = false; }
  function pickTool(t) { setTool(t); const d = draw.current; if (t === "erase") { d.erase = true; } else { d.erase = false; d.color = t === "time" ? K_TIME : t === "note" ? K_NOTE : K_INK; } }
  function clearCanvas() { const d = draw.current, cv = canvasRef.current; if (d.ctx && cv) d.ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight); }
  function togglePalm() { draw.current.penOnly = !draw.current.penOnly; setTool(function (t) { return t; }); setActiveSugg(function (s) { return s; }); forceRerender(); }
  const [, setTick] = useState(0); function forceRerender() { setTick(function (n) { return n + 1; }); }
  function doneModal() {
    const cv = canvasRef.current; const id = modalId;
    if (!cv) { setModalId(null); return; }
    const raw = cv.toDataURL("image/png");
    compressDataURL(raw, function (out) {
      setUploading(true);
      uploadKoteiImage(out).then(function (fid) {
        setImgData(function (m) { const n = Object.assign({}, m); n[fid] = out; return n; });
        patchBlock(id, { imgId: fid, img: "" });
        setModalId(null);
      }).catch(function () {
        window.alert("図の保存に失敗しました。通信を確認して、もう一度お試しください。");
        patchBlock(id, { img: out });
        setModalId(null);
      }).finally(function () { setUploading(false); });
    });
  }
  function onPhoto(e) {
    const f = e.target.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = function () {
      const im = new Image();
      im.onload = function () {
        const cv = canvasRef.current; if (!cv) return;
        const v = pAdj.current;
        v.img = im; v.rot = 0; v.x = 0; v.y = 0; v.drag = false;
        v.scale = Math.min(cv.clientWidth / im.width, cv.clientHeight / im.height);
        // 既に描いてある線は写真の上に重ねたまま保持する（決定まで消えない）
        v.snapImg = null;
        const snap = new Image();
        snap.onload = function () { v.snapImg = snap; redrawPhotoAdj(); };
        snap.src = cv.toDataURL("image/png");
        setPhotoAdj(true);
        redrawPhotoAdj();
      };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
    e.target.value = ""; // 同じ写真をもう一度選び直せるように
  }
  function redrawPhotoAdj() {
    const cv = canvasRef.current, ctx = draw.current.ctx, v = pAdj.current;
    if (!cv || !ctx || !v.img) return;
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + v.x, h / 2 + v.y);
    ctx.rotate(v.rot * Math.PI / 180);
    ctx.drawImage(v.img, -v.img.width * v.scale / 2, -v.img.height * v.scale / 2, v.img.width * v.scale, v.img.height * v.scale);
    ctx.restore();
    if (v.snapImg) ctx.drawImage(v.snapImg, 0, 0, w, h);
  }
  function photoZoom(fac) { pAdj.current.scale *= fac; redrawPhotoAdj(); }
  function photoRotate() { const v = pAdj.current; v.rot = (v.rot + 90) % 360; redrawPhotoAdj(); }
  // 決定：キャンバスは既に「写真＋その上に線」の合成状態なので、モードを抜けるだけでよい
  function photoDone() { const v = pAdj.current; v.img = null; v.snapImg = null; setPhotoAdj(false); }
  function photoCancel() {
    const cv = canvasRef.current, ctx = draw.current.ctx, v = pAdj.current;
    if (cv && ctx) {
      const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      if (v.snapImg) ctx.drawImage(v.snapImg, 0, 0, w, h);
    }
    v.img = null; v.snapImg = null; setPhotoAdj(false);
  }
  function startVoice(id) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.alert("この端末・ブラウザは音声入力に対応していません。\niPhone/iPadは最新のiOSのSafari、PCはChromeでお試しください。"); return; }
    const rec = new SR(); rec.lang = "ja-JP"; rec.interimResults = false; setRecId(id);
    rec.onresult = function (ev) { const t = ev.results[0][0].transcript; const cur = (blocks.find(function (b) { return b.id === id; }) || {}).act || ""; patchBlock(id, { act: cur ? cur + " " + t : t }); learn(t); };
    // エラーを握りつぶすと「押しても無反応」に見える。原因ごとに日本語で案内する。
    rec.onerror = function (ev) {
      setRecId(null);
      const code = (ev && ev.error) || "";
      if (code === "not-allowed" || code === "service-not-allowed") window.alert("マイクの使用が許可されていません。\n・ブラウザの設定でこのサイトのマイクを許可してください\n・iPhone/iPadは「設定 → 一般 → キーボード → 音声入力」もオンにしてください");
      else if (code === "no-speech") window.alert("音声が聞き取れませんでした。\n🎤を押してボタンが赤くなってから、はっきり話してください。");
      else if (code === "audio-capture") window.alert("マイクが見つかりません。端末のマイクを確認してください。");
      else if (code === "network") window.alert("音声認識の通信に失敗しました。電波の良い場所でもう一度お試しください。");
      else if (code !== "aborted") window.alert("音声入力でエラーが発生しました（" + (code || "不明") + "）。もう一度お試しください。");
    };
    rec.onend = function () { setRecId(null); };
    try { rec.start(); } catch (e) { setRecId(null); window.alert("音声入力を開始できませんでした。もう一度お試しください。"); }
  }

  const sz = { s: { w: "140px", h: "96px" }, m: { w: "230px", h: "150px" }, l: { w: "100%", h: "240px" } };

  const koteiStepNo = {}; (function () { let n = 0; blocks.forEach(function (b) { if (b.type === "step") { n++; koteiStepNo[b.id] = n; } }); })();

  function renderStep(b) {
    const cats = Object.keys(props.phraseCats || {}); if (histPhrases.length) cats.push("履歴");
    const baseList = suggCat === "履歴" ? histPhrases : ((props.phraseCats || {})[suggCat] || []);
    const tokA = lastKoteiToken(b.act);
    const tokenList = (tokA ? baseList.filter(function (p) { return p.indexOf(tokA) >= 0 && p !== tokA; }) : baseList).slice(0, 14);
    return React.createElement("div", { key: b.id, style: { position: "relative", borderBottom: "1px solid var(--line)", padding: "16px 0 14px" } },
      React.createElement("div", { className: "kstepGrid" },
        React.createElement("div", { className: "kstepNo" }, String(koteiStepNo[b.id]).padStart(2, "0")),
        React.createElement("div", { className: "kstepPart" },
          React.createElement("div", { className: "kfld" }, "PART"),
          React.createElement("select", { style: { width: "100%", height: 46, border: "1px solid var(--line)", borderRadius: 12, background: "var(--iquta-bg)", color: "var(--iquta)", fontWeight: 700, fontSize: 14, padding: "0 12px" }, value: b.part, onChange: function (e) { const v = e.target.value; if (v === "__new__") { const nv = window.prompt("新しいパーツ名を入力"); if (nv && nv.trim()) patchBlock(b.id, { part: nv.trim() }); } else { patchBlock(b.id, { part: v }); } } },
            React.createElement("option", { value: "" }, "—"),
            (function () { let list = (props.partList || KOTEI_PARTS).concat(props.extraParts || []); if (b.part && list.indexOf(b.part) < 0) list = list.concat([b.part]); return list; })().map(function (p) { return React.createElement("option", { key: p, value: p }, p); }),
            React.createElement("option", { value: "__new__" }, "＋ 新しいパーツ…")
          )
        ),
        React.createElement("div", { className: "kstepAct" },
          React.createElement("div", { className: "kfld" }, "作業内容"),
          React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "flex-start" } },
            React.createElement("textarea", { className: "kact", style: { flex: 1, minHeight: 46, border: "1px solid var(--line)", borderRadius: 12, background: "var(--paper)", padding: "12px 14px", fontSize: 15, color: "var(--ink)", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit", boxSizing: "border-box" }, placeholder: b.hint || "手打ち / 下の定型句 / 音声", value: b.act, onFocus: function () { lastFocusRef.current = b.id; setActiveSugg(b.id); }, onBlur: function () { learn(b.act); setTimeout(function () { setActiveSugg(function (s) { return s === b.id ? null : s; }); }, 200); }, onChange: function (e) { patchBlock(b.id, { act: e.target.value }); } }),
            React.createElement("button", { style: { width: 46, height: 46, border: "1px solid " + (recId === b.id ? "var(--aka)" : "var(--line)"), borderRadius: 12, background: recId === b.id ? "var(--aka)" : "#fff", color: recId === b.id ? "#fff" : "var(--iquta)", fontSize: 11, fontWeight: 600, flex: "none", letterSpacing: ".04em" }, onClick: function () { startVoice(b.id); } }, recId === b.id ? "録音中" : "音声")
          ),
          activeSugg === b.id && React.createElement("div", { style: { marginTop: 6 } },
            React.createElement("div", { style: { display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" } },
              cats.map(function (c) {
                return React.createElement("button", { key: c, style: { border: "1px solid " + (suggCat === c ? K_PART : K_LINE), background: suggCat === c ? K_PART : "#fff", color: suggCat === c ? "#fff" : "#555", borderRadius: 12, padding: "4px 12px", fontSize: 12, fontWeight: 700 }, onMouseDown: function (e) { e.preventDefault(); setSuggCat(c); } }, c);
              })
            ),
            tokenList.length > 0 && React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } },
              tokenList.map(function (p) {
                return React.createElement("button", { key: p, style: { border: "1px solid var(--line)", background: "var(--iquta-bg)", color: "var(--iquta)", borderRadius: 14, padding: "5px 10px", fontSize: 12 }, onMouseDown: function (e) { e.preventDefault(); const v = b.act || ""; let nv; if (v === "" || /[\s、・\n]$/.test(v)) { nv = v + p; } else { const tk = lastKoteiToken(v); nv = v.slice(0, v.length - tk.length) + p; } patchBlock(b.id, { act: nv }); } }, p);
              })
            )
          )
        ),
        React.createElement("div", { className: "kstepTime" },
          React.createElement("div", { className: "kfld" }, "TIME"),
          React.createElement("input", { className: "ktime", style: { width: "100%", height: 46, border: "1px solid var(--line)", borderRadius: 12, background: "var(--paper)", textAlign: "center", fontSize: 18, color: "var(--iquta)", fontWeight: 700, boxSizing: "border-box", fontVariantNumeric: "tabular-nums", letterSpacing: ".03em" }, inputMode: "numeric", placeholder: "—", value: b.time, onFocus: function () { lastFocusRef.current = b.id; }, onChange: function (e) { patchBlock(b.id, { time: e.target.value }); }, onBlur: function () { const s = parseKoteiTime(b.time); if (s) patchBlock(b.id, { time: fmtKoteiTime(s) }); } })
        )
      ),
      React.createElement("div", { className: "kstepPad", style: { marginTop: 10, paddingLeft: 36 } },
        React.createElement("input", { style: { width: "100%", height: 36, border: "1px solid #f0dbdb", borderRadius: 10, padding: "0 12px", fontSize: 12, color: "var(--aka)", background: "#fdf6f6", boxSizing: "border-box" }, placeholder: "注意点（赤）", value: b.note, onFocus: function () { lastFocusRef.current = b.id; }, onChange: function (e) { patchBlock(b.id, { note: e.target.value }); } })
      ),
      b.part && React.createElement("div", { className: "kstepPad", style: { marginTop: 8, paddingLeft: 36 } },
        React.createElement("input", { style: { width: "100%", height: 34, border: "1px solid var(--line)", borderRadius: 10, padding: "0 12px", fontSize: 12, color: "var(--soft)", background: "#fff", boxSizing: "border-box" }, placeholder: "パーツのメモ（印刷でパーツ名の横に出ます）", value: b.gmemo || "", onChange: function (e) { patchBlock(b.id, { gmemo: e.target.value }); } })
      ),
      insertRow(b.id),
      moveButtons(b.id)
    );
  }

  function renderSketch(b) {
    const s = sz[b.size || "s"];
    return React.createElement("div", { key: b.id, style: { position: "relative", borderBottom: "1px solid " + K_LINE, padding: "10px 0 12px" } },
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } },
        React.createElement("span", { style: { fontSize: 10, color: "#999" } }, "図・写真"),
        React.createElement("div", { style: { display: "flex", gap: 4 } },
          ["s", "m", "l"].map(function (k) { return React.createElement("button", { key: k, style: Object.assign({ border: "1px solid " + K_LINE, background: b.size === k ? K_PART : "#fff", color: b.size === k ? "#fff" : "#555", borderRadius: 6, padding: "4px 9px", fontSize: 12 }), onClick: function () { patchBlock(b.id, { size: k }); } }, k === "s" ? "小" : k === "m" ? "中" : "大"); })
        )
      ),
      React.createElement("div", { style: { width: s.w, height: s.h, border: "1px solid " + K_LINE, borderRadius: 8, overflow: "hidden", background: "#fff", cursor: "pointer", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", fontSize: 13 }, onClick: function () { setModalId(b.id); } },
        (function () { const src = b.imgId ? imgData[b.imgId] : b.img; if (src) return React.createElement("img", { src: src, style: { width: "100%", height: "100%", objectFit: "contain" } }); if (b.imgId) return "読み込み中…"; return "タップして描く / 写真"; })(),
        React.createElement("span", { style: { position: "absolute", right: 6, bottom: 5, background: "rgba(30,90,215,.88)", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 10 } }, "編集")
      ),
      React.createElement("input", { style: { width: "100%", border: "none", borderBottom: "1px solid " + K_LINE, background: "transparent", padding: "6px 2px", fontSize: 13, color: "#555", marginTop: 8, boxSizing: "border-box" }, placeholder: "図の説明（任意）", value: b.caption, onChange: function (e) { patchBlock(b.id, { caption: e.target.value }); } }),
      insertRow(b.id),
      moveButtons(b.id)
    );
  }

  function moveButtons(id) {
    return React.createElement("div", { style: { position: "absolute", top: 8, right: 0, display: "flex", gap: 4 } },
      React.createElement("button", { style: mvBtn, onClick: function () { move(id, -1); } }, "↑"),
      React.createElement("button", { style: mvBtn, onClick: function () { move(id, 1); } }, "↓"),
      React.createElement("button", { style: Object.assign({}, mvBtn, { color: K_NOTE }), onClick: function () { del(id); } }, "✕")
    );
  }
  const mvBtn = { width: 30, height: 30, border: "1px solid var(--line)", background: "#fff", borderRadius: 8, fontSize: 13, color: "var(--faint)" };

  function renderSummary() {
    const tot = summary.tot, map = summary.map;
    const rows = Object.keys(map).map(function (p) { const o = map[p]; const pct = tot ? Math.round(o.s / tot * 100) : 0; return { p: p, n: o.n, s: o.s, pct: pct }; });
    return React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: 16, marginTop: 20, border: "1px solid var(--line)" } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
        React.createElement("span", { style: { fontSize: 12, fontWeight: 600, letterSpacing: ".2em", color: "var(--iquta)" } }, "集計"),
        React.createElement("span", { style: { fontSize: 13, color: "var(--soft)" } }, "1着 総工数 ", React.createElement("b", { style: { fontSize: 20, color: "var(--iquta)", fontVariantNumeric: "tabular-nums" } }, fmtKoteiTime(tot)))
      ),
      React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13 } },
        React.createElement("span", null, "1日実働"),
        React.createElement("input", { style: { width: 70, border: "1px solid " + K_LINE, borderRadius: 6, padding: 6, textAlign: "center", color: K_TIME, fontWeight: 700 }, type: "number", value: workMin, onChange: function (e) { setWorkMin(parseInt(e.target.value, 10) || 0); } }),
        React.createElement("span", { style: { color: "#999" } }, "分")
      ),
      [3, 4, 5].map(function (ppl) { const per = tot / 60 / ppl; const day = per ? workMin / per : 0; return React.createElement("div", { key: ppl, style: { display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 } }, React.createElement("b", null, ppl + "人"), React.createElement("span", null, "1着 ", React.createElement("b", { style: { color: K_TIME } }, per.toFixed(1) + "分")), React.createElement("span", null, "1日 ", React.createElement("b", { style: { color: K_TIME } }, day.toFixed(1) + "着"))); }),
      React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 } },
        React.createElement("thead", null, React.createElement("tr", null,
          React.createElement("th", { style: thKotei }, "パーツ"), React.createElement("th", { style: thKotei }, "工程"), React.createElement("th", { style: thKotei }, "合計"), React.createElement("th", { style: thKotei }, "比")
        )),
        React.createElement("tbody", null, rows.map(function (r) {
          return React.createElement("tr", { key: r.p },
            React.createElement("td", { style: Object.assign({}, tdKotei, { textAlign: "left", fontWeight: 700, color: K_PART }) }, r.p),
            React.createElement("td", { style: tdKotei }, r.n),
            React.createElement("td", { style: tdKotei }, fmtKoteiTime(r.s)),
            React.createElement("td", { style: tdKotei }, r.pct + "%")
          );
        }))
      )
    );
  }
  const thKotei = { border: "1px solid var(--line)", padding: "6px 8px", background: "var(--iquta-bg)", color: "var(--iquta)", textAlign: "center" };
  const tdKotei = { border: "1px solid var(--line)", padding: "6px 8px", textAlign: "center" };

  function renderModal() {
    const penBtn = function (c, label) { return React.createElement("button", { style: { width: 30, height: 30, borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 0 0 1px " + K_LINE + (((tool === "ink" && c === K_INK) || (tool === "time" && c === K_TIME) || (tool === "note" && c === K_NOTE)) ? ",0 0 0 3px " + K_PART : ""), background: c, padding: 0 }, onClick: function () { pickTool(c === K_TIME ? "time" : c === K_NOTE ? "note" : "ink"); }, title: label }); };
    return React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,20,20,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 } },
      React.createElement("div", { style: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 760, padding: 12 } },
        photoAdj
          // 写真調整モード：位置決め専用のツールバーに切替（決定するまで描画・保存はできない）
          ? React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 } },
            React.createElement("span", { style: { fontSize: 12, color: "#555", fontWeight: 700 } }, "📷 ドラッグで移動"),
            React.createElement("button", { style: mTool, onClick: function () { photoZoom(1.15); } }, "＋拡大"),
            React.createElement("button", { style: mTool, onClick: function () { photoZoom(0.87); } }, "－縮小"),
            React.createElement("button", { style: mTool, onClick: photoRotate }, "⟳ 回転"),
            React.createElement("button", { style: { marginLeft: "auto", border: "1px solid " + K_LINE, background: "#fff", color: "#555", borderRadius: 8, padding: "9px 14px" }, onClick: photoCancel }, "やめる"),
            React.createElement("button", { style: { border: "1px solid " + K_PART, background: K_PART, color: "#fff", borderRadius: 8, padding: "9px 14px", fontWeight: 700 }, onClick: photoDone }, "✓ 写真を決定")
          )
          : React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 } },
            penBtn(K_INK, "黒"), penBtn(K_TIME, "青"), penBtn(K_NOTE, "赤"),
            React.createElement("button", { style: Object.assign({}, mTool, tool === "erase" ? mToolOn : {}), onClick: function () { pickTool("erase"); } }, "消しゴム"),
            React.createElement("label", { style: mTool }, "写真", React.createElement("input", { type: "file", accept: "image/*", capture: "environment", style: { display: "none" }, onChange: onPhoto })),
            React.createElement("button", { style: mTool, onClick: clearCanvas }, "全消去"),
            React.createElement("button", { style: Object.assign({}, mTool, draw.current.penOnly ? mToolOn : {}), onClick: togglePalm }, draw.current.penOnly ? "✏️ペンのみ" : "✋指もOK"),
            React.createElement("button", { style: { marginLeft: "auto", border: "1px solid " + K_LINE, background: "#fff", color: "#555", borderRadius: 8, padding: "9px 14px" }, onClick: function () { if (!uploading) setModalId(null); } }, "閉じる"),
            React.createElement("button", { style: { border: "1px solid " + K_PART, background: uploading ? "#888" : K_PART, color: "#fff", borderRadius: 8, padding: "9px 14px", fontWeight: 700 }, onClick: function () { if (!uploading) doneModal(); } }, uploading ? "保存中…" : "完了")
          ),
        React.createElement("div", { style: { border: "1px solid " + K_LINE, borderRadius: 8, overflow: "hidden", background: "#fff" } },
          React.createElement("canvas", { ref: canvasRef, style: { display: "block", width: "100%", height: "62vh", touchAction: "none" }, onPointerDown: pDown, onPointerMove: pMove, onPointerUp: pUp, onPointerLeave: pUp })
        )
      )
    );
  }
  const mTool = { border: "1px solid " + K_LINE, background: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: "#333", display: "inline-flex", alignItems: "center", gap: 5 };
  const mToolOn = { background: K_PART, color: "#fff", borderColor: K_PART };
  const kMetaK = { fontSize: 9, color: "var(--faint)", letterSpacing: ".18em", marginBottom: 4, fontWeight: 600 };

  return React.createElement(Shell, null,
    // 工程行のレスポンシブ切替（件1）。インラインstyleではメディアクエリが書けないためhere。
    // 430px以下: 作業内容を全幅1行目に、パーツ・時間を2行目で横2分割。移動ボタン(絶対配置)とは
    // margin-topで重なりを回避。431px以上は既定値＝従来の3列（108px|1fr|78px・右余白76px）のまま。
    // 工程行のレイアウト（iqutaモック準拠）。PC: 番号24|PART92|作業内容1fr|TIME62。
    // 430px以下: 番号＋作業内容が上段、下段にPART(1fr)＋TIME(82px)（時間欄が画面内に収まる改修を維持）。
    React.createElement("style", null,
      ".kstepGrid{display:grid;grid-template-columns:24px 92px 1fr 62px;grid-template-areas:'no part act time';gap:12px;padding-right:76px;align-items:start}" +
      ".kstepNo{grid-area:no;font-size:12px;color:var(--faint);font-weight:600;line-height:46px;text-align:center;font-variant-numeric:tabular-nums}" +
      ".kstepPart{grid-area:part}.kstepAct{grid-area:act}.kstepTime{grid-area:time}" +
      ".kfld{font-size:9px;color:var(--iquta);opacity:.55;letter-spacing:.16em;margin-bottom:6px;font-weight:600}" +
      ".kact:focus,.ktime:focus{outline:none;border-color:var(--iquta);background:#fff}" +
      ".kstepPad{padding-right:76px}" +
      "@media (max-width:430px){" +
      ".kstepGrid{grid-template-columns:24px 1fr 82px;grid-template-areas:'no act act' 'sp part time';row-gap:10px;padding-right:0;margin-top:34px}" +
      ".kstepPart .kfld,.kstepTime .kfld{display:none}" +
      ".kstepPad{padding-right:0}" +
      "}"
    ),
    // ヘッダー常設の保存/印刷は最下部のボタンと同じ関数（handleSave/doPrint）を呼ぶ（入口2つ・処理1つ）
    React.createElement(Header, { sub: "工程分析表", back: props.back, dirty: isDirty, actions: [
      { label: uploading ? "…" : "印刷", onClick: function () { if (!uploading) doPrint(); } },
      { label: "保存", onClick: handleSaveStay, primary: true },
    ] }),
    React.createElement(Body, null,
      // ── topbar（iqutaモック準拠）：品番=青24px、サブ情報、TOTAL/1日目標/工程数のメタ行 ──
      React.createElement("div", { style: { borderBottom: "1px solid var(--line)", padding: "4px 4px 18px", marginBottom: 4 } },
        React.createElement("div", { style: { display: "flex", gap: 14, alignItems: "flex-start" } },
          React.createElement("div", { style: { flex: 1, minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 24, fontWeight: 400, color: "var(--iquta)", letterSpacing: ".01em" } }, part.partNo),
            (part.partName || props.brandName) && React.createElement("div", { style: { fontSize: 12, color: "var(--soft)", marginTop: 5, letterSpacing: ".03em" } }, [part.partName, props.brandName].filter(Boolean).join(" · ")),
            React.createElement("div", { style: { display: "flex", gap: 24, marginTop: 18, flexWrap: "wrap", alignItems: "flex-end" } },
              React.createElement("div", null, React.createElement("div", { style: kMetaK }, "TOTAL"), React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: "var(--iquta)", fontVariantNumeric: "tabular-nums", letterSpacing: ".01em" } }, fmtKoteiTime(summary.tot))),
              React.createElement("div", null, React.createElement("div", { style: kMetaK }, "1日目標"), React.createElement("input", { style: { width: 64, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", fontSize: 16, fontWeight: 700, textAlign: "center", color: "var(--ink)", background: "var(--paper)" }, placeholder: "15", value: targetPerDay, onChange: function (e) { setTargetPerDay(e.target.value); } })),
              React.createElement("div", null, React.createElement("div", { style: kMetaK }, "工程数"), React.createElement("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" } }, blocks.filter(function (b) { return b.type === "step"; }).length)),
              React.createElement("div", null, React.createElement("div", { style: kMetaK }, "運針(3c間)"), React.createElement("input", { style: { width: 80, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", fontSize: 14, background: "var(--paper)", color: "var(--ink)" }, placeholder: "12針", value: unten, onChange: function (e) { setUnten(e.target.value); } })),
              React.createElement("div", null, React.createElement("div", { style: kMetaK }, "糸番手"), React.createElement("input", { style: { width: 80, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 8px", fontSize: 14, background: "var(--paper)", color: "var(--ink)" }, placeholder: "#50", value: thread, onChange: function (e) { setThread(e.target.value); } }))
            )
          ),
          React.createElement("button", { style: { flex: "none", width: 84, height: 110, border: "1px dashed var(--line)", borderRadius: 10, background: designImgId && imgData[designImgId] ? "#fff" : "var(--paper)", padding: 0, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }, onClick: function () { setDesignOpen(true); } },
            (designImgId && imgData[designImgId])
              ? React.createElement("img", { src: imgData[designImgId], style: { width: "100%", height: "100%", objectFit: "cover" } })
              : React.createElement("div", { style: { fontSize: 11, color: "var(--faint)", textAlign: "center", lineHeight: 1.5 } }, "＋\nデザイン画"),
            React.createElement("span", { style: { position: "absolute", right: 4, bottom: 4, background: "rgba(30,90,215,.88)", color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 8 } }, designImgId ? "変更" : "追加")
          )
        ),
        React.createElement("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start", marginTop: 16 } },
          React.createElement("div", { style: { flex: "1 1 auto", minWidth: 0 } }, renderQtyTable()),
          React.createElement("div", { style: { flex: "1 1 200px", minWidth: 180 } },
            React.createElement("div", { style: kMetaK }, "全体の注意事項"),
            React.createElement("textarea", { style: { width: "100%", minHeight: 96, border: "1px solid #f0dbdb", borderRadius: 10, padding: 10, fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5, fontWeight: 700, color: "var(--aka)", background: "#fdf6f6" }, placeholder: "全体への注意点・申し送りなど", value: headNote, onChange: function (e) { setHeadNote(e.target.value); } })
          )
        )
      ),
      React.createElement("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "16px 6px 10px" } },
        React.createElement("div", { style: { fontSize: 12, letterSpacing: ".2em", color: "var(--iquta)", fontWeight: 600 } }, "工程を組む"),
        React.createElement("div", { style: { fontSize: 11, color: "var(--faint)", letterSpacing: ".04em" } }, blocks.filter(function (b) { return b.type === "step"; }).length + " 工程")
      ),
      React.createElement("div", { style: { padding: "0 2px" } },
        blocks.map(function (b) { return b.type === "step" ? renderStep(b) : renderSketch(b); })
      ),
      // 追加ボタンは各行に付けたため末尾の行は撤去（重複排除）。
      // ただしブロック0個の白紙状態だけは行が無く追加できないので、その時のみ残す。
      blocks.length === 0 && React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 12 } },
        React.createElement("button", { style: addBtn, onClick: function () { addStep(); } }, "＋ 工程を追加"),
        React.createElement("button", { style: addBtn, onClick: function () { addSketch(); } }, "＋ 図・写真")
      ),
      renderSummary(),
      React.createElement("button", { style: { width: "100%", background: "var(--iquta)", color: "#fff", border: "none", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, marginTop: 18 }, onClick: handleSave }, "保存して閉じる"),
      React.createElement("button", { style: { width: "100%", background: "#fff", color: "var(--iquta)", border: "1px solid var(--line)", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, marginTop: 8 }, onClick: function () { if (!uploading) doPrint(); } }, uploading ? "図を準備中…" : "A4印刷 / PDF保存"),
      (sheet && sheet.id) && React.createElement("button", { style: { width: "100%", background: "none", color: "var(--aka)", border: "none", borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 700, marginTop: 8 }, onClick: function () { if (window.confirm("この工程表を削除しますか？")) { props.onDelete(sheet.id); props.back(); } } }, "削除する")
    ),
    modalId != null && renderModal(),
    designOpen && renderDesignModal(),
    React.createElement(props.SI)
  );
}
const addBtn = { flex: 1, border: "1px solid var(--line)", background: "#fff", color: "var(--iquta)", borderRadius: 12, padding: 14, fontSize: 14, fontWeight: 600 };
