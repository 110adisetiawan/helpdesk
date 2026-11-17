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
const SHIFTS = ["PAGI", "MIDDLE", "SORE", "MALAM", "IJIN", "CUTI"];   // isi dropdown (sama untuk semua jadwal)
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

// warna tiap shift: [warna isi, warna huruf]. LIBUR disiapkan kalau nanti ditambahkan ke SHIFTS.
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
const writeMsg = (e) => (e && e.code === "permission-denied")
  ? "Tidak punya izin mengubah jadwal. Pastikan email kamu terdaftar di Rules Firestore untuk koleksi \"schedules\"."
  : "Gagal menyimpan: " + ((e && e.message) || e);

/* ---------- Gaya (dipakai bersama oleh semua jadwal) ---------- */
const style = el("style");
style.id = "jadwal-style";
style.textContent = Object.entries(SHIFT_STYLE).map(([k, [bg, fg]]) => `.sh-${k}{background:${bg};color:${fg}}`).join("") + `
  .jadwal-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-bottom:12px}
  .jadwal-bar .field{min-width:150px}
  .jadwal-bar select{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text)}
  .jadwal-legend{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto;align-self:center}
  .jadwal-legend span{padding:3px 10px;border-radius:6px;font-size:.78rem;font-weight:700}
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
  .jadwal td{padding:0;height:36px;border-right:1px solid #fff;border-bottom:1px solid #fff;text-align:center;font-weight:700;font-size:.85rem}
  .jadwal td.dt,.jadwal td.dy{z-index:1;padding:0 8px;background:#F3F5F7;color:#1F2933;border-bottom:1px solid var(--line)}
  .jadwal tr:nth-child(even) td.dt,.jadwal tr:nth-child(even) td.dy,.jadwal tr:nth-child(even) td.nt{background:#fff}
  .jadwal td.dy.sun{color:var(--no)}
  .jadwal tr.today td.dt,.jadwal tr.today td.dy{background:var(--brand-tint);color:var(--brand-dark)}
  .jadwal tr.today td.dt{box-shadow:inset 4px 0 0 var(--brand)}
  .jadwal td.sh{min-width:92px}
  .jadwal td.nt{min-width:200px;padding:0 10px;background:#F3F5F7;color:#3C4650;font-weight:600;border-bottom:1px solid var(--line)}
  .jadwal td select{width:100%;height:36px;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-align:center;text-align-last:center;cursor:pointer}
  .jadwal td select option{background:#fff;color:#1B2436}
  .jadwal td input{width:100%;height:36px;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:center}
  .jadwal td select:focus-visible,.jadwal td input:focus-visible{outline:3px solid var(--brand);outline-offset:-3px}
  .rekap-wrap{overflow-x:auto}
  table.rekap{border-collapse:collapse;min-width:480px}
  .rekap th,.rekap td{padding:8px 14px;border:1px solid var(--line);text-align:center;font-size:.85rem}
  .rekap th{background:#376A58;color:#fff}
  .rekap td.lab{font-weight:700}
  .j-dialog{border:0;border-radius:var(--radius);padding:22px;width:min(480px,calc(100vw - 24px))}
  .j-dialog::backdrop{background:rgba(10,18,36,.6)}
  .j-dialog form{display:grid;gap:14px}
  .j-dialog h2{margin:0;font-size:1.15rem;color:var(--ink)}
  @media (max-width:760px){
    .jadwal-legend{margin-left:0;width:100%}
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
      <button type="button" class="btn sm j-names" hidden></button>
      <div class="jadwal-legend j-legend" aria-label="Keterangan warna shift"></div>
    </div>
    <p class="jadwal-mode j-mode"></p>
    <p class="jadwal-status j-status" role="status"></p>
    <div class="jadwal-wrap j-wrap" hidden></div>
    <div class="j-rekap-box" hidden>
      <h2 class="section-title">Rekap bulan ini</h2>
      <div class="rekap-wrap j-rekap"></div>
    </div>
    <dialog class="editor j-dialog" aria-labelledby="${uid}-dlg-title">
      <form class="j-form" novalidate>
        <h2 id="${uid}-dlg-title"></h2>
        <div class="field">
          <label for="${uid}-names-text">Satu nama per baris (urutan baris = urutan kolom)</label>
          <textarea id="${uid}-names-text" class="j-names-text" rows="9"></textarea>
          <p class="note">Berlaku untuk bulan yang sedang ditampilkan. Maksimal ${MAX_NAMES} nama.</p>
        </div>
        <p class="form-error j-dlg-err" role="alert"></p>
        <div class="actions">
          <button type="submit" class="btn solid j-dlg-save">Simpan</button>
          <button type="button" class="btn j-dlg-cancel">Batal</button>
        </div>
      </form>
    </dialog>`;
  document.querySelector("main").appendChild(section);
  const q = (s) => section.querySelector(s);

  q("h1").textContent = cfg.label;
  q(".j-desc").textContent = cfg.desc;
  q(".j-names").textContent = "Atur nama " + cfg.who;
  q(".j-dialog h2").textContent = "Atur nama " + cfg.who;

  /* --- state --- */
  const now = new Date();
  const S = {
    year: now.getFullYear(), month: now.getMonth(),
    names: cfg.names.slice(), cells: {}, notes: {},
    status: "loading",          // loading | ok | denied | error | nofb
    hasDoc: false, edit: false, sig: "", ref: null, unsub: null
  };
  let refs = [];                // referensi elemen tiap baris tanggal

  /* --- dropdown bulan / tahun / legenda --- */
  MONTHS.forEach((m, i) => { const o = el("option", null, m); o.value = String(i); q(".j-month").appendChild(o); });
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
    const o = el("option", null, String(y)); o.value = String(y); q(".j-year").appendChild(o);
  }
  q(".j-month").value = String(S.month);
  q(".j-year").value = String(S.year);
  SHIFTS.forEach((s) => q(".j-legend").appendChild(el("span", "sh-" + cssSafe(s), s)));
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

    const sig = [S.year, S.month, S.names.join("|"), S.edit].join("#");
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
    ["TANGGAL", "HARI", ...S.names, "KETERANGAN"].forEach((h) => head.appendChild(el("th", null, h)));
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
    S.names.forEach((n) => head.appendChild(el("th", null, n)));
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

  /* --- atur nama --- */
  const dlg = q(".j-dialog");
  q(".j-names").addEventListener("click", () => {
    q(".j-names-text").value = S.names.join("\n");
    q(".j-dlg-err").textContent = "";
    if (typeof dlg.showModal === "function") dlg.showModal();
    q(".j-names-text").focus();
  });
  q(".j-dlg-cancel").addEventListener("click", () => dlg.close());
  q(".j-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = q(".j-dlg-err");
    const names = [...new Set(q(".j-names-text").value.split("\n")
      .map((x) => x.trim().toUpperCase().replace(/[.\/\[\]*~`]/g, "").trim())
      .filter(Boolean))];
    if (!names.length) { err.textContent = "Isi minimal satu nama."; return; }
    if (names.length > MAX_NAMES) { err.textContent = "Maksimal " + MAX_NAMES + " nama."; return; }
    const btn = q(".j-dlg-save");
    btn.disabled = true; btn.textContent = "Menyimpan...";
    try {
      await setDoc(S.ref, { names }, { merge: true });
      dlg.close();
    } catch (x) {
      err.textContent = writeMsg(x);
    } finally {
      btn.disabled = false; btn.textContent = "Simpan";
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
