const { useState, useEffect, useRef } = React;

// ============================================================
// 設定
// ============================================================
// ▼ GASデプロイ後にここを実際のWebアプリURLへ差し替えてください
const GAS_URL = "https://script.google.com/macros/s/PLACEHOLDER/exec";
// ▼ 仕様書§1-1・§8-7の簡易認証トークン(合言葉)。GAS側と一致させること
const APP_TOKEN = "PLACEHOLDER";

// ============================================================
// マスター(暫定。docs/inquiry-provisional-masters.md §1 準拠)
// ============================================================
const PLEAT_TYPES = [
  { code: "accordion", ja: "アコーディオンプリーツ" },
  { code: "knife", ja: "ナイフプリーツ" },
  { code: "box", ja: "ボックスプリーツ" },
  { code: "sunray", ja: "サンレイプリーツ" },
  { code: "crystal", ja: "クリスタルプリーツ" },
  { code: "geometric_custom", ja: "変形・ジオメトリック" },
];
const CHANNELS = [
  { value: "email", label: "メール" },
  { value: "instagram_dm", label: "Instagram DM" },
  { value: "web_form", label: "Webフォーム" },
];
const TONES = [
  { value: "standard", label: "標準" },
  { value: "formal", label: "フォーマル" },
  { value: "casual", label: "カジュアル" },
];
const REPLY_TYPE_LABEL = {
  quote: "見積提示",
  info_request: "情報依頼",
  decline: "辞退",
  holding: "保留",
};

// ============================================================
// 汎用ユーティリティ
// ============================================================
function yen(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return Math.round(v).toLocaleString("ja-JP") + "円";
}
function usd(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}
function toNumOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function pleatLabel(code) {
  const found = PLEAT_TYPES.filter(function (p) { return p.code === code; })[0];
  return found ? found.ja : code;
}

function copyToClipboard(text, onDone) {
  function fallback() {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (onDone) onDone(true);
    } catch (e) {
      if (onDone) onDone(false);
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      if (onDone) onDone(true);
    }).catch(fallback);
  } else {
    fallback();
  }
}

// エラーコード(GASが {ok:false, error:"..."} で返す想定)を日本語メッセージへ
const ERROR_MESSAGES = {
  unauthorized: "認証トークンが一致しません。設定を確認してください。",
  missing_calculated_estimate: "見積情報を入力してください。",
  needs_manual: "見積の一部が計算できません。手動明細を追加してください。",
  api_error: "AI処理に失敗しました。時間をおいて再度お試しください。",
  parse_error: "AIの応答を解析できませんでした。もう一度お試しください。",
  timeout: "AI処理がタイムアウトしました。もう一度お試しください。",
  refusal: "AIがこの内容の処理を保留しました。代表確認が必要です。",
  bad_request: "リクエスト内容に誤りがあります。入力内容を確認してください。",
  max_tokens: "AIの応答が途中で切れました。もう一度お試しください。",
};
function errorMessageJa(err) {
  if (!err) return "不明なエラーが発生しました。";
  if (ERROR_MESSAGES[err]) return ERROR_MESSAGES[err];
  return "エラーが発生しました: " + err;
}

// GAS通信(既存アプリと同じ: text/plain でPOSTしCORSプリフライトを回避)
async function callGas(payload) {
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error("サーバーと通信できませんでした。通信状況を確認してください。");
  }
  let text;
  try {
    text = await res.text();
  } catch (e) {
    throw new Error("サーバーからの応答を読み取れませんでした。");
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error("サーバーからの応答を解析できませんでした。HTTP " + res.status);
  }
  if (json && json.ok === false) {
    throw new Error(errorMessageJa(json.error));
  }
  return json;
}

// ============================================================
// 共通UIパーツ
// ============================================================
function Banner(p) {
  const styles = {
    error: { bg: "#fdecea", border: "#e0554a", color: "#a4231b" },
    warning: { bg: "#fff8e1", border: "#e8b830", color: "#8a6300" },
    info: { bg: "#eef4ff", border: "#8ab0e8", color: "#1e4a8a" },
  };
  const s = styles[p.type] || styles.info;
  return (
    <div style={{
      background: s.bg, border: "1px solid " + s.border, color: s.color,
      borderRadius: 10, padding: "12px 14px", fontSize: 14, lineHeight: 1.6,
      marginBottom: 14, whiteSpace: "pre-wrap",
    }}>
      {p.children}
    </div>
  );
}

function Card(p) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e3e3e3", borderRadius: 12,
      padding: 16, marginBottom: 14, boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
    }}>
      {p.title ? <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: "#222" }}>{p.title}</div> : null}
      {p.children}
    </div>
  );
}

function Field(p) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12.5, color: "#666", marginBottom: 4, fontWeight: 600 }}>
        {p.label}{p.required ? <span style={{ color: "#c0392b" }}> *</span> : null}
      </label>
      {p.children}
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 11px", fontSize: 15,
  border: "1px solid #ccc", borderRadius: 8, background: "#fff", color: "#222",
  fontFamily: "inherit",
};
const selectStyle = Object.assign({}, inputStyle, { appearance: "auto" });
const textareaStyle = Object.assign({}, inputStyle, { minHeight: 120, resize: "vertical", lineHeight: 1.6 });

function Btn(p) {
  const kind = p.kind || "primary";
  const palette = {
    primary: { bg: "#2a5db0", color: "#fff", border: "#2a5db0" },
    secondary: { bg: "#fff", color: "#2a5db0", border: "#2a5db0" },
    plain: { bg: "#f2f2f2", color: "#444", border: "#ddd" },
    danger: { bg: "#fff", color: "#c0392b", border: "#c0392b" },
  };
  const c = palette[kind] || palette.primary;
  return (
    <button
      type="button"
      disabled={p.disabled}
      onClick={p.onClick}
      style={Object.assign({
        background: c.bg, color: c.color, border: "1px solid " + c.border,
        borderRadius: 8, padding: "11px 16px", fontSize: 14.5, fontWeight: 700,
        cursor: p.disabled ? "default" : "pointer", opacity: p.disabled ? 0.5 : 1,
        width: p.full ? "100%" : undefined, marginRight: p.full ? 0 : 8, marginBottom: 8,
        transition: "opacity .15s",
      }, p.style)}
    >
      {p.children}
    </button>
  );
}

function LoadingBlock(p) {
  return (
    <div style={{
      textAlign: "center", padding: "36px 12px", color: "#555", fontSize: 14.5, lineHeight: 1.8,
    }}>
      <div style={{
        width: 30, height: 30, margin: "0 auto 14px", borderRadius: "50%",
        border: "3px solid #d8e3f5", borderTopColor: "#2a5db0",
        animation: "iquta-spin 0.8s linear infinite",
      }} />
      {p.text}
    </div>
  );
}

function StepDot(p) {
  const active = p.active, done = p.done;
  return (
    <div style={{
      width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11.5, fontWeight: 700,
      background: active ? "#2a5db0" : (done ? "#c7d9f2" : "#eee"),
      color: active ? "#fff" : (done ? "#2a5db0" : "#999"),
    }}>
      {p.label}
    </div>
  );
}

function StepBar(p) {
  const steps = [
    { key: "1", label: "1" },
    { key: "2", label: "2" },
    { key: "2.5", label: "見" },
    { key: "3", label: "3" },
  ];
  const order = { "1": 0, "2": 1, "2.5": 2, "3": 3 };
  const cur = order[p.step];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16 }}>
      {steps.map(function (s, i) {
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StepDot label={s.label} active={i === cur} done={i < cur} />
            {i < steps.length - 1 ? <div style={{ width: 14, height: 1, background: "#ddd" }} /> : null}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// STEP 1: 問い合わせ入力
// ============================================================
function Step1(p) {
  return (
    <Card title="問い合わせ入力">
      <Field label="対応者名">
        <input style={inputStyle} value={p.operator} onChange={function (e) { p.setOperator(e.target.value); }} placeholder="例: 山田" />
      </Field>
      <Field label="チャネル" required>
        <select style={selectStyle} value={p.channel} onChange={function (e) { p.setChannel(e.target.value); }}>
          {CHANNELS.map(function (c) { return <option key={c.value} value={c.value}>{c.label}</option>; })}
        </select>
      </Field>
      <Field label="トーン">
        <select style={selectStyle} value={p.tone} onChange={function (e) { p.setTone(e.target.value); }}>
          {TONES.map(function (t) { return <option key={t.value} value={t.value}>{t.label}</option>; })}
        </select>
      </Field>
      <Field label="問い合わせ原文" required>
        <textarea
          style={Object.assign({}, textareaStyle, { minHeight: 220 })}
          value={p.rawText}
          onChange={function (e) { p.setRawText(e.target.value); }}
          placeholder="お客様からのメール・DM本文をそのまま貼り付けてください(言語不問)"
        />
      </Field>
      <Btn full disabled={!p.rawText.trim() || p.loading} onClick={p.onSubmit}>
        AIで処理する
      </Btn>
      {p.loading ? <LoadingBlock text={"AI処理中… 10〜30秒かかります"} /> : null}
    </Card>
  );
}

// ============================================================
// STEP 2: 結果表示
// ============================================================
function ExtractionTable(p) {
  const ex = p.extraction || {};
  const rows = [
    ["送信者名", ex.sender_name],
    ["メールアドレス", ex.sender_email],
    ["国(推定)", ex.country_guess],
    ["生地", ex.fabric_type],
    ["生地m数", ex.fabric_meters],
    ["ひだ形状(推定)", ex.pleat_type_guess ? pleatLabel(ex.pleat_type_guess) : null],
    ["数量(枚)", ex.quantity_pieces],
    ["希望納期の言及", ex.deadline_mentioned],
    ["予算の言及", ex.budget_mentioned],
    ["不足情報", (ex.missing_fields || []).join(" / ") || null],
  ];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <tbody>
        {rows.map(function (r, i) {
          return (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "6px 4px", color: "#777", whiteSpace: "nowrap", width: "42%" }}>{r[0]}</td>
              <td style={{ padding: "6px 4px", color: "#222" }}>{(r[1] === null || r[1] === undefined || r[1] === "") ? "—" : String(r[1])}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Step2(p) {
  const t = p.translation || {};
  const risk = p.risk || {};
  const replies = p.editableReplies || [];
  const [showJa, setShowJa] = useState(false);

  if (risk.requires_owner_review) {
    const holding = replies[0] || { subject_ja: "", body_ja: "" };
    return (
      <div>
        <Banner type="error">⚠ 代表確認が必要な案件です{risk.reason ? ("\n理由: " + risk.reason) : ""}</Banner>
        <Card title="保留の返信案(代表確認後にご利用ください)">
          <Field label="件名"><input style={inputStyle} readOnly value={holding.subject_ja || ""} /></Field>
          <Field label="本文"><textarea style={textareaStyle} readOnly value={holding.body_ja || ""} /></Field>
        </Card>
        {p.internalNote ? <Card title="社員向けメモ">{p.internalNote}</Card> : null}
        <Btn kind="plain" onClick={p.onReset}>最初からやり直す</Btn>
      </div>
    );
  }

  return (
    <div>
      <Card title="日本語訳・要約">
        <div style={{ marginBottom: 8 }}>
          <Btn kind="plain" onClick={function () { setShowJa(!showJa); }}>
            {showJa ? "日本語訳を閉じる" : "日本語訳を表示"}
          </Btn>
        </div>
        {showJa ? (
          <div style={{ background: "#f7f8fa", borderRadius: 8, padding: 10, fontSize: 13.5, lineHeight: 1.7, marginBottom: 10, whiteSpace: "pre-wrap" }}>
            {t.japanese_translation}
          </div>
        ) : null}
        <div style={{ fontSize: 13.5, color: "#333", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: "#666", fontSize: 12 }}>要約</div>
          {t.summary_ja}
        </div>
        {p.detectedLanguage ? (
          <div style={{ fontSize: 12, color: "#999", marginTop: 8 }}>検出言語: {p.detectedLanguage}</div>
        ) : null}
      </Card>

      <Card title="抽出情報">
        <ExtractionTable extraction={p.extraction} />
      </Card>

      {risk.payment_risk_note ? <Banner type="warning">{risk.payment_risk_note}</Banner> : null}

      <Card title="返信案">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {replies.map(function (r, i) {
            const active = i === p.selectedIndex;
            return (
              <button
                key={i}
                type="button"
                onClick={function () { p.setSelectedIndex(i); }}
                style={{
                  padding: "7px 12px", borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  border: "1px solid " + (active ? "#2a5db0" : "#ccc"),
                  background: active ? "#2a5db0" : "#fff",
                  color: active ? "#fff" : "#444",
                }}
              >
                {REPLY_TYPE_LABEL[r.type] || r.type}
              </button>
            );
          })}
        </div>
        {replies.map(function (r, i) {
          if (i !== p.selectedIndex) return null;
          return (
            <div key={i}>
              {r.type !== "instagram_dm" && p.channel === "email" ? (
                <Field label="件名(編集可)">
                  <input style={inputStyle} value={r.subject_ja} onChange={function (e) { p.onEditReply(i, { subject_ja: e.target.value }); }} />
                </Field>
              ) : null}
              <Field label="本文(編集可)">
                <textarea style={Object.assign({}, textareaStyle, { minHeight: 200 })} value={r.body_ja} onChange={function (e) { p.onEditReply(i, { body_ja: e.target.value }); }} />
              </Field>
            </div>
          );
        })}
      </Card>

      {p.internalNote ? <Card title="社員向けメモ">{p.internalNote}</Card> : null}

      <div>
        <Btn kind="secondary" onClick={p.onGoEstimate}>見積もりを作成する</Btn>
        <Btn onClick={p.onGoTranslate}>この案で翻訳へ進む</Btn>
      </div>
      <Btn kind="plain" onClick={p.onReset}>最初からやり直す</Btn>
    </div>
  );
}

// ============================================================
// STEP 2.5: 見積もり作成キット
// ============================================================
function Step25(p) {
  const kit = p.quoteKit;
  const setKit = p.setQuoteKit;
  const est = p.estimateResult;

  return (
    <div>
      <Card title="見積もり作成キット">
        <Field label="ひだの形状" required>
          <select style={selectStyle} value={kit.pleat_type} onChange={function (e) { setKit({ pleat_type: e.target.value }); }}>
            <option value="">選択してください</option>
            {PLEAT_TYPES.map(function (pt) { return <option key={pt.code} value={pt.code}>{pt.ja}</option>; })}
          </select>
        </Field>
        <Field label="ひだの大きさ(mm)"><input type="number" style={inputStyle} value={kit.pleat_size_mm} onChange={function (e) { setKit({ pleat_size_mm: e.target.value }); }} /></Field>
        <Field label="ひだの本数(サンレイ等)"><input type="number" style={inputStyle} value={kit.pleat_count} onChange={function (e) { setKit({ pleat_count: e.target.value }); }} /></Field>
        <Field label="丈(cm)"><input type="number" style={inputStyle} value={kit.garment_length_cm} onChange={function (e) { setKit({ garment_length_cm: e.target.value }); }} /></Field>
        <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
          <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={kit.cutting} onChange={function (e) { setKit({ cutting: e.target.checked }); }} /> 裁断あり
          </label>
          <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={kit.hemming} onChange={function (e) { setKit({ hemming: e.target.checked }); }} /> 裾上げあり
          </label>
        </div>
        <Field label="加工枚数" required><input type="number" style={inputStyle} value={kit.quantity_pieces} onChange={function (e) { setKit({ quantity_pieces: e.target.value }); }} /></Field>
        <Field label="生地m数"><input type="number" style={inputStyle} value={kit.fabric_meters} onChange={function (e) { setKit({ fabric_meters: e.target.value }); }} /></Field>
        <Field label="型" required>
          <div style={{ display: "flex", gap: 20 }}>
            <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="mold" checked={kit.mold === "existing"} onChange={function () { setKit({ mold: "existing" }); }} /> 既存型
            </label>
            <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="radio" name="mold" checked={kit.mold === "new"} onChange={function () { setKit({ mold: "new" }); }} /> 新規型
            </label>
          </div>
        </Field>
        <Field label="配送先国" required><input style={inputStyle} value={kit.country} onChange={function (e) { setKit({ country: e.target.value }); }} /></Field>
        <Field label="特記事項"><textarea style={textareaStyle} value={kit.notes_ja} onChange={function (e) { setKit({ notes_ja: e.target.value }); }} /></Field>

        <Btn full disabled={!kit.pleat_type || !kit.quantity_pieces || !kit.mold || !kit.country || p.loading} onClick={p.onCalculate}>
          見積計算
        </Btn>
        {p.loading ? <LoadingBlock text="計算中…" /> : null}
      </Card>

      {est ? (
        <div>
          {(est.unmatched_ja || []).length > 0 ? (
            <Banner type="warning">
              以下は自動計算できませんでした。手動明細で補ってください:{"\n"}
              {(est.unmatched_ja || []).map(function (u, i) { return "・" + u; }).join("\n")}
            </Banner>
          ) : null}
          {est.fx && est.fx.stale ? (
            <Banner type="warning">⚠ 為替レートが自動取得できず、手動レートで換算しています</Banner>
          ) : null}

          <Card title="見積明細">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <tbody>
                {(est.line_items || []).map(function (li, i) {
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "7px 4px", color: "#333" }}>
                        {li.label_ja}
                        {li.source === "manual" ? (
                          <span style={{ marginLeft: 6, fontSize: 11, background: "#f2e6c8", color: "#8a6300", borderRadius: 6, padding: "1px 6px" }}>手動</span>
                        ) : null}
                      </td>
                      <td style={{ padding: "7px 4px", textAlign: "right", whiteSpace: "nowrap", color: "#222" }}>{yen(li.amount_jpy)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: "10px 4px", fontWeight: 700 }}>合計</td>
                  <td style={{ padding: "10px 4px", textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {yen(est.total_jpy)}
                    {est.fx ? <div style={{ fontWeight: 400, fontSize: 12, color: "#777" }}>(約 {usd(est.fx.converted_total)} {est.fx.currency || "USD"})</div> : null}
                  </td>
                </tr>
              </tfoot>
            </table>
            {est.lead_time_weeks ? <div style={{ fontSize: 12.5, color: "#777", marginTop: 8 }}>納期目安: {est.lead_time_weeks}週間</div> : null}
            <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
              状態: {est.status === "computable" ? "計算完了" : "手動補完が必要"}
            </div>
          </Card>

          <Card title="手動明細の追加">
            {(p.manualItems || []).map(function (m, i) {
              return (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input style={Object.assign({}, inputStyle, { flex: 2 })} placeholder="名目" value={m.label_ja} onChange={function (e) { p.onEditManualItem(i, { label_ja: e.target.value }); }} />
                  <input style={Object.assign({}, inputStyle, { flex: 1 })} type="number" placeholder="金額(円)" value={m.amount_jpy} onChange={function (e) { p.onEditManualItem(i, { amount_jpy: e.target.value }); }} />
                  <Btn kind="plain" onClick={function () { p.onRemoveManualItem(i); }}>削除</Btn>
                </div>
              );
            })}
            <Btn kind="secondary" onClick={p.onAddManualItem}>+ 手動明細を追加</Btn>
            <Btn onClick={p.onCalculate} disabled={p.loading}>再計算</Btn>
          </Card>

          {est.status === "computable" ? (
            <Btn full onClick={p.onRegenerateReplies} disabled={p.loadingRegenerate}>
              この見積で返信案を再生成
            </Btn>
          ) : null}
          {p.loadingRegenerate ? <LoadingBlock text={"AI処理中… 10〜30秒かかります"} /> : null}
        </div>
      ) : null}

      <Btn kind="plain" onClick={p.onBackToStep2}>返信案の表示に戻る</Btn>
      <Btn kind="plain" onClick={p.onReset}>最初からやり直す</Btn>
    </div>
  );
}

// ============================================================
// STEP 3: 翻訳と最終確認
// ============================================================
function Step3(p) {
  const [copiedMsg, setCopiedMsg] = useState("");
  const r = p.translateResult;

  function doCopy(label, text) {
    copyToClipboard(text, function (ok) {
      setCopiedMsg(ok ? (label + "をコピーしました") : "コピーに失敗しました");
      setTimeout(function () { setCopiedMsg(""); }, 2000);
    });
  }

  const isJapanese = p.detectedLanguage === "ja";
  const copyDisabled = !isJapanese && r && r.number_check && r.number_check.ok === false;

  return (
    <div>
      <Card title="確定する日本語文(最終編集可)">
        <Field label="件名"><input style={inputStyle} value={p.confirmedSubjectJa} onChange={function (e) { p.setConfirmedSubjectJa(e.target.value); }} /></Field>
        <Field label="本文"><textarea style={Object.assign({}, textareaStyle, { minHeight: 200 })} value={p.confirmedBodyJa} onChange={function (e) { p.setConfirmedBodyJa(e.target.value); }} /></Field>

        {isJapanese ? (
          <div>
            <div style={{ fontSize: 12.5, color: "#777", marginBottom: 8 }}>検出言語が日本語のため、翻訳は不要です。このままコピーして送信してください。</div>
            <Btn onClick={function () { doCopy("件名", p.confirmedSubjectJa); }}>件名をコピー</Btn>
            <Btn onClick={function () { doCopy("本文", p.confirmedBodyJa); }}>本文をコピー</Btn>
          </div>
        ) : (
          <Btn full disabled={!p.confirmedBodyJa.trim() || p.loading} onClick={p.onTranslate}>
            {r ? "再翻訳" : "翻訳する"}
          </Btn>
        )}
        {p.loading ? <LoadingBlock text="翻訳中… 少々お待ちください" /> : null}
        {copiedMsg ? <div style={{ color: "#2a7a2a", fontSize: 13, marginTop: 6 }}>{copiedMsg}</div> : null}
      </Card>

      {(!isJapanese && r) ? (
        <div>
          {r.number_check && r.number_check.ok === false ? (
            <Banner type="error">
              ⚠ 金額・数量が翻訳文で確認できません{(r.number_check.missing && r.number_check.missing.length) ? ("\n未確認: " + r.number_check.missing.join(", ")) : ""}
              {"\n「再翻訳」ボタンでやり直してください。"}
            </Banner>
          ) : null}
          {r.length_warning ? (
            <Banner type="warning">文字数上限に収まりません。日本語文を短くして再翻訳してください。</Banner>
          ) : null}

          <Card title={"翻訳結果(" + p.detectedLanguage + ")"}>
            <Field label="件名">
              <input style={Object.assign({}, inputStyle, { background: "#f7f8fa" })} readOnly value={r.subject_translated || ""} />
            </Field>
            <Field label="本文">
              <textarea style={Object.assign({}, textareaStyle, { minHeight: 180, background: "#f7f8fa" })} readOnly value={r.body_translated || ""} />
            </Field>
            <Btn disabled={copyDisabled} onClick={function () { doCopy("件名", r.subject_translated || ""); }}>件名をコピー</Btn>
            <Btn disabled={copyDisabled} onClick={function () { doCopy("本文", r.body_translated || ""); }}>本文をコピー</Btn>
          </Card>

          <Card title="逆翻訳(日本語)">
            <div style={{ fontSize: 12.5, color: "#a4231b", fontWeight: 700, marginBottom: 8 }}>
              ↓この内容で送信されます。日本語で確認してください
            </div>
            <div style={{
              background: "#fffdf5", border: "2px solid #e8b830", borderRadius: 10, padding: 12,
              fontSize: 14, lineHeight: 1.8, whiteSpace: "pre-wrap", color: "#222",
            }}>
              {r.back_translation_ja}
            </div>
            {r.translator_note_ja ? (
              <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
                <span style={{ fontWeight: 700 }}>翻訳メモ: </span>{r.translator_note_ja}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      <Btn kind="plain" onClick={p.onBackToStep2}>返信案の表示に戻る</Btn>
      <Btn kind="plain" onClick={p.onReset}>最初からやり直す</Btn>
    </div>
  );
}

// ============================================================
// App 本体
// ============================================================
const INIT_QUOTE_KIT = {
  pleat_type: "", pleat_size_mm: "", pleat_count: "", garment_length_cm: "",
  cutting: false, hemming: false, quantity_pieces: "", fabric_meters: "",
  mold: "existing", country: "", notes_ja: "",
};

function App() {
  const [step, setStep] = useState("1"); // "1" | "2" | "2.5" | "3"
  const [error, setError] = useState("");

  // 全ステップ共通
  const [operator, setOperator] = useState("");
  const [channel, setChannel] = useState("email");
  const [tone, setTone] = useState("standard");
  const [rawText, setRawText] = useState("");

  const [loadingProcess, setLoadingProcess] = useState(false);
  const [caseId, setCaseId] = useState(null);
  const [detectedLanguage, setDetectedLanguage] = useState(null);
  const [translation, setTranslation] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [risk, setRisk] = useState(null);
  const [editableReplies, setEditableReplies] = useState([]);
  const [internalNote, setInternalNote] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // STEP 2.5
  const [quoteKit, setQuoteKitState] = useState(INIT_QUOTE_KIT);
  const [manualItems, setManualItems] = useState([]);
  const [estimateResult, setEstimateResult] = useState(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [loadingRegenerate, setLoadingRegenerate] = useState(false);
  const kitInitialized = useRef(false);

  // STEP 3
  const [confirmedSubjectJa, setConfirmedSubjectJa] = useState("");
  const [confirmedBodyJa, setConfirmedBodyJa] = useState("");
  const [translateResult, setTranslateResult] = useState(null);
  const [loadingTranslate, setLoadingTranslate] = useState(false);

  function setQuoteKit(patch) { setQuoteKitState(function (p) { return Object.assign({}, p, patch); }); }

  function resetAll() {
    setStep("1"); setError("");
    setOperator(""); setChannel("email"); setTone("standard"); setRawText("");
    setLoadingProcess(false); setCaseId(null); setDetectedLanguage(null);
    setTranslation(null); setExtraction(null); setRisk(null);
    setEditableReplies([]); setInternalNote(""); setSelectedIndex(0);
    setQuoteKitState(INIT_QUOTE_KIT); setManualItems([]); setEstimateResult(null);
    setLoadingEstimate(false); setLoadingRegenerate(false);
    kitInitialized.current = false;
    setConfirmedSubjectJa(""); setConfirmedBodyJa(""); setTranslateResult(null); setLoadingTranslate(false);
  }

  function applyProcessResult(json) {
    setCaseId(json.case_id || caseId);
    setDetectedLanguage((json.translation && json.translation.detected_language) || json.detected_language || detectedLanguage);
    setTranslation(json.translation || null);
    setExtraction(json.extraction || null);
    setRisk(json.risk || null);
    const replies = json.replies || [];
    setEditableReplies(replies.map(function (r) { return { type: r.type, subject_ja: r.subject_ja || "", body_ja: r.body_ja || "" }; }));
    setInternalNote(json.internal_note_ja || "");
    setSelectedIndex(0);
  }

  async function onSubmitInquiry() {
    setError(""); setLoadingProcess(true);
    try {
      const json = await callGas({
        action: "process_inquiry",
        token: APP_TOKEN,
        inquiry: { raw_text: rawText, sender_name: "", sender_email: "", channel: channel },
        operator: operator,
        options: { tone: tone, force_reply_types: [] },
      });
      applyProcessResult(json);
      setStep("2");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingProcess(false);
    }
  }

  function onGoEstimate() {
    if (!kitInitialized.current && extraction) {
      const ex = extraction;
      const guess = ex.pleat_type_guess;
      const validGuess = PLEAT_TYPES.some(function (pt) { return pt.code === guess; });
      setQuoteKitState(function (p) {
        return Object.assign({}, p, {
          pleat_type: validGuess ? guess : p.pleat_type,
          quantity_pieces: (ex.quantity_pieces !== null && ex.quantity_pieces !== undefined) ? ex.quantity_pieces : p.quantity_pieces,
          fabric_meters: (ex.fabric_meters !== null && ex.fabric_meters !== undefined) ? ex.fabric_meters : p.fabric_meters,
          country: ex.country_guess || p.country,
        });
      });
      kitInitialized.current = true;
    }
    setError("");
    setStep("2.5");
  }

  function onEditReply(i, patch) {
    setEditableReplies(function (list) {
      const copy = list.slice();
      copy[i] = Object.assign({}, copy[i], patch);
      return copy;
    });
  }

  function onGoTranslate() {
    const r = editableReplies[selectedIndex] || { subject_ja: "", body_ja: "" };
    setConfirmedSubjectJa(r.subject_ja);
    setConfirmedBodyJa(r.body_ja);
    setTranslateResult(null);
    setError("");
    setStep("3");
  }

  function onAddManualItem() {
    setManualItems(function (l) { return l.concat([{ label_ja: "", amount_jpy: "" }]); });
  }
  function onEditManualItem(i, patch) {
    setManualItems(function (l) {
      const copy = l.slice();
      copy[i] = Object.assign({}, copy[i], patch);
      return copy;
    });
  }
  function onRemoveManualItem(i) {
    setManualItems(function (l) { return l.filter(function (_, idx) { return idx !== i; }); });
  }

  async function onCalculateEstimate() {
    setError(""); setLoadingEstimate(true);
    try {
      const validManual = manualItems
        .filter(function (m) { return m.label_ja && m.label_ja.trim() && m.amount_jpy !== ""; })
        .map(function (m) { return { label_ja: m.label_ja.trim(), amount_jpy: Number(m.amount_jpy) }; });
      const json = await callGas({
        action: "calculate_estimate",
        token: APP_TOKEN,
        case_id: caseId,
        quote_kit: {
          pleat_type: quoteKit.pleat_type,
          pleat_size_mm: toNumOrNull(quoteKit.pleat_size_mm),
          pleat_count: toNumOrNull(quoteKit.pleat_count),
          garment_length_cm: toNumOrNull(quoteKit.garment_length_cm),
          cutting: !!quoteKit.cutting,
          hemming: !!quoteKit.hemming,
          quantity_pieces: toNumOrNull(quoteKit.quantity_pieces),
          fabric_meters: toNumOrNull(quoteKit.fabric_meters),
          mold: quoteKit.mold,
          country: quoteKit.country,
          notes_ja: quoteKit.notes_ja,
        },
        manual_line_items: validManual,
      });
      setEstimateResult(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingEstimate(false);
    }
  }

  async function onRegenerateReplies() {
    setError(""); setLoadingRegenerate(true);
    try {
      const json = await callGas({
        action: "process_inquiry",
        token: APP_TOKEN,
        case_id: caseId,
        inquiry: { raw_text: rawText, sender_name: "", sender_email: "", channel: channel },
        operator: operator,
        options: { tone: tone, force_reply_types: [] },
        calculated_estimate: estimateResult,
      });
      applyProcessResult(json);
      setStep("2");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingRegenerate(false);
    }
  }

  async function onTranslate() {
    setError(""); setLoadingTranslate(true);
    try {
      const json = await callGas({
        action: "translate_reply",
        token: APP_TOKEN,
        case_id: caseId,
        confirmed_subject_ja: confirmedSubjectJa,
        confirmed_body_ja: confirmedBodyJa,
        target_language: detectedLanguage,
        channel: channel,
        tone: tone,
        operator: operator,
      });
      setTranslateResult(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingTranslate(false);
    }
  }

  return (
    <div style={{
      maxWidth: 640, margin: "0 auto", padding: "16px 14px 60px",
      fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", color: "#222",
    }}>
      <style>{`
        @keyframes iquta-spin { to { transform: rotate(360deg); } }
        input, textarea, select { outline: none; }
        input:focus, textarea:focus, select:focus { border-color: #2a5db0 !important; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 17 }}>iquta海外問い合わせ</div>
      </div>

      <StepBar step={step} />

      {error ? <Banner type="error">{error}</Banner> : null}

      {step === "1" ? (
        <Step1
          operator={operator} setOperator={setOperator}
          channel={channel} setChannel={setChannel}
          tone={tone} setTone={setTone}
          rawText={rawText} setRawText={setRawText}
          loading={loadingProcess}
          onSubmit={onSubmitInquiry}
        />
      ) : null}

      {step === "2" ? (
        <Step2
          translation={translation} extraction={extraction} risk={risk}
          editableReplies={editableReplies} internalNote={internalNote}
          selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex}
          onEditReply={onEditReply}
          detectedLanguage={detectedLanguage} channel={channel}
          onGoEstimate={onGoEstimate} onGoTranslate={onGoTranslate}
          onReset={resetAll}
        />
      ) : null}

      {step === "2.5" ? (
        <Step25
          quoteKit={quoteKit} setQuoteKit={setQuoteKit}
          onCalculate={onCalculateEstimate} loading={loadingEstimate}
          estimateResult={estimateResult}
          manualItems={manualItems}
          onAddManualItem={onAddManualItem} onEditManualItem={onEditManualItem} onRemoveManualItem={onRemoveManualItem}
          onRegenerateReplies={onRegenerateReplies} loadingRegenerate={loadingRegenerate}
          onBackToStep2={function () { setStep("2"); }}
          onReset={resetAll}
        />
      ) : null}

      {step === "3" ? (
        <Step3
          confirmedSubjectJa={confirmedSubjectJa} setConfirmedSubjectJa={setConfirmedSubjectJa}
          confirmedBodyJa={confirmedBodyJa} setConfirmedBodyJa={setConfirmedBodyJa}
          detectedLanguage={detectedLanguage}
          onTranslate={onTranslate} loading={loadingTranslate}
          translateResult={translateResult}
          onBackToStep2={function () { setStep("2"); }}
          onReset={resetAll}
        />
      ) : null}
    </div>
  );
}
