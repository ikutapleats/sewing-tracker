
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
  parts: [], records: [], qtyRecords: [], members: [], vendors: [], brands: [], monthlyTargets: {}, saidanReports: [],
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
  activeMemberId: null,
  calMonth: null,
  calSelectedDate: null,
  saidanPartId: null,
  saidanForm: null,
  dlMonth: null,
  dlSelectedDate: null,
  teamMonthTeam: null,
  teamMonthMonth: null,
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

async function gasLoad() {
  const res = await fetch(GAS_URL);
  return await res.json();
}

function App() {
  const [data, setData] = useState(EMPTY_DATA);
  const [ui, setUi] = useState(INIT_UI);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const saveQueue = useRef(null);

  const set = (patch) => setUi((p) => Object.assign({}, p, patch));
  const setAP = (patch) => setUi((p) => Object.assign({}, p, { addPartForm: Object.assign({}, p.addPartForm, patch) }));
  const setEP = (patch) => setUi((p) => Object.assign({}, p, { editPartForm: Object.assign({}, p.editPartForm, patch) }));
  const setMF = (patch) => setUi((p) => Object.assign({}, p, { memberForm: Object.assign({}, p.memberForm, patch) }));
  const setQF = (patch) => setUi((p) => Object.assign({}, p, { qtyForm: Object.assign({}, p.qtyForm, patch) }));
  const setTF = (patch) => setUi((p) => Object.assign({}, p, { targetForm: Object.assign({}, p.targetForm, patch) }));

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
      setData(merged);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

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

  const partSummary = useMemo(() => data.parts.map((part) => {
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

  const activePart = partSummary.find((p) => p.id === ui.activePartId);
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

  function addMember() {
    const name = ui.addMemberForm.name.trim();
    if (!name) return;
    updateData({ members: data.members.concat([{ id: genId(), name }]) });
    set({ addMemberForm: { name: "" } });
  }
  function deleteMember(id) { updateData({ members: data.members.filter((m) => m.id !== id) }); }
  function saveMemberName() {
    const name = ui.editMemberName.trim();
    if (!name) return;
    updateData({ members: data.members.map((m) => m.id === ui.editMemberId ? Object.assign({}, m, { name }) : m) });
    set({ editMemberId: null, editMemberName: "" });
  }

  function addVendor() {
    const name = ui.addVendorForm.name.trim();
    if (!name) return;
    updateData({ vendors: data.vendors.concat([{ id: genId(), name }]) });
    set({ addVendorForm: { name: "" } });
  }
  function deleteVendor(id) { updateData({ vendors: data.vendors.filter((v) => v.id !== id) }); }
  function saveVendorName() {
    const name = ui.editVendorName.trim();
    if (!name) return;
    updateData({ vendors: data.vendors.map((v) => v.id === ui.editVendorId ? Object.assign({}, v, { name }) : v) });
    set({ editVendorId: null, editVendorName: "" });
  }

  function addBrand() {
    const name = ui.addBrandForm.name.trim();
    if (!name) return;
    updateData({ brands: (data.brands || []).concat([{ id: genId(), name }]) });
    set({ addBrandForm: { name: "" } });
  }
  function deleteBrand(id) { updateData({ brands: (data.brands || []).filter((b) => b.id !== id) }); }
  function saveBrandName() {
    const name = ui.editBrandName.trim();
    if (!name) return;
    updateData({ brands: (data.brands || []).map((b) => b.id === ui.editBrandId ? Object.assign({}, b, { name }) : b) });
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
    if (f.id) {
      const idx = list.findIndex((r) => r.id === f.id);
      if (idx >= 0) list[idx] = Object.assign({}, f, { colors, updatedAt: today() });
      else list.push(Object.assign({}, f, { colors, updatedAt: today() }));
    } else {
      const rec = Object.assign({}, f, { colors, id: genId(), createdAt: today(), updatedAt: today() });
      const idx = list.findIndex((r) => r.partId === f.partId);
      if (idx >= 0) list[idx] = Object.assign(rec, { id: list[idx].id });
      else list.push(rec);
    }
    updateData({ saidanReports: list });
    set({ screen: "part_detail" });
  }

  function deleteSaidan(partId) {
    updateData({ saidanReports: (data.saidanReports || []).filter((r) => r.partId !== partId) });
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
<script>window.onload=function(){window.print()}<\/script>
</body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
  }

  function saveTarget() {
    const f = ui.targetForm;
    if (!f.month || !f.team) return;
    const nt = Object.assign({}, data.monthlyTargets);
    nt[f.month] = Object.assign({}, nt[f.month] || {});
    nt[f.month][f.team] = {
      sales: parseFloat(f.sales) || 0,
      members: parseFloat(f.members) || 0,
      workDays: parseFloat(f.workDays) || 0,
      hoursPerDay: parseFloat(f.hoursPerDay) || 0,
    };
    updateData({ monthlyTargets: nt });
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
        React.createElement(BigBtn, { icon: "📋", label: "品番マスター", sub: "全品番の登録・割当管理" + (unassigned > 0 ? "　⚠️ 未割当 " + unassigned + "件" : ""), onClick: () => set({ screen: "master", masterFilter: "all" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "🗂️", label: "ダッシュボード", sub: "納期・進捗を一目で確認", onClick: () => set({ screen: "dashboard" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "📅", label: "納期カレンダー", sub: "品番ごとの納品予定日を一覧", onClick: () => set({ screen: "deadline_calendar", dlMonth: today().slice(0, 7) }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "🏷️", label: "ブランド別仕事一覧", sub: "客先ごとの納品前・納品済みを確認", onClick: () => set({ screen: "brand_jobs", selectedBrandId: null }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "📊", label: "集計・仕事量管理", sub: "全体・チーム別の実績と予算", onClick: () => set({ screen: "summary" }) }),
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
              React.createElement(RoleBtn, { icon: "✂️", label: "メンバー", onClick: () => set({ selectedTeam: team, userRole: "member", screen: "member_entry", memberForm: { memberId: "", partId: "", hours: "", date: today() } }) })
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
              p.closedAt ? React.createElement(Badge, { type: "done" }) : React.createElement(Badge, { type: "open" }),
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
            p.closedAt ? React.createElement(Badge, { type: "done" }) : React.createElement(Badge, { type: "open" }),
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
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "完了日"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#2a7a2a" : "#bbb" } }, p.closedAt ? fmt(p.closedAt) : "進行中"))
          ),
          p.deadline && !p.closedAt && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: p.remainDays <= 3 ? "#c00" : "#888" } }, "納期まであと ", React.createElement("b", null, p.remainDays), " 日", p.dailyNeeded ? " ／ 1日あたり " + p.dailyNeeded.toFixed(1) + "h 必要" : "")
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
            // 日付ごとにグループ化
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
        p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777", marginTop: 16 }), onClick: () => reopenPart(p.id) }, "再開する"),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#fff0f0", color: "#c00", marginTop: 8 }), onClick: () => { if (window.confirm("この品番を削除しますか？")) { deletePart(p.id); set({ screen: "master" }); } } }, "削除する")
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "dashboard") {
    const isDelivered = ui.dashFilter === "delivered";
    // 納品済み = closedAt がある品番、納品前 = closedAt がない品番
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
    const todayRecs = data.records.filter((r) => { const part = data.parts.find((p) => p.id === r.partId); return r.date === f.date && part && part.assignee === ui.selectedTeam; });
    const ready = f.memberId && f.partId && f.hours;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: ui.selectedTeam + "　作業記録", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        data.members.length === 0
          ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#aaa", padding: 24 }) }, "メンバーが登録されていません。", React.createElement("br"), "ホーム→メンバー管理から登録してください。")
          : React.createElement("div", { style: st.card },
              React.createElement(FormRow, { label: "日付" }, React.createElement("input", { style: st.input, type: "date", value: f.date, onChange: (e) => setMF({ date: e.target.value }) })),
              React.createElement(FormRow, { label: "自分の名前" }, React.createElement("select", { style: st.input, value: f.memberId, onChange: (e) => setMF({ memberId: e.target.value }) },
                React.createElement("option", { value: "" }, "選択してください"),
                data.members.map((m) => React.createElement("option", { key: m.id, value: m.id }, m.name))
              )),
              React.createElement(FormRow, { label: "品番を選ぶ" },
                teamParts.length === 0
                  ? React.createElement("div", { style: { color: "#bbb", fontSize: 13, padding: "8px 0" } }, "進行中の品番がありません")
                  : React.createElement("select", { style: st.input, value: f.partId, onChange: (e) => setMF({ partId: e.target.value }) },
                      React.createElement("option", { value: "" }, "選択してください"),
                      teamParts.map((p) => React.createElement("option", { key: p.id, value: p.id }, p.partNo + (p.partName ? " (" + p.partName + ")" : "")))
                    )
              ),
              React.createElement(FormRow, { label: "作業時間（h）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3.5", min: "0", step: "0.5", value: f.hours, onChange: (e) => setMF({ hours: e.target.value }) })),
              React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: addRecord }, "記録する")
            ),
        React.createElement(SectionLabel, null, "本日の入力 (" + f.date + ")"),
        todayRecs.length === 0 && React.createElement(Empty, null, "まだ入力がありません"),
        todayRecs.map((r) => { const part = data.parts.find((x) => x.id === r.partId); return React.createElement("div", { key: r.id, style: st.recRow }, React.createElement("span", { style: { fontSize: 12, color: "#888", minWidth: 64 } }, r.memberName), React.createElement("span", { style: { fontSize: 13, fontWeight: 700, flex: 1 } }, part ? part.partNo : "?"), React.createElement("span", { style: { fontSize: 13, color: "#555" } }, r.hours + "h"), React.createElement("button", { style: st.deleteBtn, onClick: () => deleteRecord(r.id) }, "✕")); })
      ),
      React.createElement(SI)
    );
  }

  if (ui.screen === "summary") {
    const sm = ui.summaryMonth;
    // 仕掛り月でフィルタリングした品番
    const monthParts = partSummary.filter((p) => p.workMonth === sm);
    const allMonths = Array.from(new Set(partSummary.map((p) => p.workMonth).filter(Boolean))).sort().reverse();

    const mTotalQty = monthParts.reduce((a, p) => a + (p.qty || 0), 0);
    const mCompletedQty = monthParts.reduce((a, p) => a + p.completedQty, 0);
    const mTotalSales = monthParts.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalSales, 0);
    const mTotalHours = monthParts.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalHours, 0);
    const mTotalProfit = monthParts.filter((p) => p.assigneeType === "outsource" && p.profit !== null).reduce((a, p) => a + p.profit, 0);
    const mHourlyRate = mTotalHours > 0 ? mTotalSales / mTotalHours : 0;
    // この月の全品番の予定売上合計（社内・単価×数量）
    const mPlannedSales = monthParts.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "集計・仕事量管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,

        // 月選択
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

        // この月のサマリー
        monthParts.length === 0
          ? React.createElement("div", { style: Object.assign({}, st.card, { textAlign: "center", color: "#bbb", padding: 24 }) },
              sm.replace("-", "年") + "月の仕掛り品番はありません"
            )
          : React.createElement("div", null,

              React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 8 } },
                sm.replace("-", "年") + "月仕掛り — " + monthParts.length + "品番"
              ),

              // 売上ハイライト
              React.createElement("div", { style: { background: "#1a1a1a", borderRadius: 12, padding: "16px 18px", marginBottom: 12, color: "#fff" } },
                React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, "この月の予定売上合計（社内・単価×数量）"),
                React.createElement("div", { style: { fontSize: 28, fontWeight: 700 } }, "¥" + Math.round(mPlannedSales).toLocaleString()),
                React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 6, borderTop: "1px solid #444", paddingTop: 8 } },
                  "外注利益: ¥" + Math.round(mTotalProfit).toLocaleString()
                )
              ),

              React.createElement("div", { style: st.grid2 },
                React.createElement(SBox, { label: "総枚数", value: mTotalQty.toLocaleString() + "枚" }),
                React.createElement(SBox, { label: "完成枚数", value: mCompletedQty.toLocaleString() + "枚" }),
                React.createElement(SBox, { label: "社内 売上実績", value: "¥" + Math.round(mTotalSales).toLocaleString() }),
                React.createElement(SBox, { label: "時間単価（実績）", value: mTotalHours > 0 ? "¥" + Math.round(mHourlyRate).toLocaleString() + "/h" : "—" })
              ),

              // チーム別目標 vs 割当 vs 実績
              React.createElement(SectionLabel, null, "チーム別 予定 / 割当 / 実績"),
              TEAMS.map((team) => {
                const tParts = monthParts.filter((p) => p.assignee === team && p.assigneeType === "team");
                const tHours = tParts.reduce((a, p) => a + p.totalHours, 0);
                const tSales = tParts.reduce((a, p) => a + p.totalSales, 0);
                const tQty = tParts.reduce((a, p) => a + (p.qty || 0), 0);
                const tCompletedQty = tParts.reduce((a, p) => a + p.completedQty, 0);
                // 見込み時間 = 品番の見積もり総時間
                const tAssignedHours = tParts.reduce((a, p) => a + (p.estTotalHours || 0), 0);
                const tRate = tHours > 0 ? tSales / tHours : 0;
                // 予定売上 = 割り当てられた品番の単価×数量の合計（= このチームの目標）
                const tPlannedSales = tParts.reduce((a, p) => a + (p.unitPrice || 0) * (p.qty || 0), 0);
                // 売上達成率 = 完成枚数ベースの実績売上 ÷ 予定売上
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

                  // 予定売上（= 目標）を大きく表示
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

                  // 時間ブロック：見込み / 実績
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

                  // 完成枚数の進捗
                  React.createElement("div", null,
                    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
                      React.createElement("span", null, "完成枚数"),
                      React.createElement("span", { style: { fontWeight: 700 } }, tCompletedQty + "枚 / " + tQty + "枚")
                    ),
                    React.createElement(ProgressBar, { value: tQty > 0 ? tCompletedQty / tQty : 0, color: "#2a7a2a" })
                  )
                );
              }),

              // 外注サマリー
              monthParts.some((p) => p.assigneeType === "outsource") && React.createElement("div", null,
                React.createElement(SectionLabel, null, "外注 サマリー"),
                React.createElement("button", { style: Object.assign({}, st.monthlyCard, { width: "100%", border: "none", textAlign: "left", cursor: "pointer", display: "block" }), onClick: () => set({ screen: "team_month", teamMonthTeam: "__outsource__", teamMonthMonth: sm }) },
                  React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
                    React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "🏢 外注品番を見る"),
                    React.createElement("span", { style: { fontSize: 11, color: "#3b6fd4" } }, "一覧 ›")
                  ),
                  React.createElement("div", { style: st.grid2 },
                    React.createElement(SBox, { label: "外注品番数", value: monthParts.filter((p) => p.assigneeType === "outsource").length + "件" }),
                    React.createElement(SBox, { label: "利益合計", value: "¥" + Math.round(mTotalProfit).toLocaleString(), dark: mTotalProfit > 0 })
                  )
                )
              ),

              // この月の品番一覧
              React.createElement(SectionLabel, null, "品番一覧"),
              monthParts.map((p) => React.createElement("button", {
                key: p.id,
                style: Object.assign({}, st.summaryCard, { textAlign: "left" }),
                onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "summary" })
              },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                  React.createElement("div", null,
                    React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, p.partNo + (p.partName ? " " + p.partName : "")),
                    p.brandName && React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } }, "🏷 " + p.brandName)
                  ),
                  React.createElement("div", { style: { textAlign: "right", fontSize: 12, color: "#aaa" } },
                    p.closedAt ? React.createElement(Badge, { type: "done" }) : React.createElement(Badge, { type: "open" }),
                    React.createElement("div", { style: { marginTop: 4 } }, p.assigneeType === "outsource" ? ("外注 / 利益¥" + (p.profit !== null ? Math.round(p.profit).toLocaleString() : "—")) : (p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "未記録"))
                  )
                )
              ))
            ),

        // CSV・シート出力
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

    // メンバー履歴詳細（カレンダー）
    if (am && activeMember) {
      const calMonth = ui.calMonth || today().slice(0, 7);
      const memberRecs = data.records.filter((r) => r.memberId === am);
      const monthRecs = memberRecs.filter((r) => r.date && r.date.slice(0, 7) === calMonth);

      // 日付ごとにグループ化
      const dayMap = {};
      monthRecs.forEach((r) => {
        if (!dayMap[r.date]) dayMap[r.date] = [];
        const part = data.parts.find((p) => p.id === r.partId);
        dayMap[r.date].push({ ...r, part });
      });

      // カレンダー構築
      const [year, month] = calMonth.split("-").map(Number);
      const firstDay = new Date(year, month - 1, 1).getDay(); // 0=日
      const daysInMonth = new Date(year, month, 0).getDate();
      const totalHours = memberRecs.reduce((a, r) => a + r.hours, 0);
      const monthHours = monthRecs.reduce((a, r) => a + r.hours, 0);

      // 前月・次月
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

          // サマリー
          React.createElement("div", { style: st.grid2 },
            React.createElement(SBox, { label: "累計作業時間", value: totalHours.toFixed(1) + "h" }),
            React.createElement(SBox, { label: calMonth.replace("-", "年") + "月の作業時間", value: monthHours > 0 ? monthHours.toFixed(1) + "h" : "—" })
          ),

          // 月切り替え
          React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } },
            React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ calMonth: prevMonth }) }, "‹"),
            React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, year + "年" + month + "月"),
            React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16, opacity: isCurrentMonth ? 0.3 : 1 }), disabled: isCurrentMonth, onClick: () => !isCurrentMonth && set({ calMonth: nextMonth }) }, "›")
          ),

          // カレンダーグリッド
          React.createElement("div", { style: { background: "#fff", borderRadius: 12, padding: "12px", boxShadow: "0 1px 4px rgba(0,0,0,.06)", marginBottom: 16 } },
            // 曜日ヘッダー
            React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 } },
              ["日", "月", "火", "水", "木", "金", "土"].map((d, i) =>
                React.createElement("div", { key: d, style: { textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#c00" : i === 6 ? "#3b6fd4" : "#aaa", padding: "4px 0" } }, d)
              )
            ),
            // 日付セル
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

          // 選択日の詳細 or 月の作業一覧
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

    // メンバー一覧
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
      React.createElement(SectionLabel, null, "外注先一覧（" + data.vendors.length + "社）"),
      data.vendors.length === 0 && React.createElement(Empty, null, "外注先がいません"),
      data.vendors.map((v) => React.createElement("div", { key: v.id, style: st.memberRow },
        ui.editVendorId === v.id
          ? React.createElement(React.Fragment, null, React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editVendorName, onChange: (e) => set({ editVendorName: e.target.value }) }), React.createElement("button", { style: st.inlineBtn, onClick: saveVendorName }, "保存"), React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editVendorId: null }) }, "取消"))
          : React.createElement(React.Fragment, null, React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600 } }, v.name), React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editVendorId: v.id, editVendorName: v.name }) }, "編集"), React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteVendor(v.id) }, "削除"))
      ))
    ),
    React.createElement(SI)
  );

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
      React.createElement(SectionLabel, null, "ブランド一覧（" + (data.brands || []).length + "件）"),
      (data.brands || []).length === 0 && React.createElement(Empty, null, "ブランドが登録されていません"),
      (data.brands || []).map((b) => React.createElement("div", { key: b.id, style: st.memberRow },
        ui.editBrandId === b.id
          ? React.createElement(React.Fragment, null, React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editBrandName, onChange: (e) => set({ editBrandName: e.target.value }) }), React.createElement("button", { style: st.inlineBtn, onClick: saveBrandName }, "保存"), React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editBrandId: null }) }, "取消"))
          : React.createElement(React.Fragment, null, React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600 } }, b.name), React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editBrandId: b.id, editBrandName: b.name }) }, "編集"), React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteBrand(b.id) }, "削除"))
      ))
    ),
    React.createElement(SI)
  );

  if (ui.screen === "brand_jobs") {
    const brands = data.brands || [];
    const sb = ui.selectedBrandId;
    const selectedBrand = brands.find((b) => b.id === sb);

    // ブランド未選択：ブランド選択画面
    if (!sb) {
      // ブランドごとの進行中件数を集計
      const brandCounts = {};
      partSummary.forEach((p) => {
        if (!p.brandId) return;
        if (!brandCounts[p.brandId]) brandCounts[p.brandId] = { active: 0, done: 0 };
        if (p.closedAt) brandCounts[p.brandId].done++;
        else brandCounts[p.brandId].active++;
      });
      // ブランド未設定の品番
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

    // ブランド選択済み：品番一覧
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

    // サマリー集計
    const activeSales = activeList.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalSales, 0);
    const activeHours = activeList.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalHours, 0);
    const doneSales = doneList.filter((p) => p.assigneeType !== "outsource").reduce((a, p) => a + p.totalSales, 0);

    return React.createElement(Shell, null,
      React.createElement(Header, {
        title: isNone ? "ブランド未設定" : selectedBrand ? selectedBrand.name : "",
        back: () => set({ selectedBrandId: null })
      }),
      React.createElement(Body, null,

        // サマリーボックス
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "納品前 品番数", value: activeList.length + "件" }),
          React.createElement(SBox, { label: "納品済み 品番数", value: doneList.length + "件" }),
          React.createElement(SBox, { label: "納品前 売上合計", value: "¥" + Math.round(activeSales).toLocaleString() }),
          React.createElement(SBox, { label: "納品済み 売上合計", value: "¥" + Math.round(doneSales).toLocaleString(), dark: true })
        ),

        // 納品前
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
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, p.partNo + (p.partName ? " " + p.partName : "")),
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

        // 納品済み
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
          React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, p.partNo + (p.partName ? " " + p.partName : "")),
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

  if (ui.screen === "deadline_calendar") {
    const dlMonth = ui.dlMonth || today().slice(0, 7);
    const [year, month] = dlMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const prevMonth = month === 1 ? (year - 1) + "-12" : year + "-" + String(month - 1).padStart(2, "0");
    const nextMonth = month === 12 ? (year + 1) + "-01" : year + "-" + String(month + 1).padStart(2, "0");

    // 納期がこの月の品番を日付ごとにまとめる
    const dlByDate = {};
    partSummary.forEach((p) => {
      if (!p.deadline || p.deadline.slice(0, 7) !== dlMonth) return;
      if (!dlByDate[p.deadline]) dlByDate[p.deadline] = [];
      dlByDate[p.deadline].push(p);
    });
    const monthDlCount = Object.values(dlByDate).reduce((a, arr) => a + arr.length, 0);

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    const todayStr = today();

    const teamColor = (p) => {
      if (p.assigneeType === "outsource") return "#888";
      return TEAM_COLORS[p.assignee] || "#bbb";
    };

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "📅 納期カレンダー", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,

        // 月切り替え
        React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 } },
          React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ dlMonth: prevMonth, dlSelectedDate: null }) }, "‹"),
          React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, year + "年" + month + "月　納期 " + monthDlCount + "件"),
          React.createElement("button", { style: Object.assign({}, st.ghostBtn, { padding: "8px 16px", fontSize: 16 }), onClick: () => set({ dlMonth: nextMonth, dlSelectedDate: null }) }, "›")
        ),

        // チーム色凡例
        React.createElement("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12, fontSize: 11 } },
          TEAMS.map((t) => React.createElement("div", { key: t, style: { display: "flex", alignItems: "center", gap: 4 } },
            React.createElement("div", { style: { width: 10, height: 10, borderRadius: 3, background: TEAM_COLORS[t] } }),
            React.createElement("span", { style: { color: "#888" } }, t)
          )),
          React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 4 } },
            React.createElement("div", { style: { width: 10, height: 10, borderRadius: 3, background: "#888" } }),
            React.createElement("span", { style: { color: "#888" } }, "外注")
          )
        ),

        // カレンダー
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
                  } }, p.partNo)
                ),
                items.length > 3 && React.createElement("div", { style: { fontSize: 9, color: "#aaa", textAlign: "center" } }, "他" + (items.length - 3) + "件")
              );
            })
          )
        ),

        // 選択日の詳細
        ui.dlSelectedDate && dlByDate[ui.dlSelectedDate] && React.createElement("div", null,
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 } },
            React.createElement("div", { style: st.sectionLabel }, ui.dlSelectedDate.slice(5).replace("-", "/") + " 納期の品番"),
            React.createElement("button", { style: st.ghostBtn, onClick: () => set({ dlSelectedDate: null }) }, "✕")
          ),
          dlByDate[ui.dlSelectedDate].map((p) =>
            React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left", borderLeft: "4px solid " + teamColor(p) }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "deadline_calendar" }) },
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
                React.createElement("div", null,
                  React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, p.partNo + (p.partName ? " " + p.partName : "")),
                  React.createElement("div", { style: { fontSize: 11, color: "#888", marginTop: 2 } },
                    (p.assigneeType === "outsource" ? "外注: " + (p.vendorName || "?") : (p.assignee || "未割当")) + "　" + p.qty + "枚"
                  )
                ),
                p.closedAt ? React.createElement(Badge, { type: "done" }) : React.createElement(Badge, { type: "open" })
              )
            )
          )
        ),

        // 納期未設定の注意
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
function Badge(p) { const done = p.type === "done"; return React.createElement("span", { style: { background: done ? "#e8f5e8" : "#fff3e0", color: done ? "#2a7a2a" : "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, done ? "完了" : "進行中"); }
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
  root: { fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", background: "#f5f4f0", minHeight: "100vh", maxWidth: 680, margin: "0 auto", paddingBottom: 48 },
  header: { background: "#1a1a1a", color: "#fff", padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 },
  headerTitle: { fontSize: 18, fontWeight: 700 },
  backBtn: { background: "none", border: "none", color: "#777", fontSize: 14, padding: "0 0 4px", cursor: "pointer", display: "block" },
  body: { padding: "16px", maxWidth: 680, margin: "0 auto" },
  bigBtn: { display: "flex", alignItems: "center", gap: 16, width: "100%", background: "#1a1a1a", color: "#fff", border: "1px solid transparent", borderRadius: 12, padding: "16px 20px", cursor: "pointer", marginBottom: 0 },
  roleBtn: { display: "flex", alignItems: "center", gap: 8, flex: 1, background: "#fff", border: "1px solid #e0deda", borderRadius: 10, padding: "12px 14px", cursor: "pointer", justifyContent: "center" },
  quickBtn: { flex: 1, background: "#fff", border: "1px solid #e0deda", borderRadius: 10, padding: "10px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#333" },
  editBtn: { background: "#f5f4f0", border: "1px solid #e0deda", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#555", fontWeight: 600, whiteSpace: "nowrap" },
  dashedBtn: { display: "block", width: "100%", background: "#fff", border: "2px dashed #d0cec8", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, color: "#555", cursor: "pointer", marginBottom: 16 },
  card: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  sectionLabel: { fontSize: 11, color: "#aaa", letterSpacing: "0.1em", marginBottom: 8, marginTop: 16 },
  empty: { textAlign: "center", color: "#ccc", fontSize: 13, padding: "18px 0" },
  input: { width: "100%", background: "#f5f4f0", border: "1px solid #e8e6e0", borderRadius: 8, padding: "10px 12px", fontSize: 15, boxSizing: "border-box", outline: "none", color: "#1a1a1a" },
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

