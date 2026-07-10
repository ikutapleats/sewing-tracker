const { useState, useMemo } = React;

/*
  生田プリーツ｜プリーツ加工 問い合わせフォーム
  -----------------------------------------------------------------
  設計の要点:
  - 現行Googleフォーム(75問)は、分岐ごとに共通質問を重複させていた。
    → 本フォームは「共通質問は1回だけ」「寸法は選んだ種類の分だけ」表示。
       1人が見る項目は 約15問 に減る。
  - 送信時に、問い合わせアプリ(inquiry-app-spec)の web_form 入力JSONを組み立てる。
    実運用では handleSubmit 内から Apps Script(doPost) へ POST する(投げっぱなし)。
  - 金額計算はここでは一切しない。数値の解釈・見積もりはバックエンド側。
  - 「その他(未定)」を選んだ場合は、加工内容が決まっていないため
    共通の「生地・仕上げ・納期」セクション自体を表示しない(ご希望内容+画像のみ)。
*/

// ---- ブランドトークン（インラインstyleで指定。藍＝textile heritage の一点差し色）----
const C = {
  paper: "#FBF9F5",
  card: "#FFFFFF",
  ink: "#26221C",
  sub: "#6E675B",
  line: "#E2DCD0",
  lineStrong: "#CFC7B7",
  ai: "#2C3E63",      // 藍
  aiSoft: "#EAEEF5",
  fold: "#B8B0A2",    // 線画の影
  warn: "#8A5A2B",
};
const serif = '"Hiragino Mincho ProN","Yu Mincho",serif';
const gothic = '"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif';

// ---- 送信設定 ----
// ▼ 受付用GAS(pleats-form-receiver.gs)をデプロイ後、WebアプリURLへ差し替える
const ENDPOINT = "https://script.google.com/macros/s/AKfycbwMlFQQQR5-1qZMwrwVtZ99wDFrSAITajBwjpDLghGK7-DBLGFsSdVe7WOW6XnccuYnsw/exec";
// 添付合計の上限(バックストップ)。写真は送信前に自動縮小されるので通常は当たらない。
// 主に縮小できない大きなPDF/仕様書を守るための安全弁。base64化でJSON本文は約1.37倍に
// 膨らむため、実測で失敗した約20MB(本文約27MB)より十分低い10MB(本文約13.7MB)に設定。
// ※上限超で送ると no-cors のため無言で失敗(台帳に行が増えない)。だから事前に弾く。
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEBUG = false; // trueで送信後に構造化JSONを表示(開発確認用)

// ---- lucide-react 相当のインラインSVGアイコン（同名・同props・同見た目）----
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

// 画像の自動縮小設定。長辺をこのpx以下に縮小し、JSON本文(base64)の肥大とGAS受信上限を回避する。
const MAX_IMAGE_EDGE = 2000; // 長辺の上限px(スタッフが仕上がりを確認するには十分)
const IMAGE_QUALITY = 0.85;  // JPEG書き出し品質
const DOWNSCALE_TYPES = ["image/jpeg", "image/png", "image/webp"]; // 縮小対象の画像形式

// File → { name, mime, size, data(base64) }。原本をそのままbase64化する低レベル関数。
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

// 送信用にファイルを読み込む。写真(jpeg/png/webp)は長辺MAX_IMAGE_EDGEへ縮小しJPEG化する。
// 縮小できない形式(PDF・HEIC・SVG等)や、縮小しても小さくならない場合は原本のまま送る。
async function readFileForUpload(file) {
  if (!DOWNSCALE_TYPES.includes(file.type)) return readFileAsBase64(file);
  try {
    // createImageBitmap の imageOrientation でスマホ写真のEXIF回転も正しく反映する
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
    // 元がもともと小さければ原本を採用(拡大や再エンコードで増やさない)
    return readFileAsBase64(file);
  } catch (e) {
    // デコード不可の形式などは原本のまま(上限チェックで別途弾かれる)
    return readFileAsBase64(file);
  }
}

// ---- プリーツ種類の定義（線画つき）----
const PLEAT_TYPES = [
  { id: "one_way", label: "車ひだ", sub: "ワンウェイプリーツ" },
  { id: "box", label: "ボックスプリーツ", sub: "" },
  { id: "accordion", label: "アコーディオン", sub: "均等プリーツ" },
  { id: "crystal", label: "クリスタル", sub: "細かいプリーツ" },
  { id: "wrinkle", label: "しわ加工", sub: "" },
  { id: "multiple", label: "複数種類希望", sub: "" },
  { id: "other", label: "その他", sub: "未定・不明" },
];

// プリーツ図案（淡いブルーのグラデーション＋光沢の立体タッチ）
// 参考図の質感に合わせ、全種類を同じ淡いブルーで統一。形の違いで見分ける。
function Diagram({ type }) {
  const EDGE = "#a7c4dd", EDGE2 = "#9dbdd8", CREASE = "#ffffff";
  const TOP = 24, BOT = 132, SHIFT = 6;

  const defs = (p) => `<defs>
    <linearGradient id="${p}f" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#eef6fd"/><stop offset=".55" stop-color="#dcebf8"/><stop offset="1" stop-color="#cbe1f3"/>
    </linearGradient>
    <linearGradient id="${p}r" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#a6cae7"/><stop offset="1" stop-color="#c4dcf0"/>
    </linearGradient>
    <filter id="${p}s" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="3" stdDeviation="3.2" flood-color="#5b7fa0" flood-opacity="0.20"/>
    </filter>
  </defs>`;

  // 車ひだ: 一方向に倒れる立ち面＋影ひだ（濃い面）＋折り目のハイライト
  const oneway = (p, n = 6) => {
    const m = 14, unit = (200 - 2 * m) / n, rw = unit * 0.30, lean = SHIFT;
    let s = "";
    for (let i = 0; i < n; i++) {
      const x = m + i * unit;
      s += `<path d="M${x} ${TOP + 5} L${x + rw} ${TOP} L${x + rw} ${BOT} L${x} ${BOT + 5} Z" fill="url(#${p}r)" stroke="${EDGE2}" stroke-width="1"/>`;
      s += `<path d="M${x + rw} ${TOP} L${x + unit} ${TOP + lean} L${x + unit} ${BOT + lean} L${x + rw} ${BOT} Z" fill="url(#${p}f)" stroke="${EDGE}" stroke-width="1"/>`;
      s += `<path d="M${x + rw} ${TOP} L${x + rw} ${BOT}" stroke="${CREASE}" stroke-width="1.2" opacity="0.65"/>`;
    }
    return s;
  };
  // ボックス（生田＝インバーテッド）: 幅広の面の間に谷を突き合わせた沈み込み
  const box = (p, n = 4) => {
    const m = 14, unit = (200 - 2 * m) / n, fw = unit * 0.58, tw = unit - fw;
    let s = "";
    for (let i = 0; i < n; i++) {
      const x = m + i * unit, c = x + fw + tw / 2;
      s += `<path d="M${x} ${TOP} L${x + fw} ${TOP} L${x + fw} ${BOT} L${x} ${BOT} Z" fill="url(#${p}f)" stroke="${EDGE}" stroke-width="1"/>`;
      s += `<path d="M${x + fw} ${TOP} L${c} ${TOP + 4} L${c} ${BOT + 4} L${x + fw} ${BOT} Z" fill="url(#${p}r)" stroke="${EDGE2}" stroke-width="1"/>`;
      s += `<path d="M${c} ${TOP + 4} L${x + unit} ${TOP} L${x + unit} ${BOT} L${c} ${BOT + 4} Z" fill="url(#${p}r)" stroke="${EDGE2}" stroke-width="1"/>`;
      s += `<path d="M${x + fw} ${TOP} L${x + fw} ${BOT}" stroke="${CREASE}" stroke-width="1.1" opacity="0.6"/>`;
    }
    return s;
  };
  // アコーディオン: 平行・均等のジグザグ（光沢の明暗を交互に）
  const accordion = (p, n = 9) => {
    const m = 12, unit = (200 - 2 * m) / n, amp = 6;
    let s = "";
    for (let i = 0; i < n; i++) {
      const x0 = m + i * unit, xm = x0 + unit / 2, x1 = x0 + unit;
      s += `<path d="M${x0} ${TOP} L${xm} ${TOP + amp} L${xm} ${BOT + amp} L${x0} ${BOT} Z" fill="url(#${p}${i % 2 ? "r" : "f"})" stroke="${EDGE}" stroke-width="0.9"/>`;
      s += `<path d="M${xm} ${TOP + amp} L${x1} ${TOP} L${x1} ${BOT} L${xm} ${BOT + amp} Z" fill="url(#${p}${i % 2 ? "f" : "r"})" stroke="${EDGE}" stroke-width="0.9"/>`;
    }
    return s;
  };
  // クリスタル: 細かく山を少し丸めた（マシンプリーツ）
  const crystal = (p, n = 17) => {
    const m = 8, unit = (200 - 2 * m) / n, amp = 4;
    let s = "";
    for (let i = 0; i < n; i++) {
      const x0 = m + i * unit, xm = x0 + unit / 2, x1 = x0 + unit;
      s += `<path d="M${x0} ${TOP} Q${(x0 + xm) / 2} ${TOP + amp} ${xm} ${TOP + amp} L${xm} ${BOT + amp} Q${(x0 + xm) / 2} ${BOT + amp} ${x0} ${BOT} Z" fill="url(#${p}${i % 2 ? "r" : "f"})" stroke="${EDGE}" stroke-width="0.7"/>`;
      s += `<path d="M${xm} ${TOP + amp} Q${(xm + x1) / 2} ${TOP + amp} ${x1} ${TOP} L${x1} ${BOT} Q${(xm + x1) / 2} ${BOT + amp} ${xm} ${BOT + amp} Z" fill="url(#${p}${i % 2 ? "f" : "r"})" stroke="${EDGE}" stroke-width="0.7"/>`;
    }
    return s;
  };
  // しわ加工: 不規則な縦のクリンクル
  const wrinkle = (p) => {
    let s = `<rect x="12" y="${TOP}" width="176" height="${BOT - TOP}" rx="4" fill="url(#${p}f)" stroke="${EDGE}" stroke-width="1"/>`;
    const seeds = [24, 40, 54, 72, 88, 106, 122, 140, 158, 176], h = (BOT - TOP) / 2;
    seeds.forEach((x, i) => {
      const amp = (i % 3) + 1.2;
      s += `<path d="M${x} ${TOP} q${amp * 3} ${(BOT - TOP) / 4} 0 ${h} q${-amp * 3} ${(BOT - TOP) / 4} 0 ${h}" fill="none" stroke="${i % 2 ? EDGE2 : CREASE}" stroke-width="${i % 2 ? 1.4 : 1.6}" opacity="${i % 2 ? 0.8 : 0.75}"/>`;
    });
    return s;
  };
  const multiple = (p) =>
    `<g transform="translate(6,30) scale(0.30)">${oneway(p, 4)}</g>` +
    `<g transform="translate(72,30) scale(0.30)">${box(p, 2)}</g>` +
    `<g transform="translate(136,30) scale(0.30)">${accordion(p, 6)}</g>`;
  const other = (p) =>
    `<rect x="30" y="34" width="140" height="88" rx="10" fill="none" stroke="${EDGE2}" stroke-width="1.6" stroke-dasharray="5 5"/>` +
    `<text x="100" y="90" text-anchor="middle" font-size="42" fill="${EDGE2}" font-family="serif">?</text>`;

  const gens = { one_way: oneway, box, accordion, crystal, wrinkle, multiple, other };
  const gen = gens[type] || other;
  const p = "d_" + type + "_"; // グラデーションIDの重複回避（種類ごとに一意）
  const flat = type === "wrinkle" || type === "other" || type === "multiple";
  const inner = gen(p);
  const body = flat ? inner : `<g filter="url(#${p}s)">${inner}</g>`;
  const svg = `<svg viewBox="0 0 200 156" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">${defs(p)}${body}</svg>`;
  return <span style={{ display: "block", width: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// 種類ごとに「寸法セクションで何を訊くか」
const needsFaceShadow = (t) => t === "one_way" || t === "box"; // 表ひだ/影ひだの2値
const needsSingleWidth = (t) => t === "accordion";             // ひだ幅1値(ウエスト/裾で変えられる=裾広がり可)
const needsCrystal = (t) => t === "crystal";                   // マシンプリーツ: 山〜谷サイズ1値+途中消し
const needsFlow = (t) => t === "one_way";                       // 流れる方向
const needsPattern = (t) => ["one_way", "box", "accordion"].includes(t);
const imageRequired = (t) => ["wrinkle", "multiple", "other"].includes(t); // 寸法で表現できない
// 納期を「必須」にする種類。複数種類希望・その他は加工内容が未確定なため納期を任意とし、
// 納期未入力で送信できなくなる不具合を防ぐ(納期欄は表示するが必須にしない/その他は非表示)。
const deadlineRequired = (t) => !!t && t !== "multiple" && t !== "other";

// ---- 小さなUI部品 ----
function Field({ label, required, hint, children }) {
  return (
    <label style={{ display: "block", marginBottom: 20 }}>
      <div style={{ fontSize: 14, color: C.ink, fontWeight: 600, marginBottom: 6 }}>
        {label}
        {required && <span style={{ color: C.warn, marginLeft: 6, fontSize: 12 }}>必須</span>}
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
        {busy ? "読み込み中…" : "画像・ファイルを選ぶ"}
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
          <CircleAlert size={13} /> この種類では画像が必須です
        </div>
      )}
    </div>
  );
}

// 寸法の2値入力（表ひだ / 影ひだ）
function PairWidth({ label, value, onChange }) {
  return (
    <Field label={label} hint="表ひだと影ひだを同じ寸法にすることもできます。平行を希望の場合は空欄で構いません。">
      <div style={{ display: "flex", gap: 10 }}>
        {["表ひだ", "影ひだ"].map((k) => (
          <div key={k} style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>{k}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <TextInput inputMode="decimal" placeholder="例 1.5"
                value={value[k] || ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
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
    name: "", email: "", phone: "", org: "",
    type: "",
    waistPair: {}, hemPair: {}, waistSingle: "", hemSingle: "", length: "",
    crystalPitch: "", crystalFade: "",
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
    if (!f.name.trim()) m.push("氏名");
    if (!f.email.trim()) m.push("メールアドレス");
    if (!t) m.push("プリーツの種類");
    if (t && imageRequired(t) && f.imageFiles.length === 0) m.push("イメージ写真");
    if (deadlineRequired(t) && !f.deadline.trim()) m.push("希望納期");
    return m;
  }, [f, t]);

  const toggleHem = (v) =>
    set("hemFinish", f.hemFinish.includes(v) ? f.hemFinish.filter((x) => x !== v) : [...f.hemFinish, v]);
  const toggleMulti = (v) =>
    set("multiTypes", f.multiTypes.includes(v) ? f.multiTypes.filter((x) => x !== v) : [...f.multiTypes, v]);

  function buildPayload() {
    // inquiry-app-spec の web_form 入力に沿った構造化データ
    const typeLabel = PLEAT_TYPES.find((x) => x.id === t)?.label;
    return {
      action: "process_inquiry",
      inquiry: {
        channel: "web_form",
        sender_name: f.name,
        sender_email: f.email,
        phone: f.phone,
        organization: f.org,
        structured: {
          pleat_type: t,
          pleat_type_label: typeLabel,
          dimensions: {
            waist: needsFaceShadow(t) ? f.waistPair : needsSingleWidth(t) ? { ひだ幅: f.waistSingle } : null,
            hem: needsFaceShadow(t) ? f.hemPair : needsSingleWidth(t) ? { ひだ幅: f.hemSingle } : null,
            pleat_size: needsCrystal(t) ? f.crystalPitch || null : null,
            length: f.length || null,
          },
          flow_direction: needsFlow(t) ? f.flow || null : null,
          pattern: needsPattern(t) ? f.pattern || null : null,
          crystal_fade: needsCrystal(t) ? f.crystalFade || null : null,
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

    // 添付合計サイズのチェック
    const totalBytes = [...f.imageFiles, ...f.designFiles].reduce((s, x) => s + (x.size || 0), 0);
    if (totalBytes > MAX_UPLOAD_BYTES) {
      setError(`添付が大きすぎます（合計 ${(totalBytes / 1024 / 1024).toFixed(1)}MB）。${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB以内に減らすか、送信後の返信メールに添付してください。`);
      return;
    }

    setError("");
    setSending(true);
    try {
      // CORSを避けるため text/plain + no-cors の「投げっぱなし」送信。
      // 応答は読めないが、台帳への記録はサーバー側で完了する。
      await fetch(ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      setSubmitted(payload);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError("送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。");
    } finally {
      setSending(false);
    }
  }

  // ---- 送信後の確認画面 ----
  if (submitted) {
    return (
      <div style={{ background: C.paper, minHeight: "100vh", fontFamily: gothic, padding: "48px 20px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 32 }}>
            <div style={{ width: 44, height: 44, borderRadius: 999, background: C.aiSoft, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Check size={22} color={C.ai} strokeWidth={2.5} />
            </div>
            <h2 style={{ fontFamily: serif, fontSize: 22, color: C.ink, margin: "0 0 8px" }}>受け付けました</h2>
            <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.8, margin: 0 }}>
              後日、担当者よりメールでご連絡します。内容の確認や見積もりのため、追加でお伺いすることがあります。
            </p>
            {DEBUG && (
              <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>送信された構造化データ（開発確認用・実運用では非表示。画像はファイル名のみ表示）</div>
                <pre style={{ fontSize: 11, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 6, padding: 14, overflow: "auto", color: C.ink, lineHeight: 1.6 }}>
{JSON.stringify(submitted, (k, v) => (k === "data" ? `[base64 ${Math.ceil((v?.length || 0) * 0.75 / 1024)}KB]` : v), 2)}
                </pre>
              </div>
            )}
            <button onClick={() => setSubmitted(null)} style={{ marginTop: 20, fontSize: 13, color: C.ai, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              ← フォームに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- 本体 ----
  return (
    <div style={{ background: C.paper, minHeight: "100vh", fontFamily: gothic }}>
      {/* ヘッダー */}
      <div style={{ borderBottom: `1px solid ${C.line}`, background: C.card }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px" }}>
          <div style={{ fontSize: 12, letterSpacing: 3, color: C.ai, marginBottom: 6 }}>IKUTA PLEATS</div>
          <h1 style={{ fontFamily: serif, fontSize: 26, color: C.ink, margin: "0 0 10px", fontWeight: 600 }}>
            プリーツ加工 お問い合わせ
          </h1>
          <p style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.85, margin: 0 }}>
            決まっていない項目は空欄で構いません。分かる範囲でご記入ください。
            種類を選ぶと、その加工に必要な項目だけを表示します。
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 20px 80px" }}>

        {/* 基本情報 */}
        <Section title="ご連絡先">
          <Field label="氏名" required>
            <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="メールアドレス" required>
            <TextInput type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="電話番号">
            <TextInput type="tel" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="所属（学校・ブランド・企業名）" hint="個人の方は空欄で構いません。">
            <TextInput value={f.org} onChange={(e) => set("org", e.target.value)} />
          </Field>
        </Section>

        {/* 種類 */}
        <Section title="プリーツの種類" required>
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

        {/* 寸法（条件分岐） */}
        {t && t !== "multiple" && t !== "other" && (
          <Section title="加工の寸法" note={t === "wrinkle" ? "しわ加工は丈のみ。仕上がりはイメージ写真で共有してください。" : "写真を参考に、分かる範囲でご記入ください。"}>
            {needsFaceShadow(t) && (
              <>
                <PairWidth label="① ウエスト側　表ひだ・影ひだの幅" value={f.waistPair} onChange={(v) => set("waistPair", v)} />
                <PairWidth label="② 裾側　表ひだ・影ひだの幅" value={f.hemPair} onChange={(v) => set("hemPair", v)} />
              </>
            )}
            {needsSingleWidth(t) && (
              <>
                <Field label="① ウエスト側　ひだの幅" hint="回答例: 1.5cm　平行を希望の場合は空欄で構いません。">
                  <WidthMM value={f.waistSingle} onChange={(v) => set("waistSingle", v)} />
                </Field>
                <Field label="② 裾側　ひだの幅" hint="回答例: 2cm　ウエストより裾を広くすると、裾広がり（アンブレラプリーツ）になります。">
                  <WidthMM value={f.hemSingle} onChange={(v) => set("hemSingle", v)} />
                </Field>
              </>
            )}
            {needsCrystal(t) && (
              <>
                <Field label="① ひだの大きさ（山から谷）" hint="マシンプリーツのため3〜14mmの範囲。ウエストと裾は同じ大きさになり、裾広がりにはできません。回答例: 5mm">
                  <WidthMM value={f.crystalPitch} onChange={(v) => set("crystalPitch", v)} unit="mm" placeholder="例 5" />
                </Field>
                <Field label="② 途中からプリーツを消す加工" hint="裾や途中でプリーツを消す（無くす）加工も可能です。">
                  {["希望する", "希望しない", "未定・相談したい"].map((o) => (
                    <Choice key={o} selected={f.crystalFade === o} onClick={() => set("crystalFade", o)}>{o}</Choice>
                  ))}
                </Field>
              </>
            )}
            <Field label="③ 丈">
              <WidthMM value={f.length} onChange={(v) => set("length", v)} unit="cm" placeholder="例 60" />
            </Field>

            {needsFlow(t) && (
              <Field label="プリーツの流れる方向" hint="一般的なプリーツスカートは左流れが多いです。">
                {["左流れ", "右流れ", "未定・わからない"].map((o) => (
                  <Choice key={o} selected={f.flow === o} onClick={() => set("flow", o)}>{o}</Choice>
                ))}
              </Field>
            )}
            {needsPattern(t) && (
              <Field label="パターンはありますか">
                {["紙のパターンがある", "パターンデータがある", "ない"].map((o) => (
                  <Choice key={o} selected={f.pattern === o} onClick={() => set("pattern", o)}>{o}</Choice>
                ))}
              </Field>
            )}
            <Field label="イメージ写真" required={imageRequired(t)} hint="仕上がりの参考になる写真があれば。">
              <FileInput files={f.imageFiles} onChange={(v) => set("imageFiles", v)} required={imageRequired(t)} />
            </Field>
          </Section>
        )}

        {/* 複数種類希望 */}
        {t === "multiple" && (
          <Section title="ご希望の種類" required note="当てはまるものをすべて選び、下欄に希望を記入してください。">
            {["車ひだ", "ボックスプリーツ", "アコーディオン", "クリスタル", "しわ加工"].map((o) => (
              <CheckItem key={o} checked={f.multiTypes.includes(o)} onClick={() => toggleMulti(o)}>{o}</CheckItem>
            ))}
            <Field label="それぞれの希望内容" hint="寸法・丈・組み合わせなど、決まっている範囲で。">
              <textarea value={f.multiDetail} onChange={(e) => set("multiDetail", e.target.value)}
                rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
            <Field label="イメージ写真・デザイン画" required>
              <FileInput files={f.imageFiles} onChange={(v) => set("imageFiles", v)} required />
            </Field>
          </Section>
        )}

        {/* その他（未定） */}
        {t === "other" && (
          <Section title="ご希望の内容" required>
            <Field label="ご希望・お困りごと" hint="やりたいこと、決まっていないことなど、そのまま書いてください。">
              <textarea value={f.otherDetail} onChange={(e) => set("otherDetail", e.target.value)}
                rows={4} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
            <Field label="イメージ写真・デザイン画" required>
              <FileInput files={f.imageFiles} onChange={(v) => set("imageFiles", v)} required />
            </Field>
          </Section>
        )}

        {/* 共通事項（type選択後、かつ「その他」以外にのみ表示） */}
        {t && t !== "other" && (
          <Section title="生地・仕上げ・納期">
            <Field label="生地の種類・組成" hint="回答例: オーガンジー ポリエステル100% ／ ブロード ポリエステル90% 綿10%　※ポリエステル率はプリーツの定着に関わるため、分かればご記入ください。">
              <TextInput value={f.fabric} onChange={(e) => set("fabric", e.target.value)} />
            </Field>
            <Field label="耳を除いた生地幅">
              <WidthMM value={f.fabricWidth} onChange={(v) => set("fabricWidth", v)} unit="cm" placeholder="例 140" />
            </Field>
            <Field label="数量" hint="枚数、または m 数でお答えください。">
              <TextInput value={f.quantity} onChange={(e) => set("quantity", e.target.value)} placeholder="例 30m ／ 20枚" />
            </Field>
            <Field label="裾上げの有無" hint="三つ巻き・ロックルイス（手まつり風）・メロー始末に対応可能です。">
              {["三つ巻き", "ロックルイス", "メロー始末", "裾上げなし（裁ちきり）", "未定・わからない"].map((o) => (
                <CheckItem key={o} checked={f.hemFinish.includes(o)} onClick={() => toggleHem(o)}>{o}</CheckItem>
              ))}
              <TextInput value={f.hemFinishOther} onChange={(e) => set("hemFinishOther", e.target.value)}
                placeholder="その他・種類ごとに変えたい場合はこちら" />
            </Field>
            <Field label="希望納期" required={deadlineRequired(t)} hint="カレンダーから日付を選ぶか、時期が未定の場合は「特になし」を選んでください。">
              <TextInput type="date"
                value={f.deadline === "特になし" ? "" : f.deadline}
                disabled={f.deadline === "特になし"}
                onChange={(e) => set("deadline", e.target.value)}
                style={{ ...inputStyle, opacity: f.deadline === "特になし" ? 0.5 : 1 }} />
              <div style={{ marginTop: 8 }}>
                <CheckItem
                  checked={f.deadline === "特になし"}
                  onClick={() => set("deadline", f.deadline === "特になし" ? "" : "特になし")}>
                  特になし（時期は未定）
                </CheckItem>
              </div>
            </Field>
            <Field label="デザイン画・仕様書" hint="あればアップロードしてください。">
              <FileInput files={f.designFiles} onChange={(v) => set("designFiles", v)} />
            </Field>
            <Field label="その他" hint="来社希望や質問があればご記入ください。">
              <textarea value={f.note} onChange={(e) => set("note", e.target.value)}
                rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </Field>
          </Section>
        )}

        {/* 送信 */}
        <div style={{ marginTop: 8 }}>
          {missing.length > 0 && t && (
            <div style={{ fontSize: 13, color: C.warn, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <CircleAlert size={15} /> 未入力: {missing.join("・")}
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
            {sending ? "送信中…" : "送信する"} {!sending && <ArrowRight size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// 寸法(cm)入力の共通部品
function WidthMM({ value, onChange, unit = "cm", placeholder = "例 1.5" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 240 }}>
      <TextInput inputMode="decimal" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <span style={{ fontSize: 13, color: C.sub, whiteSpace: "nowrap" }}>{unit}</span>
    </div>
  );
}

// セクション枠
function Section({ title, required, note, children }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 24, marginBottom: 18 }}>
      <div style={{ marginBottom: note ? 6 : 18 }}>
        <h2 style={{ fontFamily: serif, fontSize: 17, color: C.ink, margin: 0, fontWeight: 600 }}>
          {title}
          {required && <span style={{ color: C.warn, marginLeft: 8, fontSize: 11, fontFamily: gothic }}>必須</span>}
        </h2>
      </div>
      {note && <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.7, margin: "0 0 18px" }}>{note}</p>}
      {children}
    </section>
  );
}
