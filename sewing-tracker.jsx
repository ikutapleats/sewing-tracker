// GitHub Pages用: importを使わずReactをグローバルから取得
const { useState, useMemo, useEffect, useCallback } = React;

const GAS_URL = "https://script.google.com/macros/s/AKfycbxN7_GWK5xxPJm79eq2uvA1AIVRI6x_g0fD1HHng_Eyo51JEw5JVC3021iYYz_Y3yjxcw/exec";

const TEAMS = ["Aチーム", "Bチーム", "Cチーム", "サンプルチーム"];
const TEAM_COLORS = {
  "Aチーム": "#3b6fd4",
  "Bチーム": "#2a7a2a",
  "Cチーム": "#c25000",
  "サンプルチーム": "#7a2a7a",
};
const STATUSES = ["未着手", "受注確認", "裁断待ち", "製作中", "完了"];

function today() { return new Date().toISOString().slice(0, 10); }
function genId() { return Math.random().toString(36).slice(2, 9); }
function fmt(d) { return d ? d.slice(5).replace("-", "/") : "—"; }
function diffDays(a, b) {
  if (!a || !b) return null;
  return Math.ceil((new Date(b) - new Date(a)) / 86400000);
}

const EMPTY_DATA = {
  parts: [],
  records: [],
  qtyRecords: [],
  members: [],
  vendors: [],
  monthlyTargets: {},
};

const INIT_UI = {
  screen: "home",
  selectedTeam: null,
  userRole: null,
  addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estMinPerUnit: "", deadline: "", status: "未着手", note: "", assignee: "未割当", assigneeType: "team", vendorId: "", sellPrice: "", vendorPrice: "" },
  editPartForm: null,
  memberForm: { memberId: "", partId: "", hours: "", date: today() },
  qtyForm: { partId: "", qty: "", date: today() },
  addMemberForm: { name: "" },
  addVendorForm: { name: "" },
  targetForm: { month: today().slice(0, 7), team: TEAMS[0], sales: "", hourlyRate: "" },
  activePartId: null,
  masterFilter: "all",
  summaryMonth: today().slice(0, 7),
  editMemberId: null, editMemberName: "",
  editVendorId: null, editVendorName: "",
  prevScreen: "master",
};

async function gasSave(data) {
  const json = JSON.stringify(data);
  const encoded = encodeURIComponent(json);
  await fetch(GAS_URL + "?action=save&data=" + encoded, { mode: "no-cors" });
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
      if (!Array.isArray(merged.parts)) merged.parts = [];
      if (!Array.isArray(merged.records)) merged.records = [];
      if (!Array.isArray(merged.qtyRecords)) merged.qtyRecords = [];
      setData(merged);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (nd) => {
    setSaving(true);
    try { await gasSave(nd); } catch(e) {}
    finally { setSaving(false); }
  }, []);

  function updateData(patch) {
    const nd = Object.assign({}, data, patch);
    setData(nd);
    save(nd);
  }

  // ── computed ─────────────────────────────────────────────────────
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
    return Object.assign({}, part, { totalHours, totalSales, hourlyRate, estHoursPerUnit, estTotalHours, progress, workerMap, recs, remainDays, dailyNeeded, completedQty, remainQty, qtyProgress, profit, profitRate, vendorName });
  }), [data.parts, data.records, data.qtyRecords, data.vendors]);

  const activePart = partSummary.find((p) => p.id === ui.activePartId);

  const teamParts = useMemo(() => {
    if (!ui.selectedTeam) return [];
    return partSummary.filter((p) => p.assigneeType === "team" && p.assignee === ui.selectedTeam && !p.closedAt);
  }, [partSummary, ui.selectedTeam]);

  const dashItems = useMemo(() => {
    return partSummary.filter((p) => !p.closedAt).sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }, [partSummary]);

  const filteredMaster = useMemo(() => {
    if (ui.masterFilter === "all") return partSummary;
    if (ui.masterFilter === "未割当") return partSummary.filter((p) => !p.assignee || p.assignee === "未割当");
    if (ui.masterFilter === "外注") return partSummary.filter((p) => p.assigneeType === "outsource");
    return partSummary.filter((p) => p.assignee === ui.masterFilter);
  }, [partSummary, ui.masterFilter]);

  // ── actions ──────────────────────────────────────────────────────
  function addPart() {
    const f = ui.addPartForm;
    if (!f.partNo) return;
    const isOut = f.assigneeType === "outsource";
    const np = {
      id: genId(),
      partNo: f.partNo.trim(),
      partName: f.partName.trim(),
      unitPrice: parseFloat(f.unitPrice) || 0,
      qty: parseFloat(f.qty) || 0,
      estMinPerUnit: isOut ? 0 : (parseFloat(f.estMinPerUnit) || 0),
      deadline: f.deadline || null,
      status: f.status || "未着手",
      note: f.note.trim(),
      assignee: isOut ? f.vendorId : (f.assignee || "未割当"),
      assigneeType: f.assigneeType || "team",
      sellPrice: isOut ? (parseFloat(f.sellPrice) || 0) : 0,
      vendorPrice: isOut ? (parseFloat(f.vendorPrice) || 0) : 0,
      createdAt: today(),
      closedAt: null,
    };
    updateData({ parts: data.parts.concat([np]) });
    set({ addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estMinPerUnit: "", deadline: "", status: "未着手", note: "", assignee: "未割当", assigneeType: "team", vendorId: "", sellPrice: "", vendorPrice: "" }, screen: "master" });
  }

  function startEdit(part) {
    set({
      editPartForm: {
        id: part.id,
        partName: part.partName || "",
        unitPrice: part.unitPrice || "",
        qty: part.qty || "",
        estMinPerUnit: part.estMinPerUnit || "",
        deadline: part.deadline || "",
        status: part.status || "未着手",
        note: part.note || "",
        sellPrice: part.sellPrice || "",
        vendorPrice: part.vendorPrice || "",
        assigneeType: part.assigneeType || "team",
      },
      screen: "edit_part",
    });
  }

  function savePart() {
    const f = ui.editPartForm;
    if (!f) return;
    const isOut = f.assigneeType === "outsource";
    updateData({
      parts: data.parts.map((p) => p.id === f.id ? Object.assign({}, p, {
        partName: f.partName.trim(),
        unitPrice: parseFloat(f.unitPrice) || 0,
        qty: parseFloat(f.qty) || 0,
        estMinPerUnit: isOut ? 0 : (parseFloat(f.estMinPerUnit) || 0),
        deadline: f.deadline || null,
        status: f.status || "未着手",
        note: f.note.trim(),
        sellPrice: isOut ? (parseFloat(f.sellPrice) || 0) : (p.sellPrice || 0),
        vendorPrice: isOut ? (parseFloat(f.vendorPrice) || 0) : (p.vendorPrice || 0),
      }) : p)
    });
    set({ editPartForm: null, screen: "part_detail" });
  }

  function updatePartAssignee(id, assignee, assigneeType) {
    updateData({ parts: data.parts.map((p) => p.id === id ? Object.assign({}, p, { assignee, assigneeType }) : p) });
  }

  function closePart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? Object.assign({}, p, { closedAt: today() }) : p) }); }
  function reopenPart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? Object.assign({}, p, { closedAt: null }) : p) }); }
  function deletePart(id) { updateData({ parts: data.parts.filter((p) => p.id !== id), records: data.records.filter((r) => r.partId !== id), qtyRecords: (data.qtyRecords || []).filter((r) => r.partId !== id) }); }

  function addRecord() {
    const f = ui.memberForm;
    const member = data.members.find((m) => m.id === f.memberId);
    if (!member || !f.partId || !f.hours) return;
    updateData({ records: data.records.concat([{ id: genId(), partId: f.partId, memberId: f.memberId, memberName: member.name, hours: parseFloat(f.hours), date: f.date }]) });
    setMF({ hours: "" });
  }
  function deleteRecord(id) { updateData({ records: data.records.filter((r) => r.id !== id) }); }

  function addQtyRecord() {
    const f = ui.qtyForm;
    if (!f.partId || !f.qty) return;
    updateData({ qtyRecords: (data.qtyRecords || []).concat([{ id: genId(), partId: f.partId, qty: parseFloat(f.qty), date: f.date || today() }]) });
    setQF({ qty: "", partId: "", date: today() });
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

  function saveTarget() {
    const f = ui.targetForm;
    if (!f.month || !f.team) return;
    const nt = Object.assign({}, data.monthlyTargets);
    nt[f.month] = Object.assign({}, nt[f.month] || {});
    nt[f.month][f.team] = { sales: parseFloat(f.sales) || 0, hourlyRate: parseFloat(f.hourlyRate) || 0 };
    updateData({ monthlyTargets: nt });
    setTF({ sales: "", hourlyRate: "" });
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
    csv += "\n\n完成枚数記録\n品番,完成枚数,日付\n";
    (data.qtyRecords || []).forEach((r) => {
      const part = data.parts.find((p) => p.id === r.partId);
      csv += [part ? part.partNo : "?", r.qty, r.date].join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "作業実績_" + today() + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  }

 function exportToSheet() {
    const month = ui.summaryMonth;
    fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "report", month: month, data: data })
    }).then((res) => res.json()).then(() => {
      alert("スプレッドシートに出力しました！\nGoogleスプレッドシートの「月次レポート」シートを確認してください。");
    }).catch(() => alert("出力に失敗しました。"));
  }

  if (loading) return React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, fontFamily: "'Hiragino Sans', sans-serif" } },
    React.createElement("div", { style: st.spinner }),
    React.createElement("div", { style: { color: "#aaa", fontSize: 14 } }, "読み込み中...")
  );

  const SI = () => saving ? React.createElement("div", { style: { position: "fixed", bottom: 16, right: 16, zIndex: 100 } }, React.createElement("div", { style: st.saveBadge }, "💾 保存中...")) : null;

  // ════════════════════════════════════════════════════════════════
  // HOME
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "home") {
    const unassigned = partSummary.filter((p) => (!p.assignee || p.assignee === "未割当") && !p.closedAt).length;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "作業実績管理", sub: "IQUTA PLEATS" }),
      React.createElement(Body, null,
        React.createElement(BigBtn, { icon: "📋", label: "品番マスター", sub: "全品番の登録・割当管理" + (unassigned > 0 ? "　⚠️ 未割当 " + unassigned + "件" : ""), onClick: () => set({ screen: "master", masterFilter: "all" }) }),
        React.createElement(Spacer, { h: 8 }),
        React.createElement(BigBtn, { icon: "🗂️", label: "ダッシュボード", sub: "納期・進捗を一目で確認", onClick: () => set({ screen: "dashboard" }) }),
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
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement(QuickBtn, { label: "👥 メンバー管理", onClick: () => set({ screen: "member_mgmt" }) }),
          React.createElement(QuickBtn, { label: "🏢 外注先管理", onClick: () => set({ screen: "vendor_mgmt" }) }),
          React.createElement(QuickBtn, { label: "🎯 目標設定", onClick: () => set({ screen: "target_setting" }) })
        )
      ),
      React.createElement(SI)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // 品番マスター
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "master") {
    const filters = ["all", "未割当"].concat(TEAMS).concat(["外注"]);
    const unassigned = partSummary.filter((p) => (!p.assignee || p.assignee === "未割当") && !p.closedAt);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番マスター", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("button", { style: st.dashedBtn, onClick: () => set({ screen: "add_part" }) }, "＋ 新しい品番を登録する"),
        unassigned.length > 0 && React.createElement("div", { style: { background: "#fff8e0", border: "1px solid #ffe599", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#b07000" } }, "⚠️ 担当未割当の品番が " + unassigned.length + " 件あります"),
        React.createElement("div", { style: st.filterRow },
          filters.map((f) => React.createElement("button", { key: f, style: Object.assign({}, st.filterBtn, ui.masterFilter === f ? st.filterBtnActive : {}), onClick: () => set({ masterFilter: f }) }, f === "all" ? "全体" : f))
        ),
        React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 12 } }, filteredMaster.length + "件"),
        filteredMaster.length === 0 && React.createElement(Empty, null, "品番がありません"),
        filteredMaster.map((p) => React.createElement("button", { key: p.id, style: Object.assign({}, st.summaryCard, { textAlign: "left" }), onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "master" }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } },
            React.createElement("div", null,
              React.createElement("div", { style: { fontSize: 15, fontWeight: 700 } }, p.partNo),
              p.partName && React.createElement("div", { style: { fontSize: 12, color: "#888", marginTop: 2 } }, p.partName)
            ),
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
            React.createElement("span", null, p.qty + "枚"),
            p.deadline && React.createElement("span", { style: { color: p.remainDays !== null && p.remainDays <= 3 ? "#c00" : p.remainDays !== null && p.remainDays <= 7 ? "#c25000" : "#aaa" } }, "納期: " + fmt(p.deadline) + (p.remainDays !== null ? "（あと" + p.remainDays + "日）" : "")),
            p.status && React.createElement("span", null, p.status)
          )
        ))
      ),
      React.createElement(SI)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // 品番登録
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "add_part") {
    const f = ui.addPartForm;
    const isOut = f.assigneeType === "outsource";
    const estHoursPerUnit = (parseFloat(f.estMinPerUnit) || 0) / 60;
    const estTotal = (!isOut && f.unitPrice && f.qty && f.estMinPerUnit)
      ? { sales: parseFloat(f.unitPrice) * parseFloat(f.qty), hours: estHoursPerUnit * parseFloat(f.qty) } : null;
    const profit = (isOut && f.sellPrice && f.vendorPrice && f.qty)
      ? (parseFloat(f.sellPrice) - parseFloat(f.vendorPrice)) * parseFloat(f.qty) : null;
    const ready = f.partNo;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番を登録", back: () => set({ screen: "master" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品番 ＊" }, React.createElement("input", { style: st.input, placeholder: "例: A-2024-001", value: f.partNo, onChange: (e) => setAP({ partNo: e.target.value }) })),
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, placeholder: "例: プリーツスカート", value: f.partName, onChange: (e) => setAP({ partName: e.target.value }) })),
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

  // ════════════════════════════════════════════════════════════════
  // 品番編集
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "edit_part" && ui.editPartForm) {
    const f = ui.editPartForm;
    const isOut = f.assigneeType === "outsource";
    const estHoursPerUnit = (parseFloat(f.estMinPerUnit) || 0) / 60;
    const estTotal = (!isOut && f.unitPrice && f.qty && f.estMinPerUnit)
      ? { sales: parseFloat(f.unitPrice) * parseFloat(f.qty), hours: estHoursPerUnit * parseFloat(f.qty) } : null;
    const profit = (isOut && f.sellPrice && f.vendorPrice && f.qty)
      ? (parseFloat(f.sellPrice) - parseFloat(f.vendorPrice)) * parseFloat(f.qty) : null;

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番を編集", back: () => set({ screen: "part_detail", editPartForm: null }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, placeholder: "例: プリーツスカート", value: f.partName, onChange: (e) => setEP({ partName: e.target.value }) })),
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
          React.createElement(FormRow, { label: "備考" }, React.createElement("input", { style: st.input, placeholder: "メモなど", value: f.note, onChange: (e) => setEP({ note: e.target.value }) })),
          estTotal && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: "#f0f8f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "合計売上予定"), React.createElement("b", null, "¥" + Math.round(estTotal.sales).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "総見積もり時間"), React.createElement("b", null, estTotal.hours.toFixed(1) + "h")),
            estTotal.hours > 0 && React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "目標時間単価"), React.createElement("b", { style: { color: "#2a7a2a" } }, "¥" + Math.round(estTotal.sales / estTotal.hours).toLocaleString() + "/h"))
          ),
          profit !== null && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: profit >= 0 ? "#f0f8f0" : "#fff0f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "利益"), React.createElement("b", { style: { color: profit >= 0 ? "#2a7a2a" : "#c00" } }, "¥" + Math.round(profit).toLocaleString()))
          ),
          React.createElement("button", { style: st.primaryBtn, onClick: savePart }, "保存する")
        )
      )
    );
  }

  // ════════════════════════════════════════════════════════════════
  // 品番詳細
  // ════════════════════════════════════════════════════════════════
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
        p.partName && React.createElement("div", { style: { fontSize: 15, color: "#555", marginBottom: 12 } }, p.partName),

        // 担当変更
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px" }) },
          React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginBottom: 8 } }, "担当を変更する"),
          React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            React.createElement("button", { style: Object.assign({}, st.assignBtn, (!p.assignee || p.assignee === "未割当") ? st.assignBtnActive : {}), onClick: () => updatePartAssignee(p.id, "未割当", "team") }, "未割当"),
            TEAMS.map((t) => React.createElement("button", { key: t, style: Object.assign({}, st.assignBtn, p.assignee === t && p.assigneeType === "team" ? st.assignBtnActive : {}), onClick: () => updatePartAssignee(p.id, t, "team") }, t)),
            data.vendors.map((v) => React.createElement("button", { key: v.id, style: Object.assign({}, st.assignBtn, p.assignee === v.id && p.assigneeType === "outsource" ? st.assignBtnActive : {}), onClick: () => updatePartAssignee(p.id, v.id, "outsource") }, "外注: " + v.name))
          )
        ),

        // 日程
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px", marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 13 } },
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "登録日"), React.createElement("div", { style: { fontWeight: 700 } }, fmt(p.createdAt))),
            p.deadline && React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "納期"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#aaa" : (p.remainDays <= 3 ? "#c00" : "#c25000") } }, fmt(p.deadline))),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "完了日"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#2a7a2a" : "#bbb" } }, p.closedAt ? fmt(p.closedAt) : "進行中"))
          ),
          p.deadline && !p.closedAt && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: p.remainDays <= 3 ? "#c00" : "#888" } }, "納期まであと ", React.createElement("b", null, p.remainDays), " 日", p.dailyNeeded ? " ／ 1日あたり " + p.dailyNeeded.toFixed(1) + "h 必要" : "")
        ),

        // 枚数進捗
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

        // KPI
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
          p.recs.slice().sort((a, b) => a.date.localeCompare(b.date)).map((r) => React.createElement("div", { key: r.id, style: st.recRow },
            React.createElement("span", { style: { fontSize: 12, color: "#aaa", minWidth: 42 } }, r.date.slice(5).replace("-", "/")),
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700, flex: 1 } }, r.memberName),
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, r.hours + "h")
          ))
        ),

        !p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { marginTop: 20 }), onClick: () => { closePart(p.id); set({ screen: "master" }); } }, "この品番を完了にする"),
        p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777", marginTop: 16 }), onClick: () => reopenPart(p.id) }, "再開する"),
        React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#fff0f0", color: "#c00", marginTop: 8 }), onClick: () => { if (window.confirm("この品番を削除しますか？")) { deletePart(p.id); set({ screen: "master" }); } } }, "削除する")
      ),
      React.createElement(SI)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // ダッシュボード
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "dashboard") {
    const urgent = dashItems.filter((p) => p.remainDays !== null && p.remainDays <= 3);
    const caution = dashItems.filter((p) => p.remainDays !== null && p.remainDays > 3 && p.remainDays <= 7);
    const normal = dashItems.filter((p) => p.remainDays === null || p.remainDays > 7);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "ダッシュボード", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 16 } }, "本日: " + today() + "　進行中: " + dashItems.length + "件"),
        urgent.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#fff0f0", color: "#c00", borderColor: "#ffcccc" }) }, "🔴 緊急 — 納期まで3日以内"),
          urgent.map((p) => React.createElement(DashCard, { key: p.id, item: p, vendors: data.vendors, level: "red", onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "dashboard" }) }))
        ),
        caution.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#fffbf0", color: "#b07000", borderColor: "#ffe599" }) }, "🟡 要注意 — 納期まで7日以内"),
          caution.map((p) => React.createElement(DashCard, { key: p.id, item: p, vendors: data.vendors, level: "yellow", onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "dashboard" }) }))
        ),
        normal.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#f0f8f0", color: "#2a7a2a", borderColor: "#b8e6b8" }) }, "🟢 余裕あり"),
          normal.map((p) => React.createElement(DashCard, { key: p.id, item: p, vendors: data.vendors, level: "green", onClick: () => set({ activePartId: p.id, screen: "part_detail", prevScreen: "dashboard" }) }))
        ),
        dashItems.length === 0 && React.createElement(Empty, null, "進行中の品番がありません")
      ),
      React.createElement(SI)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // チームリーダー
  // ════════════════════════════════════════════════════════════════
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
          React.createElement(FormRow, { label: "完成枚数" },
            React.createElement("input", { style: st.input, type: "number", placeholder: "例: 10", min: "0", value: qf.qty, onChange: (e) => setQF({ qty: e.target.value }) })
          ),
          React.createElement(FormRow, { label: "日付" },
            React.createElement("input", { style: st.input, type: "date", value: qf.date, onChange: (e) => setQF({ date: e.target.value }) })
          ),
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

  // ════════════════════════════════════════════════════════════════
  // メンバー入力
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "member_entry") {
    const f = ui.memberForm;
    const todayRecs = data.records.filter((r) => {
      const part = data.parts.find((p) => p.id === r.partId);
      return r.date === f.date && part && part.assignee === ui.selectedTeam;
    });
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
        todayRecs.map((r) => {
          const part = data.parts.find((x) => x.id === r.partId);
          return React.createElement("div", { key: r.id, style: st.recRow },
            React.createElement("span", { style: { fontSize: 12, color: "#888", minWidth: 64 } }, r.memberName),
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700, flex: 1 } }, part ? part.partNo : "?"),
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, r.hours + "h"),
            React.createElement("button", { style: st.deleteBtn, onClick: () => deleteRecord(r.id) }, "✕")
          );
        })
      ),
      React.createElement(SI)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // 集計
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "summary") {
    const totalQty = partSummary.filter((p) => !p.closedAt).reduce((a, p) => a + (p.qty || 0), 0);
    const totalCompletedQty = partSummary.filter((p) => !p.closedAt).reduce((a, p) => a + p.completedQty, 0);
    const totalSales = partSummary.reduce((a, p) => a + p.totalSales, 0);
    const totalProfit = partSummary.filter((p) => p.assigneeType === "outsource" && p.profit !== null).reduce((a, p) => a + p.profit, 0);
    const unassigned = partSummary.filter((p) => (!p.assignee || p.assignee === "未割当") && !p.closedAt).length;

    return React.createElement(Shell, null,
      React.createElement(Header, { title: "集計・仕事量管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 16 } },
          React.createElement("button", { style: Object.assign({}, st.quickBtn, { background: "#1a1a1a", color: "#fff" }), onClick: downloadCSV }, "📥 CSVダウンロード"),
          React.createElement("button", { style: Object.assign({}, st.quickBtn, { background: "#2a7a2a", color: "#fff" }), onClick: exportToSheet }, "📊 スプレッドシートに出力")
        ),
        React.createElement(FormRow, { label: "出力対象月" }, React.createElement("input", { style: st.input, type: "month", value: ui.summaryMonth, onChange: (e) => set({ summaryMonth: e.target.value }) })),
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "進行中 総枚数", value: totalQty.toLocaleString() + "枚" }),
          React.createElement(SBox, { label: "完成済み枚数", value: totalCompletedQty.toLocaleString() + "枚" }),
          React.createElement(SBox, { label: "社内 総売上実績", value: "¥" + Math.round(totalSales).toLocaleString() }),
          React.createElement(SBox, { label: "外注 利益合計", value: "¥" + Math.round(totalProfit).toLocaleString(), dark: true })
        ),
        unassigned > 0 && React.createElement("div", { style: { background: "#fff8e0", border: "1px solid #ffe599", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#b07000" } }, "⚠️ 未割当の品番が " + unassigned + " 件あります"),
        React.createElement(SectionLabel, null, "チーム別 仕事量"),
        TEAMS.map((team) => {
          const tParts = partSummary.filter((p) => p.assignee === team && p.assigneeType === "team");
          const tOpen = tParts.filter((p) => !p.closedAt);
          const tHours = tParts.reduce((a, p) => a + p.totalHours, 0);
          const tSales = tParts.reduce((a, p) => a + p.totalSales, 0);
          const tQty = tOpen.reduce((a, p) => a + (p.qty || 0), 0);
          const tCompletedQty = tOpen.reduce((a, p) => a + p.completedQty, 0);
          const tRate = tHours > 0 ? tSales / tHours : 0;
          return React.createElement("div", { key: team, style: st.monthlyCard },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } },
              React.createElement(TeamBadge, { team, small: true }),
              React.createElement("span", { style: { fontSize: 12, color: "#aaa" } }, tOpen.length + "品番 / " + tQty + "枚")
            ),
            React.createElement("div", { style: st.grid2 },
              React.createElement(SBox, { label: "完成枚数", value: tCompletedQty + "枚 / " + tQty + "枚" }),
              React.createElement(SBox, { label: "残り枚数", value: (tQty - tCompletedQty) + "枚" }),
              React.createElement(SBox, { label: "累計作業時間", value: tHours.toFixed(1) + "h" }),
              React.createElement(SBox, { label: "時間単価", value: tHours > 0 ? "¥" + Math.round(tRate).toLocaleString() + "/h" : "—" })
            ),
            tQty > 0 && React.createElement("div", null,
              React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
                React.createElement("span", null, "枚数進捗"),
                React.createElement("span", null, tCompletedQty + "枚 / " + tQty + "枚")
              ),
              React.createElement(ProgressBar, { value: tQty > 0 ? tCompletedQty / tQty : 0 })
            )
          );
        }),
        React.createElement(SectionLabel, null, "外注 サマリー"),
        React.createElement("div", { style: st.monthlyCard },
          React.createElement("div", { style: st.grid2 },
            React.createElement(SBox, { label: "外注品番数", value: partSummary.filter((p) => p.assigneeType === "outsource" && !p.closedAt).length + "件" }),
            React.createElement(SBox, { label: "利益合計", value: "¥" + Math.round(totalProfit).toLocaleString(), dark: totalProfit > 0 })
          ),
          data.vendors.map((v) => {
            const vParts = partSummary.filter((p) => p.assignee === v.id && p.assigneeType === "outsource" && !p.closedAt);
            const vProfit = vParts.reduce((a, p) => a + (p.profit || 0), 0);
            if (vParts.length === 0) return null;
            return React.createElement("div", { key: v.id, style: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555", marginBottom: 6 } },
              React.createElement("span", null, v.name),
              React.createElement("span", null, vParts.length + "件 ／ 利益 ¥" + Math.round(vProfit).toLocaleString())
            );
          })
        )
      ),
      React.createElement(SI)
    );
  }

  // ════════════════════════════════════════════════════════════════
  // メンバー管理
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "member_mgmt") return React.createElement(Shell, null,
    React.createElement(Header, { title: "メンバー管理（全社共通）", back: () => set({ screen: "home" }) }),
    React.createElement(Body, null,
      React.createElement("div", { style: st.card },
        React.createElement(FormRow, { label: "新しいメンバーを追加" },
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("input", { style: Object.assign({}, st.input, { flex: 1 }), placeholder: "名前を入力", value: ui.addMemberForm.name, onChange: (e) => set({ addMemberForm: { name: e.target.value } }) }),
            React.createElement("button", { style: st.inlineBtn, onClick: addMember }, "追加")
          )
        )
      ),
      React.createElement(SectionLabel, null, "メンバー一覧（" + data.members.length + "人）"),
      data.members.length === 0 && React.createElement(Empty, null, "メンバーがいません"),
      data.members.map((m) => React.createElement("div", { key: m.id, style: st.memberRow },
        ui.editMemberId === m.id
          ? React.createElement(React.Fragment, null,
              React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editMemberName, onChange: (e) => set({ editMemberName: e.target.value }) }),
              React.createElement("button", { style: st.inlineBtn, onClick: saveMemberName }, "保存"),
              React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editMemberId: null }) }, "取消")
            )
          : React.createElement(React.Fragment, null,
              React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600 } }, m.name),
              React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editMemberId: m.id, editMemberName: m.name }) }, "編集"),
              React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteMember(m.id) }, "削除")
            )
      ))
    ),
    React.createElement(SI)
  );

  // ════════════════════════════════════════════════════════════════
  // 外注先管理
  // ════════════════════════════════════════════════════════════════
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
          ? React.createElement(React.Fragment, null,
              React.createElement("input", { style: Object.assign({}, st.input, { flex: 1, fontSize: 14 }), value: ui.editVendorName, onChange: (e) => set({ editVendorName: e.target.value }) }),
              React.createElement("button", { style: st.inlineBtn, onClick: saveVendorName }, "保存"),
              React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editVendorId: null }) }, "取消")
            )
          : React.createElement(React.Fragment, null,
              React.createElement("span", { style: { flex: 1, fontSize: 14, fontWeight: 600 } }, v.name),
              React.createElement("button", { style: st.ghostBtn, onClick: () => set({ editVendorId: v.id, editVendorName: v.name }) }, "編集"),
              React.createElement("button", { style: Object.assign({}, st.ghostBtn, { color: "#c00" }), onClick: () => deleteVendor(v.id) }, "削除")
            )
      ))
    ),
    React.createElement(SI)
  );

  // ════════════════════════════════════════════════════════════════
  // 目標設定
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "target_setting") {
    const f = ui.targetForm;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "月次目標設定", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "対象月" }, React.createElement("input", { style: st.input, type: "month", value: f.month, onChange: (e) => setTF({ month: e.target.value }) })),
          React.createElement(FormRow, { label: "チーム" }, React.createElement("select", { style: st.input, value: f.team, onChange: (e) => setTF({ team: e.target.value }) }, TEAMS.map((t) => React.createElement("option", { key: t }, t)))),
          React.createElement(FormRow, { label: "売上目標（円）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 500000", value: f.sales, onChange: (e) => setTF({ sales: e.target.value }) })),
          React.createElement(FormRow, { label: "目標時間単価（円/h）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 2000", value: f.hourlyRate, onChange: (e) => setTF({ hourlyRate: e.target.value }) })),
          React.createElement("button", { style: st.primaryBtn, onClick: saveTarget }, "保存する")
        )
      ),
      React.createElement(SI)
    );
  }

  return null;
}

// ── Sub-components ──────────────────────────────────────────────────
function Shell(p) { return React.createElement("div", { style: st.root }, p.children); }
function Header(p) {
  return React.createElement("div", { style: st.header },
    p.back && React.createElement("button", { style: st.backBtn, onClick: p.back }, "‹ 戻る"),
    p.sub && React.createElement("div", { style: { fontSize: 10, letterSpacing: "0.2em", color: "#555", marginBottom: 2 } }, p.sub),
    React.createElement("div", { style: st.headerTitle }, p.title)
  );
}
function Body(p) { return React.createElement("div", { style: st.body }, p.children); }
function Spacer(p) { return React.createElement("div", { style: { height: p.h || 8 } }); }
function Divider(p) {
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" } },
    React.createElement("div", { style: { flex: 1, height: 1, background: "#e0deda" } }),
    React.createElement("span", { style: { fontSize: 11, color: "#bbb" } }, p.label),
    React.createElement("div", { style: { flex: 1, height: 1, background: "#e0deda" } })
  );
}
function BigBtn(p) {
  return React.createElement("button", { style: st.bigBtn, onClick: p.onClick },
    React.createElement("span", { style: { fontSize: 22 } }, p.icon),
    React.createElement("div", { style: { textAlign: "left" } },
      React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, p.label),
      React.createElement("div", { style: { fontSize: 11, color: "#999", marginTop: 2 } }, p.sub)
    )
  );
}
function RoleBtn(p) {
  return React.createElement("button", { style: st.roleBtn, onClick: p.onClick },
    React.createElement("span", { style: { fontSize: 16 } }, p.icon),
    React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, p.label)
  );
}
function QuickBtn(p) { return React.createElement("button", { style: st.quickBtn, onClick: p.onClick }, p.label); }
function TeamBadge(p) {
  const c = TEAM_COLORS[p.team] || "#888";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: p.small ? 11 : 13, padding: p.small ? "2px 8px" : "4px 12px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44", display: "inline-block" } }, p.team);
}
function AssigneeBadge(p) {
  const part = p.part;
  const vendors = p.vendors;
  if (!part.assignee || part.assignee === "未割当") return React.createElement("span", { style: { background: "#f0f0f0", color: "#aaa", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, "未割当");
  if (part.assigneeType === "outsource") {
    const v = vendors.find((v) => v.id === part.assignee);
    return React.createElement("span", { style: { background: "#88888818", color: "#555", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid #88888844" } }, "外注: " + (v ? v.name : "?"));
  }
  const c = TEAM_COLORS[part.assignee] || "#888";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44" } }, part.assignee);
}
function StatusBadge(p) {
  const colors = { "未着手": "#aaa", "受注確認": "#3b6fd4", "裁断待ち": "#c25000", "製作中": "#7a2a7a", "完了": "#2a7a2a" };
  const c = colors[p.status] || "#aaa";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44" } }, p.status);
}
function SectionLabel(p) { return React.createElement("div", { style: st.sectionLabel }, p.children); }
function Empty(p) { return React.createElement("div", { style: st.empty }, p.children); }
function FormRow(p) { return React.createElement("div", { style: { marginBottom: 14 } }, React.createElement("div", { style: { fontSize: 11, color: "#888", marginBottom: 4 } }, p.label), p.children); }
function SBox(p) {
  return React.createElement("div", { style: Object.assign({}, st.sBox, { background: p.dark ? "#1a1a1a" : "#fff" }) },
    React.createElement("div", { style: { fontSize: 10, color: p.dark ? "#777" : "#aaa", marginBottom: 5 } }, p.label),
    React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: p.dark ? "#fff" : "#1a1a1a" } }, p.value)
  );
}
function Badge(p) {
  const done = p.type === "done";
  return React.createElement("span", { style: { background: done ? "#e8f5e8" : "#fff3e0", color: done ? "#2a7a2a" : "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, done ? "完了" : "進行中");
}
function ProgressBar(p) {
  const pct = Math.min(Math.max(p.value || 0, 0), 1) * 100;
  const c = p.color || (pct >= 100 ? "#2a7a2a" : "#3b6fd4");
  return React.createElement("div", { style: st.barBg }, React.createElement("div", { style: Object.assign({}, st.barFill, { width: pct + "%", background: c }) }));
}
function DashCard(p) {
  const item = p.item;
  const colors = { red: "#c00", yellow: "#b07000", green: "#2a7a2a" };
  const c = colors[p.level];
  const isOut = item.assigneeType === "outsource";
  const assigneeLabel = isOut ? ("外注: " + (item.vendorName || "?")) : (item.assignee || "未割当");
  return React.createElement("button", { style: Object.assign({}, st.dashCard, { borderLeft: "4px solid " + c }), onClick: p.onClick },
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, item.partNo + (item.partName ? " (" + item.partName + ")" : "")),
        React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } }, assigneeLabel + (item.status ? " ／ " + item.status : ""))
      ),
      React.createElement("div", { style: { textAlign: "right" } },
        item.deadline && React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: c } }, "あと" + item.remainDays + "日"),
        item.deadline && React.createElement("div", { style: { fontSize: 11, color: "#aaa" } }, "納期: " + item.deadline.slice(5).replace("-", "/"))
      )
    ),
    item.qtyProgress !== null && React.createElement("div", { style: { marginTop: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
        React.createElement("span", null, "完成 " + item.completedQty + "枚 / " + item.qty + "枚"),
        React.createElement("span", { style: { color: c, fontWeight: 700 } }, "残り " + item.remainQty + "枚")
      ),
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
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 3 } },
        React.createElement("span", null, "完成 " + part.completedQty + "枚 / " + part.qty + "枚"),
        React.createElement("span", { style: { color: part.remainQty === 0 ? "#2a7a2a" : "#888", fontWeight: 700 } }, "残り " + part.remainQty + "枚")
      ),
      React.createElement(ProgressBar, { value: part.qtyProgress, color: part.remainQty === 0 ? "#2a7a2a" : "#3b6fd4" })
    ),
    React.createElement("div", { style: Object.assign({}, st.statsRow, { background: p.done ? "#eeecea" : "#f5f4f0" }) },
      React.createElement("span", null, "累計 "),
      React.createElement("b", null, part.totalHours.toFixed(1) + "h"),
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
  saveBadge: { background: "#1a1a1a", color: "#fff", fontSize: 12, padding: "8px 14px", borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,.2)" },
  spinner: { width: 32, height: 32, border: "3px solid #e0deda", borderTop: "3px solid #1a1a1a", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  alertBanner: { fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8, border: "1px solid", marginBottom: 8, marginTop: 8 },
  dashCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
};

const styleEl = document.createElement("style");
styleEl.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(styleEl);
