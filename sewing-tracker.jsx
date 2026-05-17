import { useState, useMemo, useEffect, useCallback } from "react";

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
  parts: [],        // 社内品番
  outsources: [],   // 外注品番
  records: [],      // 作業記録
  members: [],      // 全社共通メンバー [{id, name}]
  vendors: [],      // 外注先 [{id, name}]
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
  const url = `${GAS_URL}?action=save&data=${encoded}`;
  await fetch(url, { mode: "no-cors" });
}

async function gasLoad() {
  const res = await fetch(GAS_URL);
  return await res.json();
}

export default function App() {
  const [data, setData] = useState(EMPTY_DATA);
  const [ui, setUi] = useState(INIT_UI);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const set = (patch) => setUi((p) => ({ ...p, ...patch }));
  const setMF = (patch) => setUi((p) => ({ ...p, memberForm: { ...p.memberForm, ...patch } }));
  const setAP = (patch) => setUi((p) => ({ ...p, addPartForm: { ...p.addPartForm, ...patch } }));
  const setAO = (patch) => setUi((p) => ({ ...p, addOutsourceForm: { ...p.addOutsourceForm, ...patch } }));
  const setTF = (patch) => setUi((p) => ({ ...p, targetForm: { ...p.targetForm, ...patch } }));

  useEffect(() => {
    gasLoad().then((d) => {
      const merged = { ...EMPTY_DATA, ...d };
      if (!Array.isArray(merged.members)) merged.members = [];
      if (!Array.isArray(merged.vendors)) merged.vendors = [];
      if (!Array.isArray(merged.outsources)) merged.outsources = [];
      setData(merged);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (newData) => {
    setSaving(true);
    try { await gasSave(newData); } catch {}
    finally { setSaving(false); }
  }, []);

  function updateData(patch) {
    const newData = { ...data, ...patch };
    setData(newData);
    save(newData);
  }

  // ── computed ────────────────────────────────────────────────────
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
    return { ...part, totalHours, totalSales, hourlyRate, estTotalHours, progress, estUnitsCompleted, workerMap, recs, remainDays, dailyNeeded };
  }), [data.parts, data.records]);

  const outsourceSummary = useMemo(() => data.outsources.map((o) => {
    const vendor = data.vendors.find((v) => v.id === o.vendorId);
    const profit = (o.sellPrice - o.vendorPrice) * o.qty;
    const profitRate = o.sellPrice > 0 ? ((o.sellPrice - o.vendorPrice) / o.sellPrice) * 100 : 0;
    const remainDays = diffDays(today(), o.deadline);
    return { ...o, vendorName: vendor?.name || "未設定", profit, profitRate, remainDays };
  }), [data.outsources, data.vendors]);

  const activePart = partSummary.find((p) => p.id === ui.activePartId);
  const activeOutsource = outsourceSummary.find((o) => o.id === ui.activeOutsourceId);

  // ダッシュボード用: 全進行中品番を納期順に
  const dashboardItems = useMemo(() => {
    const internalItems = partSummary
      .filter((p) => !p.closedAt)
      .map((p) => ({ ...p, type: "internal" }));
    const outsourceItems = outsourceSummary
      .filter((o) => !o.closedAt)
      .map((o) => ({ ...o, type: "outsource" }));
    return [...internalItems, ...outsourceItems].sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }, [partSummary, outsourceSummary]);

  // ── actions ─────────────────────────────────────────────────────
  function addPart() {
    const { partNo, partName, unitPrice, qty, estHoursPerUnit, deadline, assignee, status, note } = ui.addPartForm;
    if (!partNo || !unitPrice || !qty || !estHoursPerUnit) return;
    const np = { id: genId(), team: ui.selectedTeam, partNo: partNo.trim(), partName: partName.trim(), unitPrice: parseFloat(unitPrice), qty: parseFloat(qty), estHoursPerUnit: parseFloat(estHoursPerUnit), deadline: deadline || null, assignee: assignee.trim(), status: status || "未着手", note: note.trim(), createdAt: today(), closedAt: null };
    updateData({ parts: [...data.parts, np] });
    set({ addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "", assignee: "", status: "未着手", note: "" }, screen: "leader_menu" });
  }

  function addOutsource() {
    const { partNo, partName, vendorId, qty, sellPrice, vendorPrice, deadline, note, status } = ui.addOutsourceForm;
    if (!partNo || !qty || !sellPrice || !vendorPrice) return;
    const no = { id: genId(), partNo: partNo.trim(), partName: partName.trim(), vendorId, qty: parseFloat(qty), sellPrice: parseFloat(sellPrice), vendorPrice: parseFloat(vendorPrice), deadline: deadline || null, note: note.trim(), status: status || "未着手", createdAt: today(), closedAt: null };
    updateData({ outsources: [...data.outsources, no] });
    set({ addOutsourceForm: { partNo: "", partName: "", vendorId: "", qty: "", sellPrice: "", vendorPrice: "", deadline: "", note: "", status: "未着手" }, screen: "outsource_menu" });
  }

  function closePart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? { ...p, closedAt: today() } : p) }); }
  function reopenPart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? { ...p, closedAt: null } : p) }); }
  function closeOutsource(id) { updateData({ outsources: data.outsources.map((o) => o.id === id ? { ...o, closedAt: today() } : o) }); }
  function reopenOutsource(id) { updateData({ outsources: data.outsources.map((o) => o.id === id ? { ...o, closedAt: null } : o) }); }

  function addRecord() {
    const { memberId, partId, hours, date } = ui.memberForm;
    const member = data.members.find((m) => m.id === memberId);
    if (!member || !partId || !hours) return;
    updateData({ records: [...data.records, { id: genId(), partId, memberId, memberName: member.name, hours: parseFloat(hours), date }] });
    setMF({ hours: "" });
  }
  function deleteRecord(id) { updateData({ records: data.records.filter((r) => r.id !== id) }); }

  function addMember() {
    const name = ui.addMemberForm.name.trim();
    if (!name) return;
    updateData({ members: [...data.members, { id: genId(), name }] });
    set({ addMemberForm: { name: "" } });
  }
  function deleteMember(id) { updateData({ members: data.members.filter((m) => m.id !== id) }); }
  function saveMemberName() {
    const name = ui.editMemberName.trim();
    if (!name) return;
    updateData({ members: data.members.map((m) => m.id === ui.editMemberId ? { ...m, name } : m) });
    set({ editMemberId: null, editMemberName: "" });
  }

  function addVendor() {
    const name = ui.addVendorForm.name.trim();
    if (!name) return;
    updateData({ vendors: [...data.vendors, { id: genId(), name }] });
    set({ addVendorForm: { name: "" } });
  }
  function deleteVendor(id) { updateData({ vendors: data.vendors.filter((v) => v.id !== id) }); }
  function saveVendorName() {
    const name = ui.editVendorName.trim();
    if (!name) return;
    updateData({ vendors: data.vendors.map((v) => v.id === ui.editVendorId ? { ...v, name } : v) });
    set({ editVendorId: null, editVendorName: "" });
  }

  function saveTarget() {
    const { month, sales, hourlyRate } = ui.targetForm;
    if (!month || !ui.selectedTeam) return;
    const prev = data.monthlyTargets[month] || {};
    updateData({ monthlyTargets: { ...data.monthlyTargets, [month]: { ...prev, [ui.selectedTeam]: { sales: parseFloat(sales) || 0, hourlyRate: parseFloat(hourlyRate) || 0 } } } });
    set({ targetForm: { ...ui.targetForm, sales: "", hourlyRate: "" } });
  }

  if (loading) return <Shell><Header title="作業実績管理" sub="IQUTA PLEATS" /><div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}><div style={st.spinner} /><div style={{ color: "#aaa", fontSize: 14 }}>読み込み中...</div></div></Shell>;

  const SI = () => saving ? <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 100 }}><div style={st.saveBadge}>💾 保存中...</div></div> : null;

  // ════════════════════════════════════════════════════════════════
  // HOME
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "home") return (
    <Shell>
      <Header title="作業実績管理" sub="IQUTA PLEATS" />
      <Body>
        <BigBtn icon="🗂️" label="ダッシュボード" sub="納期・進捗を一目で確認" onClick={() => set({ screen: "dashboard" })} />
        <Spacer h={8} />
        <BigBtn icon="📊" label="集計・予算管理" sub="全体・チーム別・月次の実績" onClick={() => set({ screen: "summary", summaryFilter: "all" })} />
        <Spacer h={8} />
        <BigBtn icon="🏭" label="外注管理" sub="外注先・納期・利益を管理" onClick={() => set({ screen: "outsource_menu" })} />
        <Spacer h={12} />
        <Divider label="社内チームを選ぶ" />
        {TEAMS.map((team) => (
          <div key={team} style={{ marginBottom: 12 }}>
            <TeamBadge team={team} />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <RoleBtn icon="🔑" label="リーダー" onClick={() => set({ selectedTeam: team, userRole: "leader", screen: "leader_menu" })} />
              <RoleBtn icon="✂️" label="メンバー" onClick={() => set({ selectedTeam: team, userRole: "member", screen: "member_entry", memberForm: { memberId: "", partId: "", hours: "", date: today() } })} />
            </div>
          </div>
        ))}
        <Spacer h={8} />
        <Divider label="管理設定" />
        <div style={{ display: "flex", gap: 8 }}>
          <QuickBtn label="👥 メンバー管理" onClick={() => set({ screen: "member_mgmt" })} />
          <QuickBtn label="🏢 外注先管理" onClick={() => set({ screen: "vendor_mgmt" })} />
        </div>
      </Body>
      <SI />
    </Shell>
  );

  // ════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "dashboard") {
    const urgent = dashboardItems.filter((p) => p.remainDays !== null && p.remainDays <= 3);
    const caution = dashboardItems.filter((p) => p.remainDays !== null && p.remainDays > 3 && p.remainDays <= 7);
    const normal = dashboardItems.filter((p) => p.remainDays === null || p.remainDays > 7);

    return (
      <Shell>
        <Header title="ダッシュボード" back={() => set({ screen: "home" })} />
        <Body>
          <div style={{ fontSize: 12, color: "#aaa", marginBottom: 16 }}>本日: {today()}</div>

          {urgent.length > 0 && <>
            <div style={{ ...st.alertBanner, background: "#fff0f0", color: "#c00", borderColor: "#ffcccc" }}>🔴 緊急 — 納期まで3日以内</div>
            {urgent.map((p) => <DashCard key={p.id} item={p} level="red" onClick={() => { if (p.type === "outsource") { set({ activeOutsourceId: p.id, screen: "outsource_detail" }); } else { set({ activePartId: p.id, screen: "part_detail" }); } }} />)}
          </>}

          {caution.length > 0 && <>
            <div style={{ ...st.alertBanner, background: "#fffbf0", color: "#b07000", borderColor: "#ffe599" }}>🟡 要注意 — 納期まで7日以内</div>
            {caution.map((p) => <DashCard key={p.id} item={p} level="yellow" onClick={() => { if (p.type === "outsource") { set({ activeOutsourceId: p.id, screen: "outsource_detail" }); } else { set({ activePartId: p.id, screen: "part_detail" }); } }} />)}
          </>}

          {normal.length > 0 && <>
            <div style={{ ...st.alertBanner, background: "#f0f8f0", color: "#2a7a2a", borderColor: "#b8e6b8" }}>🟢 余裕あり</div>
            {normal.map((p) => <DashCard key={p.id} item={p} level="green" onClick={() => { if (p.type === "outsource") { set({ activeOutsourceId: p.id, screen: "outsource_detail" }); } else { set({ activePartId: p.id, screen: "part_detail" }); } }} />)}
          </>}

          {dashboardItems.length === 0 && <Empty>進行中の品番がありません</Empty>}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // LEADER MENU
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "leader_menu") {
    const myParts = partSummary.filter((p) => p.team === ui.selectedTeam);
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　リーダー`} back={() => set({ screen: "home" })} />
        <Body>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <QuickBtn label="＋ 品番登録" onClick={() => set({ screen: "add_part", addPartForm: { partNo: "", partName: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "", assignee: "", status: "未着手", note: "" } })} />
            <QuickBtn label="🎯 目標設定" onClick={() => set({ screen: "target_setting" })} />
          </div>
          <SectionLabel>進行中の品番</SectionLabel>
          {myParts.filter((p) => !p.closedAt).length === 0 && <Empty>進行中の品番はありません</Empty>}
          {myParts.filter((p) => !p.closedAt).map((p) => <PartCard key={p.id} p={p} onDetail={() => set({ activePartId: p.id, screen: "part_detail" })} onClose={() => closePart(p.id)} />)}
          <SectionLabel>完了済み</SectionLabel>
          {myParts.filter((p) => p.closedAt).length === 0 && <Empty>完了済みの品番はありません</Empty>}
          {myParts.filter((p) => p.closedAt).map((p) => <PartCard key={p.id} p={p} done onDetail={() => set({ activePartId: p.id, screen: "part_detail" })} onReopen={() => reopenPart(p.id)} />)}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // ADD PART
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "add_part") {
    const { partNo, partName, unitPrice, qty, estHoursPerUnit, deadline, assignee, status, note } = ui.addPartForm;
    const estTotal = (unitPrice && qty && estHoursPerUnit) ? { sales: parseFloat(unitPrice) * parseFloat(qty), hours: parseFloat(estHoursPerUnit) * parseFloat(qty) } : null;
    const ready = partNo && unitPrice && qty && estHoursPerUnit;
    return (
      <Shell>
        <Header title="品番を登録" back={() => set({ screen: "leader_menu" })} />
        <Body>
          <div style={{ marginBottom: 12 }}><TeamBadge team={ui.selectedTeam} /></div>
          <div style={st.card}>
            <FormRow label="品番"><input style={st.input} placeholder="例: A-2024-001" value={partNo} onChange={(e) => setAP({ partNo: e.target.value })} /></FormRow>
            <FormRow label="品名"><input style={st.input} placeholder="例: プリーツスカート" value={partName} onChange={(e) => setAP({ partName: e.target.value })} /></FormRow>
            <FormRow label="担当者"><input style={st.input} placeholder="例: 生田" value={assignee} onChange={(e) => setAP({ assignee: e.target.value })} /></FormRow>
            <FormRow label="ステータス">
              <select style={st.input} value={status} onChange={(e) => setAP({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormRow>
            <FormRow label="製品単価（円）"><input style={st.input} type="number" placeholder="例: 3000" value={unitPrice} onChange={(e) => setAP({ unitPrice: e.target.value })} /></FormRow>
            <FormRow label="数量（枚）"><input style={st.input} type="number" placeholder="例: 50" value={qty} onChange={(e) => setAP({ qty: e.target.value })} /></FormRow>
            <FormRow label="1着あたりの見積もり時間（h）"><input style={st.input} type="number" placeholder="例: 0.5" min="0" step="0.1" value={estHoursPerUnit} onChange={(e) => setAP({ estHoursPerUnit: e.target.value })} /></FormRow>
            <FormRow label="納期（任意）"><input style={st.input} type="date" value={deadline} onChange={(e) => setAP({ deadline: e.target.value })} /></FormRow>
            <FormRow label="備考"><input style={st.input} placeholder="例: 急ぎ対応" value={note} onChange={(e) => setAP({ note: e.target.value })} /></FormRow>
            {estTotal && (
              <div style={st.previewBox}>
                <div style={st.previewRow}><span>合計売上予定</span><b>¥{Math.round(estTotal.sales).toLocaleString()}</b></div>
                <div style={st.previewRow}><span>総見積もり時間</span><b>{estTotal.hours.toFixed(1)}h</b></div>
                <div style={st.previewRow}><span>目標時間単価</span><b style={{ color: "#2a7a2a" }}>¥{Math.round(estTotal.sales / estTotal.hours).toLocaleString()}/h</b></div>
              </div>
            )}
            <button style={{ ...st.primaryBtn, opacity: ready ? 1 : 0.35 }} disabled={!ready} onClick={addPart}>登録する</button>
          </div>
        </Body>
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // OUTSOURCE MENU
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "outsource_menu") {
    const openOut = outsourceSummary.filter((o) => !o.closedAt);
    const doneOut = outsourceSummary.filter((o) => o.closedAt);
    return (
      <Shell>
        <Header title="外注管理" back={() => set({ screen: "home" })} />
        <Body>
          <button style={st.dashedBtn} onClick={() => set({ screen: "add_outsource", addOutsourceForm: { partNo: "", partName: "", vendorId: "", qty: "", sellPrice: "", vendorPrice: "", deadline: "", note: "", status: "未着手" } })}>
            ＋ 外注品番を登録する
          </button>

          <SectionLabel>進行中の外注品番</SectionLabel>
          {openOut.length === 0 && <Empty>進行中の外注品番はありません</Empty>}
          {openOut.map((o) => (
            <div key={o.id} style={st.leaderCard}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={st.partNoText}>{o.partNo} {o.partName && <span style={{ fontSize: 13, color: "#888", fontWeight: 400 }}>({o.partName})</span>}</div>
                  <div style={st.partMeta}>外注先: {o.vendorName}</div>
                  <div style={{ ...st.dateRow, marginTop: 4 }}>
                    {o.deadline && <><span style={{ color: o.remainDays <= 3 ? "#c00" : o.remainDays <= 7 ? "#c25000" : "#aaa" }}>納期: {fmt(o.deadline)}（あと{o.remainDays}日）</span></>}
                  </div>
                </div>
                <button style={st.detailLink} onClick={() => set({ activeOutsourceId: o.id, screen: "outsource_detail" })}>詳細 ›</button>
              </div>
              <div style={st.statsRow}>
                <span>利益 <b style={{ color: o.profit >= 0 ? "#2a7a2a" : "#c00" }}>¥{Math.round(o.profit).toLocaleString()}</b></span>
                <span style={{ color: "#ddd" }}>｜</span>
                <span>利益率 <b>{o.profitRate.toFixed(1)}%</b></span>
              </div>
              <button style={st.closeBtn} onClick={() => closeOutsource(o.id)}>この品番を完了にする</button>
            </div>
          ))}

          <SectionLabel>完了済み</SectionLabel>
          {doneOut.length === 0 && <Empty>完了済みの外注品番はありません</Empty>}
          {doneOut.map((o) => (
            <div key={o.id} style={{ ...st.leaderCard, opacity: 0.72 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <div>
                  <div style={{ ...st.partNoText, color: "#777" }}>{o.partNo} {o.partName && <span style={{ fontSize: 13, fontWeight: 400 }}>({o.partName})</span>}</div>
                  <div style={st.partMeta}>外注先: {o.vendorName} ／ 完了: {fmt(o.closedAt)}</div>
                </div>
                <button style={st.detailLink} onClick={() => set({ activeOutsourceId: o.id, screen: "outsource_detail" })}>詳細 ›</button>
              </div>
              <div style={{ ...st.statsRow, background: "#eeecea" }}>
                <span>利益 <b style={{ color: "#2a7a2a" }}>¥{Math.round(o.profit).toLocaleString()}</b> 確定</span>
              </div>
              <button style={{ ...st.closeBtn, background: "#e8e6e0", color: "#777" }} onClick={() => reopenOutsource(o.id)}>再開する</button>
            </div>
          ))}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // ADD OUTSOURCE
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "add_outsource") {
    const { partNo, partName, vendorId, qty, sellPrice, vendorPrice, deadline, note, status } = ui.addOutsourceForm;
    const profit = (sellPrice && vendorPrice && qty) ? (parseFloat(sellPrice) - parseFloat(vendorPrice)) * parseFloat(qty) : null;
    const profitRate = (sellPrice && vendorPrice && parseFloat(sellPrice) > 0) ? ((parseFloat(sellPrice) - parseFloat(vendorPrice)) / parseFloat(sellPrice)) * 100 : null;
    const ready = partNo && qty && sellPrice && vendorPrice;
    return (
      <Shell>
        <Header title="外注品番を登録" back={() => set({ screen: "outsource_menu" })} />
        <Body>
          <div style={st.card}>
            <FormRow label="品番"><input style={st.input} placeholder="例: B-2024-010" value={partNo} onChange={(e) => setAO({ partNo: e.target.value })} /></FormRow>
            <FormRow label="品名"><input style={st.input} placeholder="例: プリーツパンツ" value={partName} onChange={(e) => setAO({ partName: e.target.value })} /></FormRow>
            <FormRow label="外注先">
              {data.vendors.length === 0
                ? <div style={{ color: "#bbb", fontSize: 13, padding: "8px 0" }}>外注先が登録されていません（ホーム→外注先管理から登録）</div>
                : <select style={st.input} value={vendorId} onChange={(e) => setAO({ vendorId: e.target.value })}>
                    <option value="">選択してください</option>
                    {data.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
              }
            </FormRow>
            <FormRow label="ステータス">
              <select style={st.input} value={status} onChange={(e) => setAO({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormRow>
            <FormRow label="数量（枚）"><input style={st.input} type="number" placeholder="例: 100" value={qty} onChange={(e) => setAO({ qty: e.target.value })} /></FormRow>
            <FormRow label="販売単価（円）— 得意先への売価"><input style={st.input} type="number" placeholder="例: 5000" value={sellPrice} onChange={(e) => setAO({ sellPrice: e.target.value })} /></FormRow>
            <FormRow label="外注単価（円）— 外注先への支払い"><input style={st.input} type="number" placeholder="例: 3000" value={vendorPrice} onChange={(e) => setAO({ vendorPrice: e.target.value })} /></FormRow>
            <FormRow label="納期（任意）"><input style={st.input} type="date" value={deadline} onChange={(e) => setAO({ deadline: e.target.value })} /></FormRow>
            <FormRow label="備考"><input style={st.input} placeholder="メモなど" value={note} onChange={(e) => setAO({ note: e.target.value })} /></FormRow>
            {profit !== null && (
              <div style={{ ...st.previewBox, background: profit >= 0 ? "#f0f8f0" : "#fff0f0" }}>
                <div style={st.previewRow}><span>売上合計</span><b>¥{Math.round(parseFloat(sellPrice) * parseFloat(qty)).toLocaleString()}</b></div>
                <div style={st.previewRow}><span>外注費合計</span><b>¥{Math.round(parseFloat(vendorPrice) * parseFloat(qty)).toLocaleString()}</b></div>
                <div style={st.previewRow}><span>利益</span><b style={{ color: profit >= 0 ? "#2a7a2a" : "#c00" }}>¥{Math.round(profit).toLocaleString()}</b></div>
                {profitRate !== null && <div style={st.previewRow}><span>利益率</span><b>{profitRate.toFixed(1)}%</b></div>}
              </div>
            )}
            <button style={{ ...st.primaryBtn, opacity: ready ? 1 : 0.35 }} disabled={!ready} onClick={addOutsource}>登録する</button>
          </div>
        </Body>
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // OUTSOURCE DETAIL
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "outsource_detail" && activeOutsource) {
    const o = activeOutsource;
    return (
      <Shell>
        <Header title={o.partNo} back={() => set({ screen: "outsource_menu" })} />
        <Body>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            {o.closedAt ? <Badge type="done" /> : <Badge type="open" />}
            <span style={{ fontSize: 12, color: "#888" }}>外注</span>
            {o.status && <StatusBadge status={o.status} />}
          </div>
          {o.partName && <div style={{ fontSize: 15, color: "#555", marginBottom: 12 }}>{o.partName}</div>}

          <div style={{ ...st.card, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div><div style={st.cellLabel}>登録日</div><div style={{ fontWeight: 700 }}>{fmt(o.createdAt)}</div></div>
              {o.deadline && <div><div style={st.cellLabel}>納期</div><div style={{ fontWeight: 700, color: o.closedAt ? "#aaa" : (o.remainDays <= 3 ? "#c00" : "#c25000") }}>{fmt(o.deadline)}</div></div>}
              <div><div style={st.cellLabel}>完了日</div><div style={{ fontWeight: 700, color: o.closedAt ? "#2a7a2a" : "#bbb" }}>{o.closedAt ? fmt(o.closedAt) : "進行中"}</div></div>
            </div>
            {o.deadline && !o.closedAt && <div style={{ marginTop: 8, fontSize: 12, color: o.remainDays <= 3 ? "#c00" : "#888" }}>納期まであと <b>{o.remainDays}</b> 日</div>}
          </div>

          <div style={st.grid2}>
            <SBox label="外注先" value={o.vendorName} />
            <SBox label="数量" value={`${o.qty}枚`} />
            <SBox label="販売単価" value={`¥${o.sellPrice.toLocaleString()}`} />
            <SBox label="外注単価" value={`¥${o.vendorPrice.toLocaleString()}`} />
          </div>

          <div style={{ ...st.rateBox, background: o.closedAt ? "#1a1a1a" : "#f0f0ec", color: o.closedAt ? "#fff" : "#1a1a1a", marginBottom: 16 }}>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>{o.closedAt ? "利益（確定）" : "見込み利益"}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: o.profit >= 0 ? (o.closedAt ? "#7dff7d" : "#2a7a2a") : "#c00" }}>
              ¥{Math.round(o.profit).toLocaleString()}
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
              利益率 {o.profitRate.toFixed(1)}% ／ 売上合計 ¥{Math.round(o.sellPrice * o.qty).toLocaleString()} ／ 外注費 ¥{Math.round(o.vendorPrice * o.qty).toLocaleString()}
            </div>
          </div>

          {o.note && <div style={{ ...st.card, fontSize: 13, color: "#555" }}>📝 {o.note}</div>}

          {!o.closedAt && <button style={{ ...st.closeBtn, marginTop: 8 }} onClick={() => { closeOutsource(o.id); set({ screen: "outsource_menu" }); }}>この品番を完了にする</button>}
          {o.closedAt && <button style={{ ...st.closeBtn, background: "#e8e6e0", color: "#777", marginTop: 8 }} onClick={() => reopenOutsource(o.id)}>再開する</button>}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // MEMBER MGMT (全社共通)
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "member_mgmt") {
    return (
      <Shell>
        <Header title="メンバー管理（全社共通）" back={() => set({ screen: "home" })} />
        <Body>
          <div style={st.card}>
            <FormRow label="新しいメンバーを追加">
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...st.input, flex: 1 }} placeholder="名前を入力" value={ui.addMemberForm.name} onChange={(e) => set({ addMemberForm: { name: e.target.value } })} />
                <button style={st.inlineBtn} onClick={addMember}>追加</button>
              </div>
            </FormRow>
          </div>
          <SectionLabel>メンバー一覧（{data.members.length}人）</SectionLabel>
          {data.members.length === 0 && <Empty>メンバーがいません</Empty>}
          {data.members.map((m) => (
            <div key={m.id} style={st.memberRow}>
              {ui.editMemberId === m.id
                ? <><input style={{ ...st.input, flex: 1, fontSize: 14 }} value={ui.editMemberName} onChange={(e) => set({ editMemberName: e.target.value })} /><button style={st.inlineBtn} onClick={saveMemberName}>保存</button><button style={st.ghostBtn} onClick={() => set({ editMemberId: null })}>取消</button></>
                : <><span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{m.name}</span><button style={st.ghostBtn} onClick={() => set({ editMemberId: m.id, editMemberName: m.name })}>編集</button><button style={{ ...st.ghostBtn, color: "#c00" }} onClick={() => deleteMember(m.id)}>削除</button></>
              }
            </div>
          ))}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // VENDOR MGMT
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "vendor_mgmt") {
    return (
      <Shell>
        <Header title="外注先管理" back={() => set({ screen: "home" })} />
        <Body>
          <div style={st.card}>
            <FormRow label="新しい外注先を追加">
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...st.input, flex: 1 }} placeholder="会社名を入力" value={ui.addVendorForm.name} onChange={(e) => set({ addVendorForm: { name: e.target.value } })} />
                <button style={st.inlineBtn} onClick={addVendor}>追加</button>
              </div>
            </FormRow>
          </div>
          <SectionLabel>外注先一覧（{data.vendors.length}社）</SectionLabel>
          {data.vendors.length === 0 && <Empty>外注先がいません</Empty>}
          {data.vendors.map((v) => (
            <div key={v.id} style={st.memberRow}>
              {ui.editVendorId === v.id
                ? <><input style={{ ...st.input, flex: 1, fontSize: 14 }} value={ui.editVendorName} onChange={(e) => set({ editVendorName: e.target.value })} /><button style={st.inlineBtn} onClick={saveVendorName}>保存</button><button style={st.ghostBtn} onClick={() => set({ editVendorId: null })}>取消</button></>
                : <><span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{v.name}</span><button style={st.ghostBtn} onClick={() => set({ editVendorId: v.id, editVendorName: v.name })}>編集</button><button style={{ ...st.ghostBtn, color: "#c00" }} onClick={() => deleteVendor(v.id)}>削除</button></>
              }
            </div>
          ))}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // MEMBER ENTRY
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "member_entry") {
    const { memberId, partId, hours, date } = ui.memberForm;
    const todayRecs = data.records.filter((r) => { const part = data.parts.find((p) => p.id === r.partId); return r.date === date && part?.team === ui.selectedTeam; });
    const ready = memberId && partId && hours;
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　作業記録`} back={() => set({ screen: "home" })} />
        <Body>
          {data.members.length === 0
            ? <div style={{ ...st.card, textAlign: "center", color: "#aaa", padding: 24 }}>メンバーが登録されていません。<br />ホーム→メンバー管理から登録してください。</div>
            : <div style={st.card}>
                <FormRow label="日付"><input style={st.input} type="date" value={date} onChange={(e) => setMF({ date: e.target.value })} /></FormRow>
                <FormRow label="自分の名前">
                  <select style={st.input} value={memberId} onChange={(e) => setMF({ memberId: e.target.value })}>
                    <option value="">選択してください</option>
                    {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </FormRow>
                <FormRow label="品番を選ぶ">
                  {openParts.length === 0
                    ? <div style={{ color: "#bbb", fontSize: 13, padding: "8px 0" }}>進行中の品番がありません</div>
                    : <select style={st.input} value={partId} onChange={(e) => setMF({ partId: e.target.value })}>
                        <option value="">選択してください</option>
                        {openParts.map((p) => <option key={p.id} value={p.id}>{p.partNo}{p.partName ? ` (${p.partName})` : ""}</option>)}
                      </select>
                  }
                </FormRow>
                <FormRow label="作業時間（h）"><input style={st.input} type="number" placeholder="例: 3.5" min="0" step="0.5" value={hours} onChange={(e) => setMF({ hours: e.target.value })} /></FormRow>
                <button style={{ ...st.primaryBtn, opacity: ready ? 1 : 0.35 }} disabled={!ready} onClick={addRecord}>記録する</button>
              </div>
          }
          <SectionLabel>本日の入力 ({date})</SectionLabel>
          {todayRecs.length === 0 && <Empty>まだ入力がありません</Empty>}
          {todayRecs.map((r) => { const part = data.parts.find((x) => x.id === r.partId); return (<div key={r.id} style={st.recRow}><span style={{ fontSize: 12, color: "#888", minWidth: 64 }}>{r.memberName}</span><span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{part?.partNo ?? "?"}</span><span style={{ fontSize: 13, color: "#555" }}>{r.hours}h</span><button style={st.deleteBtn} onClick={() => deleteRecord(r.id)}>✕</button></div>); })}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // TARGET SETTING
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "target_setting") {
    const { month, sales, hourlyRate } = ui.targetForm;
    const existing = data.monthlyTargets[month]?.[ui.selectedTeam];
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　月次目標設定`} back={() => set({ screen: "leader_menu" })} />
        <Body>
          <div style={st.card}>
            <FormRow label="対象月"><input style={st.input} type="month" value={month} onChange={(e) => setTF({ month: e.target.value })} /></FormRow>
            <FormRow label="売上目標（円）"><input style={st.input} type="number" placeholder={existing?.sales ? `現在: ¥${existing.sales.toLocaleString()}` : "例: 500000"} value={sales} onChange={(e) => setTF({ sales: e.target.value })} /></FormRow>
            <FormRow label="目標時間単価（円/h）"><input style={st.input} type="number" placeholder={existing?.hourlyRate ? `現在: ¥${existing.hourlyRate.toLocaleString()}/h` : "例: 2000"} value={hourlyRate} onChange={(e) => setTF({ hourlyRate: e.target.value })} /></FormRow>
            <button style={st.primaryBtn} onClick={saveTarget}>保存する</button>
          </div>
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "summary") {
    const filtered = ui.summaryFilter === "all" ? partSummary : partSummary.filter((p) => p.team === ui.summaryFilter);
    const totalSales = filtered.reduce((a, p) => a + p.totalSales, 0);
    const totalHours = filtered.reduce((a, p) => a + p.totalHours, 0);
    const overallRate = totalHours > 0 ? totalSales / totalHours : 0;
    const outTotal = outsourceSummary.reduce((a, o) => a + o.profit, 0);
    return (
      <Shell>
        <Header title="集計・予算管理" back={() => set({ screen: "home" })} />
        <Body>
          <div style={st.tabRow}>
            <TabBtn label="社内実績" active={ui.summaryTab !== "monthly"} onClick={() => set({ summaryTab: "parts" })} />
            <TabBtn label="月次管理" active={ui.summaryTab === "monthly"} onClick={() => set({ summaryTab: "monthly" })} />
          </div>
          {ui.summaryTab !== "monthly" ? (
            <>
              <div style={st.filterRow}>{["all", ...TEAMS].map((f) => <button key={f} style={{ ...st.filterBtn, ...(ui.summaryFilter === f ? st.filterBtnActive : {}) }} onClick={() => set({ summaryFilter: f })}>{f === "all" ? "全体" : f}</button>)}</div>
              <div style={st.grid2}>
                <SBox label="社内総売上" value={`¥${Math.round(totalSales).toLocaleString()}`} />
                <SBox label="総作業時間" value={`${totalHours.toFixed(1)}h`} />
                <SBox label="平均時間単価" value={`¥${Math.round(overallRate).toLocaleString()}/h`} dark />
                <SBox label="外注利益合計" value={`¥${Math.round(outTotal).toLocaleString()}`} />
              </div>
              {ui.summaryFilter === "all" && (<>
                <SectionLabel>チーム別サマリー</SectionLabel>
                {TEAMS.map((team) => { const tps = partSummary.filter((p) => p.team === team); const th = tps.reduce((a, p) => a + p.totalHours, 0); const ts = tps.reduce((a, p) => a + p.totalSales, 0); const tr = th > 0 ? ts / th : 0; return (<button key={team} style={st.teamSummaryCard} onClick={() => set({ summaryFilter: team })}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}><TeamBadge team={team} small /><span style={{ fontSize: 12, color: "#aaa" }}>{tps.length}品番 ›</span></div><div style={{ display: "flex", gap: 20 }}><MiniCell label="総時間" val={`${th.toFixed(1)}h`} /><MiniCell label="売上" val={`¥${Math.round(ts).toLocaleString()}`} /><MiniCell label="時間単価" val={th > 0 ? `¥${Math.round(tr).toLocaleString()}/h` : "—"} accent /></div></button>); })}
              </>)}
              <SectionLabel>品番別実績</SectionLabel>
              {filtered.length === 0 && <Empty>データがありません</Empty>}
              {filtered.map((p) => (
                <button key={p.id} style={st.summaryCard} onClick={() => set({ activePartId: p.id, screen: "part_detail" })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div><span style={st.partNoText}>{p.partNo}</span>{p.partName && <span style={{ fontSize: 11, color: "#bbb", marginLeft: 6 }}>{p.partName}</span>}<span style={{ fontSize: 11, color: "#bbb", marginLeft: 6 }}>{p.team}</span></div>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{p.closedAt ? <Badge type="done" /> : <Badge type="open" />}<span style={{ color: "#ccc" }}>›</span></span>
                  </div>
                  <div style={st.dateRow}><span>開始: {fmt(p.createdAt)}</span><span style={{ color: "#ddd" }}>→</span><span style={{ color: p.closedAt ? "#2a7a2a" : (p.deadline ? "#c25000" : "#bbb") }}>{p.closedAt ? `完了: ${fmt(p.closedAt)}` : (p.deadline ? `納期: ${fmt(p.deadline)}` : "納期未設定")}</span></div>
                  {p.progress !== null && !p.closedAt && (<div style={{ marginTop: 8 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}><span>進捗 {Math.round(p.progress * 100)}%</span><span>{p.totalHours.toFixed(1)}h / {p.estTotalHours.toFixed(1)}h</span></div><ProgressBar value={p.progress} /></div>)}
                  <div style={{ display: "flex", gap: 20, marginTop: 8 }}><MiniCell label="総時間" val={`${p.totalHours.toFixed(1)}h`} /><MiniCell label="売上" val={`¥${Math.round(p.totalSales).toLocaleString()}`} /><MiniCell label="時間単価" val={p.totalHours > 0 ? `¥${Math.round(p.hourlyRate).toLocaleString()}/h` : "—"} accent /></div>
                </button>
              ))}
            </>
          ) : (
            <>
              <FormRow label="対象月"><input style={st.input} type="month" value={ui.summaryMonth} onChange={(e) => set({ summaryMonth: e.target.value })} /></FormRow>
              <Spacer h={8} />
              {TEAMS.map((team) => {
                const tParts = partSummary.filter((p) => p.team === team);
                const tRecs = data.records.filter((r) => { const part = data.parts.find((p) => p.id === r.partId); return part?.team === team && r.date.startsWith(ui.summaryMonth); });
                const mHours = tRecs.reduce((a, r) => a + r.hours, 0);
                const mSales = tParts.filter((p) => p.closedAt && p.closedAt.startsWith(ui.summaryMonth)).reduce((a, p) => a + p.totalSales, 0);
                const mRate = mHours > 0 ? mSales / mHours : 0;
                const target = data.monthlyTargets[ui.summaryMonth]?.[team] || {};
                return (
                  <div key={team} style={st.monthlyCard}>
                    <div style={{ marginBottom: 10 }}><TeamBadge team={team} small /></div>
                    <div style={st.grid2}>
                      <SBox label="実績売上" value={`¥${Math.round(mSales).toLocaleString()}`} />
                      <SBox label="実績時間" value={`${mHours.toFixed(1)}h`} />
                      {target.sales ? <SBox label="売上達成率" value={`${Math.round((mSales / target.sales) * 100)}%`} dark={mSales >= target.sales} /> : <SBox label="売上目標" value="未設定" />}
                      {target.hourlyRate ? <SBox label="時間単価 vs 目標" value={mHours > 0 ? `¥${Math.round(mRate).toLocaleString()}/h` : "—"} dark={mRate >= target.hourlyRate} /> : <SBox label="時間単価目標" value="未設定" />}
                    </div>
                    {target.sales > 0 && (<><div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}><span>売上達成率</span><span>¥{Math.round(mSales).toLocaleString()} / ¥{target.sales.toLocaleString()}</span></div><ProgressBar value={Math.min(mSales / target.sales, 1)} color={mSales >= target.sales ? "#2a7a2a" : "#3b6fd4"} /></>)}
                  </div>
                );
              })}
            </>
          )}
        </Body>
        <SI />
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // PART DETAIL
  // ════════════════════════════════════════════════════════════════
  if (ui.screen === "part_detail" && activePart) {
    const p = activePart;
    const estRate = p.estTotalHours > 0 ? p.totalSales / p.estTotalHours : null;
    return (
      <Shell>
        <Header title={p.partNo} back={() => set({ screen: ui.userRole === "leader" ? "leader_menu" : "summary" })} />
        <Body>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            {p.closedAt ? <Badge type="done" /> : <Badge type="open" />}
            <TeamBadge team={p.team} small />
            {p.status && <StatusBadge status={p.status} />}
          </div>
          {p.partName && <div style={{ fontSize: 15, color: "#555", marginBottom: 4 }}>{p.partName}</div>}
          {p.assignee && <div style={{ fontSize: 12, color: "#aaa", marginBottom: 12 }}>担当: {p.assignee}</div>}

          <div style={{ ...st.card, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div><div style={st.cellLabel}>開始日</div><div style={{ fontWeight: 700 }}>{fmt(p.createdAt)}</div></div>
              {p.deadline && <div><div style={st.cellLabel}>納期</div><div style={{ fontWeight: 700, color: p.closedAt ? "#aaa" : (p.remainDays <= 3 ? "#c00" : "#c25000") }}>{fmt(p.deadline)}</div></div>}
              <div><div style={st.cellLabel}>完了日</div><div style={{ fontWeight: 700, color: p.closedAt ? "#2a7a2a" : "#bbb" }}>{p.closedAt ? fmt(p.closedAt) : "進行中"}</div></div>
            </div>
            {p.deadline && !p.closedAt && <div style={{ marginTop: 8, fontSize: 12, color: p.remainDays <= 3 ? "#c00" : "#888" }}>納期まであと <b>{p.remainDays}</b> 日{p.dailyNeeded && ` ／ 1日あたり ${p.dailyNeeded.toFixed(1)}h 必要`}</div>}
          </div>

          <div style={st.grid2}>
            <SBox label="製品単価" value={`¥${p.unitPrice.toLocaleString()}`} />
            <SBox label="数量" value={`${p.qty}枚`} />
            <SBox label="総売上" value={`¥${Math.round(p.totalSales).toLocaleString()}`} />
            <SBox label="総作業時間" value={`${p.totalHours.toFixed(1)}h`} />
          </div>

          {p.progress !== null && (
            <div style={{ ...st.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontSize: 13, fontWeight: 700 }}>進捗</span><span style={{ fontSize: 13, color: "#555" }}>{Math.round(p.progress * 100)}%（約{p.estUnitsCompleted}着完了）</span></div>
              <ProgressBar value={p.progress} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginTop: 4 }}><span>実績 {p.totalHours.toFixed(1)}h</span><span>見積もり {p.estTotalHours.toFixed(1)}h（{p.estHoursPerUnit}h/着）</span></div>
            </div>
          )}

          <div style={{ ...st.rateBox, background: p.closedAt ? "#1a1a1a" : "#f0f0ec", color: p.closedAt ? "#fff" : "#1a1a1a", marginBottom: 16 }}>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>{p.closedAt ? "時間あたり売上（確定）" : "現時点の時間あたり売上"}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{p.totalHours > 0 ? `¥${Math.round(p.hourlyRate).toLocaleString()}/h` : "—"}</div>
            {estRate && p.totalHours > 0 && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>見積もり目標: ¥{Math.round(estRate).toLocaleString()}/h <span style={{ color: p.hourlyRate >= estRate ? "#7dff7d" : "#ffaaaa" }}>{p.hourlyRate >= estRate ? "▲ 目標超え" : "▼ 目標未達"}</span></div>}
          </div>

          {p.note && <div style={{ ...st.card, fontSize: 13, color: "#555", marginBottom: 16 }}>📝 {p.note}</div>}

          <SectionLabel>縫製士別 作業時間</SectionLabel>
          <div style={st.card}>
            {Object.keys(p.workerMap).length === 0 && <div style={{ color: "#bbb", fontSize: 13 }}>まだ記録がありません</div>}
            {Object.entries(p.workerMap).map(([worker, hours]) => { const pct = p.totalHours > 0 ? (hours / p.totalHours) * 100 : 0; return (<div key={worker} style={{ marginBottom: 14 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 13 }}>{worker}</span><span style={{ fontSize: 13, fontWeight: 700 }}>{hours.toFixed(1)}h</span></div><ProgressBar value={pct / 100} /></div>); })}
          </div>

          <SectionLabel>作業明細</SectionLabel>
          {p.recs.length === 0 && <Empty>まだ記録がありません</Empty>}
          {[...p.recs].sort((a, b) => a.date.localeCompare(b.date)).map((r) => (<div key={r.id} style={st.recRow}><span style={{ fontSize: 12, color: "#aaa", minWidth: 42 }}>{r.date.slice(5).replace("-", "/")}</span><span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{r.memberName}</span><span style={{ fontSize: 13, color: "#555" }}>{r.hours}h</span></div>))}

          {!p.closedAt && <button style={{ ...st.closeBtn, marginTop: 20 }} onClick={() => { closePart(p.id); set({ screen: "leader_menu" }); }}>この品番を完了にする</button>}
          {p.closedAt && <button style={{ ...st.closeBtn, background: "#e8e6e0", color: "#777", marginTop: 16 }} onClick={() => reopenPart(p.id)}>再開する</button>}
        </Body>
        <SI />
      </Shell>
    );
  }

  return null;
}

// ── Sub-components ──────────────────────────────────────────────────
function Shell({ children }) { return <div style={st.root}>{children}</div>; }
function Header({ title, sub, back }) { return (<div style={st.header}>{back && <button style={st.backBtn} onClick={back}>‹ 戻る</button>}{sub && <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#555", marginBottom: 2 }}>{sub}</div>}<div style={st.headerTitle}>{title}</div></div>); }
function Body({ children }) { return <div style={st.body}>{children}</div>; }
function Spacer({ h }) { return <div style={{ height: h || 8 }} />; }
function Divider({ label }) { return (<div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}><div style={{ flex: 1, height: 1, background: "#e0deda" }} /><span style={{ fontSize: 11, color: "#bbb" }}>{label}</span><div style={{ flex: 1, height: 1, background: "#e0deda" }} /></div>); }
function BigBtn({ icon, label, sub, onClick }) { return (<button style={st.bigBtn} onClick={onClick}><span style={{ fontSize: 22 }}>{icon}</span><div style={{ textAlign: "left" }}><div style={{ fontSize: 16, fontWeight: 700 }}>{label}</div><div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{sub}</div></div></button>); }
function RoleBtn({ icon, label, onClick }) { return <button style={st.roleBtn} onClick={onClick}><span style={{ fontSize: 16 }}>{icon}</span><span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span></button>; }
function QuickBtn({ label, onClick }) { return <button style={st.quickBtn} onClick={onClick}>{label}</button>; }
function TabBtn({ label, active, onClick }) { return <button style={{ ...st.tabBtn, ...(active ? st.tabBtnActive : {}) }} onClick={onClick}>{label}</button>; }
function TeamBadge({ team, small }) { const c = TEAM_COLORS[team] || "#888"; return <span style={{ background: c + "18", color: c, fontSize: small ? 11 : 13, padding: small ? "2px 8px" : "4px 12px", borderRadius: 20, fontWeight: 700, border: `1px solid ${c}44`, display: "inline-block" }}>{team}</span>; }
function StatusBadge({ status }) {
  const colors = { "未着手": "#aaa", "受注確認": "#3b6fd4", "裁断待ち": "#c25000", "製作中": "#7a2a7a", "完了": "#2a7a2a" };
  const c = colors[status] || "#aaa";
  return <span style={{ background: c + "18", color: c, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700, border: `1px solid ${c}44` }}>{status}</span>;
}
function SectionLabel({ children }) { return <div style={st.sectionLabel}>{children}</div>; }
function Empty({ children }) { return <div style={st.empty}>{children}</div>; }
function FormRow({ label, children }) { return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>{children}</div>; }
function SBox({ label, value, dark }) { return (<div style={{ ...st.sBox, background: dark ? "#1a1a1a" : "#fff" }}><div style={{ fontSize: 10, color: dark ? "#777" : "#aaa", marginBottom: 5 }}>{label}</div><div style={{ fontSize: 15, fontWeight: 700, color: dark ? "#fff" : "#1a1a1a" }}>{value}</div></div>); }
function MiniCell({ label, val, accent }) { return <div><div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 700, color: accent ? "#2a7a2a" : "#1a1a1a" }}>{val}</div></div>; }
function Badge({ type }) { const done = type === "done"; return <span style={{ background: done ? "#e8f5e8" : "#fff3e0", color: done ? "#2a7a2a" : "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{done ? "完了" : "進行中"}</span>; }
function ProgressBar({ value, color }) { const pct = Math.min(Math.max(value || 0, 0), 1) * 100; const c = color || (pct >= 100 ? "#2a7a2a" : "#3b6fd4"); return <div style={st.barBg}><div style={{ ...st.barFill, width: `${pct}%`, background: c }} /></div>; }

function DashCard({ item, level, onClick }) {
  const colors = { red: "#c00", yellow: "#b07000", green: "#2a7a2a" };
  const c = colors[level];
  const isOut = item.type === "outsource";
  return (
    <button style={{ ...st.dashCard, borderLeft: `4px solid ${c}` }} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{item.partNo} {item.partName && <span style={{ fontSize: 12, color: "#888", fontWeight: 400 }}>({item.partName})</span>}</div>
          <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
            {isOut ? `外注: ${item.vendorName}` : item.team}
            {item.assignee && ` ／ 担当: ${item.assignee}`}
            {item.status && ` ／ ${item.status}`}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          {item.deadline && <div style={{ fontSize: 13, fontWeight: 700, color: c }}>あと{item.remainDays}日</div>}
          {item.deadline && <div style={{ fontSize: 11, color: "#aaa" }}>納期: {item.deadline.slice(5).replace("-", "/")}</div>}
        </div>
      </div>
      {!isOut && item.progress !== null && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}>
            <span>進捗 {Math.round(item.progress * 100)}%</span>
            {item.dailyNeeded && <span style={{ color: c }}>1日あたり{item.dailyNeeded.toFixed(1)}h必要</span>}
          </div>
          <ProgressBar value={item.progress} color={c} />
        </div>
      )}
      {isOut && <div style={{ marginTop: 8, fontSize: 12, color: item.profit >= 0 ? "#2a7a2a" : "#c00" }}>見込み利益: ¥{Math.round(item.profit).toLocaleString()} （{item.profitRate.toFixed(1)}%）</div>}
    </button>
  );
}

function PartCard({ p, done, onDetail, onClose, onReopen }) {
  return (
    <div style={{ ...st.leaderCard, opacity: done ? 0.75 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ ...st.partNoText, color: done ? "#777" : "#1a1a1a" }}>{p.partNo}{p.partName && <span style={{ fontSize: 12, color: "#aaa", fontWeight: 400, marginLeft: 6 }}>{p.partName}</span>}</div>
          <div style={st.partMeta}>{done ? `完了日: ${p.closedAt?.slice(5).replace("-", "/")}` : `¥${p.unitPrice.toLocaleString()} × ${p.qty}枚`}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
            {p.status && <StatusBadge status={p.status} />}
            {p.deadline && !done && <span style={{ fontSize: 11, color: p.remainDays <= 3 ? "#c00" : p.remainDays <= 7 ? "#c25000" : "#aaa" }}>納期: {fmt(p.deadline)}（あと{p.remainDays}日）</span>}
          </div>
        </div>
        <button style={st.detailLink} onClick={onDetail}>詳細 ›</button>
      </div>
      {!done && p.progress !== null && (<div style={{ marginBottom: 8 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}><span>進捗 {Math.round(p.progress * 100)}%</span><span>{p.totalHours.toFixed(1)}h / {p.estTotalHours.toFixed(1)}h</span></div><ProgressBar value={p.progress} /></div>)}
      <div style={{ ...st.statsRow, background: done ? "#eeecea" : "#f5f4f0" }}><span>累計 <b>{p.totalHours.toFixed(1)}h</b></span><span style={{ color: "#ddd" }}>｜</span><span style={{ color: done ? "#2a7a2a" : "#555", fontWeight: done ? 700 : 400 }}>{p.totalHours > 0 ? `¥${Math.round(p.hourlyRate).toLocaleString()}/h` : "—"}{done ? " 確定" : ""}</span></div>
      {!done && <button style={st.closeBtn} onClick={onClose}>この品番を完了にする</button>}
      {done && <button style={{ ...st.closeBtn, background: "#e8e6e0", color: "#777" }} onClick={onReopen}>再開する</button>}
    </div>
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
  teamSummaryCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  summaryCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  monthlyCard: { background: "#fff", borderRadius: 12, padding: "16px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
  rateBox: { borderRadius: 14, padding: "18px 20px" },
  barBg: { background: "#f0eeea", borderRadius: 4, height: 6, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4, transition: "width 0.4s" },
  saveBadge: { background: "#1a1a1a", color: "#fff", fontSize: 12, padding: "8px 14px", borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,.2)" },
  spinner: { width: 32, height: 32, border: "3px solid #e0deda", borderTop: "3px solid #1a1a1a", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  alertBanner: { fontSize: 12, fontWeight: 700, padding: "8px 12px", borderRadius: 8, border: "1px solid", marginBottom: 8, marginTop: 8 },
  dashCard: { display: "block", width: "100%", background: "#fff", border: "none", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.06)" },
};

const styleTag = document.createElement("style");
styleTag.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(styleTag);
