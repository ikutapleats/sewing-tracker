import { useState, useMemo, useEffect, useCallback } from "react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbxN7_GWK5xxPJm79eq2uvA1AIVRI6x_g0fD1HHng_Eyo51JEw5JVC3021iYYz_Y3yjxcw/exec";

const TEAMS = ["Aチーム", "Bチーム", "Cチーム", "サンプルチーム"];
const TEAM_COLORS = {
  "Aチーム": "#3b6fd4",
  "Bチーム": "#2a7a2a",
  "Cチーム": "#c25000",
  "サンプルチーム": "#7a2a7a",
};

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
  members: Object.fromEntries(TEAMS.map((t) => [t, []])),
  monthlyTargets: {},
};

const INIT_UI = {
  screen: "home",
  selectedTeam: null,
  userRole: null,
  memberForm: { memberId: "", partId: "", hours: "", date: today() },
  addPartForm: { partNo: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "" },
  addMemberForm: { name: "" },
  targetForm: { month: today().slice(0, 7), sales: "", hourlyRate: "" },
  activePartId: null,
  summaryFilter: "all",
  summaryMonth: today().slice(0, 7),
  summaryTab: "parts",
  editMemberId: null,
  editMemberName: "",
};

// ── Google Apps Script 通信 ───────────────────────────────────────
async function gasGet() {
  const res = await fetch(GAS_URL);
  const json = await res.json();
  return json;
}

async function gasSave(data) {
  const body = JSON.stringify(data);
  await fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain" },
    body,
  });
}

export default function App() {
  const [data, setData] = useState(EMPTY_DATA);
  const [ui, setUi] = useState(INIT_UI);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const setUiP = (patch) => setUi((p) => ({ ...p, ...patch }));
  const setMF = (patch) => setUi((p) => ({ ...p, memberForm: { ...p.memberForm, ...patch } }));
  const setAF = (patch) => setUi((p) => ({ ...p, addPartForm: { ...p.addPartForm, ...patch } }));
  const setTF = (patch) => setUi((p) => ({ ...p, targetForm: { ...p.targetForm, ...patch } }));

  // ── 初回ロード ─────────────────────────────────────────────────
  useEffect(() => {
    gasGet()
      .then((d) => {
        const merged = { ...EMPTY_DATA, ...d };
        // membersのチームキーが欠けている場合補完
        for (const t of TEAMS) {
          if (!merged.members[t]) merged.members[t] = [];
        }
        setData(merged);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── データ保存 ─────────────────────────────────────────────────
  const save = useCallback(async (newData) => {
    setSaving(true);
    setSaveError(false);
    try {
      await gasSave(newData);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }, []);

  function updateData(patch) {
    const newData = { ...data, ...patch };
    setData(newData);
    save(newData);
  }

  // ── computed ────────────────────────────────────────────────────
  const teamMembers = useMemo(() => data.members[ui.selectedTeam] || [], [data.members, ui.selectedTeam]);

  const openParts = useMemo(
    () => data.parts.filter((p) => p.team === ui.selectedTeam && !p.closedAt),
    [data.parts, ui.selectedTeam]
  );

  const partSummary = useMemo(() => {
    return data.parts.map((part) => {
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
    });
  }, [data.parts, data.records]);

  const activeSummary = partSummary.find((p) => p.id === ui.activePartId);

  const filteredSummary = useMemo(() => {
    if (ui.summaryFilter === "all") return partSummary;
    return partSummary.filter((p) => p.team === ui.summaryFilter);
  }, [partSummary, ui.summaryFilter]);

  const monthlySummary = useMemo(() => {
    const m = ui.summaryMonth;
    return TEAMS.map((team) => {
      const tParts = partSummary.filter((p) => p.team === team);
      const tRecs = data.records.filter((r) => {
        const part = data.parts.find((p) => p.id === r.partId);
        return part?.team === team && r.date.startsWith(m);
      });
      const mHours = tRecs.reduce((a, r) => a + r.hours, 0);
      const mSales = tParts.filter((p) => p.closedAt && p.closedAt.startsWith(m)).reduce((a, p) => a + p.totalSales, 0);
      const mRate = mHours > 0 ? mSales / mHours : 0;
      const target = data.monthlyTargets[m]?.[team] || {};
      return { team, mHours, mSales, mRate, target };
    });
  }, [ui.summaryMonth, partSummary, data.records, data.parts, data.monthlyTargets]);

  // ── actions ─────────────────────────────────────────────────────
  function addPart() {
    const { partNo, unitPrice, qty, estHoursPerUnit, deadline } = ui.addPartForm;
    if (!partNo || !unitPrice || !qty || !estHoursPerUnit) return;
    const np = { id: genId(), team: ui.selectedTeam, partNo: partNo.trim(), unitPrice: parseFloat(unitPrice), qty: parseFloat(qty), estHoursPerUnit: parseFloat(estHoursPerUnit), deadline: deadline || null, createdAt: today(), closedAt: null };
    updateData({ parts: [...data.parts, np] });
    setUiP({ addPartForm: { partNo: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "" }, screen: "leader_menu" });
  }

  function closePart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? { ...p, closedAt: today() } : p) }); }
  function reopenPart(id) { updateData({ parts: data.parts.map((p) => p.id === id ? { ...p, closedAt: null } : p) }); }

  function addRecord() {
    const { memberId, partId, hours, date } = ui.memberForm;
    const member = teamMembers.find((m) => m.id === memberId);
    if (!member || !partId || !hours) return;
    const nr = { id: genId(), partId, memberId, memberName: member.name, hours: parseFloat(hours), date };
    updateData({ records: [...data.records, nr] });
    setMF({ hours: "" });
  }
  function deleteRecord(id) { updateData({ records: data.records.filter((r) => r.id !== id) }); }

  function addMember() {
    const name = ui.addMemberForm.name.trim();
    if (!name) return;
    const nm = { id: genId(), name };
    updateData({ members: { ...data.members, [ui.selectedTeam]: [...(data.members[ui.selectedTeam] || []), nm] } });
    setUiP({ addMemberForm: { name: "" } });
  }
  function deleteMember(id) {
    updateData({ members: { ...data.members, [ui.selectedTeam]: data.members[ui.selectedTeam].filter((m) => m.id !== id) } });
  }
  function saveMemberName() {
    const name = ui.editMemberName.trim();
    if (!name) return;
    updateData({ members: { ...data.members, [ui.selectedTeam]: data.members[ui.selectedTeam].map((m) => m.id === ui.editMemberId ? { ...m, name } : m) } });
    setUiP({ editMemberId: null, editMemberName: "" });
  }

  function saveTarget() {
    const { month, sales, hourlyRate } = ui.targetForm;
    if (!month || !ui.selectedTeam) return;
    const prev = data.monthlyTargets[month] || {};
    updateData({ monthlyTargets: { ...data.monthlyTargets, [month]: { ...prev, [ui.selectedTeam]: { sales: parseFloat(sales) || 0, hourlyRate: parseFloat(hourlyRate) || 0 } } } });
    setTF({ sales: "", hourlyRate: "" });
  }

  // ── ローディング画面 ────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <Header title="作業実績管理" sub="IQUTA PLEATS" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 16 }}>
          <div style={st.spinner} />
          <div style={{ color: "#aaa", fontSize: 14 }}>データを読み込んでいます...</div>
        </div>
      </Shell>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // SCREENS
  // ════════════════════════════════════════════════════════════════

  const SaveIndicator = () => (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 100 }}>
      {saving && <div style={st.saveBadge}>💾 保存中...</div>}
      {saveError && <div style={{ ...st.saveBadge, background: "#c00" }}>⚠️ 保存失敗</div>}
    </div>
  );

  // ── HOME ─────────────────────────────────────────────────────────
  if (ui.screen === "home") {
    return (
      <Shell>
        <Header title="作業実績管理" sub="IQUTA PLEATS" />
        <Body>
          <BigBtn icon="📊" label="集計・予算管理" sub="全体・チーム別・月次の実績と予算" onClick={() => setUiP({ screen: "summary", summaryFilter: "all" })} />
          <Spacer h={12} />
          <Divider label="チームを選ぶ" />
          {TEAMS.map((team) => (
            <div key={team} style={{ marginBottom: 12 }}>
              <TeamBadge team={team} />
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <RoleBtn icon="🔑" label="リーダー" onClick={() => setUiP({ selectedTeam: team, userRole: "leader", screen: "leader_menu" })} />
                <RoleBtn icon="✂️" label="メンバー" onClick={() => setUiP({ selectedTeam: team, userRole: "member", screen: "member_entry", memberForm: { memberId: "", partId: "", hours: "", date: today() } })} />
              </div>
            </div>
          ))}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  // ── LEADER MENU ──────────────────────────────────────────────────
  if (ui.screen === "leader_menu") {
    const myParts = partSummary.filter((p) => p.team === ui.selectedTeam);
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　リーダー`} back={() => setUiP({ screen: "home" })} />
        <Body>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            <QuickBtn label="＋ 品番登録" onClick={() => setUiP({ screen: "add_part", addPartForm: { partNo: "", unitPrice: "", qty: "", estHoursPerUnit: "", deadline: "" } })} />
            <QuickBtn label="👥 メンバー管理" onClick={() => setUiP({ screen: "member_mgmt" })} />
            <QuickBtn label="🎯 目標設定" onClick={() => setUiP({ screen: "target_setting" })} />
          </div>
          <SectionLabel>進行中の品番</SectionLabel>
          {myParts.filter((p) => !p.closedAt).length === 0 && <Empty>進行中の品番はありません</Empty>}
          {myParts.filter((p) => !p.closedAt).map((p) => (
            <PartCard key={p.id} p={p} onDetail={() => setUiP({ activePartId: p.id, screen: "part_detail" })} onClose={() => closePart(p.id)} />
          ))}
          <SectionLabel>完了済み</SectionLabel>
          {myParts.filter((p) => p.closedAt).length === 0 && <Empty>完了済みの品番はありません</Empty>}
          {myParts.filter((p) => p.closedAt).map((p) => (
            <PartCard key={p.id} p={p} done onDetail={() => setUiP({ activePartId: p.id, screen: "part_detail" })} onReopen={() => reopenPart(p.id)} />
          ))}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  // ── ADD PART ─────────────────────────────────────────────────────
  if (ui.screen === "add_part") {
    const { partNo, unitPrice, qty, estHoursPerUnit, deadline } = ui.addPartForm;
    const estTotal = (unitPrice && qty && estHoursPerUnit) ? { sales: parseFloat(unitPrice) * parseFloat(qty), hours: parseFloat(estHoursPerUnit) * parseFloat(qty) } : null;
    const estRate = estTotal && estTotal.hours > 0 ? estTotal.sales / estTotal.hours : null;
    const ready = partNo && unitPrice && qty && estHoursPerUnit;
    return (
      <Shell>
        <Header title="品番を登録" back={() => setUiP({ screen: "leader_menu" })} />
        <Body>
          <TeamBadgeInline team={ui.selectedTeam} />
          <div style={st.card}>
            <FormRow label="品番"><input style={st.input} placeholder="例: A-2024-001" value={partNo} onChange={(e) => setAF({ partNo: e.target.value })} /></FormRow>
            <FormRow label="製品単価（円）"><input style={st.input} type="number" placeholder="例: 3000" value={unitPrice} onChange={(e) => setAF({ unitPrice: e.target.value })} /></FormRow>
            <FormRow label="数量（枚）"><input style={st.input} type="number" placeholder="例: 50" value={qty} onChange={(e) => setAF({ qty: e.target.value })} /></FormRow>
            <FormRow label="1着あたりの見積もり時間（h）"><input style={st.input} type="number" placeholder="例: 0.5" min="0" step="0.1" value={estHoursPerUnit} onChange={(e) => setAF({ estHoursPerUnit: e.target.value })} /></FormRow>
            <FormRow label="納期（任意）"><input style={st.input} type="date" value={deadline} onChange={(e) => setAF({ deadline: e.target.value })} /></FormRow>
            {estTotal && (
              <div style={st.previewBox}>
                <div style={st.previewRow}><span>合計売上予定</span><b>¥{Math.round(estTotal.sales).toLocaleString()}</b></div>
                <div style={st.previewRow}><span>総見積もり時間</span><b>{estTotal.hours.toFixed(1)}h</b></div>
                {estRate && <div style={st.previewRow}><span>目標時間単価</span><b style={{ color: "#2a7a2a" }}>¥{Math.round(estRate).toLocaleString()}/h</b></div>}
              </div>
            )}
            <button style={{ ...st.primaryBtn, opacity: ready ? 1 : 0.35 }} disabled={!ready} onClick={addPart}>登録する</button>
          </div>
        </Body>
      </Shell>
    );
  }

  // ── MEMBER MGMT ──────────────────────────────────────────────────
  if (ui.screen === "member_mgmt") {
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　メンバー管理`} back={() => setUiP({ screen: "leader_menu" })} />
        <Body>
          <div style={st.card}>
            <FormRow label="新しいメンバーを追加">
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...st.input, flex: 1 }} placeholder="名前を入力" value={ui.addMemberForm.name} onChange={(e) => setUiP({ addMemberForm: { name: e.target.value } })} />
                <button style={st.inlineBtn} onClick={addMember}>追加</button>
              </div>
            </FormRow>
          </div>
          <SectionLabel>メンバー一覧（{teamMembers.length}人）</SectionLabel>
          {teamMembers.length === 0 && <Empty>メンバーがいません</Empty>}
          {teamMembers.map((m) => (
            <div key={m.id} style={st.memberRow}>
              {ui.editMemberId === m.id ? (
                <>
                  <input style={{ ...st.input, flex: 1, fontSize: 14 }} value={ui.editMemberName} onChange={(e) => setUiP({ editMemberName: e.target.value })} />
                  <button style={st.inlineBtn} onClick={saveMemberName}>保存</button>
                  <button style={st.ghostBtn} onClick={() => setUiP({ editMemberId: null })}>取消</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{m.name}</span>
                  <button style={st.ghostBtn} onClick={() => setUiP({ editMemberId: m.id, editMemberName: m.name })}>編集</button>
                  <button style={{ ...st.ghostBtn, color: "#c00" }} onClick={() => deleteMember(m.id)}>削除</button>
                </>
              )}
            </div>
          ))}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  // ── TARGET SETTING ────────────────────────────────────────────────
  if (ui.screen === "target_setting") {
    const { month, sales, hourlyRate } = ui.targetForm;
    const existing = data.monthlyTargets[month]?.[ui.selectedTeam];
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　月次目標設定`} back={() => setUiP({ screen: "leader_menu" })} />
        <Body>
          <div style={st.card}>
            <FormRow label="対象月"><input style={st.input} type="month" value={month} onChange={(e) => setTF({ month: e.target.value })} /></FormRow>
            <FormRow label="売上目標（円）"><input style={st.input} type="number" placeholder={existing?.sales ? `現在: ¥${existing.sales.toLocaleString()}` : "例: 500000"} value={sales} onChange={(e) => setTF({ sales: e.target.value })} /></FormRow>
            <FormRow label="目標時間単価（円/h）"><input style={st.input} type="number" placeholder={existing?.hourlyRate ? `現在: ¥${existing.hourlyRate.toLocaleString()}/h` : "例: 2000"} value={hourlyRate} onChange={(e) => setTF({ hourlyRate: e.target.value })} /></FormRow>
            <button style={st.primaryBtn} onClick={saveTarget}>保存する</button>
          </div>
          <SectionLabel>設定済みの月次目標</SectionLabel>
          {Object.entries(data.monthlyTargets).filter(([, teams]) => teams[ui.selectedTeam]).map(([m, teams]) => (
            <div key={m} style={st.targetRow}>
              <span style={{ fontWeight: 700, minWidth: 64 }}>{m}</span>
              <span style={{ fontSize: 13, color: "#555" }}>売上目標 ¥{teams[ui.selectedTeam].sales?.toLocaleString()}</span>
              <span style={{ fontSize: 13, color: "#555" }}>時間単価 ¥{teams[ui.selectedTeam].hourlyRate?.toLocaleString()}/h</span>
            </div>
          ))}
          {Object.keys(data.monthlyTargets).filter((m) => data.monthlyTargets[m][ui.selectedTeam]).length === 0 && <Empty>まだ設定がありません</Empty>}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  // ── MEMBER ENTRY ─────────────────────────────────────────────────
  if (ui.screen === "member_entry") {
    const { memberId, partId, hours, date } = ui.memberForm;
    const todayRecs = data.records.filter((r) => {
      const part = data.parts.find((p) => p.id === r.partId);
      return r.date === date && part?.team === ui.selectedTeam;
    });
    const ready = memberId && partId && hours;
    return (
      <Shell>
        <Header title={`${ui.selectedTeam}　作業記録`} back={() => setUiP({ screen: "home" })} />
        <Body>
          {teamMembers.length === 0 ? (
            <div style={{ ...st.card, textAlign: "center", color: "#aaa", padding: 24 }}>
              メンバーが登録されていません。<br />リーダーにメンバー登録を依頼してください。
            </div>
          ) : (
            <div style={st.card}>
              <FormRow label="日付"><input style={st.input} type="date" value={date} onChange={(e) => setMF({ date: e.target.value })} /></FormRow>
              <FormRow label="自分の名前">
                <select style={st.input} value={memberId} onChange={(e) => setMF({ memberId: e.target.value })}>
                  <option value="">選択してください</option>
                  {teamMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </FormRow>
              <FormRow label="品番を選ぶ">
                {openParts.length === 0
                  ? <div style={{ color: "#bbb", fontSize: 13, padding: "8px 0" }}>進行中の品番がありません</div>
                  : <select style={st.input} value={partId} onChange={(e) => setMF({ partId: e.target.value })}>
                      <option value="">選択してください</option>
                      {openParts.map((p) => <option key={p.id} value={p.id}>{p.partNo}</option>)}
                    </select>
                }
              </FormRow>
              <FormRow label="作業時間（h）"><input style={st.input} type="number" placeholder="例: 3.5" min="0" step="0.5" value={hours} onChange={(e) => setMF({ hours: e.target.value })} /></FormRow>
              <button style={{ ...st.primaryBtn, opacity: ready ? 1 : 0.35 }} disabled={!ready} onClick={addRecord}>記録する</button>
            </div>
          )}
          <SectionLabel>本日の入力 ({date})</SectionLabel>
          {todayRecs.length === 0 && <Empty>まだ入力がありません</Empty>}
          {todayRecs.map((r) => {
            const part = data.parts.find((x) => x.id === r.partId);
            return (
              <div key={r.id} style={st.recRow}>
                <span style={{ fontSize: 12, color: "#888", minWidth: 64 }}>{r.memberName}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{part?.partNo ?? "?"}</span>
                <span style={{ fontSize: 13, color: "#555" }}>{r.hours}h</span>
                <button style={st.deleteBtn} onClick={() => deleteRecord(r.id)}>✕</button>
              </div>
            );
          })}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  // ── SUMMARY ──────────────────────────────────────────────────────
  if (ui.screen === "summary") {
    const totalSales = filteredSummary.reduce((a, p) => a + p.totalSales, 0);
    const totalHours = filteredSummary.reduce((a, p) => a + p.totalHours, 0);
    const overallRate = totalHours > 0 ? totalSales / totalHours : 0;
    return (
      <Shell>
        <Header title="集計・予算管理" back={() => setUiP({ screen: "home" })} />
        <Body>
          <div style={st.tabRow}>
            <TabBtn label="品番別実績" active={ui.summaryTab !== "monthly"} onClick={() => setUiP({ summaryTab: "parts" })} />
            <TabBtn label="月次管理" active={ui.summaryTab === "monthly"} onClick={() => setUiP({ summaryTab: "monthly" })} />
          </div>

          {ui.summaryTab !== "monthly" ? (
            <>
              <div style={st.filterRow}>
                {["all", ...TEAMS].map((f) => (
                  <button key={f} style={{ ...st.filterBtn, ...(ui.summaryFilter === f ? st.filterBtnActive : {}) }} onClick={() => setUiP({ summaryFilter: f })}>
                    {f === "all" ? "全体" : f}
                  </button>
                ))}
              </div>
              <div style={st.grid2}>
                <SBox label="総売上合計" value={`¥${Math.round(totalSales).toLocaleString()}`} />
                <SBox label="総作業時間" value={`${totalHours.toFixed(1)}h`} />
                <SBox label="平均時間単価" value={`¥${Math.round(overallRate).toLocaleString()}/h`} dark />
                <SBox label="品番数" value={`${filteredSummary.length}品番`} />
              </div>
              {ui.summaryFilter === "all" && (
                <>
                  <SectionLabel>チーム別サマリー</SectionLabel>
                  {TEAMS.map((team) => {
                    const tps = partSummary.filter((p) => p.team === team);
                    const th = tps.reduce((a, p) => a + p.totalHours, 0);
                    const ts = tps.reduce((a, p) => a + p.totalSales, 0);
                    const tr = th > 0 ? ts / th : 0;
                    return (
                      <button key={team} style={st.teamSummaryCard} onClick={() => setUiP({ summaryFilter: team })}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <TeamBadge team={team} small /><span style={{ fontSize: 12, color: "#aaa" }}>{tps.length}品番 ›</span>
                        </div>
                        <div style={{ display: "flex", gap: 20 }}>
                          <MiniCell label="総時間" val={`${th.toFixed(1)}h`} />
                          <MiniCell label="売上" val={`¥${Math.round(ts).toLocaleString()}`} />
                          <MiniCell label="時間単価" val={th > 0 ? `¥${Math.round(tr).toLocaleString()}/h` : "—"} accent />
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
              <SectionLabel>品番別実績</SectionLabel>
              {filteredSummary.length === 0 && <Empty>データがありません</Empty>}
              {filteredSummary.map((p) => (
                <button key={p.id} style={st.summaryCard} onClick={() => setUiP({ activePartId: p.id, screen: "part_detail" })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div><span style={st.partNoText}>{p.partNo}</span><span style={{ fontSize: 11, color: "#bbb", marginLeft: 8 }}>{p.team}</span></div>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>{p.closedAt ? <Badge type="done" /> : <Badge type="open" />}<span style={{ color: "#ccc" }}>›</span></span>
                  </div>
                  <div style={st.dateRow}>
                    <span>開始: {fmt(p.createdAt)}</span>
                    <span style={{ color: "#ddd" }}>→</span>
                    <span style={{ color: p.closedAt ? "#2a7a2a" : (p.deadline ? "#c25000" : "#bbb") }}>
                      {p.closedAt ? `完了: ${fmt(p.closedAt)}` : (p.deadline ? `納期: ${fmt(p.deadline)}` : "納期未設定")}
                    </span>
                  </div>
                  {p.progress !== null && !p.closedAt && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}>
                        <span>進捗 {Math.round(p.progress * 100)}%</span>
                        <span>{p.totalHours.toFixed(1)}h / {p.estTotalHours.toFixed(1)}h</span>
                      </div>
                      <ProgressBar value={p.progress} />
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 20, marginTop: 8 }}>
                    <MiniCell label="総時間" val={`${p.totalHours.toFixed(1)}h`} />
                    <MiniCell label="売上" val={`¥${Math.round(p.totalSales).toLocaleString()}`} />
                    <MiniCell label="時間単価" val={p.totalHours > 0 ? `¥${Math.round(p.hourlyRate).toLocaleString()}/h` : "—"} accent />
                  </div>
                </button>
              ))}
            </>
          ) : (
            <>
              <FormRow label="対象月"><input style={st.input} type="month" value={ui.summaryMonth} onChange={(e) => setUiP({ summaryMonth: e.target.value })} /></FormRow>
              <Spacer h={8} />
              {monthlySummary.map(({ team, mHours, mSales, mRate, target }) => (
                <div key={team} style={st.monthlyCard}>
                  <div style={{ marginBottom: 10 }}><TeamBadge team={team} small /></div>
                  <div style={st.grid2}>
                    <SBox label="実績売上" value={`¥${Math.round(mSales).toLocaleString()}`} />
                    <SBox label="実績時間" value={`${mHours.toFixed(1)}h`} />
                    {target.sales ? <SBox label="売上目標達成率" value={`${Math.round((mSales / target.sales) * 100)}%`} dark={mSales >= target.sales} /> : <SBox label="売上目標" value="未設定" />}
                    {target.hourlyRate ? <SBox label="時間単価 vs 目標" value={mHours > 0 ? `¥${Math.round(mRate).toLocaleString()}/h` : "—"} dark={mRate >= target.hourlyRate} /> : <SBox label="時間単価目標" value="未設定" />}
                  </div>
                  {target.sales > 0 && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}>
                        <span>売上達成率</span><span>¥{Math.round(mSales).toLocaleString()} / ¥{target.sales.toLocaleString()}</span>
                      </div>
                      <ProgressBar value={Math.min(mSales / target.sales, 1)} color={mSales >= target.sales ? "#2a7a2a" : "#3b6fd4"} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  // ── PART DETAIL ──────────────────────────────────────────────────
  if (ui.screen === "part_detail" && activeSummary) {
    const p = activeSummary;
    const src = data.parts.find((x) => x.id === p.id);
    const estRate = p.estTotalHours > 0 ? p.totalSales / p.estTotalHours : null;
    return (
      <Shell>
        <Header title={p.partNo} back={() => setUiP({ screen: ui.userRole === "leader" ? "leader_menu" : "summary" })} />
        <Body>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            {p.closedAt ? <Badge type="done" /> : <Badge type="open" />}
            <TeamBadge team={p.team} small />
          </div>
          <div style={{ ...st.card, padding: "12px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <div><div style={st.cellLabel}>開始日</div><div style={{ fontWeight: 700 }}>{fmt(p.createdAt)}</div></div>
              {p.deadline && <div><div style={st.cellLabel}>納期</div><div style={{ fontWeight: 700, color: p.closedAt ? "#aaa" : (diffDays(today(), p.deadline) <= 3 ? "#c00" : "#c25000") }}>{fmt(p.deadline)}</div></div>}
              <div><div style={st.cellLabel}>完了日</div><div style={{ fontWeight: 700, color: p.closedAt ? "#2a7a2a" : "#bbb" }}>{p.closedAt ? fmt(p.closedAt) : "進行中"}</div></div>
            </div>
            {p.deadline && !p.closedAt && (
              <div style={{ marginTop: 8, fontSize: 12, color: diffDays(today(), p.deadline) <= 3 ? "#c00" : "#888" }}>
                納期まであと <b>{diffDays(today(), p.deadline)}</b> 日
                {p.dailyNeeded && ` ／ 1日あたり ${p.dailyNeeded.toFixed(1)}h 必要`}
              </div>
            )}
          </div>
          <div style={st.grid2}>
            <SBox label="製品単価" value={`¥${src.unitPrice.toLocaleString()}`} />
            <SBox label="数量" value={`${src.qty}枚`} />
            <SBox label="総売上" value={`¥${Math.round(p.totalSales).toLocaleString()}`} />
            <SBox label="総作業時間" value={`${p.totalHours.toFixed(1)}h`} />
          </div>
          {p.progress !== null && (
            <div style={{ ...st.card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>進捗</span>
                <span style={{ fontSize: 13, color: "#555" }}>{Math.round(p.progress * 100)}%（約{p.estUnitsCompleted}着完了）</span>
              </div>
              <ProgressBar value={p.progress} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginTop: 4 }}>
                <span>実績 {p.totalHours.toFixed(1)}h</span>
                <span>見積もり {p.estTotalHours.toFixed(1)}h（{p.estHoursPerUnit}h/着）</span>
              </div>
            </div>
          )}
          <div style={{ ...st.rateBox, background: p.closedAt ? "#1a1a1a" : "#f0f0ec", color: p.closedAt ? "#fff" : "#1a1a1a", marginBottom: 16 }}>
            <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>{p.closedAt ? "時間あたり売上（確定）" : "現時点の時間あたり売上"}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{p.totalHours > 0 ? `¥${Math.round(p.hourlyRate).toLocaleString()}/h` : "—"}</div>
            {estRate && (
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                見積もり目標: ¥{Math.round(estRate).toLocaleString()}/h
                {p.totalHours > 0 && <span style={{ marginLeft: 8, color: p.hourlyRate >= estRate ? "#7dff7d" : "#ffaaaa" }}>{p.hourlyRate >= estRate ? "▲ 目標超え" : "▼ 目標未達"}</span>}
              </div>
            )}
          </div>
          <SectionLabel>縫製士別 作業時間</SectionLabel>
          <div style={st.card}>
            {Object.keys(p.workerMap).length === 0 && <div style={{ color: "#bbb", fontSize: 13 }}>まだ記録がありません</div>}
            {Object.entries(p.workerMap).map(([worker, hours]) => {
              const pct = p.totalHours > 0 ? (hours / p.totalHours) * 100 : 0;
              return (
                <div key={worker} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13 }}>{worker}</span>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{hours.toFixed(1)}h</span>
                  </div>
                  <ProgressBar value={pct / 100} />
                </div>
              );
            })}
          </div>
          <SectionLabel>作業明細</SectionLabel>
          {p.recs.length === 0 && <Empty>まだ記録がありません</Empty>}
          {[...p.recs].sort((a, b) => a.date.localeCompare(b.date)).map((r) => (
            <div key={r.id} style={st.recRow}>
              <span style={{ fontSize: 12, color: "#aaa", minWidth: 42 }}>{r.date.slice(5).replace("-", "/")}</span>
              <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{r.memberName}</span>
              <span style={{ fontSize: 13, color: "#555" }}>{r.hours}h</span>
            </div>
          ))}
          {!p.closedAt && <button style={{ ...st.closeBtn, marginTop: 20 }} onClick={() => { closePart(p.id); setUiP({ screen: "leader_menu" }); }}>この品番を完了にする</button>}
          {p.closedAt && <button style={{ ...st.closeBtn, background: "#e8e6e0", color: "#777", marginTop: 16 }} onClick={() => reopenPart(p.id)}>再開する</button>}
        </Body>
        <SaveIndicator />
      </Shell>
    );
  }

  return null;
}

// ── Sub-components ──────────────────────────────────────────────────
function Shell({ children }) { return <div style={st.root}>{children}</div>; }
function Header({ title, sub, back }) {
  return (
    <div style={st.header}>
      {back && <button style={st.backBtn} onClick={back}>‹ 戻る</button>}
      {sub && <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#555", marginBottom: 2 }}>{sub}</div>}
      <div style={st.headerTitle}>{title}</div>
    </div>
  );
}
function Body({ children }) { return <div style={st.body}>{children}</div>; }
function Spacer({ h }) { return <div style={{ height: h || 8 }} />; }
function Divider({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 14px" }}>
      <div style={{ flex: 1, height: 1, background: "#e0deda" }} />
      <span style={{ fontSize: 11, color: "#bbb" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "#e0deda" }} />
    </div>
  );
}
function BigBtn({ icon, label, sub, onClick }) {
  return (
    <button style={st.bigBtn} onClick={onClick}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <div style={{ textAlign: "left" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{sub}</div>
      </div>
    </button>
  );
}
function RoleBtn({ icon, label, onClick }) {
  return <button style={st.roleBtn} onClick={onClick}><span style={{ fontSize: 16 }}>{icon}</span><span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span></button>;
}
function QuickBtn({ label, onClick }) {
  return <button style={st.quickBtn} onClick={onClick}>{label}</button>;
}
function TabBtn({ label, active, onClick }) {
  return <button style={{ ...st.tabBtn, ...(active ? st.tabBtnActive : {}) }} onClick={onClick}>{label}</button>;
}
function TeamBadge({ team, small }) {
  const c = TEAM_COLORS[team];
  return <span style={{ background: c + "18", color: c, fontSize: small ? 11 : 13, padding: small ? "2px 8px" : "4px 12px", borderRadius: 20, fontWeight: 700, border: `1px solid ${c}44`, display: "inline-block" }}>{team}</span>;
}
function TeamBadgeInline({ team }) { return <div style={{ marginBottom: 12 }}><TeamBadge team={team} /></div>; }
function SectionLabel({ children }) { return <div style={st.sectionLabel}>{children}</div>; }
function Empty({ children }) { return <div style={st.empty}>{children}</div>; }
function FormRow({ label, children }) {
  return <div style={{ marginBottom: 14 }}><div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>{children}</div>;
}
function SBox({ label, value, dark }) {
  return (
    <div style={{ ...st.sBox, background: dark ? "#1a1a1a" : "#fff" }}>
      <div style={{ fontSize: 10, color: dark ? "#777" : "#aaa", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: dark ? "#fff" : "#1a1a1a" }}>{value}</div>
    </div>
  );
}
function MiniCell({ label, val, accent }) {
  return <div><div style={{ fontSize: 10, color: "#bbb", marginBottom: 2 }}>{label}</div><div style={{ fontSize: 13, fontWeight: 700, color: accent ? "#2a7a2a" : "#1a1a1a" }}>{val}</div></div>;
}
function Badge({ type }) {
  const done = type === "done";
  return <span style={{ background: done ? "#e8f5e8" : "#fff3e0", color: done ? "#2a7a2a" : "#c25000", fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 700 }}>{done ? "完了" : "進行中"}</span>;
}
function ProgressBar({ value, color }) {
  const pct = Math.min(Math.max(value || 0, 0), 1) * 100;
  const c = color || (pct >= 100 ? "#2a7a2a" : "#3b6fd4");
  return <div style={st.barBg}><div style={{ ...st.barFill, width: `${pct}%`, background: c }} /></div>;
}
function PartCard({ p, done, onDetail, onClose, onReopen }) {
  return (
    <div style={{ ...st.leaderCard, opacity: done ? 0.75 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <div>
          <div style={{ ...st.partNoText, color: done ? "#777" : "#1a1a1a" }}>{p.partNo}</div>
          <div style={st.partMeta}>{done ? `完了日: ${fmt(p.closedAt)}` : `¥${p.unitPrice.toLocaleString()} × ${p.qty}枚`}</div>
          <div style={{ ...st.dateRow, marginTop: 4 }}>
            <span>開始: {fmt(p.createdAt)}</span>
            {p.deadline && !done && <><span style={{ color: "#ddd" }}>｜</span><span style={{ color: diffDays(today(), p.deadline) <= 3 ? "#c00" : "#c25000" }}>納期: {fmt(p.deadline)}（あと{diffDays(today(), p.deadline)}日）</span></>}
            {done && <><span style={{ color: "#ddd" }}>→</span><span style={{ color: "#2a7a2a" }}>完了: {fmt(p.closedAt)}</span></>}
          </div>
        </div>
        <button style={st.detailLink} onClick={onDetail}>詳細 ›</button>
      </div>
      {!done && p.progress !== null && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}>
            <span>進捗 {Math.round(p.progress * 100)}%</span>
            <span>{p.totalHours.toFixed(1)}h / {p.estTotalHours.toFixed(1)}h</span>
          </div>
          <ProgressBar value={p.progress} />
        </div>
      )}
      <div style={{ ...st.statsRow, background: done ? "#eeecea" : "#f5f4f0" }}>
        <span>累計 <b>{p.totalHours.toFixed(1)}h</b></span>
        <span style={{ color: "#ddd" }}>｜</span>
        <span style={{ color: done ? "#2a7a2a" : "#555", fontWeight: done ? 700 : 400 }}>{p.totalHours > 0 ? `¥${Math.round(p.hourlyRate).toLocaleString()}/h` : "—"}{done ? " 確定" : ""}</span>
      </div>
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
  bigBtn: { display: "flex", alignItems: "center", gap: 16, width: "100%", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 12, padding: "16px 20px", cursor: "pointer" },
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
  previewBox: { background: "#f0f8f0", borderRadius: 8, padding: "12px 14px", marginBottom: 12 },
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
  targetRow: { background: "#fff", borderRadius: 10, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", boxShadow: "0 1px 3px rgba(0,0,0,.04)" },
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
};

// spinner animation
const styleTag = document.createElement("style");
styleTag.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
document.head.appendChild(styleTag);
