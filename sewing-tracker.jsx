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
  outsources: [],
  records: [],
  members: [],
  vendors: [],
  monthlyTargets: {},
};

const INIT_UI = {
  screen: "home",
  selectedTeam: null,
  userRole: null,
  memberForm: { memberId: "", partId: "", hours: "", date: today() },
  addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "", assignee: "", status: "未着手", note: "" },
  addOutsourceForm: { partNo: "", partName: "", vendorId: "", qty: "", sellPrice: "", vendorPrice: "", deadline: "", note: "", status: "未着手" },
  addMemberForm: { name: "" },
  addVendorForm: { name: "" },
  targetForm: { month: today().slice(0, 7), sales: "", hourlyRate: "" },
  activePartId: null,
  activeOutsourceId: null,
  summaryFilter: "all",
  summaryMonth: today().slice(0, 7),
  summaryTab: "parts",
  editMemberId: null,
  editMemberName: "",
  editVendorId: null,
  editVendorName: "",
};

async function gasSave(data) {
  const json = JSON.stringify(data);
  const encoded = encodeURIComponent(json);
  const url = GAS_URL + "?action=save&data=" + encoded;
  await fetch(url, { mode: "no-cors" });
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
  const setMF = (patch) => setUi((p) => Object.assign({}, p, { memberForm: Object.assign({}, p.memberForm, patch) }));
  const setAP = (patch) => setUi((p) => Object.assign({}, p, { addPartForm: Object.assign({}, p.addPartForm, patch) }));
  const setAO = (patch) => setUi((p) => Object.assign({}, p, { addOutsourceForm: Object.assign({}, p.addOutsourceForm, patch) }));
  const setTF = (patch) => setUi((p) => Object.assign({}, p, { targetForm: Object.assign({}, p.targetForm, patch) }));

  useEffect(() => {
    gasLoad().then((d) => {
      const merged = Object.assign({}, EMPTY_DATA, d);
      if (!Array.isArray(merged.members)) merged.members = [];
      if (!Array.isArray(merged.vendors)) merged.vendors = [];
      if (!Array.isArray(merged.outsources)) merged.outsources = [];
      setData(merged);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (newData) => {
    setSaving(true);
    try { await gasSave(newData); } catch(e) {}
    finally { setSaving(false); }
  }, []);

  function updateData(patch) {
    const newData = Object.assign({}, data, patch);
    setData(newData);
    save(newData);
  }

  const openParts = useMemo(() => data.parts.filter((p) => p.team === ui.selectedTeam && !p.closedAt), [data.parts, ui.selectedTeam]);

  const partSummary = useMemo(() => data.parts.map((part) => {
    const recs = data.records.filter((r) => r.partId === part.id);
    const totalHours = recs.reduce((a, r) => a + r.hours, 0);
    const totalSales = part.unitPrice * part.qty;
    const hourlyRate = totalHours > 0 ? totalSales / totalHours : 0;
    const estTotalHours = part.estHoursPerUnit * part.qty;
    const progress = estTotalHours > 0 ? Math.min(totalHours / estTotalHours, 1) : null;
    const estUnitsCompleted = part.estHoursPerUnit > 0 ? Math.floor(totalHours / part.estHoursPerUnit) : 0;
    const workerMap = {};
    for (const r of recs) workerMap[r.memberName] = (workerMap[r.memberName] || 0) + r.hours;
    const remainDays = diffDays(today(), part.deadline);
    const remainHours = estTotalHours - totalHours;
    const dailyNeeded = (remainDays && remainDays > 0 && remainHours > 0) ? remainHours / remainDays : null;
    return Object.assign({}, part, { totalHours, totalSales, hourlyRate, estTotalHours, progress, estUnitsCompleted, workerMap, recs, remainDays, dailyNeeded });
  }), [data.parts, data.records]);

  const outsourceSummary = useMemo(() => data.outsources.map((o) => {
    const vendor = data.vendors.find((v) => v.id === o.vendorId);
    const profit = (o.sellPrice - o.vendorPrice) * o.qty;
    const profitRate = o.sellPrice > 0 ? ((o.sellPrice - o.vendorPrice) / o.sellPrice) * 100 : 0;
    const remainDays = diffDays(today(), o.deadline);
    return Object.assign({}, o, { vendorName: vendor ? vendor.name : "未設定", profit, profitRate, remainDays });
  }), [data.outsources, data.vendors]);

  const activePart = partSummary.find((p) => p.id === ui.activePartId);
  const activeOutsource = outsourceSummary.find((o) => o.id === ui.activeOutsourceId);

  const dashboardItems = useMemo(() => {
    const internalItems = partSummary.filter((p) => !p.closedAt).map((p) => Object.assign({}, p, { type: "internal" }));
    const outsourceItems = outsourceSummary.filter((o) => !o.closedAt).map((o) => Object.assign({}, o, { type: "outsource" }));
    return internalItems.concat(outsourceItems).sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }, [partSummary, outsourceSummary]);

  function addPart() {
    const f = ui.addPartForm;
    if (!f.partNo || !f.unitPrice || !f.qty || !f.estHoursPerUnit) return;
    const np = { id: genId(), team: ui.selectedTeam, partNo: f.partNo.trim(), partName: f.partName.trim(), unitPrice: parseFloat(f.unitPrice), qty: parseFloat(f.qty), estHoursPerUnit: parseFloat(f.estHoursPerUnit), deadline: f.deadline || null, assignee: f.assignee.trim(), status: f.status || "未着手", note: f.note.trim(), createdAt: today(), closedAt: null };
    updateData({ parts: data.parts.concat([np]) });
    set({ addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "", assignee: "", status: "未着手", note: "" }, screen: "leader_menu" });
  }

  function addOutsource() {
    const f = ui.addOutsourceForm;
    if (!f.partNo || !f.qty || !f.sellPrice || !f.vendorPrice) return;
    const no = { id: genId(), partNo: f.partNo.trim(), partName: f.partName.trim(), vendorId: f.vendorId, qty: parseFloat(f.qty), sellPrice: parseFloat(f.sellPrice), vendorPrice: parseFloat(f.vendorPrice), deadline: f.deadline || null, note: f.note.trim(), status: f.status || "未着手", createdAt: today(), closedAt: null };
    updateData({ outsources: data.outsources.concat([no]) });
    set({ addOutsourceForm: { partNo: "", partName: "", vendorId: "", qty: "", sellPrice: "", vendorPrice: "", deadline: "", note: "", status: "未着手" }, screen: "outsource_menu" });
  }

  function closePart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? Object.assign({}, p, { closedAt: today() }) : p) }); }
  function reopenPart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? Object.assign({}, p, { closedAt: null }) : p) }); }
  function closeOutsource(id) { updateData({ outsources: data.outsources.map((o) => o.id === id ? Object.assign({}, o, { closedAt: today() }) : o) }); }
  function reopenOutsource(id) { updateData({ outsources: data.outsources.map((o) => o.id === id ? Object.assign({}, o, { closedAt: null }) : o) }); }

  function addRecord() {
    const f = ui.memberForm;
    const member = data.members.find((m) => m.id === f.memberId);
    if (!member || !f.partId || !f.hours) return;
    updateData({ records: data.records.concat([{ id: genId(), partId: f.partId, memberId: f.memberId, memberName: member.name, hours: parseFloat(f.hours), date: f.date }]) });
    setMF({ hours: "" });
  }
  function deleteRecord(id) { updateData({ records: data.records.filter((r) => r.id !== id) }); }

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
    if (!f.month || !ui.selectedTeam) return;
    const prev = data.monthlyTargets[f.month] || {};
    const newTargets = Object.assign({}, data.monthlyTargets);
    newTargets[f.month] = Object.assign({}, prev);
    newTargets[f.month][ui.selectedTeam] = { sales: parseFloat(f.sales) || 0, hourlyRate: parseFloat(f.hourlyRate) || 0 };
    updateData({ monthlyTargets: newTargets });
    setTF({ sales: "", hourlyRate: "" });
  }

  if (loading) return React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, fontFamily: "'Hiragino Sans', sans-serif" } },
    React.createElement("div", { style: st.spinner }),
    React.createElement("div", { style: { color: "#aaa", fontSize: 14 } }, "読み込み中...")
  );

  const SI = () => saving ? React.createElement("div", { style: { position: "fixed", bottom: 16, right: 16, zIndex: 100 } },
    React.createElement("div", { style: st.saveBadge }, "💾 保存中...")
  ) : null;

  // HOME
  if (ui.screen === "home") return React.createElement(Shell, null,
    React.createElement(Header, { title: "作業実績管理", sub: "IQUTA PLEATS" }),
    React.createElement(Body, null,
      React.createElement(BigBtn, { icon: "🗂️", label: "ダッシュボード", sub: "納期・進捗を一目で確認", onClick: () => set({ screen: "dashboard" }) }),
      React.createElement(Spacer, { h: 8 }),
      React.createElement(BigBtn, { icon: "📊", label: "集計・予算管理", sub: "全体・チーム別・月次の実績", onClick: () => set({ screen: "summary", summaryFilter: "all" }) }),
      React.createElement(Spacer, { h: 8 }),
      React.createElement(BigBtn, { icon: "🏭", label: "外注管理", sub: "外注先・納期・利益を管理", onClick: () => set({ screen: "outsource_menu" }) }),
      React.createElement(Spacer, { h: 12 }),
      React.createElement(Divider, { label: "社内チームを選ぶ" }),
      TEAMS.map((team) => React.createElement("div", { key: team, style: { marginBottom: 12 } },
        React.createElement(TeamBadge, { team }),
        React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 6 } },
          React.createElement(RoleBtn, { icon: "🔑", label: "リーダー", onClick: () => set({ selectedTeam: team, userRole: "leader", screen: "leader_menu" }) }),
          React.createElement(RoleBtn, { icon: "✂️", label: "メンバー", onClick: () => set({ selectedTeam: team, userRole: "member", screen: "member_entry", memberForm: { memberId: "", partId: "", hours: "", date: today() } }) })
        )
      )),
      React.createElement(Spacer, { h: 8 }),
      React.createElement(Divider, { label: "管理設定" }),
      React.createElement("div", { style: { display: "flex", gap: 8 } },
        React.createElement(QuickBtn, { label: "👥 メンバー管理", onClick: () => set({ screen: "member_mgmt" }) }),
        React.createElement(QuickBtn, { label: "🏢 外注先管理", onClick: () => set({ screen: "vendor_mgmt" }) })
      )
    ),
    React.createElement(SI)
  );

  // DASHBOARD
  if (ui.screen === "dashboard") {
    const urgent = dashboardItems.filter((p) => p.remainDays !== null && p.remainDays <= 3);
    const caution = dashboardItems.filter((p) => p.remainDays !== null && p.remainDays > 3 && p.remainDays <= 7);
    const normal = dashboardItems.filter((p) => p.remainDays === null || p.remainDays > 7);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "ダッシュボード", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 16 } }, "本日: " + today()),
        urgent.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#fff0f0", color: "#c00", borderColor: "#ffcccc" }) }, "🔴 緊急 — 納期まで3日以内"),
          urgent.map((p) => React.createElement(DashCard, { key: p.id, item: p, level: "red", onClick: () => p.type === "outsource" ? set({ activeOutsourceId: p.id, screen: "outsource_detail" }) : set({ activePartId: p.id, screen: "part_detail" }) }))
        ),
        caution.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#fffbf0", color: "#b07000", borderColor: "#ffe599" }) }, "🟡 要注意 — 納期まで7日以内"),
          caution.map((p) => React.createElement(DashCard, { key: p.id, item: p, level: "yellow", onClick: () => p.type === "outsource" ? set({ activeOutsourceId: p.id, screen: "outsource_detail" }) : set({ activePartId: p.id, screen: "part_detail" }) }))
        ),
        normal.length > 0 && React.createElement("div", null,
          React.createElement("div", { style: Object.assign({}, st.alertBanner, { background: "#f0f8f0", color: "#2a7a2a", borderColor: "#b8e6b8" }) }, "🟢 余裕あり"),
          normal.map((p) => React.createElement(DashCard, { key: p.id, item: p, level: "green", onClick: () => p.type === "outsource" ? set({ activeOutsourceId: p.id, screen: "outsource_detail" }) : set({ activePartId: p.id, screen: "part_detail" }) }))
        ),
        dashboardItems.length === 0 && React.createElement(Empty, null, "進行中の品番がありません")
      ),
      React.createElement(SI)
    );
  }

  // LEADER MENU
  if (ui.screen === "leader_menu") {
    const myParts = partSummary.filter((p) => p.team === ui.selectedTeam);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: ui.selectedTeam + "　リーダー", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 20 } },
          React.createElement(QuickBtn, { label: "＋ 品番登録", onClick: () => set({ screen: "add_part", addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "", assignee: "", status: "未着手", note: "" } }) }),
          React.createElement(QuickBtn, { label: "🎯 目標設定", onClick: () => set({ screen: "target_setting" }) })
        ),
        React.createElement(SectionLabel, null, "進行中の品番"),
        myParts.filter((p) => !p.closedAt).length === 0 && React.createElement(Empty, null, "進行中の品番はありません"),
        myParts.filter((p) => !p.closedAt).map((p) => React.createElement(PartCard, { key: p.id, p, onDetail: () => set({ activePartId: p.id, screen: "part_detail" }), onClose: () => closePart(p.id) })),
        React.createElement(SectionLabel, null, "完了済み"),
        myParts.filter((p) => p.closedAt).length === 0 && React.createElement(Empty, null, "完了済みの品番はありません"),
        myParts.filter((p) => p.closedAt).map((p) => React.createElement(PartCard, { key: p.id, p, done: true, onDetail: () => set({ activePartId: p.id, screen: "part_detail" }), onReopen: () => reopenPart(p.id) }))
      ),
      React.createElement(SI)
    );
  }

  // ADD PART
  if (ui.screen === "add_part") {
    const f = ui.addPartForm;
    const estTotal = (f.unitPrice && f.qty && f.estHoursPerUnit) ? { sales: parseFloat(f.unitPrice) * parseFloat(f.qty), hours: parseFloat(f.estHoursPerUnit) * parseFloat(f.qty) } : null;
    const ready = f.partNo && f.unitPrice && f.qty && f.estHoursPerUnit;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "品番を登録", back: () => set({ screen: "leader_menu" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { marginBottom: 12 } }, React.createElement(TeamBadge, { team: ui.selectedTeam })),
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品番" }, React.createElement("input", { style: st.input, placeholder: "例: A-2024-001", value: f.partNo, onChange: (e) => setAP({ partNo: e.target.value }) })),
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, placeholder: "例: プリーツスカート", value: f.partName, onChange: (e) => setAP({ partName: e.target.value }) })),
          React.createElement(FormRow, { label: "担当者" }, React.createElement("input", { style: st.input, placeholder: "例: 生田", value: f.assignee, onChange: (e) => setAP({ assignee: e.target.value }) })),
          React.createElement(FormRow, { label: "ステータス" }, React.createElement("select", { style: st.input, value: f.status, onChange: (e) => setAP({ status: e.target.value }) }, STATUSES.map((s) => React.createElement("option", { key: s }, s)))),
          React.createElement(FormRow, { label: "製品単価（円）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3000", value: f.unitPrice, onChange: (e) => setAP({ unitPrice: e.target.value }) })),
          React.createElement(FormRow, { label: "数量（枚）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 50", value: f.qty, onChange: (e) => setAP({ qty: e.target.value }) })),
          React.createElement(FormRow, { label: "1着あたりの見積もり時間（h）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 0.5", min: "0", step: "0.1", value: f.estHoursPerUnit, onChange: (e) => setAP({ estHoursPerUnit: e.target.value }) })),
          React.createElement(FormRow, { label: "納期（任意）" }, React.createElement("input", { style: st.input, type: "date", value: f.deadline, onChange: (e) => setAP({ deadline: e.target.value }) })),
          React.createElement(FormRow, { label: "備考" }, React.createElement("input", { style: st.input, placeholder: "例: 急ぎ対応", value: f.note, onChange: (e) => setAP({ note: e.target.value }) })),
          estTotal && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: "#f0f8f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "合計売上予定"), React.createElement("b", null, "¥" + Math.round(estTotal.sales).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "総見積もり時間"), React.createElement("b", null, estTotal.hours.toFixed(1) + "h")),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "目標時間単価"), React.createElement("b", { style: { color: "#2a7a2a" } }, "¥" + Math.round(estTotal.sales / estTotal.hours).toLocaleString() + "/h"))
          ),
          React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: addPart }, "登録する")
        )
      )
    );
  }

  // OUTSOURCE MENU
  if (ui.screen === "outsource_menu") {
    const openOut = outsourceSummary.filter((o) => !o.closedAt);
    const doneOut = outsourceSummary.filter((o) => o.closedAt);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "外注管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("button", { style: st.dashedBtn, onClick: () => set({ screen: "add_outsource", addOutsourceForm: { partNo: "", partName: "", vendorId: "", qty: "", sellPrice: "", vendorPrice: "", deadline: "", note: "", status: "未着手" } }) }, "＋ 外注品番を登録する"),
        React.createElement(SectionLabel, null, "進行中の外注品番"),
        openOut.length === 0 && React.createElement(Empty, null, "進行中の外注品番はありません"),
        openOut.map((o) => React.createElement("div", { key: o.id, style: st.leaderCard },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } },
            React.createElement("div", null,
              React.createElement("div", { style: st.partNoText }, o.partNo + (o.partName ? " (" + o.partName + ")" : "")),
              React.createElement("div", { style: st.partMeta }, "外注先: " + o.vendorName),
              o.deadline && React.createElement("div", { style: { fontSize: 12, color: o.remainDays <= 3 ? "#c00" : o.remainDays <= 7 ? "#c25000" : "#aaa", marginTop: 4 } }, "納期: " + fmt(o.deadline) + "（あと" + o.remainDays + "日）")
            ),
            React.createElement("button", { style: st.detailLink, onClick: () => set({ activeOutsourceId: o.id, screen: "outsource_detail" }) }, "詳細 ›")
          ),
          React.createElement("div", { style: st.statsRow },
            React.createElement("span", null, "利益 "),
            React.createElement("b", { style: { color: o.profit >= 0 ? "#2a7a2a" : "#c00" } }, "¥" + Math.round(o.profit).toLocaleString()),
            React.createElement("span", { style: { color: "#ddd" } }, "｜"),
            React.createElement("span", null, "利益率 "),
            React.createElement("b", null, o.profitRate.toFixed(1) + "%")
          ),
          React.createElement("button", { style: st.closeBtn, onClick: () => closeOutsource(o.id) }, "この品番を完了にする")
        )),
        React.createElement(SectionLabel, null, "完了済み"),
        doneOut.length === 0 && React.createElement(Empty, null, "完了済みの外注品番はありません"),
        doneOut.map((o) => React.createElement("div", { key: o.id, style: Object.assign({}, st.leaderCard, { opacity: 0.72 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } },
            React.createElement("div", null,
              React.createElement("div", { style: Object.assign({}, st.partNoText, { color: "#777" }) }, o.partNo + (o.partName ? " (" + o.partName + ")" : "")),
              React.createElement("div", { style: st.partMeta }, "外注先: " + o.vendorName + " ／ 完了: " + fmt(o.closedAt))
            ),
            React.createElement("button", { style: st.detailLink, onClick: () => set({ activeOutsourceId: o.id, screen: "outsource_detail" }) }, "詳細 ›")
          ),
          React.createElement("div", { style: Object.assign({}, st.statsRow, { background: "#eeecea" }) },
            React.createElement("span", null, "利益 "),
            React.createElement("b", { style: { color: "#2a7a2a" } }, "¥" + Math.round(o.profit).toLocaleString()),
            React.createElement("span", null, " 確定")
          ),
          React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777" }), onClick: () => reopenOutsource(o.id) }, "再開する")
        ))
      ),
      React.createElement(SI)
    );
  }

  // ADD OUTSOURCE
  if (ui.screen === "add_outsource") {
    const f = ui.addOutsourceForm;
    const profit = (f.sellPrice && f.vendorPrice && f.qty) ? (parseFloat(f.sellPrice) - parseFloat(f.vendorPrice)) * parseFloat(f.qty) : null;
    const profitRate = (f.sellPrice && f.vendorPrice && parseFloat(f.sellPrice) > 0) ? ((parseFloat(f.sellPrice) - parseFloat(f.vendorPrice)) / parseFloat(f.sellPrice)) * 100 : null;
    const ready = f.partNo && f.qty && f.sellPrice && f.vendorPrice;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "外注品番を登録", back: () => set({ screen: "outsource_menu" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "品番" }, React.createElement("input", { style: st.input, placeholder: "例: B-2024-010", value: f.partNo, onChange: (e) => setAO({ partNo: e.target.value }) })),
          React.createElement(FormRow, { label: "品名" }, React.createElement("input", { style: st.input, placeholder: "例: プリーツパンツ", value: f.partName, onChange: (e) => setAO({ partName: e.target.value }) })),
          React.createElement(FormRow, { label: "外注先" },
            data.vendors.length === 0
              ? React.createElement("div", { style: { color: "#bbb", fontSize: 13, padding: "8px 0" } }, "外注先が登録されていません（ホーム→外注先管理から登録）")
              : React.createElement("select", { style: st.input, value: f.vendorId, onChange: (e) => setAO({ vendorId: e.target.value }) },
                  React.createElement("option", { value: "" }, "選択してください"),
                  data.vendors.map((v) => React.createElement("option", { key: v.id, value: v.id }, v.name))
                )
          ),
          React.createElement(FormRow, { label: "ステータス" }, React.createElement("select", { style: st.input, value: f.status, onChange: (e) => setAO({ status: e.target.value }) }, STATUSES.map((s) => React.createElement("option", { key: s }, s)))),
          React.createElement(FormRow, { label: "数量（枚）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 100", value: f.qty, onChange: (e) => setAO({ qty: e.target.value }) })),
          React.createElement(FormRow, { label: "販売単価（円）— 得意先への売価" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 5000", value: f.sellPrice, onChange: (e) => setAO({ sellPrice: e.target.value }) })),
          React.createElement(FormRow, { label: "外注単価（円）— 外注先への支払い" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3000", value: f.vendorPrice, onChange: (e) => setAO({ vendorPrice: e.target.value }) })),
          React.createElement(FormRow, { label: "納期（任意）" }, React.createElement("input", { style: st.input, type: "date", value: f.deadline, onChange: (e) => setAO({ deadline: e.target.value }) })),
          React.createElement(FormRow, { label: "備考" }, React.createElement("input", { style: st.input, placeholder: "メモなど", value: f.note, onChange: (e) => setAO({ note: e.target.value }) })),
          profit !== null && React.createElement("div", { style: Object.assign({}, st.previewBox, { background: profit >= 0 ? "#f0f8f0" : "#fff0f0" }) },
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "売上合計"), React.createElement("b", null, "¥" + Math.round(parseFloat(f.sellPrice) * parseFloat(f.qty)).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "外注費合計"), React.createElement("b", null, "¥" + Math.round(parseFloat(f.vendorPrice) * parseFloat(f.qty)).toLocaleString())),
            React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "利益"), React.createElement("b", { style: { color: profit >= 0 ? "#2a7a2a" : "#c00" } }, "¥" + Math.round(profit).toLocaleString())),
            profitRate !== null && React.createElement("div", { style: st.previewRow }, React.createElement("span", null, "利益率"), React.createElement("b", null, profitRate.toFixed(1) + "%"))
          ),
          React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: addOutsource }, "登録する")
        )
      )
    );
  }

  // OUTSOURCE DETAIL
  if (ui.screen === "outsource_detail" && activeOutsource) {
    const o = activeOutsource;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: o.partNo, back: () => set({ screen: "outsource_menu" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" } },
          React.createElement(Badge, { type: o.closedAt ? "done" : "open" }),
          React.createElement("span", { style: { fontSize: 12, color: "#888" } }, "外注"),
          o.status && React.createElement(StatusBadge, { status: o.status })
        ),
        o.partName && React.createElement("div", { style: { fontSize: 15, color: "#555", marginBottom: 12 } }, o.partName),
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px", marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 13 } },
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "登録日"), React.createElement("div", { style: { fontWeight: 700 } }, fmt(o.createdAt))),
            o.deadline && React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "納期"), React.createElement("div", { style: { fontWeight: 700, color: o.closedAt ? "#aaa" : (o.remainDays <= 3 ? "#c00" : "#c25000") } }, fmt(o.deadline))),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "完了日"), React.createElement("div", { style: { fontWeight: 700, color: o.closedAt ? "#2a7a2a" : "#bbb" } }, o.closedAt ? fmt(o.closedAt) : "進行中"))
          ),
          o.deadline && !o.closedAt && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: o.remainDays <= 3 ? "#c00" : "#888" } }, "納期まであと ", React.createElement("b", null, o.remainDays), " 日")
        ),
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "外注先", value: o.vendorName }),
          React.createElement(SBox, { label: "数量", value: o.qty + "枚" }),
          React.createElement(SBox, { label: "販売単価", value: "¥" + o.sellPrice.toLocaleString() }),
          React.createElement(SBox, { label: "外注単価", value: "¥" + o.vendorPrice.toLocaleString() })
        ),
        React.createElement("div", { style: Object.assign({}, st.rateBox, { background: o.closedAt ? "#1a1a1a" : "#f0f0ec", color: o.closedAt ? "#fff" : "#1a1a1a", marginBottom: 16 }) },
          React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, o.closedAt ? "利益（確定）" : "見込み利益"),
          React.createElement("div", { style: { fontSize: 28, fontWeight: 700, color: o.profit >= 0 ? (o.closedAt ? "#7dff7d" : "#2a7a2a") : "#c00" } }, "¥" + Math.round(o.profit).toLocaleString()),
          React.createElement("div", { style: { fontSize: 13, opacity: 0.7, marginTop: 4 } }, "利益率 " + o.profitRate.toFixed(1) + "% ／ 売上合計 ¥" + Math.round(o.sellPrice * o.qty).toLocaleString() + " ／ 外注費 ¥" + Math.round(o.vendorPrice * o.qty).toLocaleString())
        ),
        o.note && React.createElement("div", { style: Object.assign({}, st.card, { fontSize: 13, color: "#555" }) }, "📝 " + o.note),
        !o.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { marginTop: 8 }), onClick: () => { closeOutsource(o.id); set({ screen: "outsource_menu" }); } }, "この品番を完了にする"),
        o.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777", marginTop: 8 }), onClick: () => reopenOutsource(o.id) }, "再開する")
      ),
      React.createElement(SI)
    );
  }

  // MEMBER MGMT
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

  // VENDOR MGMT
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

  // MEMBER ENTRY
  if (ui.screen === "member_entry") {
    const f = ui.memberForm;
    const todayRecs = data.records.filter((r) => { const part = data.parts.find((p) => p.id === r.partId); return r.date === f.date && part && part.team === ui.selectedTeam; });
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
                openParts.length === 0
                  ? React.createElement("div", { style: { color: "#bbb", fontSize: 13, padding: "8px 0" } }, "進行中の品番がありません")
                  : React.createElement("select", { style: st.input, value: f.partId, onChange: (e) => setMF({ partId: e.target.value }) },
                      React.createElement("option", { value: "" }, "選択してください"),
                      openParts.map((p) => React.createElement("option", { key: p.id, value: p.id }, p.partNo + (p.partName ? " (" + p.partName + ")" : "")))
                    )
              ),
              React.createElement(FormRow, { label: "作業時間（h）" }, React.createElement("input", { style: st.input, type: "number", placeholder: "例: 3.5", min: "0", step: "0.5", value: f.hours, onChange: (e) => setMF({ hours: e.target.value }) })),
              React.createElement("button", { style: Object.assign({}, st.primaryBtn, { opacity: ready ? 1 : 0.35 }), disabled: !ready, onClick: addRecord }, "記録する")
            ),
        React.createElement(SectionLabel, null, "本日の入力 (" + f.date + ")"),
        todayRecs.length === 0 && React.createElement(Empty, null, "まだ入力がありません"),
        todayRecs.map((r) => { const part = data.parts.find((x) => x.id === r.partId); return React.createElement("div", { key: r.id, style: st.recRow },
          React.createElement("span", { style: { fontSize: 12, color: "#888", minWidth: 64 } }, r.memberName),
          React.createElement("span", { style: { fontSize: 13, fontWeight: 700, flex: 1 } }, part ? part.partNo : "?"),
          React.createElement("span", { style: { fontSize: 13, color: "#555" } }, r.hours + "h"),
          React.createElement("button", { style: st.deleteBtn, onClick: () => deleteRecord(r.id) }, "✕")
        ); })
      ),
      React.createElement(SI)
    );
  }

  // TARGET SETTING
  if (ui.screen === "target_setting") {
    const f = ui.targetForm;
    const existing = data.monthlyTargets[f.month] && data.monthlyTargets[f.month][ui.selectedTeam];
    return React.createElement(Shell, null,
      React.createElement(Header, { title: ui.selectedTeam + "　月次目標設定", back: () => set({ screen: "leader_menu" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.card },
          React.createElement(FormRow, { label: "対象月" }, React.createElement("input", { style: st.input, type: "month", value: f.month, onChange: (e) => setTF({ month: e.target.value }) })),
          React.createElement(FormRow, { label: "売上目標（円）" }, React.createElement("input", { style: st.input, type: "number", placeholder: existing ? "現在: ¥" + existing.sales.toLocaleString() : "例: 500000", value: f.sales, onChange: (e) => setTF({ sales: e.target.value }) })),
          React.createElement(FormRow, { label: "目標時間単価（円/h）" }, React.createElement("input", { style: st.input, type: "number", placeholder: existing ? "現在: ¥" + existing.hourlyRate.toLocaleString() + "/h" : "例: 2000", value: f.hourlyRate, onChange: (e) => setTF({ hourlyRate: e.target.value }) })),
          React.createElement("button", { style: st.primaryBtn, onClick: saveTarget }, "保存する")
        )
      ),
      React.createElement(SI)
    );
  }

  // SUMMARY
  if (ui.screen === "summary") {
    const filtered = ui.summaryFilter === "all" ? partSummary : partSummary.filter((p) => p.team === ui.summaryFilter);
    const totalSales = filtered.reduce((a, p) => a + p.totalSales, 0);
    const totalHours = filtered.reduce((a, p) => a + p.totalHours, 0);
    const overallRate = totalHours > 0 ? totalSales / totalHours : 0;
    const outTotal = outsourceSummary.reduce((a, o) => a + o.profit, 0);
    return React.createElement(Shell, null,
      React.createElement(Header, { title: "集計・予算管理", back: () => set({ screen: "home" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: st.tabRow },
          React.createElement(TabBtn, { label: "社内実績", active: ui.summaryTab !== "monthly", onClick: () => set({ summaryTab: "parts" }) }),
          React.createElement(TabBtn, { label: "月次管理", active: ui.summaryTab === "monthly", onClick: () => set({ summaryTab: "monthly" }) })
        ),
        ui.summaryTab !== "monthly"
          ? React.createElement("div", null,
              React.createElement("div", { style: st.filterRow },
                ["all"].concat(TEAMS).map((f2) => React.createElement("button", { key: f2, style: Object.assign({}, st.filterBtn, ui.summaryFilter === f2 ? st.filterBtnActive : {}), onClick: () => set({ summaryFilter: f2 }) }, f2 === "all" ? "全体" : f2))
              ),
              React.createElement("div", { style: st.grid2 },
                React.createElement(SBox, { label: "社内総売上", value: "¥" + Math.round(totalSales).toLocaleString() }),
                React.createElement(SBox, { label: "総作業時間", value: totalHours.toFixed(1) + "h" }),
                React.createElement(SBox, { label: "平均時間単価", value: "¥" + Math.round(overallRate).toLocaleString() + "/h", dark: true }),
                React.createElement(SBox, { label: "外注利益合計", value: "¥" + Math.round(outTotal).toLocaleString() })
              ),
              React.createElement(SectionLabel, null, "品番別実績"),
              filtered.length === 0 && React.createElement(Empty, null, "データがありません"),
              filtered.map((p) => React.createElement("button", { key: p.id, style: st.summaryCard, onClick: () => set({ activePartId: p.id, screen: "part_detail" }) },
                React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } },
                  React.createElement("div", null,
                    React.createElement("span", { style: st.partNoText }, p.partNo),
                    p.partName && React.createElement("span", { style: { fontSize: 11, color: "#bbb", marginLeft: 6 } }, p.partName),
                    React.createElement("span", { style: { fontSize: 11, color: "#bbb", marginLeft: 6 } }, p.team)
                  ),
                  React.createElement("span", { style: { display: "flex", gap: 6, alignItems: "center" } },
                    React.createElement(Badge, { type: p.closedAt ? "done" : "open" }),
                    React.createElement("span", { style: { color: "#ccc" } }, "›")
                  )
                ),
                React.createElement("div", { style: st.dateRow },
                  React.createElement("span", null, "開始: " + fmt(p.createdAt)),
                  React.createElement("span", { style: { color: "#ddd" } }, "→"),
                  React.createElement("span", { style: { color: p.closedAt ? "#2a7a2a" : (p.deadline ? "#c25000" : "#bbb") } }, p.closedAt ? "完了: " + fmt(p.closedAt) : (p.deadline ? "納期: " + fmt(p.deadline) : "納期未設定"))
                ),
                React.createElement("div", { style: { display: "flex", gap: 20, marginTop: 8 } },
                  React.createElement(MiniCell, { label: "総時間", val: p.totalHours.toFixed(1) + "h" }),
                  React.createElement(MiniCell, { label: "売上", val: "¥" + Math.round(p.totalSales).toLocaleString() }),
                  React.createElement(MiniCell, { label: "時間単価", val: p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "—", accent: true })
                )
              ))
            )
          : React.createElement("div", null,
              React.createElement(FormRow, { label: "対象月" }, React.createElement("input", { style: st.input, type: "month", value: ui.summaryMonth, onChange: (e) => set({ summaryMonth: e.target.value }) })),
              React.createElement(Spacer, { h: 8 }),
              TEAMS.map((team) => {
                const tParts = partSummary.filter((p) => p.team === team);
                const tRecs = data.records.filter((r) => { const part = data.parts.find((p) => p.id === r.partId); return part && part.team === team && r.date.startsWith(ui.summaryMonth); });
                const mHours = tRecs.reduce((a, r) => a + r.hours, 0);
                const mSales = tParts.filter((p) => p.closedAt && p.closedAt.startsWith(ui.summaryMonth)).reduce((a, p) => a + p.totalSales, 0);
                const mRate = mHours > 0 ? mSales / mHours : 0;
                const target = data.monthlyTargets[ui.summaryMonth] && data.monthlyTargets[ui.summaryMonth][team];
                return React.createElement("div", { key: team, style: st.monthlyCard },
                  React.createElement("div", { style: { marginBottom: 10 } }, React.createElement(TeamBadge, { team, small: true })),
                  React.createElement("div", { style: st.grid2 },
                    React.createElement(SBox, { label: "実績売上", value: "¥" + Math.round(mSales).toLocaleString() }),
                    React.createElement(SBox, { label: "実績時間", value: mHours.toFixed(1) + "h" }),
                    target ? React.createElement(SBox, { label: "売上達成率", value: Math.round((mSales / target.sales) * 100) + "%", dark: mSales >= target.sales }) : React.createElement(SBox, { label: "売上目標", value: "未設定" }),
                    target ? React.createElement(SBox, { label: "時間単価 vs 目標", value: mHours > 0 ? "¥" + Math.round(mRate).toLocaleString() + "/h" : "—", dark: mRate >= target.hourlyRate }) : React.createElement(SBox, { label: "時間単価目標", value: "未設定" })
                  )
                );
              })
            )
      ),
      React.createElement(SI)
    );
  }

  // PART DETAIL
  if (ui.screen === "part_detail" && activePart) {
    const p = activePart;
    const estRate = p.estTotalHours > 0 ? p.totalSales / p.estTotalHours : null;
    return React.createElement(Shell, null,
      React.createElement(Header, { title: p.partNo, back: () => set({ screen: ui.userRole === "leader" ? "leader_menu" : "summary" }) }),
      React.createElement(Body, null,
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" } },
          React.createElement(Badge, { type: p.closedAt ? "done" : "open" }),
          React.createElement(TeamBadge, { team: p.team, small: true }),
          p.status && React.createElement(StatusBadge, { status: p.status })
        ),
        p.partName && React.createElement("div", { style: { fontSize: 15, color: "#555", marginBottom: 4 } }, p.partName),
        p.assignee && React.createElement("div", { style: { fontSize: 12, color: "#aaa", marginBottom: 12 } }, "担当: " + p.assignee),
        React.createElement("div", { style: Object.assign({}, st.card, { padding: "12px 16px", marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 13 } },
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "開始日"), React.createElement("div", { style: { fontWeight: 700 } }, fmt(p.createdAt))),
            p.deadline && React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "納期"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#aaa" : (p.remainDays <= 3 ? "#c00" : "#c25000") } }, fmt(p.deadline))),
            React.createElement("div", null, React.createElement("div", { style: st.cellLabel }, "完了日"), React.createElement("div", { style: { fontWeight: 700, color: p.closedAt ? "#2a7a2a" : "#bbb" } }, p.closedAt ? fmt(p.closedAt) : "進行中"))
          ),
          p.deadline && !p.closedAt && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: p.remainDays <= 3 ? "#c00" : "#888" } }, "納期まであと ", React.createElement("b", null, p.remainDays), " 日", p.dailyNeeded ? " ／ 1日あたり " + p.dailyNeeded.toFixed(1) + "h 必要" : "")
        ),
        React.createElement("div", { style: st.grid2 },
          React.createElement(SBox, { label: "製品単価", value: "¥" + p.unitPrice.toLocaleString() }),
          React.createElement(SBox, { label: "数量", value: p.qty + "枚" }),
          React.createElement(SBox, { label: "総売上", value: "¥" + Math.round(p.totalSales).toLocaleString() }),
          React.createElement(SBox, { label: "総作業時間", value: p.totalHours.toFixed(1) + "h" })
        ),
        p.progress !== null && React.createElement("div", { style: Object.assign({}, st.card, { marginBottom: 16 }) },
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 6 } },
            React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, "進捗"),
            React.createElement("span", { style: { fontSize: 13, color: "#555" } }, Math.round(p.progress * 100) + "%（約" + p.estUnitsCompleted + "着完了）")
          ),
          React.createElement(ProgressBar, { value: p.progress }),
          React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginTop: 4 } },
            React.createElement("span", null, "実績 " + p.totalHours.toFixed(1) + "h"),
            React.createElement("span", null, "見積もり " + p.estTotalHours.toFixed(1) + "h（" + p.estHoursPerUnit + "h/着）")
          )
        ),
        React.createElement("div", { style: Object.assign({}, st.rateBox, { background: p.closedAt ? "#1a1a1a" : "#f0f0ec", color: p.closedAt ? "#fff" : "#1a1a1a", marginBottom: 16 }) },
          React.createElement("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 } }, p.closedAt ? "時間あたり売上（確定）" : "現時点の時間あたり売上"),
          React.createElement("div", { style: { fontSize: 28, fontWeight: 700 } }, p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "—"),
          estRate && p.totalHours > 0 && React.createElement("div", { style: { fontSize: 12, opacity: 0.6, marginTop: 4 } }, "見積もり目標: ¥" + Math.round(estRate).toLocaleString() + "/h ",
            React.createElement("span", { style: { color: p.hourlyRate >= estRate ? "#7dff7d" : "#ffaaaa" } }, p.hourlyRate >= estRate ? "▲ 目標超え" : "▼ 目標未達")
          )
        ),
        p.note && React.createElement("div", { style: Object.assign({}, st.card, { fontSize: 13, color: "#555", marginBottom: 16 }) }, "📝 " + p.note),
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
        )),
        !p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { marginTop: 20 }), onClick: () => { closePart(p.id); set({ screen: "leader_menu" }); } }, "この品番を完了にする"),
        p.closedAt && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777", marginTop: 16 }), onClick: () => reopenPart(p.id) }, "再開する")
      ),
      React.createElement(SI)
    );
  }

  return null;
}

// ── Sub-components ──────────────────────────────────────────────────
function Shell(props) { return React.createElement("div", { style: st.root }, props.children); }
function Header(props) {
  return React.createElement("div", { style: st.header },
    props.back && React.createElement("button", { style: st.backBtn, onClick: props.back }, "‹ 戻る"),
    props.sub && React.createElement("div", { style: { fontSize: 10, letterSpacing: "0.2em", color: "#555", marginBottom: 2 } }, props.sub),
    React.createElement("div", { style: st.headerTitle }, props.title)
  );
}
function Body(props) { return React.createElement("div", { style: st.body }, props.children); }
function Spacer(props) { return React.createElement("div", { style: { height: props.h || 8 } }); }
function Divider(props) {
  return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" } },
    React.createElement("div", { style: { flex: 1, height: 1, background: "#e0deda" } }),
    React.createElement("span", { style: { fontSize: 11, color: "#bbb" } }, props.label),
    React.createElement("div", { style: { flex: 1, height: 1, background: "#e0deda" } })
  );
}
function BigBtn(props) {
  return React.createElement("button", { style: st.bigBtn, onClick: props.onClick },
    React.createElement("span", { style: { fontSize: 22 } }, props.icon),
    React.createElement("div", { style: { textAlign: "left" } },
      React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, props.label),
      React.createElement("div", { style: { fontSize: 11, color: "#999", marginTop: 2 } }, props.sub)
    )
  );
}
function RoleBtn(props) {
  return React.createElement("button", { style: st.roleBtn, onClick: props.onClick },
    React.createElement("span", { style: { fontSize: 16 } }, props.icon),
    React.createElement("span", { style: { fontSize: 13, fontWeight: 700 } }, props.label)
  );
}
function QuickBtn(props) { return React.createElement("button", { style: st.quickBtn, onClick: props.onClick }, props.label); }
function TabBtn(props) { return React.createElement("button", { style: Object.assign({}, st.tabBtn, props.active ? st.tabBtnActive : {}), onClick: props.onClick }, props.label); }
function TeamBadge(props) {
  const c = TEAM_COLORS[props.team] || "#888";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: props.small ? 11 : 13, padding: props.small ? "2px 8px" : "4px 12px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44", display: "inline-block" } }, props.team);
}
function StatusBadge(props) {
  const colors = { "未着手": "#aaa", "受注確認": "#3b6fd4", "裁断待ち": "#c25000", "製作中": "#7a2a7a", "完了": "#2a7a2a" };
  const c = colors[props.status] || "#aaa";
  return React.createElement("span", { style: { background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: "1px solid " + c + "44" } }, props.status);
}
function SectionLabel(props) { return React.createElement("div", { style: st.sectionLabel }, props.children); }
function Empty(props) { return React.createElement("div", { style: st.empty }, props.children); }
function FormRow(props) {
  return React.createElement("div", { style: { marginBottom: 14 } },
    React.createElement("div", { style: { fontSize: 11, color: "#888", marginBottom: 4 } }, props.label),
    props.children
  );
}
function SBox(props) {
  return React.createElement("div", { style: Object.assign({}, st.sBox, { background: props.dark ? "#1a1a1a" : "#fff" }) },
    React.createElement("div", { style: { fontSize: 10, color: props.dark ? "#777" : "#aaa", marginBottom: 5 } }, props.label),
    React.createElement("div", { style: { fontSize: 15, fontWeight: 700, color: props.dark ? "#fff" : "#1a1a1a" } }, props.value)
  );
}
function MiniCell(props) {
  return React.createElement("div", null,
    React.createElement("div", { style: { fontSize: 10, color: "#bbb", marginBottom: 2 } }, props.label),
    React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: props.accent ? "#2a7a2a" : "#1a1a1a" } }, props.val)
  );
}
function Badge(props) {
  const done = props.type === "done";
  return React.createElement("span", { style: { background: done ? "#e8f5e8" : "#fff3e0", color: done ? "#2a7a2a" : "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 } }, done ? "完了" : "進行中");
}
function ProgressBar(props) {
  const pct = Math.min(Math.max(props.value || 0, 0), 1) * 100;
  const c = props.color || (pct >= 100 ? "#2a7a2a" : "#3b6fd4");
  return React.createElement("div", { style: st.barBg }, React.createElement("div", { style: Object.assign({}, st.barFill, { width: pct + "%", background: c }) }));
}
function DashCard(props) {
  const item = props.item;
  const colors = { red: "#c00", yellow: "#b07000", green: "#2a7a2a" };
  const c = colors[props.level];
  const isOut = item.type === "outsource";
  return React.createElement("button", { style: Object.assign({}, st.dashCard, { borderLeft: "4px solid " + c }), onClick: props.onClick },
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" } },
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, item.partNo + (item.partName ? " (" + item.partName + ")" : "")),
        React.createElement("div", { style: { fontSize: 11, color: "#aaa", marginTop: 2 } },
          (isOut ? "外注: " + item.vendorName : item.team) +
          (item.assignee ? " ／ 担当: " + item.assignee : "") +
          (item.status ? " ／ " + item.status : "")
        )
      ),
      React.createElement("div", { style: { textAlign: "right" } },
        item.deadline && React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: c } }, "あと" + item.remainDays + "日"),
        item.deadline && React.createElement("div", { style: { fontSize: 11, color: "#aaa" } }, "納期: " + item.deadline.slice(5).replace("-", "/"))
      )
    ),
    !isOut && item.progress !== null && React.createElement("div", { style: { marginTop: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
        React.createElement("span", null, "進捗 " + Math.round(item.progress * 100) + "%"),
        item.dailyNeeded && React.createElement("span", { style: { color: c } }, "1日あたり" + item.dailyNeeded.toFixed(1) + "h必要")
      ),
      React.createElement(ProgressBar, { value: item.progress, color: c })
    ),
    isOut && React.createElement("div", { style: { marginTop: 8, fontSize: 12, color: item.profit >= 0 ? "#2a7a2a" : "#c00" } }, "見込み利益: ¥" + Math.round(item.profit).toLocaleString() + " （" + item.profitRate.toFixed(1) + "%）")
  );
}
function PartCard(props) {
  const p = props.p;
  return React.createElement("div", { style: Object.assign({}, st.leaderCard, { opacity: props.done ? 0.75 : 1 }) },
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 } },
      React.createElement("div", null,
        React.createElement("div", { style: Object.assign({}, st.partNoText, { color: props.done ? "#777" : "#1a1a1a" }) }, p.partNo + (p.partName ? " " : ""), p.partName && React.createElement("span", { style: { fontSize: 12, color: "#aaa", fontWeight: 400 } }, p.partName)),
        React.createElement("div", { style: st.partMeta }, props.done ? "完了日: " + (p.closedAt ? p.closedAt.slice(5).replace("-", "/") : "") : "¥" + p.unitPrice.toLocaleString() + " × " + p.qty + "枚"),
        React.createElement("div", { style: { display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" } },
          p.status && React.createElement(StatusBadge, { status: p.status }),
          p.deadline && !props.done && React.createElement("span", { style: { fontSize: 11, color: p.remainDays <= 3 ? "#c00" : p.remainDays <= 7 ? "#c25000" : "#aaa" } }, "納期: " + fmt(p.deadline) + "（あと" + p.remainDays + "日）")
        )
      ),
      React.createElement("button", { style: st.detailLink, onClick: props.onDetail }, "詳細 ›")
    ),
    !props.done && p.progress !== null && React.createElement("div", { style: { marginBottom: 8 } },
      React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 } },
        React.createElement("span", null, "進捗 " + Math.round(p.progress * 100) + "%"),
        React.createElement("span", null, p.totalHours.toFixed(1) + "h / " + p.estTotalHours.toFixed(1) + "h")
      ),
      React.createElement(ProgressBar, { value: p.progress })
    ),
    React.createElement("div", { style: Object.assign({}, st.statsRow, { background: props.done ? "#eeecea" : "#f5f4f0" }) },
      React.createElement("span", null, "累計 "),
      React.createElement("b", null, p.totalHours.toFixed(1) + "h"),
      React.createElement("span", { style: { color: "#ddd" } }, "｜"),
      React.createElement("span", { style: { color: props.done ? "#2a7a2a" : "#555", fontWeight: props.done ? 700 : 400 } }, p.totalHours > 0 ? "¥" + Math.round(p.hourlyRate).toLocaleString() + "/h" : "—", props.done ? " 確定" : "")
    ),
    !props.done && React.createElement("button", { style: st.closeBtn, onClick: props.onClose }, "この品番を完了にする"),
    props.done && React.createElement("button", { style: Object.assign({}, st.closeBtn, { background: "#e8e6e0", color: "#777" }), onClick: props.onReopen }, "再開する")
  );
}

const st = {
  root: { fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", background: "#f5f4f0", minHeight: "100vh", maxWidth: 680, margin: "0 auto", paddingBottom: 48 },
  header: { background: "#1a1a1a", color: "#fff", padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 },
  headerTitle: { fontSize: 18, fontWeight: 700 },
  backBtn: { background: "none", border: "none", color: "#777", fontSize: 14, padding: "0 0 4px", cursor: "pointer", display: "block" },
  body: { padding: "16px", maxWidth: 680, margin: "0 auto" },
  bigBtn: { display: "flex", alignItems: "center", gap: 16, width: "100%", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 12, padding: "16px 20px", cursor: "pointer", marginBottom: 0 },
  roleBtn: { display: "flex", alignItems: "center", gap: 8, flex: 1, background: "#fff", border: "1px solid #e0deda", borderRadius: 10, padding: "12px 14px", cursor: "pointer", justifyContent: "center" },
  quickBtn: { flex: 1, background: "#fff", border: "1px solid #e0deda", borderRadius: 10, padding: "10px 8px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#333" },
  tabRow: { display: "flex", gap: 0, marginBottom: 16, background: "#e8e6e0", borderRadius: 10, padding: 3 },
  tabBtn: { flex: 1, background: "none", border: "none", borderRadius: 8, padding: "8px", fontSize: 13, cursor: "pointer", color: "#888", fontWeight: 600 },
  tabBtnActive: { background: "#fff", color: "#1a1a1a", boxShadow: "0 1px 3px rgba(0,0,0,.1)" },
  filterRow: { display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" },
  filterBtn: { background: "#fff", border: "1px solid #e0deda", borderRadius: 20, padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "#888" },
  filterBtnActive: { background: "#1a1a1a", color: "#fff", border: "1px solid #1a1a1a" },
  dashedBtn: { display: "block", width: "100%", background: "#fff", border: "2px dashed #d0cec8", borderRadius: 12, padding: "14px", fontSize: 15, fontWeight: 700, color: "#555", cursor: "pointer", marginBottom: 20 },
  card: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 16, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  sectionLabel: { fontSize: 11, color: "#aaa", letterSpacing: "0.1em", marginBottom: 8, marginTop: 16 },
  empty: { textAlign: "center", color: "#ccc", fontSize: 13, padding: "18px 0" },
  input: { width: "100%", background: "#f5f4f0", border: "1px solid #e8e6e0", borderRadius: 8, padding: "10px 12px", fontSize: 15, boxSizing: "border-box", outline: "none", color: "#1a1a1a" },
  primaryBtn: { width: "100%", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 4 },
  inlineBtn: { background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" },
  ghostBtn: { background: "none", border: "1px solid #e0deda", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: "#666" },
  previewBox: { borderRadius: 8, padding: "12px 14px", marginBottom: 12 },
  previewRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555", marginBottom: 4 },
  leaderCard: { background: "#fff", borderRadius: 12, padding: "14px 16px", marginBottom: 10, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  partNoText: { fontSize: 16, fontWeight: 700 },
  partMeta: { fontSize: 11, color: "#bbb", marginTop: 2 },
  dateRow: { display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#aaa" },
  cellLabel: { fontSize: 10, color: "#aaa", marginBottom: 2 },
  detailLink: { background: "none", border: "none", color: "#aaa", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
  statsRow: { display: "flex", gap: 10, fontSize: 13, color: "#555", borderRadius: 8, padding: "8px 12px", marginBottom: 10 },
  closeBtn: { width: "100%", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 8, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  recRow: { background: "#fff", borderRadius: 10, padding: "11px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,.04)" },
  memberRow: { background: "#fff", borderRadius: 10, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 1px 3px rgba(0,0,0,.04)" },
  deleteBtn: { background: "none", border: "none", color: "#ccc", fontSize: 16, cursor: "pointer", padding: "4px 8px" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
  sBox: { borderRadius: 12, padding: "14px", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  summaryCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  monthlyCard: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  rateBox: { borderRadius: 14, padding: "18px 20px" },
  barBg: { background: "#f0eeea", borderRadius: 4, height: 6, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4, transition: "width 0.4s" },
  saveBadge: { background: "#1a1a1a", color: "#fff", fontSize: 12, padding: "8px 14px", borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,.2)" },
  spinner: { width: 32, height: 32, border: "3px solid #e0deda", borderTop: "3px solid #1a1a1a", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  alertBanner: { fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8, border: "1px solid", marginBottom: 8, marginTop: 8 },
  dashCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  teamSummaryCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
};

const styleEl = document.createElement("style");
styleEl.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(styleEl);
