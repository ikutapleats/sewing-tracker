const { useState, useMemo } = React;

/*
  IKUTA PLEATS | Pleating Inquiry Form (English)
  -----------------------------------------------------------------
  This is the English-facing twin of pleats-form-app.jsx.
  UI is in English, but every SELECTABLE value is submitted in Japanese
  (each option carries {en, ja}; the `ja` value is stored/sent) so the
  staff ledger (案件台帳) stays uniformly Japanese. Free-text fields
  (name, company, notes, fabric, dimensions numbers) are sent as typed.
  Same backend endpoint, same spreadsheet, same illustrations.
*/

const C = {
  paper: "#FBF9F5",
  card: "#FFFFFF",
  ink: "#26221C",
  sub: "#6E675B",
  line: "#E2DCD0",
  lineStrong: "#CFC7B7",
  ai: "#2C3E63",
  aiSoft: "#EAEEF5",
  fold: "#B8B0A2",
  warn: "#8A5A2B",
};
const serif = '"Hiragino Mincho ProN","Yu Mincho",Georgia,serif';
const gothic = '"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif';

// Same endpoint / receiver as the Japanese form (writes to the same ledger).
const ENDPOINT = "https://script.google.com/macros/s/AKfycbwMlFQQQR5-1qZMwrwVtZ99wDFrSAITajBwjpDLghGK7-DBLGFsSdVe7WOW6XnccuYnsw/exec";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEBUG = false;

function Check({ size = 24, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function Upload({ size = 24, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" x2="12" y1="3" y2="15" />
    </svg>
  );
}
function ArrowRight({ size = 24, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
function X({ size = 24, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
function CircleAlert({ size = 24, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

const MAX_IMAGE_EDGE = 2000;
const IMAGE_QUALITY = 0.85;
const DOWNSCALE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function readFileAsBase64(file, overrideName, overrideMime) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const data = String(r.result).split(",")[1] || "";
      resolve({
        name: overrideName || file.name,
        mime: overrideMime || file.type || "application/octet-stream",
        size: file.size,
        data,
      });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function readFileForUpload(file) {
  if (!DOWNSCALE_TYPES.includes(file.type)) return readFileAsBase64(file);
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longEdge = Math.max(bmp.width, bmp.height);
    const scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const b64 = (canvas.toDataURL("image/jpeg", IMAGE_QUALITY).split(",")[1]) || "";
    const approxBytes = Math.floor(b64.length * 0.75);
    if (approxBytes < file.size) {
      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return { name, mime: "image/jpeg", size: approxBytes, data: b64 };
    }
    return readFileAsBase64(file);
  } catch (e) {
    return readFileAsBase64(file);
  }
}

// ---- Pleat types (label = English shown, ja = Japanese sent to ledger) ----
const PLEAT_TYPES = [
  { id: "one_way", label: "Knife pleats", sub: "One-way", ja: "車ひだ" },
  { id: "box", label: "Box pleats", sub: "Inverted", ja: "ボックスプリーツ" },
  { id: "accordion", label: "Accordion", sub: "Even / parallel", ja: "アコーディオン" },
  { id: "sunray", label: "Sunray", sub: "Flared hem", ja: "サンレイ" },
  { id: "crystal", label: "Crystal", sub: "Fine pleats", ja: "クリスタル" },
  { id: "wrinkle", label: "Crinkle", sub: "Wrinkle finish", ja: "しわ加工" },
  { id: "multiple", label: "Multiple types", sub: "", ja: "複数種類希望" },
  { id: "other", label: "Other / undecided", sub: "", ja: "その他" },
];
const jaLabel = (id) => (PLEAT_TYPES.find((x) => x.id === id) || {}).ja || id;

// ---- Illustrations (shared with the Japanese form: pleats/<id>.jpg) ----
const ILLUST_TYPES = ["one_way", "box", "accordion", "sunray", "crystal", "wrinkle"];
function Diagram({ type }) {
  const imgStyle = { width: "100%", height: "auto", display: "block", borderRadius: 6 };
  if (ILLUST_TYPES.includes(type))
    return <img src={`pleats/${type}.jpg`} alt="" style={imgStyle} loading="lazy" />;
  if (type === "multiple")
    return (
      <div style={{ display: "flex", gap: 4 }}>
        {["one_way", "box", "accordion"].map((k) => (
          <img key={k} src={`pleats/${k}.jpg`} alt="" loading="lazy"
            style={{ width: "33.33%", height: "auto", display: "block", borderRadius: 4 }} />
        ))}
      </div>
    );
  return (
    <div style={{
      width: "100%", aspectRatio: "3 / 2", borderRadius: 6, background: C.paper,
      border: `1.5px dashed ${C.lineStrong}`, display: "flex", alignItems: "center",
      justifyContent: "center", color: C.sub, fontSize: 34, fontFamily: serif,
    }}>?</div>
  );
}

// ---- which dimension fields each type asks (identical logic to the JP form) ----
const needsFaceShadow = (t) => t === "one_way" || t === "box";
const needsParallelWidth = (t) => t === "accordion";
const needsFlareWidth = (t) => t === "sunray";
const needsCrystal = (t) => t === "crystal";
const needsFlow = (t) => t === "one_way";
const needsPattern = (t) => ["one_way", "box", "accordion", "sunray"].includes(t);
const imageRequired = (t) => ["wrinkle", "multiple", "other"].includes(t);
const deadlineRequired = (t) => !!t && t !== "multiple" && t !== "other";

// ---- option lists: shown in English, submitted in Japanese ----
const FLOW_OPTS = [
  { en: "Left-flowing", ja: "左流れ" },
  { en: "Right-flowing", ja: "右流れ" },
  { en: "Undecided", ja: "未定・わからない" },
];
const PATTERN_OPTS = [
  { en: "I have a paper pattern", ja: "紙のパターンがある" },
  { en: "I have pattern data", ja: "パターンデータがある" },
  { en: "None", ja: "ない" },
];
const FADE_OPTS = [
  { en: "Yes, please", ja: "希望する" },
  { en: "No", ja: "希望しない" },
  { en: "Undecided / want to discuss", ja: "未定・相談したい" },
];
const HEM_OPTS = [
  { en: "Rolled hem (three-fold)", ja: "三つ巻き" },
  { en: "Overlocked and blind-stitched hem", ja: "ロックルイス" },
  { en: "Rolled hem", ja: "メロー始末" },
  { en: "No hemming (raw cut)", ja: "裾上げなし（裁ちきり）" },
  { en: "Undecided", ja: "未定・わからない" },
];
const NO_DEADLINE = "特になし"; // stored/sent value; shown as English below

// Country / region list for the English form (submitted as-is; last option = Other).
const COUNTRIES = [
  "United States", "United Kingdom", "France", "Italy", "Germany", "Spain",
  "Netherlands", "Belgium", "Switzerland", "Austria", "Denmark", "Sweden",
  "Norway", "Finland", "Ireland", "Portugal", "Poland", "Czech Republic",
  "Greece", "Hungary", "Romania", "Russia", "Ukraine", "Canada", "Mexico",
  "Brazil", "Argentina", "Chile", "Colombia", "Peru", "Australia",
  "New Zealand", "South Korea", "China", "Hong Kong", "Taiwan", "Japan",
  "Singapore", "Thailand", "Malaysia", "Indonesia", "Philippines", "Vietnam",
  "India", "United Arab Emirates", "Saudi Arabia", "Qatar", "Israel", "Turkey",
  "Egypt", "South Africa", "Morocco", "Nigeria", "Kenya", "Other",
];

// ---- small UI parts ----
function Field({ label, required, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 20 }}>
      <div style={{ fontSize: 14, color: C.ink, fontWeight: 600, marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: C.warn, marginLeft: 6, fontSize: 12 }}>Required</span>}
      </div>
      {hint && <div style={{ fontSize: 12, color: C.sub, marginBottom: 8, lineHeight: 1.6 }}>{hint}</div>}
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px",
  border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 15,
  color: C.ink, background: C.card, fontFamily: gothic, outline: "none",
};

function TextInput({ style, ...props }) {
  return <input {...props} style={{ ...inputStyle, ...style }} onFocus={(e) => (e.target.style.borderColor = C.ai)} onBlur={(e) => (e.target.style.borderColor = C.line)} />;
}

function Choice({ selected, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        padding: "10px 12px", marginBottom: 8, borderRadius: 6, cursor: "pointer",
        border: `1px solid ${selected ? C.ai : C.line}`,
        background: selected ? C.aiSoft : C.card, color: C.ink, fontSize: 14, fontFamily: gothic,
      }}>
      <span style={{
        width: 16, height: 16, borderRadius: 999, flexShrink: 0,
        border: `1.5px solid ${selected ? C.ai : C.lineStrong}`,
        background: selected ? C.ai : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{selected && <Check size={10} color="#fff" strokeWidth={3} />}</span>
      {children}
    </button>
  );
}

function CheckItem({ checked, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
        padding: "9px 12px", marginBottom: 8, borderRadius: 6, cursor: "pointer",
        border: `1px solid ${checked ? C.ai : C.line}`,
        background: checked ? C.aiSoft : C.card, color: C.ink, fontSize: 14, fontFamily: gothic,
      }}>
      <span style={{
        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
        border: `1.5px solid ${checked ? C.ai : C.lineStrong}`,
        background: checked ? C.ai : "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{checked && <Check size={10} color="#fff" strokeWidth={3} />}</span>
      {children}
    </button>
  );
}

function FileInput({ files, onChange, required }) {
  const [busy, setBusy] = useState(false);
  const pick = async (list) => {
    setBusy(true);
    try {
      const read = await Promise.all(Array.from(list).map(readFileForUpload));
      onChange([...files, ...read]);
    } finally {
      setBusy(false);
    }
  };
  const remove = (i) => onChange(files.filter((_, idx) => idx !== i));
  const fmt = (b) => (b > 1024 * 1024 ? (b / 1024 / 1024).toFixed(1) + "MB" : Math.ceil(b / 1024) + "KB");
  return (
    <div>
      <label style={{
        display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px",
        border: `1px dashed ${C.lineStrong}`, borderRadius: 6, cursor: busy ? "wait" : "pointer",
        fontSize: 13, color: C.ai, background: C.card, fontFamily: gothic, opacity: busy ? 0.6 : 1,
      }}>
        <Upload size={15} />
        {busy ? "Loading…" : "Choose images / files"}
        <input type="file" multiple style={{ display: "none" }}
          onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      </label>
      {files.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {files.map((f, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.sub, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 4, padding: "3px 6px 3px 8px" }}>
              {f.name}<span style={{ color: C.lineStrong }}>{fmt(f.size)}</span>
              <button type="button" onClick={() => remove(i)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", color: C.sub }}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      {required && files.length === 0 && (
        <div style={{ fontSize: 12, color: C.warn, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <CircleAlert size={13} /> An image is required for this type.
        </div>
      )}
    </div>
  );
}

// two-value width input (face / shadow). Shown in English, stored under Japanese keys.
function PairWidth({ label, value, onChange }) {
  const KEYS = [{ en: "Face pleat", ja: "表ひだ" }, { en: "Shadow pleat", ja: "影ひだ" }];
  return (
    <Field label={label} hint="You may enter the same size for both, or leave blank if you want them parallel.">
      <div style={{ display: "flex", gap: 10 }}>
        {KEYS.map((k) => (
          <div key={k.ja} style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>{k.en}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TextInput inputMode="decimal" placeholder="e.g. 1.5"
                value={value[k.ja] || ""} onChange={(e) => onChange({ ...value, [k.ja]: e.target.value })} />
              <span style={{ fontSize: 13, color: C.sub }}>cm</span>
            </div>
          </div>
        ))}
      </div>
    </Field>
  );
}

function App() {
  const [f, setF] = useState({
    name: "", email: "", phone: "", org: "", country: "",
    type: "",
    waistPair: {}, hemPair: {}, waistSingle: "", hemSingle: "", length: "",
    crystalPitch: "", crystalFade: "",
    sunrayAngle: "", sunrayAngleOther: "",
    flow: "", pattern: "",
    fabric: "", fabricWidth: "", quantity: "",
    hemFinish: [], hemFinishOther: "",
    deadline: "", note: "",
    multiTypes: [], multiDetail: "",
    otherDetail: "",
    imageFiles: [], designFiles: [],
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const [submitted, setSubmitted] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const t = f.type;

  const missing = useMemo(() => {
    const m = [];
    if (!f.name.trim()) m.push("Name");
    if (!f.email.trim()) m.push("Email address");
    if (!t) m.push("Pleat type");
    if (t && imageRequired(t) && f.imageFiles.length === 0) m.push("Reference photo");
    if (deadlineRequired(t) && !f.deadline.trim()) m.push("Desired deadline");
    return m;
  }, [f, t]);

  const toggleHem = (v) =>
    set("hemFinish", f.hemFinish.includes(v) ? f.hemFinish.filter((x) => x !== v) : [...f.hemFinish, v]);
  const toggleMulti = (v) =>
    set("multiTypes", f.multiTypes.includes(v) ? f.multiTypes.filter((x) => x !== v) : [...f.multiTypes, v]);

  function buildPayload() {
    return {
      action: "process_inquiry",
      inquiry: {
        channel: "web_form_en",
        sender_name: f.name,
        sender_email: f.email,
        phone: f.phone,
        organization: f.org,
        structured: {
          country: f.country || null,
          pleat_type: t,
          pleat_type_label: jaLabel(t), // Japanese label for the staff ledger
          dimensions: {
            waist: needsFaceShadow(t) ? f.waistPair : (needsParallelWidth(t) || needsFlareWidth(t)) ? { ひだ幅: f.waistSingle } : null,
            hem: needsFaceShadow(t) ? f.hemPair : needsFlareWidth(t) ? { ひだ幅: f.hemSingle } : null,
            pleat_size: needsCrystal(t) ? f.crystalPitch || null : null,
            length: f.length || null,
          },
          flow_direction: needsFlow(t) ? f.flow || null : null,
          pattern: needsPattern(t) ? f.pattern || null : null,
          crystal_fade: needsCrystal(t) ? f.crystalFade || null : null,
          sunray_angle: needsFlareWidth(t) ? (f.sunrayAngle === "その他" ? (f.sunrayAngleOther ? f.sunrayAngleOther + "度" : null) : (f.sunrayAngle || null)) : null,
          multi_types: t === "multiple" ? f.multiTypes : null,
          multi_detail: t === "multiple" ? f.multiDetail : null,
          other_detail: t === "other" ? f.otherDetail : null,
          fabric: f.fabric || null,
          fabric_width: f.fabricWidth || null,
          quantity: f.quantity || null,
          hem_finish: f.hemFinish,
          hem_finish_other: f.hemFinishOther || null,
          deadline: f.deadline || null,
          image_files: f.imageFiles,
          design_files: f.designFiles,
          note: f.note || null,
        },
      },
    };
  }

  async function handleSubmit() {
    if (missing.length || sending) return;
    const payload = buildPayload();

    const totalBytes = [...f.imageFiles, ...f.designFiles].reduce((s, x) => s + (x.size || 0), 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      setError(`Attachments are too large (total ${(totalBytes / 1024 / 1024).toFixed(1)} MB). Please reduce them to under ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB, or attach them to the reply email after submitting.`);
      return;
    }

    setError("");
    setSending(true);
    try {
      await fetch(ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      setSubmitted(payload);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError("Failed to send. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  // ---- confirmation screen ----
  if (submitted) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh", fontFamily: gothic, padding: "48px 20px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 32 }}>
            <div style={{ width: 44, height: 44, borderRadius: 999, background: C.aiSoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Check size={22} color={C.ai} strokeWidth={2.5} />
            </div>
            <h2 style={{ fontFamily: serif, fontSize: 22, color: C.ink, margin: "0 0 8px" }}>Thank you — we've received your inquiry.</h2>
            <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.8, margin: 0 }}>
              A member of our team will contact you by email. We may ask a few more questions to confirm details and prepare a quote.
            </p>
            {DEBUG && (
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>Structured data sent (dev only; images shown as filename)</div>
                <pre style={{ fontSize: 11, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 6, padding: 14, overflow: "auto", color: C.ink, lineHeight: 1.6 }}>
{JSON.stringify(submitted, (k, v) => (k === "data" ? `[base64 ${Math.ceil((v?.length || 0) * 0.75 / 1024)}KB]` : v), 2)}
                </pre>
              </div>
            )}
            <button onClick={() => setSubmitted(null)} style={{ marginTop: 20, fontSize: 13, color: C.ai, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              ← Back to the form
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- body ----
  return (
    <div style={{ background: C.paper, minHeight: "100vh", fontFamily: gothic }}>
      <div style={{ borderBottom: `1px solid ${C.line}`, background: C.card }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: C.ai }}>IQUTA PLEATS</div>
            <a href="pleats-form.html" style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: C.ai, textDecoration: "none", borderRadius: 999, padding: "5px 16px", whiteSpace: "nowrap", letterSpacing: 0.3 }}>日本語</a>
          </div>
          <h1 style={{ fontFamily: serif, fontSize: 26, color: C.ink, margin: "0 0 10px", fontWeight: 600 }}>
            Pleating Inquiry
          </h1>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.85, margin: 0 }}>
            Leave anything undecided blank — fill in what you can. Choosing a type shows only the fields needed for that process. Measurements are in cm/mm.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px" }}>

        {/* contact */}
        <Section title="Contact details">
          <Field label="Name" required>
            <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Email address" required>
            <TextInput type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone number">
            <TextInput type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Country / Region" hint="Where the order will be shipped.">
            <select value={f.country} onChange={(e) => set("country", e.target.value)}
              style={{ ...inputStyle, appearance: "auto" }}>
              <option value="">Please select…</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Affiliation (school, brand, or company)" hint="Leave blank if you are an individual.">
            <TextInput value={f.org} onChange={(e) => set("org", e.target.value)} />
          </Field>
        </Section>

        {/* type */}
        <Section title="Pleat type" required>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {PLEAT_TYPES.map((p) => {
              const sel = t === p.id;
              return (
                <button key={p.id} type="button" onClick={() => set("type", p.id)}
                  style={{
                    textAlign: "left", padding: 12, borderRadius: 8, cursor: "pointer",
                    border: `1.5px solid ${sel ? C.ai : C.line}`,
                    background: sel ? C.aiSoft : C.card,
                  }}>
                  <Diagram type={p.id} />
                  <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: C.ink }}>{p.label}</div>
                  {p.sub && <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{p.sub}</div>}
                </button>
              );
            })}
          </div>
        </Section>

        {/* dimensions */}
        {t && t !== "multiple" && t !== "other" && (
          <Section title="Dimensions" note={
            t === "wrinkle" ? "Wrinkle finish uses length only. Please share the desired result with a reference photo."
              : t === "accordion" ? "Accordion is a parallel pleat (same width at waist and hem). For a flared hem, please choose the “Sunray” type."
                : t === "sunray" ? "Sunray flares toward the hem. Please make the hem-side pleat width larger than the waist side."
                  : "Please fill in what you can, referring to a photo."
          }>
            {needsFaceShadow(t) && (
              <>
                <PairWidth label="① Waist side — face & shadow pleat width" value={f.waistPair} onChange={(v) => set("waistPair", v)} />
                <PairWidth label="② Hem side — face & shadow pleat width" value={f.hemPair} onChange={(v) => set("hemPair", v)} />
              </>
            )}
            {needsParallelWidth(t) && (
              <Field label="Pleat width" hint="e.g. 2 cm. Accordion is parallel, so the width is the same from waist to hem. (For a flared hem, please choose the “Sunray” type.)">
                <WidthMM value={f.waistSingle} onChange={(v) => set("waistSingle", v)} />
              </Field>
            )}
            {needsFlareWidth(t) && (
              <>
                <Field label="① Waist-side pleat width" hint="e.g. 1.5 cm (narrower than the hem side)">
                  <WidthMM value={f.waistSingle} onChange={(v) => set("waistSingle", v)} />
                </Field>
                <Field label="② Hem-side pleat width" hint="e.g. 3 cm. Making the hem wider than the waist creates the flare.">
                  <WidthMM value={f.hemSingle} onChange={(v) => set("hemSingle", v)} />
                </Field>
                <Field label="Fan angle" hint="A half circle (180°) is the most common request. Please specify within 180°.">
                  {[{ val: "90度", en: "90°" }, { val: "180度", en: "180° (half circle)" }, { val: "その他", en: "Other (enter a value)" }].map((o) => (
                    <Choice key={o.val} selected={f.sunrayAngle === o.val} onClick={() => set("sunrayAngle", o.val)}>{o.en}</Choice>
                  ))}
                  {f.sunrayAngle === "その他" && (
                    <div style={{ marginTop: 4 }}>
                      <WidthMM value={f.sunrayAngleOther} onChange={(v) => set("sunrayAngleOther", v)} unit="°" placeholder="e.g. 45 (within 180°)" />
                    </div>
                  )}
                </Field>
              </>
            )}
            {needsCrystal(t) && (
              <>
                <Field label="① Pleat size (peak to valley)" hint="Machine-pleated, so within 3–14 mm. Waist and hem are the same size; it cannot be flared. e.g. 5 mm">
                  <WidthMM value={f.crystalPitch} onChange={(v) => set("crystalPitch", v)} unit="mm" placeholder="e.g. 5" />
                </Field>
                <Field label="② Fade-out pleating" hint="We can also fade the pleats out partway (for example, toward the hem).">
                  {FADE_OPTS.map((o) => (
                    <Choice key={o.ja} selected={f.crystalFade === o.ja} onClick={() => set("crystalFade", o.ja)}>{o.en}</Choice>
                  ))}
                </Field>
              </>
            )}
            <Field label="③ Length">
              <WidthMM value={f.length} onChange={(v) => set("length", v)} unit="cm" placeholder="e.g. 60" />
            </Field>

            {needsFlow(t) && (
              <Field label="Pleat direction" hint="Most pleated skirts flow to the left.">
                {FLOW_OPTS.map((o) => (
                  <Choice key={o.ja} selected={f.flow === o.ja} onClick={() => set("flow", o.ja)}>{o.en}</Choice>
                ))}
              </Field>
            )}
            {needsPattern(t) && (
              <Field label="Do you have a pattern?">
                {PATTERN_OPTS.map((o) => (
                  <Choice key={o.ja} selected={f.pattern === o.ja} onClick={() => set("pattern", o.ja)}>{o.en}</Choice>
                ))}
              </Field>
            )}
            <Field label="Reference photo" required={imageRequired(t)} hint="A photo of the desired result, if you have one.">
              <FileInput files={f.imageFiles} onChange={(v) => set("imageFiles", v)} required={imageRequired(t)} />
            </Field>
          </Section>
        )}

        {/* multiple */}
        {t === "multiple" && (
          <Section title="Requested types" required note="Select all that apply and describe your request below.">
            {PLEAT_TYPES.filter((p) => ILLUST_TYPES.includes(p.id)).map((p) => (
              <CheckItem key={p.id} checked={f.multiTypes.includes(p.ja)} onClick={() => toggleMulti(p.ja)}>
                {p.label}
              </CheckItem>
            ))}
            <Field label="Details for each" hint="Sizes, length, combinations — as far as decided.">
              <textarea value={f.multiDetail} onChange={(e) => set("multiDetail", e.target.value)}
                rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
            <Field label="Reference photos / design sketches" required>
              <FileInput files={f.imageFiles} onChange={(v) => set("imageFiles", v)} required />
            </Field>
          </Section>
        )}

        {/* other */}
        {t === "other" && (
          <Section title="Your request" required>
            <Field label="What you'd like / what you're unsure about" hint="Write freely — what you want to do, what's undecided, etc.">
              <textarea value={f.otherDetail} onChange={(e) => set("otherDetail", e.target.value)}
                rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
            <Field label="Reference photos / design sketches" required>
              <FileInput files={f.imageFiles} onChange={(v) => set("imageFiles", v)} required />
            </Field>
          </Section>
        )}

        {/* common (after a type is chosen, except "other") */}
        {t && t !== "other" && (
          <Section title="Fabric, finishing & deadline">
            <Field label="Fabric type & composition" hint="e.g. Organza, 100% polyester / Broadcloth, 90% polyester 10% cotton. The polyester ratio affects how well pleats set, so please note it if known.">
              <TextInput value={f.fabric} onChange={(e) => set("fabric", e.target.value)} />
            </Field>
            <Field label="Fabric width (excluding selvage)">
              <WidthMM value={f.fabricWidth} onChange={(v) => set("fabricWidth", v)} unit="cm" placeholder="e.g. 140" />
            </Field>
            <Field label="Quantity" hint="Answer in number of pieces or in meters.">
              <TextInput value={f.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="e.g. 30 m / 20 pcs" />
            </Field>
            <Field label="Hemming" hint="We can do a three-fold rolled hem, an overlocked and blind-stitched hem, or a rolled hem.">
              {HEM_OPTS.map((o) => (
                <CheckItem key={o.ja} checked={f.hemFinish.includes(o.ja)} onClick={() => toggleHem(o.ja)}>{o.en}</CheckItem>
              ))}
              <TextInput value={f.hemFinishOther} onChange={(e) => set("hemFinishOther", e.target.value)}
                placeholder="Other, or if it differs per type" />
            </Field>
            <Field label="Desired deadline" required={deadlineRequired(t)} hint="Pick a date, or choose “No specific deadline” if the timing is undecided.">
              <TextInput type="date"
                value={f.deadline === NO_DEADLINE ? "" : f.deadline}
                disabled={f.deadline === NO_DEADLINE}
                onChange={(e) => set("deadline", e.target.value)}
                style={{ ...inputStyle, opacity: f.deadline === NO_DEADLINE ? 0.5 : 1 }} />
              <div style={{ marginTop: 8 }}>
                <CheckItem
                  checked={f.deadline === NO_DEADLINE}
                  onClick={() => set("deadline", f.deadline === NO_DEADLINE ? "" : NO_DEADLINE)}>
                  No specific deadline (timing undecided)
                </CheckItem>
              </div>
            </Field>
            <Field label="Design sketches / spec sheets" hint="Upload if available.">
              <FileInput files={f.designFiles} onChange={(v) => set("designFiles", v)} />
            </Field>
            <Field label="Anything else" hint="Let us know if you'd like to visit us or have any questions.">
              <textarea value={f.note} onChange={(e) => set("note", e.target.value)}
                rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
          </Section>
        )}

        {/* submit */}
        <div style={{ marginTop: 8 }}>
          {missing.length > 0 && t && (
            <div style={{ fontSize: 13, color: C.warn, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <CircleAlert size={15} /> Missing: {missing.join(", ")}
            </div>
          )}
          {error && (
            <div style={{ fontSize: 13, color: C.warn, marginBottom: 12, display: "flex", alignItems: "center", gap: 6, lineHeight: 1.6 }}>
              <CircleAlert size={15} /> {error}
            </div>
          )}
          <button type="button" onClick={handleSubmit} disabled={missing.length > 0 || sending}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "13px 28px", borderRadius: 8, border: "none",
              background: missing.length || sending ? C.lineStrong : C.ai, color: "#fff",
              fontSize: 15, fontWeight: 600, fontFamily: gothic,
              cursor: missing.length || sending ? "not-allowed" : "pointer",
            }}>
            {sending ? "Sending…" : "Send"} {!sending && <ArrowRight size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// cm/mm width input
function WidthMM({ value, onChange, unit = "cm", placeholder = "e.g. 1.5" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 240 }}>
      <TextInput inputMode="decimal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <span style={{ fontSize: 13, color: C.sub, whiteSpace: "nowrap" }}>{unit}</span>
    </div>
  );
}

// section frame
function Section({ title, required, note, children }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 24, marginBottom: 18 }}>
      <div style={{ marginBottom: note ? 6 : 18 }}>
        <h2 style={{ fontFamily: serif, fontSize: 17, color: C.ink, margin: 0, fontWeight: 600 }}>
          {title}
          {required && <span style={{ color: C.warn, marginLeft: 8, fontSize: 11, fontFamily: gothic }}>Required</span>}
        </h2>
      </div>
      {note && <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.7, margin: "0 0 18px" }}>{note}</p>}
      {children}
    </section>
  );
}
