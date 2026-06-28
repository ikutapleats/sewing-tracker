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

async function gasAddRecord(record) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "addRecord", record }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("addRecord failed");
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
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "addQtyRecord", record }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("addQtyRecord failed");
}

async function gasAddKoteiRecords(records) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "addKoteiRecords", records }),
  });
  const result = await res.json();
  if (result.status !== "saved") throw new Error("addKoteiRecords failed: " + JSON.stringify(result));
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
      setData(merged);
    }).catch(() => {}).finally(() => setLoading(false));
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
      setData(merged);
    } catch (e) {}
  }, []);

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
    saving && React.createElement("div", { style: st.saveBadge }, "💾 保存中..."),
    saveError && React.createElement("div", { style: Object.assign({}, st.saveBadge, { background: "#c00" }) }, "⚠️ 保存失敗 - 再試行してください")
  );

  if (ui.screen === "home") {
    const unassigned = partSummary.filter((p) => (!p.assignee || p.assignee === "未割当") && !p.closedAt).length;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "作業実績管理", sub: "IQUTA PLEATS" }),
      React.createElement(Body, null,
        React.createElement(BigBtn, { icon: "📊", label: "集計・仕事量管理", sub: "全体・チーム別の実績と予算", onClick: () => set({ screen: "summary" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "📅", label: "納期カレンダー", sub: "品番ごとの納品予定日を一覧", onClick: () => set({ screen: "deadline_calendar", dlMonth: today().slice(0, 7) }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "💰", label: "売上カレンダー", sub: "日ごとの完成売上を全体・チーム別で確認", onClick: () => set({ screen: "sales_calendar", salesMonth: today().slice(0, 7), salesTeam: "all" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "🗂️", label: "ダッシュボード", sub: "納期・進捗を一目で確認", onClick: () => set({ screen: "dashboard" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "🏷️", label: "ブランド別仕事一覧", sub: "客先ごとの納品前・納品済みを確認", onClick: () => set({ screen: "brand_jobs", selectedBrandId: null }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "✂️", label: "サンプル管理", sub: "サンプル作成の記録・実働時間・サンプル代", onClick: () => set({ screen: "sample_list" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "📐", label: "工程分析表", sub: "品番ごとの工程・時間・図を一覧／作成・印刷", onClick: () => set({ screen: "kotei_list", koteiSearch: "" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "💴", label: "生産価値", sub: "人・日・品番ごとの時間と生産価値を振り返る", onClick: () => set({ screen: "value_view", vvAxis: "member", vvPeriod: "month", vvMonth: today().slice(0, 7), vvExpanded: {} }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "📋", label: "品番マスター", sub: "全品番の登録・割当管理" + (unassigned > 0 ? "　⚠️ 未割当 " + unassigned + "件" : ""), onClick: () => set({ screen: "master", masterFilter: "all" }) }),
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
              React.createElement(RoleBtn, { icon: "🔑", label: "リーダー", onClick: () => set({ selectedTeam: team, userRole: "leader", screen: "team_leader" }) }),
              React.createElement(RoleBtn, { icon: "😄", label: "メンバー", onClick: () => set({ selectedTeam: team, userRole: "member", screen: "member_entry", memberForm: { memberId: "", partId: "", hours: "", date: today() } }) })
            )
          );
        }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(Divider, { label: "管理設定" }),
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 8 } },
          React.createElement(QuickBtn, { label: "👥 メンバー管理", onClick: () => set({ screen: "member_mgmt" }) }),
          React.createElement(QuickBtn, { label: "🏢 外注先管理", onClick: () => set({ screen: "vendor_mgmt" }) })
        ),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement(QuickBtn, { label: "🏷️ ブランド管理", onClick: () => set({ screen: "brand_mgmt" }) })
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
        unassigned.length > 0 && React.createElement("div", { style: { background: "#fff8e0", border: "1px solid #ffe599", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#b07000" } }, "⚠️ 担当未割当の品番が " + unassigned.length + " 件あります"),
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
              React.createElement("span", { style: { color: p.remainQty === 0 ? "#2a7a2a" : "#888" } }, "残り " + p.remainQty + "枚")
            ),
            React.createElement(ProgressBar, { value: p.qtyProgress, color: p.remainQty === 0 ? "#2a7a2a" : "#3b6fd4" })
          ),
          React.createElement("div", { style: { display: "flex", gap: 8, fontSize: 12, color: "#aaa", flexWrap: "wrap" } },
            p.brandName && React.createElement("span", { style: { color: "#888", fontWeight: 600 } }, "🏷 " + p.brandName),
            p.workMonth && React.createElement("span", { style: { color: "#3b6fd4", fontWeight: 600 } }, p.workMonth.replace("-", "年") + "月仕掛り"),
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
            estTotal.hours > 0 && React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "目標時間単価"), React.createElement("b", { style: { color: "#2a7a2a" } }, "¥" + Math.round(estTotal.sales / estTotal.hours).toLocaleString() + "/h"))
          ),
          profit !== null && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: profit >= 0 ? "#f0f8f0" : "#fff0f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "売上合計"), React.createElement("b", null, "¥" + Math.round(parseFloat(f.sellPrice) * parseFloat(f.qty)).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "外注費合計"), React.createElement("b", null, "¥" + Math.round(parseFloat(f.vendorPrice) * parseFloat(f.qty)).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "利益"), React.createElement("b", { style: { color: profit >= 0 ? "#2a7a2a" : "#c00" } }, "¥" + Math.round(profit).toLocaleString()))
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
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "仕掛り月"), React.createElement("div", { style: { fontWeight: 700, color: p.workMonth ? "#3b6fd4" : "#bbb" } }, p.workMonth ? p.workMonth.replace("-", "年") + "月" : "未設定")),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "登録日"), React.createElement("div", { style: { fontWeight: 700 } }, fmt(p.createdAt))),
            p.deadline && React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "納期"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#aaa" : (p.remainDays <= 3 ? "#c00" : "#c25000") } }, fmt(p.deadline))),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "完了日"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#2a7a2a" : "#bbb" } }, p.closedAt ? fmt(p.closedAt) : ((p.status || "未着手") === "未着手" ? "裁断前" : "進行中")))
          ),
          p.deadline && !p.closedAt && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: p.remainDays <= 3 ? "#c00" : "#888" } }, "納期まであと ", React.createElement("b", null, p.remainDays), " 日")
        ),
        p.qtyProgress !== null && React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "📦 完成枚数"),
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, p.completedQty + "枚 / " + p.qty + "枚")
          ),
          React.createElement(ProgressBar, { value: p.qtyProgress, color: p.remainQty === 0 ? "#2a7a2a" : "#3b6fd4" }),
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#aaa", marginTop: 6 } },
            React.createElement("span", null, Math.round(p.qtyProgress * 100) + "% 完了"),
            React.createElement("span", { style: { color: p.remainQty === 0 ? "#2a7a2a" : "#c25000", fontWeight: 700 } }, "残り " + p.remainQty + "枚")
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
        !isOut && React.createElement("div", { style: Object.assign({}, st.rateBox, { background: p.closedAt ? "#1a1a1a" : "#f0f0ec", color: p.closedAt ? "#fff" : "#1a1a1a", marginBottom: 16 }) },
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
                      React.createElement("span", { style: { color: "#3b6fd4", fontWeight: 700 } }, r.hours + "h")
                    )
                  )
                )
              );
            });
          })()
        ),
        !p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { marginTop: 20 }), onClick: () => { closePart(p.id); set({ screen: "master" }); } }, "この品番を完了にする"),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#14555a", marginTop: 8 }), onClick: () => openSaidan(p) }, "✂️ 裁断報告書" + ((data.saidanReports || []).find((r) => r.partId === p.id) ? "　（登録済み）" : "")),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#0f3d4a", marginTop: 8 }), onClick: () => openKotei(p) }, "📐 工程分析表" + ((data.koteiSheets || []).find((r) => r.partId === p.id) ? "　（登録済み）" : "")),
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
            style: Object.assign({}, st.filterBtn, { flex: 1, padding: "10px", fontSize: 13, fontWeight: 700 }, isDelivered ? Object.assign({}, st.filterBtnActive, { background: "#2a7a2a", borderColor: "#2a7a2a" }) : {}),
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
          !isDelivered && React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#f0f8f0", color: "#2a7a2a", borderColor: "#b8e6b8" }) }, "🟢 余裕あり"),
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
          React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 12 } }, "📦 今日の完成枚数を入力"),
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
      React.createElement("div", { style: { width: 26, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#0f3d4a", flex: "none" } }, koteiParenNum(stepNo[s.id])),
      React.createElement("div", { style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 13, color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, s.act || "（無題の工程）"),
        React.createElement("div", { style: { fontSize: 10, color: "#aaa" } }, (s.part ? s.part + "　" : "") + fmtKoteiTime(parseKoteiTime(s.time)))
      ),
      React.createElement("input", { style: { width: 60, textAlign: "center", border: "1px solid #d9d5c8", borderRadius: 8, padding: "8px 4px", fontSize: 15, background: "#fff" }, type: "number", min: "0", placeholder: "枚", value: (ui.kEntryQty || {})[s.id] || "", onChange: (e) => setKQ({ [s.id]: e.target.value }) })
    );
    const hasQty = Object.keys(ui.kEntryQty || {}).some((id) => parseFloat((ui.kEntryQty || {})[id]) > 0);
    const ready = f.memberId && f.partId && ((f.hours && parseFloat(f.hours) > 0) || hasQty);

    // 本日・本人の記録
    const myRecs = f.memberId ? data.records.filter((r) => r.memberId === f.memberId && r.date === f.date) : [];
    const myKotei = f.memberId ? (data.koteiRecords || []).filter((r) => r.memberId === f.memberId && r.date === f.date) : [];
    const dayHours = myRecs.reduce((a, r) => a + (r.hours || 0), 0);
    const dayValue = myKotei.reduce((a, r) => a + koteiValue(r, data.parts), 0);
    const myMemberName = (data.members.find((m) => m.id === f.memberId) || {}).name || "";

    return React.createElement(Shell, null,
      React.createElement(Header, { title: ui.selectedTeam + "　作業記録", back: () => set({ screen: "home" }) }),
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
                f.partId && React.createElement(FormRow, { label: "作業時間（h）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3.5", min: "0", step: "0.5", value: f.hours, onChange: (e) => setMF({ hours: e.target.value }) })),
                f.partId && selSheet && React.createElement("div", null,
                  usualSteps.length > 0 && React.createElement("div", { style: { background: "#eef3f4", borderRadius: 10, padding: "10px 12px", marginBottom: 10, border: "1px solid #cfe0e4" } },
                    React.createElement("div", { style: { fontSize: 12, color: "#0f3d4a", fontWeight: 700, marginBottom: 8 } }, "⭐ 以前にやった工程"),
                    usualSteps.map((s) => stepRow(s))
                  ),
                  React.createElement("div", { style: { fontSize: 11, color: "#888", margin: "4px 0 8px" } }, "📐 すべての工程（パーツ名をタップで開く）"),
                  kGroups.length === 0 && React.createElement("div", { style: { color: "#bbb", fontSize: 13 } }, "この品番の工程表に工程がありません"),
                  kGroups.map((grp, gi) => {
                    const gkey = "g" + gi;
                    const gopen = !!ui.kEntryOpen[gkey];
                    const gfilled = grp.steps.filter((s) => parseFloat((ui.kEntryQty || {})[s.id]) > 0).length;
                    return React.createElement("div", { key: gi, style: { background: "#f5f4f0", borderRadius: 10, marginBottom: 8, overflow: "hidden" } },
                      React.createElement("button", { style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px", background: "none", border: "none", cursor: "pointer" }, onClick: () => toggleOpen(gkey) },
                        React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "#0f3d4a" } }, grp.part + "（" + grp.steps.length + "工程）"),
                        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
                          gfilled > 0 && React.createElement("span", { style: { fontSize: 11, color: "#0f3d4a", fontWeight: 700, background: "#cfe0e4", borderRadius: 10, padding: "2px 8px" } }, gfilled + "件入力済"),
                          React.createElement("span", { style: { color: "#999", fontSize: 13 } }, gopen ? "▼" : "▶")
                        )
                      ),
                      gopen && React.createElement("div", { style: { padding: "0 12px 10px" } },
                        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginBottom: 8 } },
                          React.createElement("span", { style: { fontSize: 11, color: "#999" } }, "まとめて"),
                          React.createElement("input", { style: { width: 60, textAlign: "center", border: "1px solid #d9d5c8", borderRadius: 8, padding: "6px 4px", fontSize: 14 }, type: "number", min: "0", placeholder: "枚", onChange: (e) => setGroupQty(grp.steps, e.target.value) }),
                          React.createElement("span", { style: { fontSize: 11, color: "#999" } }, "枚")
                        ),
                        grp.steps.map((s) => stepRow(s))
                      )
                    );
                  })
                ),
                f.partId && !selSheet && React.createElement("div", { style: { fontSize: 11, color: "#bbb", margin: "4px 0 8px" } }, "この品番は工程表がないため、時間のみ記録します"),
                f.partId && React.createElement("button", { style: Object.assign({}, st.primaryBtn, { background: "#0f3d4a", opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: saveEntry }, "記録する")
              )
            ),

        f.memberId && (myRecs.length > 0 || myKotei.length > 0) && React.createElement("div", null,
          React.createElement(SectionLabel, null, "本日の記録 (" + f.date + ")"),
          React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 12 } },
            React.createElement("div", { style: { flex: 1, background: "#1a1a1a", color: "#fff", borderRadius: 12, padding: "14px 16px" } },
              React.createElement("div", { style: { fontSize: 11, opacity: 0.6, marginBottom: 4 } }, "時間"),
              React.createElement("div", { style: { fontSize: 22, fontWeight: 700 } }, dayHours.toFixed(1) + "h")
            ),
            React.createElement("div", { style: { flex: 1, background: "#0f3d4a", color: "#fff", borderRadius: 12, padding: "14px 16px" } },
              React.createElement("div", { style: { fontSize: 11, opacity: 0.65, marginBottom: 4 } }, "生産価値"),
              React.createElement("div", { style: { fontSize: 22, fontWeight: 700 } }, "¥" + Math.round(dayValue).toLocaleString())
            )
          ),
          myRecs.length > 0 && React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 6 } }, "⏱ 時間"),
            myRecs.map((r) => { const part = data.parts.find((x) => x.id === r.partId); return React.createElement("div", { key: r.id, style: st.recRow }, React.createElement("span", { style: { fontSize: 13, fontWeight: 700, flex: 1 } }, part ? part.partNo : "?"), React.createElement("span", { style: { fontSize: 13, color: "#555" } }, r.hours + "h"), React.createElement("button", { style: st.deleteBtn, onClick: () => deleteRecord(r.id) }, "✕")); })
          ),
          myKotei.length > 0 && React.createElement("div", { style: { marginTop: 10 } },
            React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 6 } }, "📐 生産価値"),
            myKotei.slice().sort((a, b) => koteiValue(b, data.parts) - koteiValue(a, data.parts)).map((r) => {
              const part = data.parts.find((p) => p.id === r.partId);
              return React.createElement("div", { key: r.id, style: Object.assign({}, st.recRow, { alignItems: "flex-start" }) },
                React.createElement("div", { style: { flex: 1, minWidth: 0 } },
                  React.createElement("div", { style: { fontSize: 13, fontWeight: 700 } }, (part ? part.partNo : "?") + "　" + (r.stepPart || "")),
                  React.createElement("div", { style: { fontSize: 12, color: "#777", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, (r.stepAct || "") + " ×" + r.qty + "枚")
                ),
                React.createElement("div", { style: { fontSize: 14, fontWeight: 700, color: "#0f3d4a", whiteSpace: "nowrap" } }, "¥" + Math.round(koteiValue(r, data.parts)).toLocaleString()),
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
    const inPeriod = (d) => ui.vvPeriod === "day" ? d === ui.vvDay : (d || "").slice(0, 7) === ui.vvMonth;
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
          React.createElement("button", { style: Object.assign({}, st.filterBtn, { flex: 1, padding: "9px", fontWeight: 700 }, ui.vvPeriod === "day" ? st.filterBtnActive : {}), onClick: () => set({ vvPeriod: "day", vvExpanded: {} }) }, "日で見る")
        ),
        ui.vvPeriod === "month"
          ? React.createElement("input", { style: Object.assign({}, st.input, { marginBottom: 10 }), type: "month", value: ui.vvMonth, onChange: (e) => set({ vvMonth: e.target.value, vvExpanded: {} }) })
          : React.createElement("input", { style: Object.assign({}, st.input, { marginBottom: 10 }), type: "date", value: ui.vvDay, onChange: (e) => set({ vvDay: e.target.value, vvExpanded: {} }) }),

        React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 12 } },
          axisBtn("member", "人ごと"), axisBtn("date", "日ごと"), axisBtn("part", "品番ごと")
        ),

        React.createElement("div", { style: { background: "#1a1a1a", color: "#fff", borderRadius: 12, padding: "14px 18px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" } },
          React.createElement("div", null,
            React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 2 } }, "この期間の合計"),
            React.createElement("div", { style: { fontSize: 24, fontWeight: 700 } }, yen(totValue))
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
                      React.createElement("div", { style: { width: 90, textAlign: "right", fontSize: 15, fontWeight: 700, color: "#0f3d4a" } }, yen(o.value)),
                      React.createElement("span", { style: { width: 14, textAlign: "center", color: "#ccc" } }, exp ? "▼" : "▶")
                    )
                  ),
                  exp && React.createElement("div", { style: { background: "#fff", borderRadius: "0 0 12px 12px", margin: "0 0 10px", padding: "2px 14px 10px", boxShadow: "0 1px 4px rgba(0,0,0,.06)" } },
                    subKeys.map((sk) => React.createElement("div", { key: sk, style: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid #f0eeea" } },
                      React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 13, color: "#444", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, secLabel(sk)),
                      React.createElement("div", { style: { width: 56, textAlign: "right", fontSize: 12, color: "#888" } }, o.sub[sk].hours.toFixed(1) + "h"),
                      React.createElement("div", { style: { width: 90, textAlign: "right", fontSize: 13, fontWeight: 700, color: "#0f3d4a" } }, yen(o.sub[sk].value))
                    ))
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

              React.createElement("div", { style: { background: "#1a1a1a", borderRadius: 12, padding: "16px 18px", marginBottom: 12, color: "#fff" } },
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
                      React.createElement("span", { style: { fontSize: 11, color: "#3b6fd4" } }, "品番を見る ›")
                    ),
                    React.createElement("span", { style: { fontSize: 12, color: "#aaa" } }, tParts.length + "品番 / " + tQty + "枚")
                  ),

                  React.createElement("div", { style: { background: "#1a1a1a", borderRadius: 10, padding: "14px 16px", marginBottom: 12, color: "#fff" } },
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
                      React.createElement(ProgressBar, { value: salesProgress, color: salesProgress >= 1 ? "#7dff7d" : "#3b6fd4" })
                    )
                  ),

                  React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 } },
                    React.createElement("div", { style: { background: "#f0f4ff", borderRadius: 10, padding: "10px 12px", textAlign: "center" } },
                      React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "見込み時間"),
                      React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "#3b6fd4" } },
                        tAssignedHours > 0 ? tAssignedHours.toFixed(0) + "h" : "—"
                      )
                    ),
                    React.createElement("div", { style: { background: "#f0f8f0", borderRadius: 10, padding: "10px 12px", textAlign: "center" } },
                      React.createElement("div", { style: { fontSize: 10, color: "#aaa", marginBottom: 4 } }, "実績時間"),
                      React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: "#2a7a2a" } },
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
                    React.createElement(ProgressBar, { value: tQty > 0 ? tCompletedQty / tQty : 0, color: "#2a7a2a" })
                  )
                );
              }),

              monthParts.some((p) => p.assigneeType === "outsource") && React.createElement("div", null,
                React.createElement(SectionLabel, null, "外注 サマリー"),
                React.createElement("button", { style: Object.assign({}, st.monthlyCard, { width: "100%", border: "none", textAlign: "left", cursor: "pointer", display: "block" }), onClick: () => set({ screen: "team_month", teamMonthTeam: "__outsource__", teamMonthMonth: sm }) },
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
                    React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "🏢 外注品番を見る"),
                    React.createElement("span", { style: { fontSize: 11, color: "#3b6fd4" } }, "一覧 ›")
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
          React.createElement("button", { style: Object.assign({}, st.quickBtn, { background: "#1a1a1a", color: "#fff" }), onClick: downloadCSV }, "📥 CSVダウンロード"),
          React.createElement("button", { style: Object.assign({}, st.quickBtn, { background: "#2a7a2a", color: "#fff" }), onClick: exportToSheet }, "📊 スプレッドシートに出力")
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
                React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "#3b6fd4" : "#aaa", padding: "4px 0" } }, d)
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
                    background: isToday ? "#1a1a1a" : hasWork ? "#f0f4ff" : "#fafafa",
                    border: isToday ? "none" : hasWork ? "1px solid #c8d8ff" : "1px solid #f0eeea",
                    cursor: hasWork ? "pointer" : "default",
                  },
                  onClick: () => hasWork && set({ calSelectedDate: dateStr })
                },
                  React.createElement("div", { style: { textAlign: "center", fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? "#fff" : dow === 0 ? "#c00" : dow === 6 ? "#3b6fd4" : "#555", marginBottom: 2 } }, d),
                  hasWork && React.createElement("div", { style: { textAlign: "center" } },
                    React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: isToday ? "#7df" : "#3b6fd4" } }, dayHours.toFixed(1) + "h"),
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
                    React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: "#3b6fd4" } }, r.hours + "h")
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

              React.createElement("div", { style: { background: "#1a1a1a", color: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 12 } },
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
                  list.map((p) => React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left", marginBottom: 8, borderLeft: "3px solid " + (p.closedAt ? "#2a7a2a" : (p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "#c25000" : "#e0deda")) }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "vendor_detail" }) },
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

              React.createElement("div", { style: { background: "#1a1a1a", color: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 12 } },
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
                  p.workMonth && React.createElement("div", { style: { fontSize: 11, color: "#3b6fd4", marginTop: 2 } }, p.workMonth.replace("-", "年") + "月仕掛り")
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
                  p.workMonth && React.createElement("div", { style: { fontSize: 11, color: "#3b6fd4", marginTop: 2 } }, p.workMonth.replace("-", "年") + "月仕掛り")
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
      style: Object.assign({}, st.summaryCard, { textAlign: "left", opacity: p.closedAt ? 0.75 : 1, borderLeft: "3px solid " + (p.closedAt ? "#2a7a2a" : (p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "#c25000" : "#e0deda")) }),
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
            React.createElement(ProgressBar, { value: p.qtyProgress, color: p.remainQty === 0 ? "#2a7a2a" : "#3b6fd4" })
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

        React.createElement("div", { style: { background: "#1a1a1a", color: "#fff", borderRadius: 12, padding: "16px 18px", marginBottom: 12 } },
          React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, (sTeam === "all" ? "社内全体" : sTeam) + "　" + month + "月の完成売上"),
          React.createElement("div", { style: { fontSize: 28, fontWeight: 700 } }, "¥" + Math.round(monthSales).toLocaleString()),
          React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 4 } }, "完成 " + monthQty.toLocaleString() + "枚")
        ),

        React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: "10px", boxShadow: "0 1px 4px rgba(0,0,0,.06)", marginBottom: 16 } },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 } },
            ["日","月","火","水","木","金","土"].map((d, i) =>
              React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "#3b6fd4" : "#aaa", padding: "4px 0" } }, d)
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
                React.createElement("div", { style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: dow === 0 ? "#c00" : dow === 6 ? "#3b6fd4" : "#555" } }, d),
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
              React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "#3b6fd4" : "#aaa", padding: "4px 0" } }, d)
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
                React.createElement("div", { style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: dow === 0 ? "#c00" : dow === 6 ? "#3b6fd4" : "#555", marginBottom: 2 } }, d),
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
            style: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (ui.koteiPartsDrag === i ? "#0f3d4a" : "#d9d5c8"), borderRadius: 16, padding: "6px 6px 6px 8px", fontSize: 13, cursor: "grab", background: ui.koteiPartsDrag === i ? "#eef3f4" : "#fff" }
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
            style: { display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid " + (ui.koteiDrag === i ? "#0f3d4a" : "#d9d5c8"), borderRadius: 16, padding: "6px 6px 6px 8px", fontSize: 13, cursor: "grab", background: ui.koteiDrag === i ? "#eef3f4" : "#fff" }
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
        React.createElement("button", { style: { width: "100%", border: "1px solid #0f3d4a", background: "#eef3f4", color: "#0f3d4a", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 700, marginBottom: 8 }, onClick: () => set({ screen: "kotei_phrases" }) }, "⚙ 作業候補（アイロン・ミシン・その他）を編集"),
        React.createElement("button", { style: { width: "100%", border: "1px solid #0f3d4a", background: "#eef3f4", color: "#0f3d4a", borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 700, marginBottom: 12 }, onClick: () => set({ screen: "kotei_parts" }) }, "⚙ パーツ名を編集"),
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
                React.createElement("div", { style: { fontWeight: 700, color: "#1558d6", fontSize: 15 } }, fmtKoteiTime(o.sheet.totalSec || 0)),
                React.createElement("div", { style: { marginTop: 2 } }, steps + "工程" + (figs ? " ・ 図" + figs : ""))
              )
            )
          );
        })
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "kotei_edit" && ui.koteiPartId) {
    const part = data.parts.find((p) => p.id === ui.koteiPartId);
    if (!part) { return null; }
    const sheet = (data.koteiSheets || []).find((r) => r.partId === part.id) || null;
    const brandName = ((data.brands || []).find((b) => b.id === part.brandId) || {}).name || "";
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
function Header(p) { return React.createElement("div", { style: st.header }, p.back && React.createElement("button", { style: st.backBtn, onClick: p.back }, "‹ 戻る"), p.sub && React.createElement("div", { style: { fontSize: 10, letterSpacing: "0.2em", color: "#555", marginBottom: 2 } }, p.sub), React.createElement("div", { style: st.headerTitle }, p.title)); }
function Body(p) { return React.createElement("div", { style: st.body }, p.children); }
function Spacer(p) { return React.createElement("div", { style: { height: p.h || 8 } }); }
function Divider(p) { return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" } }, React.createElement("div", { style: { flex: 1, height: 1, background: "#e0deda" } }), React.createElement("span", { style: { fontSize: 11, color: "#bbb" } }, p.label), React.createElement("div", { style: { flex: 1, height: 1, background: "#e0deda" } })); }
function BigBtn(p) { return React.createElement("button", { style: st.bigBtn, onClick: p.onClick }, React.createElement("span", { style: { fontSize: 22 } }, p.icon), React.createElement("div", { style: { textAlign: "left" } }, React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, p.label), React.createElement("div", { style: { fontSize: 11, color: "#999", marginTop: 2 } }, p.sub))); }
function RoleBtn(p) { return React.createElement("button", { style: st.roleBtn, onClick: p.onClick }, React.createElement("span", { style: { fontSize: 16 } }, p.icon), React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, p.label)); }
function QuickBtn(p) { return React.createElement("button", { style: st.quickBtn, onClick: p.onClick }, p.label); }
function TeamBadge(p) { const c = TEAM_COLORS[p.team] || "#888"; return React.createElement("span", { style: { background: c + "18", color: c, fontSize: p.small ? 11 : 13, padding: p.small ? "2px 8px" : "4px 12px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44", display: "inline-block" } }, p.team); }
function AssigneeBadge(p) {
  const part = p.part; const vendors = p.vendors;
  if (!part.assignee || part.assignee === "未割当") return React.createElement("span", { style: { background: "#f0f0f0", color: "#aaa", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, "未割当");
  if (part.assigneeType === "outsource") { const v = vendors.find((v) => v.id === part.assignee); return React.createElement("span", { style: { background: "#88888818", color: "#555", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid #88888844" } }, "外注: " + (v ? v.name : "?")); }
  const c = TEAM_COLORS[part.assignee] || "#888";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44" } }, part.assignee);
}
function StatusBadge(p) { const colors = { "未着手": "#aaa", "裁断済み": "#c25000", "仕掛り中": "#7a2a7a", "完了": "#2a7a2a" }; const c = colors[p.status] || "#aaa"; return React.createElement("span", { style: { background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44" } }, p.status); }
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
function ProgressBar(p) { const pct = Math.min(Math.max(p.value || 0, 0), 1) * 100; const c = p.color || (pct >= 100 ? "#2a7a2a" : "#3b6fd4"); return React.createElement("div", { style: st.barBg }, React.createElement("div", { style: Object.assign({}, st.barFill, { width: pct + "%", background: c }) })); }
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
      React.createElement(ProgressBar, { value: part.qtyProgress, color: part.remainQty === 0 ? "#2a7a2a" : "#3b6fd4" })
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

const st = {
  root: { fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", background: "#f5f4f0", minHeight: "100vh", maxWidth: 680, width: "100%", margin: "0 auto", paddingBottom: 48, overflowX: "hidden", boxSizing: "border-box" },
  header: { background: "#1a1a1a", color: "#fff", padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 },
  headerTitle: { fontSize: 18, fontWeight: 700 },
  backBtn: { background: "none", border: "none", color: "#777", fontSize: 14, padding: "0 0 4px", cursor: "pointer", display: "block" },
  body: { padding: "16px", maxWidth: 680, width: "100%", margin: "0 auto", boxSizing: "border-box" },
  bigBtn: { display: "flex", alignItems: "center", gap: 16, width: "100%", background: "#1a1a1a", color: "#fff", border: "1px solid transparent", borderRadius: 12, padding: "16px 20px", cursor: "pointer", marginBottom: 0 },
  roleBtn: { display: "flex", alignItems: "center", gap: 8, flex: 1, background: "#fff", border: "1px solid #e0deda", borderRadius: 10, padding: "12px 14px", cursor: "pointer", justifyContent: "center" },
  quickBtn: { flex: 1, background: "#fff", border: "1px solid #e0deda", borderRadius: 10, padding: "10px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#333" },
  editBtn: { background: "#f5f4f0", border: "1px solid #e0deda", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#555", fontWeight: 600, whiteSpace: "nowrap" },
  dashedBtn: { display: "block", width: "100%", background: "#fff", border: "2px dashed #d0cec8", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, color: "#555", cursor: "pointer", marginBottom: 16 },
  card: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  sectionLabel: { fontSize: 11, color: "#aaa", letterSpacing: "0.1em", marginBottom: 8, marginTop: 16 },
  empty: { textAlign: "center", color: "#ccc", fontSize: 13, padding: "18px 0" },
  input: { width: "100%", maxWidth: "100%", minWidth: 0, background: "#f5f4f0", border: "1px solid #e8e6e0", borderRadius: 8, padding: "10px 12px", fontSize: 15, boxSizing: "border-box", outline: "none", color: "#1a1a1a", WebkitAppearance: "none", appearance: "none", display: "block" },
  primaryBtn: { width: "100%", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  inlineBtn: { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  ghostBtn: { background: "none", border: "1px solid #e0deda", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#666" },
  assignBtn: { background: "#fff", border: "1px solid #e0deda", borderRadius: 20, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "#666" },
  assignBtnActive: { background: "#1a1a1a", color: "#fff", border: "1px solid #1a1a1a" },
  filterRow: { display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" },
  filterBtn: { background: "#fff", border: "1px solid #e0deda", borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "#888" },
  filterBtnActive: { background: "#1a1a1a", color: "#fff", border: "1px solid #1a1a1a" },
  previewBox: { borderRadius: 8, padding: "12px 14px", marginBottom: 12 },
  previewRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555", marginBottom: 4 },
  leaderCard: { background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  partNoText: { fontSize: 16, fontWeight: 700 },
  partMeta: { fontSize: 11, color: "#bbb", marginTop: 2 },
  cellLabel: { fontSize: 10, color: "#aaa", marginBottom: 2 },
  detailLink: { background: "none", border: "none", color: "#aaa", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  statsRow: { display: "flex", gap: 10, fontSize: 13, color: "#555", borderRadius: 8, padding: "8px 12px", marginBottom: 10 },
  closeBtn: { width: "100%", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  recRow: { background: "#fff", borderRadius: 10, padding: "11px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,.04)" },
  memberRow: { background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 1px 3px rgba(0,0,0,.04)" },
  deleteBtn: { background: "none", border: "none", color: "#ccc", fontSize: 16, cursor: "pointer", padding: "4px 8px" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
  sBox: { borderRadius: 12, padding: "14px", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  summaryCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  monthlyCard: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  rateBox: { borderRadius: 14, padding: "18px 20px", marginBottom: 16 },
  barBg: { background: "#f0eeea", borderRadius: 4, height: 6, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4, transition: "width 0.4s" },
  saveBadge: { background: "#1a1a1a", color: "#fff", fontSize: 12, padding: "8px 14px", borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,.2)", marginBottom: 8 },
  spinner: { width: 32, height: 32, border: "3px solid #e0deda", borderTop: "3px solid #1a1a1a", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  alertBanner: { fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8, border: "1px solid", marginBottom: 8, marginTop: 8 },
  dashCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
};

const styleEl = document.createElement("style");
styleEl.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(styleEl);


// ===================== 工程分析表（KoteiEditor） =====================
const KOTEI_PARTS = ["芯","甲止め","伸止め","準備","裏身頃","前身頃","表身頃","身頃","肩ひも","ヨーク","衿","衿吊り","カフス","袖","表袖","裏袖","袖リブ","ポケット","内ポケット","ポケットフラップ","フリル","前端フリル","袖裾フリル","ペプラム","スカート","ベルト","見返し","組立","まとめ","その他"];
const KOTEI_PHRASE_CATS = {
  "アイロン": ["割りアイロン","方倒しアイロン","キセアイロン","キセ","高アイロン","上高アイロン","中心高アイロン","後高アイロン","後高0.5cmキセアイロン","裾アイロン","返しアイロン","ケンボロアイロン"],
  "ミシン": ["脇はぎ","見返し脇はぎ","後中心はぎ","見返しとはぎ","身頃とスカートはぎ","CB見返しはぎ","2枚はぎ","3枚はぎ","外袖と内袖はぎ","つなぎ合わせ","ロック","イッテコイロック","見返しロック","下側ロック始末","中ぬい","本ぬい","周りぬい","袋ぬい","外表でぬい","仮どめ","タックとめ","ゴムとめ","釦とめ","三角どめ","ぬいどめ","三巻き","裾三巻き","スリット三巻り","コバST","裏コバST","ステッチ","シャーリング位置ぬい"],
  "その他": ["糸始末","たたきつけ","ギャザー入れ","ホールあけ","ホール印","ネーム付け","ブランドネームたたきつけ","センタクネーム仮どめ","矢羽に切り込み","ケバカット","パイピング","ケンボロ口折り","ケンボロ付け","伸止め貼り","芯貼り","口布折り"]
};
const K_INK = "#1a1a1a", K_TIME = "#1558d6", K_NOTE = "#c0271d", K_PART = "#0f3d4a", K_PARTBG = "#e4ecef", K_LINE = "#d9d5c8";

function parseKoteiTime(s) {
  if (!s) return 0; s = ("" + s).trim();
  if (s.indexOf(":") >= 0) { const a = s.split(":"); return (parseInt(a[0] || 0, 10) * 60) + (parseInt(a[1] || 0, 10)); }
  return parseInt(s, 10) || 0;
}
function fmtKoteiTime(sec) { sec = Math.round(sec || 0); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
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

  function patchBlock(id, patch) { setBlocks(function (bs) { return bs.map(function (b) { return b.id === id ? Object.assign({}, b, patch) : b; }); }); }
  function addStep() { setBlocks(function (bs) { return bs.concat([{ id: genId(), type: "step", part: "", act: "", time: "", note: "" }]); }); }
  function addSketch() { setBlocks(function (bs) { return bs.concat([{ id: genId(), type: "sketch", img: "", caption: "", size: "s" }]); }); }
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
        React.createElement("span", { style: { fontSize: 11, color: "#999" } }, "色 × サイズ別 枚数"),
        React.createElement("div", { style: { display: "flex", gap: 6 } },
          React.createElement("button", { style: { border: "1px solid " + K_LINE, background: "#fff", borderRadius: 6, padding: "4px 9px", fontSize: 12, color: "#555" }, onClick: addColor }, "＋色"),
          React.createElement("button", { style: { border: "1px solid " + K_LINE, background: "#fff", borderRadius: 6, padding: "4px 9px", fontSize: 12, color: "#555" }, onClick: addSize }, "＋サイズ")
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
              React.createElement("th", { style: Object.assign({}, cell, { background: "#f5f4f0", padding: "6px 8px" }) }, "計"),
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
                React.createElement("td", { style: Object.assign({}, cell, { background: "#f5f4f0", fontWeight: 700, padding: "0 8px" }) }, rowTotal || ""),
                React.createElement("td", { style: cell }, colors.length > 1 && React.createElement("button", { style: { border: "none", background: "none", color: K_NOTE, fontSize: 14, cursor: "pointer", padding: "0 4px" }, onClick: function () { removeColor(ci); } }, "✕"))
              );
            }),
            React.createElement("tr", null,
              React.createElement("td", { style: Object.assign({}, cell, { background: "#e8e6e0", fontWeight: 700, padding: "6px 8px" }) }, "合計"),
              React.createElement("td", { style: Object.assign({}, cell, { background: "#e8e6e0" }) }, ""),
              colTotals.map(function (n, i) { return React.createElement("td", { key: i, style: Object.assign({}, cell, { background: "#e8e6e0", fontWeight: 700 }) }, n || ""); }),
              React.createElement("td", { style: Object.assign({}, cell, { background: "#1a1a1a", color: "#fff", fontWeight: 700, padding: "0 8px" }) }, grandQty || ""),
              React.createElement("td", { style: Object.assign({}, cell, { background: "#e8e6e0" }) }, "")
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

  function handleSave() {
    const rec = { id: (sheet && sheet.id) || genId(), partId: part.id, needle: needle, unten: unten, thread: thread, headNote: headNote, targetPerDay: targetPerDay, workMin: workMin, sizes: sizes, colors: colors, blocks: blocks, totalSec: summary.tot, designImgId: designImgId, updatedAt: today() };
    props.onSave(rec); props.back();
  }

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
    let figSeq = 0; const figNoMap = {}; const stepNoMap = {}; let lastStepId = null;
    let stepSeq = 0; const stepSeqMap = {};
    blocks.forEach(function (b) {
      if (b.type === "step") { lastStepId = b.id; stepSeq++; stepSeqMap[b.id] = stepSeq; }
      else if (b.type === "sketch" && (b.imgId || b.img)) { figSeq++; figNoMap[b.id] = figSeq; if (lastStepId) { if (!stepNoMap[lastStepId]) stepNoMap[lastStepId] = []; stepNoMap[lastStepId].push(figSeq); } }
    });
    let proc = "";
    groups.forEach(function (grp) {
      let txt = '<div class="phead"><span class="pname">' + esc(grp.part || "—") + '</span><span class="psum">' + fmtKoteiTime(grp.sec) + '</span>' + (grp.memo ? '<span class="pmemo">' + esc(grp.memo) + '</span>' : '') + '</div>';
      let fig = "";
      grp.items.forEach(function (b) {
        if (b.type === "step") {
          const sn = stepNoMap[b.id] ? ' <span class="stepno">' + stepNoMap[b.id].map(circNum).join("") + '</span>' : '';
          txt += '<div class="prow"><span class="time">' + esc(b.time || "") + '</span><span class="act">' + '(' + stepSeqMap[b.id] + ') ' + esc(b.act || "") + sn + '</span></div>';
          if (b.note) txt += '<div class="note">⚠ ' + esc(b.note) + '</div>';
        } else {
          const src = b.imgId ? imgMap[b.imgId] : b.img;
          if (src) fig += '<div class="figitem">' + (figNoMap[b.id] ? '<div class="fnofig">' + circNum(figNoMap[b.id]) + '</div>' : '') + (b.caption ? '<div class="cap">' + esc(b.caption) + '</div>' : '') + '<img src="' + src + '"></div>';
        }
      });
      proc += '<div class="pgroup"><div class="ptext">' + txt + '</div>' + (fig ? '<div class="pfig">' + fig + '</div>' : '') + '</div>';
    });
    const bodyHtml = '<div class="proc">' + proc + '</div>';
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
      '.proc{column-count:2;column-gap:5mm;column-fill:auto;height:auto}.pgroup{break-inside:avoid;margin-bottom:1.5mm;display:flex;gap:2mm;align-items:flex-start}.ptext{flex:1;min-width:0}.pfig{flex:none;width:26mm;display:flex;flex-direction:column;gap:1mm}' +
      '.phead{font-weight:700;color:#0f3d4a;background:#e4ecef;padding:0.5mm 1.5mm;font-size:9pt;margin:0 0 0.5mm;display:flex;gap:2mm;align-items:center}.phead .fno{color:#1558d6;font-weight:700;flex:none}.phead .pname{flex:none}.phead .psum{color:#1f7a4d;font-size:8.5pt;font-weight:700;border:1px solid #1f7a4d;padding:0 1.5mm;background:#fff;flex:none}.phead .pmemo{color:#333;font-size:8pt;font-weight:400;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stepno{color:#6a3d9a;border:0.35mm solid #6a3d9a;border-radius:1.2mm;font-weight:700;font-size:8.5pt;padding:0 1mm;background:#efe8f7}.fnofig{color:#6a3d9a;border:0.45mm solid #6a3d9a;border-radius:1.2mm;font-weight:700;font-size:10pt;text-align:center;margin-bottom:0.5mm;padding:0 1.4mm;display:inline-block;background:#efe8f7}' +
      '.prow{display:flex;gap:2mm;font-size:8.5pt;padding:0.2mm 0;align-items:baseline}.prow .time{color:#1558d6;font-weight:700;width:11mm;flex:none;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.prow .act{flex:1}' +
      '.note{color:#c0271d;font-size:7.5pt;padding:0 0 0.4mm 13mm}' +
      '.figitem .cap{font-size:7pt;color:#666;margin-bottom:0.2mm}.figitem img{display:block;width:100%}' +
      '.design{float:right;width:36mm;margin:0 0 2mm 4mm;border:1px solid #bbb;border-radius:1mm;overflow:hidden}.design img{display:block;width:100%}' +
      '.qtywrap{display:flex;gap:4mm;align-items:flex-start;overflow:hidden;margin-bottom:3mm}' +
      '.hnote{flex:1;border:1px solid #ccc;border-radius:1mm;padding:2mm 3mm;font-size:8.5pt;line-height:1.4;min-width:0;font-weight:700;color:#c0271d}.hnote .ht{font-size:8pt;color:#888;margin-bottom:1mm;font-weight:700}' +
      '.footer{margin-top:4mm;border-top:1px solid #ddd;padding-top:1.5mm;font-size:8pt;color:#888;display:flex;justify-content:space-between}' +
      '@media print{body{padding:6mm 8mm}}' +
      '</style></head><body>' + designHtml +
      '<div class="head"><span class="big">' + esc(part.partNo || "") + '</span>' +
      (part.partName ? '<span class="m">' + esc(part.partName) + '</span>' : '') +
      (props.brandName ? '<span class="m">🏷 ' + esc(props.brandName) + '</span>' : '') +
      '<span class="tt">1着 ' + fmtKoteiTime(summary.tot) + '</span>' +
      (targetPerDay ? '<span class="m">1日目標 ' + esc(targetPerDay) + '着</span>' : '') +
      (unten ? '<span class="m">運針(3c間) ' + esc(unten) + '</span>' : '') +
      (thread ? '<span class="m">糸番手 ' + esc(thread) + '</span>' : '') +
      '</div>' + '<div class="qtywrap">' + tbl + commentHtml + '</div>' + '<div style="clear:both"></div>' + bodyHtml +
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
  function pDown(e) { if (!allowDraw(e)) return; const d = draw.current; d.drawing = true; const r = e.currentTarget.getBoundingClientRect(); d.last = { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function pMove(e) {
    const d = draw.current; if (!d.drawing || !allowDraw(e) || !d.ctx) return;
    const r = e.currentTarget.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const ctx = d.ctx;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (d.erase) { ctx.globalCompositeOperation = "destination-out"; ctx.lineWidth = 26; }
    else { ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = d.color; ctx.lineWidth = 1.6 + ((e.pressure || 0.5) * 4); }
    ctx.beginPath(); ctx.moveTo(d.last.x, d.last.y); ctx.lineTo(x, y); ctx.stroke(); d.last = { x: x, y: y };
  }
  function pUp() { draw.current.drawing = false; }
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
    rd.onload = function () { const im = new Image(); im.onload = function () { const cv = canvasRef.current, ctx = draw.current.ctx; if (!cv || !ctx) return; const w = cv.clientWidth, h = cv.clientHeight, r = Math.min(w / im.width, h / im.height); const dw = im.width * r, dh = im.height * r; ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh); }; im.src = rd.result; };
    rd.readAsDataURL(f);
  }
  function startVoice(id) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { window.alert("この端末・ブラウザは音声入力に対応していません（iPadのSafariは非対応です）"); return; }
    const rec = new SR(); rec.lang = "ja-JP"; rec.interimResults = false; setRecId(id);
    rec.onresult = function (ev) { const t = ev.results[0][0].transcript; const cur = (blocks.find(function (b) { return b.id === id; }) || {}).act || ""; patchBlock(id, { act: cur ? cur + " " + t : t }); learn(t); };
    rec.onerror = function () {}; rec.onend = function () { setRecId(null); };
    rec.start();
  }

  const sz = { s: { w: "140px", h: "96px" }, m: { w: "230px", h: "150px" }, l: { w: "100%", h: "240px" } };

  const koteiStepNo = {}; (function () { let n = 0; blocks.forEach(function (b) { if (b.type === "step") { n++; koteiStepNo[b.id] = n; } }); })();

  function renderStep(b) {
    const cats = Object.keys(props.phraseCats || {}); if (histPhrases.length) cats.push("履歴");
    const baseList = suggCat === "履歴" ? histPhrases : ((props.phraseCats || {})[suggCat] || []);
    const tokA = lastKoteiToken(b.act);
    const tokenList = (tokA ? baseList.filter(function (p) { return p.indexOf(tokA) >= 0 && p !== tokA; }) : baseList).slice(0, 14);
    return React.createElement("div", { key: b.id, style: { position: "relative", borderBottom: "1px solid " + K_LINE, padding: "10px 0 12px" } },
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "108px 1fr 78px", gap: 8, paddingRight: 76 } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, React.createElement("span", { style: { color: K_PART, fontWeight: 700, fontSize: 13 } }, koteiParenNum(koteiStepNo[b.id])), " パーツ"),
          React.createElement("select", { style: { width: "100%", height: 42, border: "1px solid " + K_LINE, borderRadius: 8, background: K_PARTBG, color: K_PART, fontWeight: 700, fontSize: 14, padding: "0 6px" }, value: b.part, onChange: function (e) { const v = e.target.value; if (v === "__new__") { const nv = window.prompt("新しいパーツ名を入力"); if (nv && nv.trim()) patchBlock(b.id, { part: nv.trim() }); } else { patchBlock(b.id, { part: v }); } } },
            React.createElement("option", { value: "" }, "—"),
            (function () { let list = (props.partList || KOTEI_PARTS).concat(props.extraParts || []); if (b.part && list.indexOf(b.part) < 0) list = list.concat([b.part]); return list; })().map(function (p) { return React.createElement("option", { key: p, value: p }, p); }),
            React.createElement("option", { value: "__new__" }, "＋ 新しいパーツ…")
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, "作業内容"),
          React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "flex-start" } },
            React.createElement("textarea", { style: { flex: 1, minHeight: 42, border: "1px solid " + K_LINE, borderRadius: 8, padding: 9, fontSize: 15, color: K_INK, resize: "vertical", lineHeight: 1.35, fontFamily: "inherit", boxSizing: "border-box" }, placeholder: "手打ち / 下の定型句 / 🎤", value: b.act, onFocus: function () { setActiveSugg(b.id); }, onBlur: function () { learn(b.act); setTimeout(function () { setActiveSugg(function (s) { return s === b.id ? null : s; }); }, 200); }, onChange: function (e) { patchBlock(b.id, { act: e.target.value }); } }),
            React.createElement("button", { style: { width: 42, height: 42, border: "1px solid " + K_LINE, borderRadius: 8, background: recId === b.id ? K_NOTE : "#fff", color: recId === b.id ? "#fff" : "#333", fontSize: 18, flex: "none" }, onClick: function () { startVoice(b.id); } }, "🎤")
          ),
          activeSugg === b.id && React.createElement("div", { style: { marginTop: 6 } },
            React.createElement("div", { style: { display: "flex", gap: 5, marginBottom: 6, flexWrap: "wrap" } },
              cats.map(function (c) {
                return React.createElement("button", { key: c, style: { border: "1px solid " + (suggCat === c ? K_PART : K_LINE), background: suggCat === c ? K_PART : "#fff", color: suggCat === c ? "#fff" : "#555", borderRadius: 12, padding: "4px 12px", fontSize: 12, fontWeight: 700 }, onMouseDown: function (e) { e.preventDefault(); setSuggCat(c); } }, c);
              })
            ),
            tokenList.length > 0 && React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 5 } },
              tokenList.map(function (p) {
                return React.createElement("button", { key: p, style: { border: "1px solid " + K_PART, background: "#eef3f4", color: K_PART, borderRadius: 14, padding: "5px 10px", fontSize: 12 }, onMouseDown: function (e) { e.preventDefault(); const v = b.act || ""; let nv; if (v === "" || /[\s、・\n]$/.test(v)) { nv = v + p; } else { const tk = lastKoteiToken(v); nv = v.slice(0, v.length - tk.length) + p; } patchBlock(b.id, { act: nv }); } }, p);
              })
            )
          )
        ),
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, "時間"),
          React.createElement("input", { style: { width: "100%", height: 42, border: "1px solid " + K_LINE, borderRadius: 8, textAlign: "center", fontSize: 16, color: K_TIME, fontWeight: 700, boxSizing: "border-box" }, inputMode: "numeric", placeholder: "2:10", value: b.time, onChange: function (e) { patchBlock(b.id, { time: e.target.value }); }, onBlur: function () { const s = parseKoteiTime(b.time); if (s) patchBlock(b.id, { time: fmtKoteiTime(s) }); } })
        )
      ),
      React.createElement("div", { style: { marginTop: 8, paddingRight: 76 } },
        React.createElement("input", { style: { width: "100%", height: 38, border: "1px dashed " + K_NOTE, borderRadius: 8, padding: "0 9px", fontSize: 13, color: K_NOTE, background: "#fffafa", boxSizing: "border-box" }, placeholder: "注意点（赤）", value: b.note, onChange: function (e) { patchBlock(b.id, { note: e.target.value }); } })
      ),
      b.part && React.createElement("div", { style: { marginTop: 6, paddingRight: 76 } },
        React.createElement("input", { style: { width: "100%", height: 36, border: "1px solid " + K_LINE, borderRadius: 8, padding: "0 9px", fontSize: 12, color: "#555", boxSizing: "border-box" }, placeholder: "📝 パーツのメモ（印刷でパーツ名の横に出ます）", value: b.gmemo || "", onChange: function (e) { patchBlock(b.id, { gmemo: e.target.value }); } })
      ),
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
        React.createElement("span", { style: { position: "absolute", right: 6, bottom: 5, background: "rgba(15,61,74,.85)", color: "#fff", fontSize: 10, padding: "2px 7px", borderRadius: 10 } }, "編集")
      ),
      React.createElement("input", { style: { width: "100%", border: "none", borderBottom: "1px solid " + K_LINE, background: "transparent", padding: "6px 2px", fontSize: 13, color: "#555", marginTop: 8, boxSizing: "border-box" }, placeholder: "図の説明（任意）", value: b.caption, onChange: function (e) { patchBlock(b.id, { caption: e.target.value }); } }),
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
  const mvBtn = { width: 30, height: 30, border: "1px solid " + K_LINE, background: "#fff", borderRadius: 7, fontSize: 14, color: "#555" };

  function renderSummary() {
    const tot = summary.tot, map = summary.map;
    const rows = Object.keys(map).map(function (p) { const o = map[p]; const pct = tot ? Math.round(o.s / tot * 100) : 0; return { p: p, n: o.n, s: o.s, pct: pct }; });
    return React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: 14, marginTop: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
        React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "集計"),
        React.createElement("span", { style: { fontSize: 13 } }, "1着 総工数 ", React.createElement("b", { style: { fontSize: 20, color: K_TIME } }, fmtKoteiTime(tot)))
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
  const thKotei = { border: "1px solid #eee", padding: "6px 8px", background: K_PARTBG, color: K_PART, textAlign: "center" };
  const tdKotei = { border: "1px solid #eee", padding: "6px 8px", textAlign: "center" };

  function renderModal() {
    const penBtn = function (c, label) { return React.createElement("button", { style: { width: 30, height: 30, borderRadius: "50%", border: "2px solid #fff", boxShadow: "0 0 0 1px " + K_LINE + (((tool === "ink" && c === K_INK) || (tool === "time" && c === K_TIME) || (tool === "note" && c === K_NOTE)) ? ",0 0 0 3px " + K_PART : ""), background: c, padding: 0 }, onClick: function () { pickTool(c === K_TIME ? "time" : c === K_NOTE ? "note" : "ink"); }, title: label }); };
    return React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 100, background: "rgba(20,20,20,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 } },
      React.createElement("div", { style: { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 760, padding: 12 } },
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 } },
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

  return React.createElement(Shell, null,
    React.createElement(Header, { title: "📐 工程分析表", back: props.back }),
    React.createElement(Body, null,
      React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: "12px 16px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)" } },
        React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" } },
          React.createElement("div", { style: { flex: 1, minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, part.partNo + (part.partName ? "　" + part.partName : "")),
            props.brandName && React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, "🏷 " + props.brandName),
            React.createElement("div", { style: { display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" } },
              React.createElement("div", null, React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, "1着 総工数（自動）"), React.createElement("div", { style: { fontSize: 20, fontWeight: 700, color: K_TIME, lineHeight: "38px" } }, fmtKoteiTime(summary.tot))),
              React.createElement("div", null, React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, "1日の目標枚数"), React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4 } },
                React.createElement("input", { style: { width: 80, border: "1px solid " + K_LINE, borderRadius: 8, padding: "8px 9px", fontSize: 14, textAlign: "center" }, placeholder: "12〜15", value: targetPerDay, onChange: function (e) { setTargetPerDay(e.target.value); } }),
                React.createElement("span", { style: { fontSize: 13, color: "#888" } }, "着")
              )),
              React.createElement("div", null, React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, "運針(3c間)"), React.createElement("input", { style: { width: 90, border: "1px solid " + K_LINE, borderRadius: 8, padding: "8px 9px", fontSize: 14 }, placeholder: "例: 12針", value: unten, onChange: function (e) { setUnten(e.target.value); } })),
              React.createElement("div", null, React.createElement("div", { style: { fontSize: 10, color: "#999", marginBottom: 3 } }, "糸番手"), React.createElement("input", { style: { width: 90, border: "1px solid " + K_LINE, borderRadius: 8, padding: "8px 9px", fontSize: 14 }, placeholder: "例: #50", value: thread, onChange: function (e) { setThread(e.target.value); } }))
            )
          ),
          React.createElement("button", { style: { flex: "none", width: 92, height: 122, border: "1px dashed " + K_LINE, borderRadius: 8, background: designImgId && imgData[designImgId] ? "#fff" : "#f5f4f0", padding: 0, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }, onClick: function () { setDesignOpen(true); } },
            (designImgId && imgData[designImgId])
              ? React.createElement("img", { src: imgData[designImgId], style: { width: "100%", height: "100%", objectFit: "cover" } })
              : React.createElement("div", { style: { fontSize: 11, color: "#999", textAlign: "center", lineHeight: 1.5 } }, "＋\nデザイン画"),
            React.createElement("span", { style: { position: "absolute", right: 4, bottom: 4, background: "rgba(15,61,74,.85)", color: "#fff", fontSize: 9, padding: "1px 6px", borderRadius: 8 } }, designImgId ? "変更" : "追加")
          )
        ),
        React.createElement("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start", marginTop: 4 } },
          React.createElement("div", { style: { flex: "1 1 auto", minWidth: 0 } }, renderQtyTable()),
          React.createElement("div", { style: { flex: "1 1 200px", minWidth: 180 } },
            React.createElement("div", { style: { fontSize: 11, color: "#999", marginBottom: 4 } }, "全体の注意事項・コメント"),
            React.createElement("textarea", { style: { width: "100%", minHeight: 96, border: "1px solid " + K_LINE, borderRadius: 8, padding: 9, fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", lineHeight: 1.5, fontWeight: 700, color: K_NOTE }, placeholder: "全体への注意点・申し送りなど", value: headNote, onChange: function (e) { setHeadNote(e.target.value); } })
          )
        )
      ),
      React.createElement("div", { style: { background: "#fbfaf6", borderRadius: 10, padding: "4px 12px", boxShadow: "0 1px 4px rgba(0,0,0,.06)" } },
        blocks.map(function (b) { return b.type === "step" ? renderStep(b) : renderSketch(b); })
      ),
      React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 12 } },
        React.createElement("button", { style: addBtn, onClick: addStep }, "＋ 工程を追加"),
        React.createElement("button", { style: addBtn, onClick: addSketch }, "＋ 図・写真")
      ),
      renderSummary(),
      React.createElement("button", { style: { width: "100%", background: K_PART, color: "#fff", border: "none", borderRadius: 8, padding: 14, fontSize: 15, fontWeight: 700, marginTop: 16 }, onClick: handleSave }, "保存する"),
      React.createElement("button", { style: { width: "100%", background: "#14555a", color: "#fff", border: "none", borderRadius: 8, padding: 13, fontSize: 14, fontWeight: 700, marginTop: 8 }, onClick: function () { if (!uploading) doPrint(); } }, uploading ? "図を準備中…" : "🖨 A4印刷 / PDF保存"),
      (sheet && sheet.id) && React.createElement("button", { style: { width: "100%", background: "#fff0f0", color: "#c00", border: "none", borderRadius: 8, padding: 12, fontSize: 13, fontWeight: 700, marginTop: 8 }, onClick: function () { if (window.confirm("この工程表を削除しますか？")) { props.onDelete(sheet.id); props.back(); } } }, "削除する")
    ),
    modalId != null && renderModal(),
    designOpen && renderDesignModal(),
    React.createElement(props.SI)
  );
}
const addBtn = { flex: 1, border: "2px dashed " + K_PART, background: "#fff", color: K_PART, borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 700 };
