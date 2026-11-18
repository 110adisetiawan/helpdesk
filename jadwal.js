/* =====================================================================
   jadwal.js – menu "Jadwal Helpdesk" dan "Jadwal Teknisi"
   (muncul di navbar, di sebelah kanan Template Chat)

   Cara pasang: di index.html, TEPAT SETELAH <script type="module"> Firebase
   yang sudah ada, tambahkan satu baris:
       <script type="module" src="jadwal.js"></script>
   File ini memakai ulang koneksi Firebase dari index.html (tidak perlu isi
   config lagi), lalu menambahkan sendiri menu navbar, halaman, dan gayanya.

   Data (Firestore): koleksi "schedules", satu dokumen per bulan
     Helpdesk : id "YYYY-MM"            (contoh "2026-11")
     Teknisi  : id "teknisi-YYYY-MM"    (contoh "teknisi-2026-11")
   Isi dokumen:
     names : ["SATRIA", "MAISTRO", ...]        (urutan kolom)
     colors: { "SATRIA": "#E11D48", ... }      (warna judul kolom nama, opsional)
     cells : { "1": { "SATRIA": "PAGI", ... }, "2": {...} }   (kunci = tanggal)
     notes : { "3": "haris jam 1 siang", ... }

   Aturan Firestore (di dalam match /databases/{database}/documents).
   Satu aturan ini sudah mencakup jadwal helpdesk dan teknisi:
     match /schedules/{id} {
       allow read: if true;
       allow write: if request.auth != null
                    && request.auth.token.email in ['EMAIL_ADMIN_KAMU'];
     }
   ===================================================================== */
import { getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

/* ---------- Pengaturan yang boleh diubah ---------- */
const COLLECTION = "schedules";
const SHIFTS = ["PAGI", "MIDDLE", "SORE", "MALAM", "LIBUR", "IJIN", "CUTI"];   // isi dropdown (sama untuk semua jadwal)
// pola rotasi bawaan untuk "Isi pola otomatis" (sama seperti jadwal helpdesk: 7 hari berulang)
const DEFAULT_PATTERN = ["PAGI", "PAGI", "SORE", "SORE", "MALAM", "LIBUR", "LIBUR"];
const DEFAULT_HEAD = "#376A58";          // warna judul kolom nama kalau belum diberi warna
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_NAMES = 12;

// Daftar jadwal. Urutan = urutan menu di navbar. Untuk menambah jadwal lain, cukup tambah satu baris di sini.
//   hash      : alamat halaman (jangan ada dua yang sama)
//   docPrefix : awalan id dokumen Firestore ("" = id polos "YYYY-MM", dipakai jadwal helpdesk)
//   names     : nama awal kolom, bisa diubah admin lewat tombol "Atur nama"
const SCHEDULES = [
  { key: "helpdesk", hash: "#jadwal", label: "Jadwal Helpdesk", who: "helpdesk",
    desc: "Jadwal shift tim helpdesk per bulan.", docPrefix: "",
    names: ["SATRIA", "MAISTRO", "ZHIFRON", "AWAN", "AHSIN", "AKBAR", "HARIS"] },
  { key: "teknisi", hash: "#jadwal-teknisi", label: "Jadwal Teknisi", who: "teknisi",
    desc: "Jadwal shift tim teknisi per bulan.", docPrefix: "teknisi-",
    names: ["FAJAR", "UDIN"] }
];

// warna tiap shift: [warna isi, warna huruf]
const SHIFT_STYLE = {
  PAGI:   ["#BDE0F5", "#1F5FA8"],
  MIDDLE: ["#E3D4F7", "#5B2E91"],
  SORE:   ["#FFC9A8", "#8A4B1F"],
  MALAM:  ["#3A3A3A", "#FFFFFF"],
  IJIN:   ["#FFE599", "#5C4400"],
  CUTI:   ["#0B53A6", "#FFFFFF"],
  LIBUR:  ["#B00000", "#FFFFFF"]
};
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DAYS = ["MINGGU", "SENIN", "SELASA", "RABU", "KAMIS", "JUMAT", "SABTU"];

/* ---------- Helper ---------- */
const pad = (n) => String(n).padStart(2, "0");
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const cssSafe = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, "");
// warna huruf yang terbaca di atas warna latar (putih atau gelap)
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#1B2436" : "#FFFFFF";
}
function paintHead(th, color) {
  if (color && HEX.test(color)) { th.style.background = color; th.style.color = inkFor(color); }
}
const writeMsg = (e) => (e && e.code === "permission-denied")
  ? "Tidak punya izin mengubah jadwal. Pastikan email kamu terdaftar di Rules Firestore untuk koleksi \"schedules\"."
  : "Gagal menyimpan: " + ((e && e.message) || e);

/* ---------- Gaya (dipakai bersama oleh semua jadwal) ---------- */
const style = el("style");
style.id = "jadwal-style";
style.textContent = Object.entries(SHIFT_STYLE).map(([k, [bg, fg]]) => `.sh-${k}{background:${bg};color:${fg}}`).join("") + `
  :root{--j-cell:#F3F5F7;--j-cell-alt:#FFFFFF;--j-ink:#1F2933;--j-note:#3C4650;--j-border:#FFFFFF}
  :root[data-theme="dark"]{--j-cell:#1E2A44;--j-cell-alt:#172033;--j-ink:#E4E9F2;--j-note:#B7C4DE;--j-border:#0E1524}
  .jadwal-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-bottom:12px}
  .jadwal-bar .field{min-width:150px}
  .jadwal-bar select{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text)}
  .jadwal-mode{margin:0 0 12px;font-size:.9rem;color:var(--muted)}
  .jadwal-status{margin:0 0 12px;font-weight:600;color:var(--muted)}
  .jadwal-status:empty{display:none}
  .jadwal-status.err{color:var(--no)}
  .jadwal-wrap{overflow:auto;max-height:calc(100vh - 250px);min-height:300px;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
  table.jadwal{border-collapse:separate;border-spacing:0;width:100%;min-width:920px}
  .jadwal th{position:sticky;top:0;z-index:2;background:#376A58;color:#fff;font-size:.78rem;letter-spacing:.03em;padding:10px 8px;white-space:nowrap;text-align:center}
  .jadwal th:nth-child(-n+2){z-index:4}
  .jadwal th:nth-child(1),.jadwal td.dt{position:sticky;left:0;min-width:108px;width:108px}
  .jadwal th:nth-child(2),.jadwal td.dy{position:sticky;left:108px;min-width:96px;width:96px}
  .jadwal td{padding:0;height:36px;border-right:1px solid var(--j-border);border-bottom:1px solid var(--j-border);text-align:center;font-weight:700;font-size:.85rem}
  .jadwal td.dt,.jadwal td.dy{z-index:1;padding:0 8px;background:var(--j-cell);color:var(--j-ink);border-bottom:1px solid var(--line)}
  .jadwal tr:nth-child(even) td.dt,.jadwal tr:nth-child(even) td.dy,.jadwal tr:nth-child(even) td.nt{background:var(--j-cell-alt)}
  .jadwal td.dy.sun{color:var(--no)}
  .jadwal tr.today td.dt,.jadwal tr.today td.dy{background:var(--brand-tint);color:var(--brand-dark)}
  .jadwal tr.today td.dt{box-shadow:inset 4px 0 0 var(--brand)}
  .jadwal td.sh{min-width:92px}
  .jadwal td.nt{min-width:200px;padding:0 10px;background:var(--j-cell);color:var(--j-note);font-weight:600;border-bottom:1px solid var(--line)}
  .jadwal td select{width:100%;height:36px;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-align:center;text-align-last:center;cursor:pointer}
  .jadwal td select option{background:#fff;color:#1B2436}
  .jadwal td input{width:100%;height:36px;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:center}
  .jadwal td select:focus-visible,.jadwal td input:focus-visible{outline:3px solid var(--brand);outline-offset:-3px}
  .rekap-wrap{overflow-x:auto}
  table.rekap{border-collapse:collapse;min-width:480px}
  .rekap th,.rekap td{padding:8px 14px;border:1px solid var(--line);text-align:center;font-size:.85rem}
  .rekap th{background:#376A58;color:#fff}
  .rekap td.lab{font-weight:700}
  .j-dialog{border:0;border-radius:var(--radius);padding:22px;width:min(640px,calc(100vw - 24px))}
  .j-dialog::backdrop{background:rgba(10,18,36,.6)}
  .j-dialog form{display:grid;gap:14px}
  .j-dialog h2{margin:0;font-size:1.15rem;color:var(--ink)}
  .j-dialog .note{margin:0;font-size:.85rem;color:var(--muted)}
  .j-dialog input[type=text],.j-dialog input[type=number],.j-dialog select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);min-width:0}
  .j-nrow{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto auto auto;gap:6px;align-items:center;margin-bottom:8px}
  .j-nrow input[type=color]{width:42px;height:36px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer}
  .j-nrow input[type=color].is-default{opacity:.4}
  .j-steps{display:flex;flex-wrap:wrap;gap:8px}
  .j-step{display:grid;gap:2px;font-size:.72rem;font-weight:700;color:var(--muted);text-align:center}
  .j-step select{font-weight:700;text-align:center;padding:6px 4px}
  .j-prow{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;margin-bottom:6px}
  .j-prow label{display:flex;align-items:center;gap:8px;font-weight:700}
  .j-range{display:flex;flex-wrap:wrap;gap:12px}
  .j-range .field{min-width:120px}
  .j-p-sum{margin:0;font-size:.88rem;font-weight:600;color:var(--muted)}
  .j-p-sum.err{color:var(--no)}
  @media (max-width:760px){
    .nav-links{overflow-x:auto;scrollbar-width:none;min-width:0}
    .nav-links::-webkit-scrollbar{display:none}
    .nav-links a{flex:none;white-space:nowrap}
  }
  @media (max-width:560px){.nav-links a{padding:0 10px;font-size:.85rem}}
`;
document.head.appendChild(style);

/* ---------- Koneksi bersama ---------- */
let db = null;
const instances = [];

/* =====================================================================
   Satu jadwal = satu menu + satu halaman + satu state
   ===================================================================== */
function createSchedule(cfg, afterEl) {
  const uid = "j-" + cfg.key;

  /* --- menu navbar --- */
  const link = el("a", null, cfg.label);
  link.href = cfg.hash;
  link.dataset.nav = "jadwal-" + cfg.key;
  if (afterEl) afterEl.after(link); else document.querySelector(".nav-links").appendChild(link);

  /* --- halaman --- */
  const section = el("section", "page");
  section.id = "page-" + uid;
  section.hidden = true;
  section.setAttribute("aria-labelledby", uid + "-h");
  section.innerHTML = `
    <div class="page-head">
      <h1 id="${uid}-h"></h1>
      <p class="j-desc"></p>
    </div>
    <div class="jadwal-bar">
      <div class="field"><label for="${uid}-month">Bulan</label><select id="${uid}-month" class="j-month"></select></div>
      <div class="field"><label for="${uid}-year">Tahun</label><select id="${uid}-year" class="j-year"></select></div>
      <button type="button" class="btn sm j-names" hidden>Atur nama &amp; warna</button>
      <button type="button" class="btn sm j-pattern" hidden>Isi pola otomatis</button>
    </div>
    <p class="jadwal-mode j-mode"></p>
    <p class="jadwal-status j-status" role="status"></p>
    <div class="jadwal-wrap j-wrap" hidden></div>
    <div class="j-rekap-box" hidden>
      <h2 class="section-title">Rekap bulan ini</h2>
      <div class="rekap-wrap j-rekap"></div>
    </div>
    <dialog class="editor j-dialog j-ndialog" aria-labelledby="${uid}-ndlg-title">
      <form class="j-nform" novalidate>
        <h2 id="${uid}-ndlg-title"></h2>
        <p class="note">Urutan baris = urutan kolom. Warna dipakai untuk judul kolom nama, tombol "Bawaan" mengembalikannya ke hijau. Kalau sebuah nama diganti, jadwal yang sudah terisi atas nama lama tidak ikut pindah.</p>
        <div class="j-nlist"></div>
        <div class="actions"><button type="button" class="btn sm j-nadd">+ Tambah nama</button></div>
        <p class="form-error j-n-err" role="alert"></p>
        <div class="actions">
          <button type="submit" class="btn solid j-n-save">Simpan</button>
          <button type="button" class="btn j-n-cancel">Batal</button>
        </div>
      </form>
    </dialog>
    <dialog class="editor j-dialog j-pdialog" aria-labelledby="${uid}-pdlg-title">
      <form class="j-pform" novalidate>
        <h2 id="${uid}-pdlg-title">Isi pola otomatis</h2>
        <p class="note">Pola diulang terus dari tanggal mulai. Tiap orang bisa mulai dari urutan yang berbeda (bawaannya mundur satu urutan per orang, seperti jadwal helpdesk).</p>
        <div class="field">
          <label>Pola (urutan yang berulang)</label>
          <div class="j-steps"></div>
          <div class="actions" style="margin-top:8px">
            <button type="button" class="btn sm j-step-add">+ Tambah urutan</button>
            <button type="button" class="btn sm j-step-del">− Kurangi</button>
            <button type="button" class="btn sm j-step-reset">Pola bawaan</button>
          </div>
        </div>
        <div class="field">
          <label>Siapa yang diisi, dan mulai dari urutan ke berapa</label>
          <div class="j-people"></div>
        </div>
        <div class="j-range">
          <div class="field"><label for="${uid}-from">Dari tanggal</label><input id="${uid}-from" class="j-from" type="number" min="1" step="1"></div>
          <div class="field"><label for="${uid}-to">Sampai tanggal</label><input id="${uid}-to" class="j-to" type="number" min="1" step="1"></div>
        </div>
        <label class="check"><input type="checkbox" class="j-over"> Timpa sel yang sudah terisi</label>
        <p class="j-p-sum" role="status"></p>
        <div class="actions">
          <button type="submit" class="btn solid j-p-save">Isi jadwal</button>
          <button type="button" class="btn j-p-cancel">Batal</button>
        </div>
      </form>
    </dialog>`;
  document.querySelector("main").appendChild(section);
  const q = (s) => section.querySelector(s);

  q("h1").textContent = cfg.label;
  q(".j-desc").textContent = cfg.desc;
  q(".j-ndialog h2").textContent = "Atur nama & warna " + cfg.who;

  /* --- state --- */
  const now = new Date();
  const S = {
    year: now.getFullYear(), month: now.getMonth(),
    names: cfg.names.slice(), colors: {}, cells: {}, notes: {},
    status: "loading",          // loading | ok | denied | error | nofb
    hasDoc: false, edit: false, sig: "", ref: null, unsub: null
  };
  let refs = [];                // referensi elemen tiap baris tanggal

  /* --- dropdown bulan / tahun --- */
  MONTHS.forEach((m, i) => { const o = el("option", null, m); o.value = String(i); q(".j-month").appendChild(o); });
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
    const o = el("option", null, String(y)); o.value = String(y); q(".j-year").appendChild(o);
  }
  q(".j-month").value = String(S.month);
  q(".j-year").value = String(S.year);
  q(".j-month").addEventListener("change", (e) => { S.month = parseInt(e.target.value, 10); subscribe(); });
  q(".j-year").addEventListener("change", (e) => { S.year = parseInt(e.target.value, 10); subscribe(); });

  /* --- render --- */
  const STATUS_TEXT = {
    loading: "Memuat jadwal…",
    denied: "Jadwal belum bisa dimuat karena aturan Firestore belum mengizinkan koleksi \"schedules\". Tambahkan aturan untuk koleksi ini (lihat komentar di bagian atas jadwal.js).",
    error: "Gagal memuat jadwal. Periksa koneksi internet lalu muat ulang halaman.",
    nofb: "Firebase belum aktif di halaman ini, jadwal tidak bisa dimuat."
  };

  function render() {
    const ok = S.status === "ok";
    q(".j-names").hidden = !(S.edit && ok);
    q(".j-pattern").hidden = !(S.edit && ok);
    q(".j-mode").textContent = !ok ? "" : S.edit
      ? "Mode edit: pilih shift langsung di tabel, perubahan tersimpan otomatis."
      : "Hanya lihat. Untuk mengubah jadwal, masuk lewat menu Admin.";

    let msg = STATUS_TEXT[S.status] || "";
    if (ok && !S.hasDoc) msg = S.edit ? "Belum ada jadwal untuk bulan ini. Pilih shift di tabel untuk mulai mengisi." : "Jadwal bulan ini belum diisi.";
    const st = q(".j-status");
    st.textContent = msg;
    st.className = "jadwal-status j-status" + (S.status === "denied" || S.status === "error" ? " err" : "");

    q(".j-wrap").hidden = !ok;
    q(".j-rekap-box").hidden = !ok;
    if (!ok) return;

    const sig = [S.year, S.month, S.names.join("|"), S.edit, JSON.stringify(S.colors)].join("#");
    if (sig !== S.sig) { S.sig = sig; buildTable(); }
    sync();
  }

  function buildTable() {
    const wrap = q(".j-wrap");
    wrap.innerHTML = "";
    refs = [];

    const table = el("table", "jadwal");
    table.setAttribute("aria-label", cfg.label + " " + MONTHS[S.month] + " " + S.year);
    const head = el("tr");
    ["TANGGAL", "HARI"].forEach((h) => head.appendChild(el("th", null, h)));
    S.names.forEach((n) => { const th = el("th", null, n); paintHead(th, S.colors[n]); head.appendChild(th); });
    head.appendChild(el("th", null, "KETERANGAN"));
    table.appendChild(el("thead")).appendChild(head);

    const body = el("tbody");
    const days = new Date(S.year, S.month + 1, 0).getDate();
    const today = new Date();
    const isThisMonth = today.getFullYear() === S.year && today.getMonth() === S.month;

    for (let d = 1; d <= days; d++) {
      const date = new Date(S.year, S.month, d);
      const tr = el("tr");
      if (isThisMonth && d === today.getDate()) tr.className = "today";
      tr.appendChild(el("td", "dt", pad(d) + "/" + pad(S.month + 1) + "/" + S.year));
      tr.appendChild(el("td", "dy" + (date.getDay() === 0 ? " sun" : ""), DAYS[date.getDay()]));

      const row = { day: d, tr, cells: [], noteTd: null, noteInput: null };
      S.names.forEach((name) => {
        const td = el("td", "sh");
        let sel = null;
        if (S.edit) {
          sel = el("select");
          sel.setAttribute("aria-label", name + ", tanggal " + d);
          const blank = el("option", null, "—"); blank.value = ""; sel.appendChild(blank);
          SHIFTS.forEach((s) => { const o = el("option", null, s); o.value = s; sel.appendChild(o); });
          sel.addEventListener("change", () => saveCell(d, name, sel.value));
          td.appendChild(sel);
        }
        tr.appendChild(td);
        row.cells.push({ name, td, sel });
      });

      const nt = el("td", "nt");
      if (S.edit) {
        const inp = el("input");
        inp.type = "text"; inp.maxLength = 120;
        inp.setAttribute("aria-label", "Keterangan tanggal " + d);
        inp.addEventListener("change", () => saveNote(d, inp.value.trim()));
        nt.appendChild(inp);
        row.noteInput = inp;
      }
      row.noteTd = nt;
      tr.appendChild(nt);
      body.appendChild(tr);
      refs.push(row);
    }
    table.appendChild(body);
    wrap.appendChild(table);

    // buka langsung di baris hari ini kalau yang ditampilkan bulan berjalan
    if (isThisMonth && !section.hidden) {
      const t = refs[today.getDate() - 1].tr;
      wrap.scrollTop = Math.max(0, t.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop - 90);
    }
  }

  // isi nilai ke tabel tanpa membangun ulang (supaya ketikan keterangan tidak hilang)
  function sync() {
    refs.forEach((r) => {
      const rowData = S.cells[r.day] || {};
      r.cells.forEach((c) => {
        const v = typeof rowData[c.name] === "string" ? rowData[c.name] : "";
        c.td.className = "sh" + (v ? " sh-" + cssSafe(v) : "");
        if (c.sel) {
          if (v && !SHIFTS.includes(v) && ![...c.sel.options].some((o) => o.value === v)) {
            const o = el("option", null, v); o.value = v; c.sel.appendChild(o);   // nilai lama di luar daftar tetap terlihat
          }
          c.sel.value = v;
        } else {
          c.td.textContent = v;
        }
      });
      const note = typeof S.notes[r.day] === "string" ? S.notes[r.day] : "";
      if (r.noteInput) { if (document.activeElement !== r.noteInput) r.noteInput.value = note; }
      else r.noteTd.textContent = note;
    });
    renderRekap();
  }

  function renderRekap() {
    const box = q(".j-rekap");
    box.innerHTML = "";
    const table = el("table", "rekap");
    table.setAttribute("aria-label", "Rekap jumlah shift per orang");
    const head = el("tr");
    head.appendChild(el("th", null, "SHIFT"));
    S.names.forEach((n) => { const th = el("th", null, n); paintHead(th, S.colors[n]); head.appendChild(th); });
    table.appendChild(el("thead")).appendChild(head);
    const body = el("tbody");
    const days = new Date(S.year, S.month + 1, 0).getDate();
    SHIFTS.forEach((s) => {
      const tr = el("tr");
      tr.appendChild(el("td", "lab sh-" + cssSafe(s), s));
      S.names.forEach((name) => {
        let n = 0;
        for (let d = 1; d <= days; d++) if (S.cells[d] && S.cells[d][name] === s) n++;
        tr.appendChild(el("td", null, String(n)));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    box.appendChild(table);
  }

  /* --- simpan ke Firestore --- */
  async function saveCell(day, name, value) {
    const ref = S.ref;
    (S.cells[day] = S.cells[day] || {})[name] = value;      // tampilkan dulu, simpan menyusul
    sync();
    try {
      await setDoc(ref, { cells: { [day]: { [name]: value } } }, { merge: true });
    } catch (e) {
      alert(writeMsg(e));
      subscribe();                                           // kembalikan ke data di server
    }
  }
  async function saveNote(day, text) {
    const ref = S.ref;
    S.notes[day] = text;
    try {
      await setDoc(ref, { notes: { [day]: text } }, { merge: true });
    } catch (e) {
      alert(writeMsg(e));
      subscribe();
    }
  }

  /* --- atur nama & warna --- */
  const ndlg = q(".j-ndialog");
  let nrows = [];
  function collectRows() {
    nrows = [...q(".j-nlist").children].map((r) => {
      const c = r.querySelector(".j-ncolor");
      return { name: r.querySelector(".j-nname").value, color: c.dataset.set === "1" ? c.value : null };
    });
  }
  function renderRows() {
    const list = q(".j-nlist");
    list.innerHTML = "";
    nrows.forEach((r, i) => {
      const row = el("div", "j-nrow");
      const up = el("button", "btn sm", "▲"); up.type = "button"; up.disabled = i === 0;
      up.setAttribute("aria-label", "Naikkan nama " + (i + 1));
      up.addEventListener("click", () => { collectRows(); [nrows[i - 1], nrows[i]] = [nrows[i], nrows[i - 1]]; renderRows(); });
      const down = el("button", "btn sm", "▼"); down.type = "button"; down.disabled = i === nrows.length - 1;
      down.setAttribute("aria-label", "Turunkan nama " + (i + 1));
      down.addEventListener("click", () => { collectRows(); [nrows[i + 1], nrows[i]] = [nrows[i], nrows[i + 1]]; renderRows(); });
      const name = el("input", "j-nname");
      name.type = "text"; name.maxLength = 30; name.value = r.name; name.placeholder = "Nama";
      name.setAttribute("aria-label", "Nama " + (i + 1));
      const color = el("input", "j-ncolor");
      color.type = "color"; color.value = r.color || DEFAULT_HEAD;
      color.dataset.set = r.color ? "1" : "0";
      color.classList.toggle("is-default", !r.color);
      color.setAttribute("aria-label", "Warna nama " + (i + 1));
      color.addEventListener("input", () => { color.dataset.set = "1"; color.classList.remove("is-default"); });
      const reset = el("button", "btn sm", "Bawaan"); reset.type = "button";
      reset.addEventListener("click", () => { collectRows(); nrows[i].color = null; renderRows(); });
      const del = el("button", "btn sm danger", "Hapus"); del.type = "button";
      del.setAttribute("aria-label", "Hapus nama " + (i + 1));
      del.addEventListener("click", () => { collectRows(); nrows.splice(i, 1); renderRows(); });
      row.append(up, down, name, color, reset, del);
      list.appendChild(row);
    });
  }
  q(".j-names").addEventListener("click", () => {
    nrows = S.names.map((n) => ({ name: n, color: S.colors[n] || null }));
    renderRows();
    q(".j-n-err").textContent = "";
    if (typeof ndlg.showModal === "function") ndlg.showModal();
  });
  q(".j-nadd").addEventListener("click", () => {
    collectRows();
    if (nrows.length >= MAX_NAMES) { q(".j-n-err").textContent = "Maksimal " + MAX_NAMES + " nama."; return; }
    q(".j-n-err").textContent = "";
    nrows.push({ name: "", color: null });
    renderRows();
    const ins = q(".j-nlist").querySelectorAll(".j-nname");
    ins[ins.length - 1].focus();
  });
  q(".j-n-cancel").addEventListener("click", () => ndlg.close());
  q(".j-nform").addEventListener("submit", async (e) => {
    e.preventDefault();
    collectRows();
    const err = q(".j-n-err");
    const names = [], colors = {};
    nrows.forEach((r) => {
      const name = r.name.trim().toUpperCase().replace(/[.\/\[\]*~`]/g, "").trim();
      if (!name || names.includes(name)) return;
      names.push(name);
      if (r.color && HEX.test(r.color)) colors[name] = r.color.toUpperCase();
    });
    if (!names.length) { err.textContent = "Isi minimal satu nama."; return; }
    if (names.length > MAX_NAMES) { err.textContent = "Maksimal " + MAX_NAMES + " nama."; return; }
    const btn = q(".j-n-save");
    btn.disabled = true; btn.textContent = "Menyimpan...";
    try {
      await setDoc(S.ref, { names, colors }, { merge: true, mergeFields: ["names", "colors"] });
      ndlg.close();
    } catch (x) {
      err.textContent = writeMsg(x);
    } finally {
      btn.disabled = false; btn.textContent = "Simpan";
    }
  });

  /* --- isi pola otomatis --- */
  const pdlg = q(".j-pdialog");
  const PKEY = "upaznet-pola-" + cfg.key;           // pola terakhir diingat di browser admin
  const pat = { pattern: DEFAULT_PATTERN.slice(), offsets: {} };
  try {
    const sv = JSON.parse(localStorage.getItem(PKEY));
    if (sv && Array.isArray(sv.pattern) && sv.pattern.length >= 2 && sv.pattern.length <= 14 && sv.pattern.every((v) => typeof v === "string")) {
      pat.pattern = sv.pattern;
      if (sv.offsets && typeof sv.offsets === "object") pat.offsets = sv.offsets;
    }
  } catch (_) {}
  const savePat = () => { try { localStorage.setItem(PKEY, JSON.stringify(pat)); } catch (_) {} };
  // bawaan: tiap orang mundur satu urutan dari orang sebelumnya
  const defOffset = (i, n) => ((((0 - i) % n) + n) % n) + 1;
  function effOffset(name, i) {
    const n = pat.pattern.length, v = pat.offsets[name];
    if (v === undefined) return defOffset(i, n);
    return v === 0 ? 0 : ((v - 1) % n) + 1;           // 0 = tidak diisi
  }
  const shiftOptions = (sel, withBlank) => {
    if (withBlank) { const b = el("option", null, "—"); b.value = ""; sel.appendChild(b); }
    SHIFTS.forEach((x) => { const o = el("option", null, x); o.value = x; sel.appendChild(o); });
  };

  function renderPattern() {
    const n = pat.pattern.length;
    const steps = q(".j-steps");
    steps.innerHTML = "";
    pat.pattern.forEach((v, i) => {
      const box = el("label", "j-step");
      box.appendChild(el("span", null, String(i + 1)));
      const sel = el("select");
      sel.setAttribute("aria-label", "Urutan ke-" + (i + 1));
      shiftOptions(sel, true);
      if (v && !SHIFTS.includes(v)) { const o = el("option", null, v); o.value = v; sel.appendChild(o); }
      sel.value = v;
      sel.className = v ? "sh-" + cssSafe(v) : "";
      sel.addEventListener("change", () => { pat.pattern[i] = sel.value; sel.className = sel.value ? "sh-" + cssSafe(sel.value) : ""; summary(); });
      box.appendChild(sel);
      steps.appendChild(box);
    });
    const people = q(".j-people");
    people.innerHTML = "";
    S.names.forEach((name, i) => {
      const off = effOffset(name, i);
      const row = el("div", "j-prow");
      const lab = el("label");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = off !== 0;
      lab.append(cb, document.createTextNode(name));
      const note = el("span", "note", "mulai dari urutan ke-");
      const sel = el("select");
      sel.setAttribute("aria-label", "Mulai dari urutan untuk " + name);
      for (let k = 1; k <= n; k++) { const o = el("option", null, String(k)); o.value = String(k); sel.appendChild(o); }
      sel.value = String(off || defOffset(i, n));
      sel.disabled = off === 0;
      cb.addEventListener("change", () => { pat.offsets[name] = cb.checked ? Number(sel.value) : 0; sel.disabled = !cb.checked; summary(); });
      sel.addEventListener("change", () => { pat.offsets[name] = Number(sel.value); summary(); });
      row.append(lab, note, sel);
      people.appendChild(row);
    });
    summary();
  }

  // hitung sel yang akan diisi (tanpa menulis apa pun)
  function planPattern() {
    const n = pat.pattern.length;
    const days = new Date(S.year, S.month + 1, 0).getDate();
    const from = parseInt(q(".j-from").value, 10), to = parseInt(q(".j-to").value, 10);
    if (!(from >= 1 && to <= days && from <= to)) return { error: "Rentang tanggal tidak valid. Isi antara 1 dan " + days + ", dan \"dari\" tidak boleh lebih besar dari \"sampai\"." };
    const overwrite = q(".j-over").checked;
    const updates = {}; let count = 0; const who = new Set();
    S.names.forEach((name, i) => {
      const off = effOffset(name, i);
      if (!off) return;
      for (let d = from; d <= to; d++) {
        const v = pat.pattern[(off - 1 + (d - from)) % n];
        const cur = (S.cells[d] && S.cells[d][name]) || "";
        if (cur === v) continue;
        if (!overwrite && (cur || !v)) continue;    // tanpa timpa: hanya isi sel kosong dengan shift
        (updates[d] = updates[d] || {})[name] = v;
        count++; who.add(name);
      }
    });
    return { updates, count, people: who.size };
  }
  function summary() {
    const box = q(".j-p-sum");
    const pl = planPattern();
    box.className = "j-p-sum" + (pl.error ? " err" : "");
    box.textContent = pl.error ? pl.error
      : pl.count ? "Akan mengisi " + pl.count + " sel untuk " + pl.people + " orang."
      : "Tidak ada sel yang perlu diisi. Centang \"Timpa sel yang sudah terisi\" kalau ingin mengganti isi yang ada.";
  }

  q(".j-pattern").addEventListener("click", () => {
    const days = new Date(S.year, S.month + 1, 0).getDate();
    q(".j-from").max = q(".j-to").max = String(days);
    q(".j-from").value = "1"; q(".j-to").value = String(days);
    q(".j-over").checked = false;
    renderPattern();
    if (typeof pdlg.showModal === "function") pdlg.showModal();
  });
  q(".j-step-add").addEventListener("click", () => { if (pat.pattern.length < 14) { pat.pattern.push(""); renderPattern(); } });
  q(".j-step-del").addEventListener("click", () => { if (pat.pattern.length > 2) { pat.pattern.pop(); renderPattern(); } });
  q(".j-step-reset").addEventListener("click", () => { pat.pattern = DEFAULT_PATTERN.slice(); pat.offsets = {}; renderPattern(); });
  q(".j-from").addEventListener("input", summary);
  q(".j-to").addEventListener("input", summary);
  q(".j-over").addEventListener("change", summary);
  q(".j-p-cancel").addEventListener("click", () => pdlg.close());
  q(".j-pform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pl = planPattern();
    if (pl.error || !pl.count) { summary(); return; }
    const btn = q(".j-p-save");
    btn.disabled = true; btn.textContent = "Mengisi...";
    const ref = S.ref;
    Object.entries(pl.updates).forEach(([d, row]) => { S.cells[d] = Object.assign(S.cells[d] || {}, row); });
    sync();                                                   // tampilkan dulu, simpan menyusul (satu kali tulis)
    try {
      await setDoc(ref, { cells: pl.updates }, { merge: true });
      savePat();
      pdlg.close();
    } catch (x) {
      q(".j-p-sum").className = "j-p-sum err";
      q(".j-p-sum").textContent = writeMsg(x);
      subscribe();
    } finally {
      btn.disabled = false; btn.textContent = "Isi jadwal";
    }
  });

  /* --- langganan data bulan yang dipilih --- */
  function subscribe() {
    if (S.unsub) { S.unsub(); S.unsub = null; }
    if (!db) return;
    S.status = "loading";
    render();
    S.ref = doc(db, COLLECTION, cfg.docPrefix + S.year + "-" + pad(S.month + 1));
    S.unsub = onSnapshot(S.ref, (snap) => {
      const d = snap.exists() ? snap.data() : {};
      S.hasDoc = snap.exists();
      const names = Array.isArray(d.names)
        ? [...new Set(d.names.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, MAX_NAMES)
        : [];
      S.names = names.length ? names : cfg.names.slice();
      S.colors = {};
      if (d.colors && typeof d.colors === "object") Object.entries(d.colors).forEach(([k, v]) => { if (typeof v === "string" && HEX.test(v)) S.colors[k] = v; });
      S.cells = d.cells && typeof d.cells === "object" ? d.cells : {};
      S.notes = d.notes && typeof d.notes === "object" ? d.notes : {};
      S.status = "ok";
      render();
    }, (err) => {
      console.warn("[" + cfg.label + "] Gagal memuat:", err);
      S.status = err && err.code === "permission-denied" ? "denied" : "error";
      render();
    });
  }

  render();
  return {
    cfg, link, section,
    subscribe,
    setEdit(v) { S.edit = !!v; render(); },
    setNoFirebase() { S.status = "nofb"; render(); }
  };
}

/* ---------- Pasang semua jadwal ke navbar & halaman ---------- */
let anchor = document.querySelector('.nav-links [data-nav="template"]');
SCHEDULES.forEach((cfg) => {
  const inst = createSchedule(cfg, anchor);
  anchor = inst.link;                       // jadwal berikutnya dipasang di kanan jadwal sebelumnya
  instances.push(inst);
});

/* ---------- Routing ----------
   route() bawaan index.html tidak mengenal #jadwal (dianggap SOP), jadi di sini
   halaman lain disembunyikan lagi setelah route() bawaan selesai. */
function applyRoute() {
  const key = location.hash.split("/")[0];
  const active = instances.find((i) => i.cfg.hash === key);
  if (active) ["sop", "template", "admin"].forEach((n) => { const p = document.getElementById("page-" + n); if (p) p.hidden = true; });

  let changed = false;
  instances.forEach((i) => {
    const show = i === active;
    if (i.section.hidden === show) { i.section.hidden = !show; changed = true; }
  });
  if (active) {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a === active.link) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = active.cfg.label + " – Upaznet Helpdesk";
  }
  if (changed) window.scrollTo(0, 0);
}
window.addEventListener("hashchange", applyRoute);
applyRoute();

/* ---------- Mulai: tunggu Firebase dari index.html ---------- */
(async function start() {
  let app = null;
  for (let t = 0; t < 80 && !app; t++) {                  // maksimal ±8 detik
    if (getApps().length) app = getApp();
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!app) { instances.forEach((i) => i.setNoFirebase()); return; }
  db = getFirestore(app);
  onAuthStateChanged(getAuth(app), (u) => instances.forEach((i) => i.setEdit(!!u)));
  instances.forEach((i) => i.subscribe());
})();
