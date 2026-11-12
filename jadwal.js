/* =====================================================================
   jadwal.js – menu "Jadwal Helpdesk" (di sebelah kanan Template Chat)

   Cara pasang: di index.html, TEPAT SETELAH <script type="module"> Firebase
   yang sudah ada, tambahkan satu baris:
       <script type="module" src="jadwal.js"></script>
   File ini memakai ulang koneksi Firebase dari index.html (tidak perlu isi
   config lagi), lalu menambahkan sendiri menu navbar, halaman, dan gayanya.

   Data (Firestore): koleksi "schedules", satu dokumen per bulan, id "YYYY-MM"
     names : ["SATRIA", "MAISTRO", ...]        (urutan kolom)
     cells : { "1": { "SATRIA": "PAGI", ... }, "2": {...} }   (kunci = tanggal)
     notes : { "3": "haris jam 1 siang", ... }

   Aturan Firestore yang perlu ditambahkan (di dalam match /documents):
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
const SHIFTS = ["PAGI", "MIDDLE", "SORE", "MALAM", "IJIN", "CUTI", "LIBUR"];   // isi dropdown
const DEFAULT_NAMES = ["SATRIA", "MAISTRO", "ZHIFRON", "AWAN", "AHSIN", "AKBAR", "HARIS"];
const MAX_NAMES = 12;
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
const $ = (s) => document.querySelector(s);
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

/* ---------- Gaya ---------- */
const style = el("style");
style.id = "jadwal-style";
style.textContent = Object.entries(SHIFT_STYLE).map(([k, [bg, fg]]) => `.sh-${k}{background:${bg};color:${fg}}`).join("") + `
  .jadwal-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-bottom:12px}
  .jadwal-bar .field{min-width:150px}
  .jadwal-bar select{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text)}
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
  .jadwal td{padding:0;height:36px;border-right:1px solid var(--surface);border-bottom:1px solid var(--surface);text-align:center;font-weight:700;font-size:.85rem}
  .jadwal td.dt,.jadwal td.dy{z-index:1;padding:0 8px;background:var(--paper);color:var(--text);border-bottom:1px solid var(--line)}
  .jadwal tr:nth-child(even) td.dt,.jadwal tr:nth-child(even) td.dy,.jadwal tr:nth-child(even) td.nt{background:var(--surface)}
  .jadwal td.dy.sun{color:var(--no)}
  .jadwal tr.today td.dt,.jadwal tr.today td.dy{background:var(--brand-tint);color:var(--brand-dark)}
  .jadwal tr.today td.dt{box-shadow:inset 4px 0 0 var(--brand)}
  .jadwal td.sh{min-width:92px}
  .jadwal td.nt{min-width:200px;padding:0 10px;background:var(--paper);color:var(--muted);font-weight:600;border-bottom:1px solid var(--line)}
  .jadwal td select{width:100%;height:36px;border:0;background:transparent;color:inherit;font:inherit;font-weight:700;text-align:center;text-align-last:center;cursor:pointer}
  .jadwal td select option{background:var(--surface);color:var(--text)}
  .jadwal td input{width:100%;height:36px;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;text-align:center}
  .jadwal td select:focus-visible,.jadwal td input:focus-visible{outline:3px solid var(--brand);outline-offset:-3px}
  .rekap-wrap{overflow-x:auto}
  table.rekap{border-collapse:collapse;min-width:480px}
  .rekap th,.rekap td{padding:8px 14px;border:1px solid var(--line);text-align:center;font-size:.85rem}
  .rekap th{background:#376A58;color:#fff}
  .rekap td.lab{font-weight:700}
  #j-dialog,#j-pola-dlg{border:0;border-radius:var(--radius);padding:22px;width:min(480px,calc(100vw - 24px))}
  #j-dialog::backdrop,#j-pola-dlg::backdrop{background:rgba(10,18,36,.6)}
  #j-dialog form,#j-pola-dlg form{display:grid;gap:14px}
  #j-dialog h2,#j-pola-dlg h2{margin:0;font-size:1.15rem;color:var(--ink)}
  #j-pola-dlg select{width:100%;font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text)}
  .pola-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
  .pola-grid .field{min-width:0}
  .pola-grid input{width:100%}
  @media (max-width:760px){.jadwal-legend{margin-left:0;width:100%}}
  @media (max-width:560px){.nav-links a{padding:0 9px;font-size:.85rem}}
`;
document.head.appendChild(style);

/* ---------- Menu navbar + halaman ---------- */
const navLinks = $(".nav-links");
const link = el("a", null, "Jadwal Helpdesk");
link.href = "#jadwal";
link.dataset.nav = "jadwal";
const tplLink = navLinks.querySelector('[data-nav="template"]');
if (tplLink) tplLink.after(link); else navLinks.appendChild(link);

const section = el("section", "page");
section.id = "page-jadwal";
section.hidden = true;
section.setAttribute("aria-labelledby", "h-jadwal");
section.innerHTML = `
  <div class="page-head">
    <h1 id="h-jadwal">Jadwal Helpdesk</h1>
    <p>Jadwal shift tim helpdesk per bulan.</p>
  </div>
  <div class="jadwal-bar">
    <div class="field"><label for="j-month">Bulan</label><select id="j-month"></select></div>
    <div class="field"><label for="j-year">Tahun</label><select id="j-year"></select></div>
    <button type="button" class="btn sm" id="j-names" hidden>Atur nama helpdesk</button>
    <button type="button" class="btn sm solid" id="j-pola" hidden>Isi pola</button>
    <div class="jadwal-legend" id="j-legend" aria-label="Keterangan warna shift"></div>
  </div>
  <p class="jadwal-mode" id="j-mode"></p>
  <p class="jadwal-status" id="j-status" role="status"></p>
  <div class="jadwal-wrap" id="j-wrap" hidden></div>
  <div id="j-rekap-box" hidden>
    <h2 class="section-title">Rekap bulan ini</h2>
    <div class="rekap-wrap" id="j-rekap"></div>
  </div>
  <dialog class="editor" id="j-dialog" aria-labelledby="j-dlg-title">
    <form id="j-form" novalidate>
      <h2 id="j-dlg-title">Atur nama helpdesk</h2>
      <div class="field">
        <label for="j-names-text">Satu nama per baris (urutan baris = urutan kolom)</label>
        <textarea id="j-names-text" rows="9"></textarea>
        <p class="note">Berlaku untuk bulan yang sedang ditampilkan. Maksimal ${MAX_NAMES} nama.</p>
      </div>
      <p class="form-error" id="j-dlg-err" role="alert"></p>
      <div class="actions">
        <button type="submit" class="btn solid" id="j-dlg-save">Simpan</button>
        <button type="button" class="btn" id="j-dlg-cancel">Batal</button>
      </div>
    </form>
  </dialog>
  <dialog class="editor" id="j-pola-dlg" aria-labelledby="j-pola-title">
    <form id="j-pola-form" novalidate>
      <h2 id="j-pola-title">Isi jadwal dengan pola</h2>
      <div class="field"><label for="p-staff">Nama</label><select id="p-staff"></select></div>
      <div class="field">
        <label for="p-pattern">Pola (pisahkan dengan spasi)</label>
        <input id="p-pattern" type="text" value="PAGI PAGI MIDDLE MIDDLE MALAM LIBUR LIBUR" autocomplete="off">
        <p class="note">Pilihan: PAGI, MIDDLE (atau SIANG), SORE, MALAM, IJIN, CUTI, LIBUR. Tulis - untuk mengosongkan sel.</p>
      </div>
      <div class="pola-grid">
        <div class="field"><label for="p-from">Dari tanggal</label><input id="p-from" type="number" min="1" value="1"></div>
        <div class="field"><label for="p-to">Sampai tanggal</label><input id="p-to" type="number" min="1"></div>
        <div class="field"><label for="p-offset">Mulai urutan ke-</label><input id="p-offset" type="number" min="1" value="1"></div>
      </div>
      <p class="note">"Mulai urutan ke-" dipakai kalau pola harus lanjut dari bulan lalu atau staf lain mulai di titik berbeda. Contoh: isi 4 berarti tanggal pertama dimulai dari shift ke-4 di pola.</p>
      <p class="form-error" id="p-err" role="alert"></p>
      <div class="actions">
        <button type="submit" class="btn solid" id="p-save">Terapkan</button>
        <button type="button" class="btn" id="p-cancel">Batal</button>
      </div>
    </form>
  </dialog>`;
$("main").appendChild(section);

/* ---------- Routing (#jadwal) ----------
   route() bawaan index.html tidak mengenal #jadwal (dianggap SOP), jadi di sini
   halaman lain disembunyikan lagi setelah route() bawaan selesai. */
function applyRoute() {
  const on = location.hash.startsWith("#jadwal");
  if (on) {
    const wasHidden = section.hidden;
    ["sop", "template", "admin"].forEach((n) => { const p = document.getElementById("page-" + n); if (p) p.hidden = true; });
    section.hidden = false;
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a === link) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = "Jadwal Helpdesk – Upaznet Helpdesk";
    if (wasHidden) window.scrollTo(0, 0);
  } else if (!section.hidden) {
    section.hidden = true;
    window.scrollTo(0, 0);
  }
}
window.addEventListener("hashchange", applyRoute);
applyRoute();

/* ---------- State ---------- */
const now = new Date();
const S = {
  year: now.getFullYear(), month: now.getMonth(),
  names: DEFAULT_NAMES.slice(), cells: {}, notes: {},
  status: "loading",          // loading | ok | denied | error | nofb
  hasDoc: false, edit: false, sig: "", ref: null, unsub: null
};
let db = null;
let refs = [];                // referensi elemen tiap baris tanggal

/* ---------- Dropdown bulan / tahun / legenda ---------- */
MONTHS.forEach((m, i) => { const o = el("option", null, m); o.value = String(i); $("#j-month").appendChild(o); });
for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 2; y++) {
  const o = el("option", null, String(y)); o.value = String(y); $("#j-year").appendChild(o);
}
$("#j-month").value = String(S.month);
$("#j-year").value = String(S.year);
// SHIFTS.forEach((s) => {
//   const chip = el("span", "sh-" + cssSafe(s), s);
//   $("#j-legend").appendChild(chip);
// });
$("#j-month").addEventListener("change", (e) => { S.month = parseInt(e.target.value, 10); subscribe(); });
$("#j-year").addEventListener("change", (e) => { S.year = parseInt(e.target.value, 10); subscribe(); });

/* ---------- Render ---------- */
const STATUS_TEXT = {
  loading: "Memuat jadwal…",
  denied: "Jadwal belum bisa dimuat karena aturan Firestore belum mengizinkan koleksi \"schedules\". Tambahkan aturan untuk koleksi ini (lihat komentar di bagian atas jadwal.js).",
  error: "Gagal memuat jadwal. Periksa koneksi internet lalu muat ulang halaman.",
  nofb: "Firebase belum aktif di halaman ini, jadwal tidak bisa dimuat."
};

function render() {
  const ok = S.status === "ok";
  $("#j-names").hidden = !(S.edit && ok);
  $("#j-pola").hidden = !(S.edit && ok);
  $("#j-mode").textContent = !ok ? "" : S.edit
    ? "Mode edit: pilih shift langsung di tabel, atau pakai tombol Isi pola untuk mengisi satu bulan sekaligus. Perubahan tersimpan otomatis."
    : "Hanya lihat. Untuk mengubah jadwal, masuk lewat menu Admin.";

  let msg = STATUS_TEXT[S.status] || "";
  if (ok && !S.hasDoc) msg = S.edit ? "Belum ada jadwal untuk bulan ini. Pilih shift di tabel atau klik Isi pola untuk mulai mengisi." : "Jadwal bulan ini belum diisi.";
  const st = $("#j-status");
  st.textContent = msg;
  st.className = "jadwal-status" + (S.status === "denied" || S.status === "error" ? " err" : "");

  $("#j-wrap").hidden = !ok;
  $("#j-rekap-box").hidden = !ok;
  if (!ok) return;

  const sig = [S.year, S.month, S.names.join("|"), S.edit].join("#");
  if (sig !== S.sig) { S.sig = sig; buildTable(); }
  sync();
}

function buildTable() {
  const wrap = $("#j-wrap");
  wrap.innerHTML = "";
  refs = [];

  const table = el("table", "jadwal");
  table.setAttribute("aria-label", "Jadwal helpdesk " + MONTHS[S.month] + " " + S.year);
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
  if (isThisMonth) {
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
  const box = $("#j-rekap");
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

/* ---------- Simpan ke Firestore ---------- */
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

/* ---------- Atur nama helpdesk ---------- */
const dlg = $("#j-dialog");
$("#j-names").addEventListener("click", () => {
  $("#j-names-text").value = S.names.join("\n");
  $("#j-dlg-err").textContent = "";
  if (typeof dlg.showModal === "function") dlg.showModal();
  $("#j-names-text").focus();
});
$("#j-dlg-cancel").addEventListener("click", () => dlg.close());
$("#j-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#j-dlg-err");
  const names = [...new Set($("#j-names-text").value.split("\n")
    .map((x) => x.trim().toUpperCase().replace(/[.\/\[\]*~`]/g, "").trim())
    .filter(Boolean))];
  if (!names.length) { err.textContent = "Isi minimal satu nama."; return; }
  if (names.length > MAX_NAMES) { err.textContent = "Maksimal " + MAX_NAMES + " nama."; return; }
  const btn = $("#j-dlg-save");
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

/* ---------- Isi pola (pengisian cepat per staf) ----------
   Contoh pola: PAGI PAGI MIDDLE MIDDLE MALAM LIBUR LIBUR
   Pola diulang dari tanggal awal sampai tanggal akhir, lalu disimpan
   dalam satu kali tulis ke Firestore. "SIANG" dibaca sebagai MIDDLE,
   "-" berarti kosong. */
const pdlg = $("#j-pola-dlg");
$("#j-pola").addEventListener("click", () => {
  const sel = $("#p-staff");
  const prev = sel.value;
  sel.innerHTML = "";
  S.names.forEach((n) => { const o = el("option", null, n); o.value = n; sel.appendChild(o); });
  if (S.names.includes(prev)) sel.value = prev;
  $("#p-from").value = "1";
  $("#p-to").value = String(new Date(S.year, S.month + 1, 0).getDate());
  $("#p-err").textContent = "";
  if (typeof pdlg.showModal === "function") pdlg.showModal();
  $("#p-pattern").focus();
});
$("#p-cancel").addEventListener("click", () => pdlg.close());

$("#j-pola-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#p-err");
  err.textContent = "";
  const maxDay = new Date(S.year, S.month + 1, 0).getDate();
  const name = $("#p-staff").value;
  const from = parseInt($("#p-from").value, 10);
  const to = parseInt($("#p-to").value, 10);
  const offset = parseInt($("#p-offset").value, 10) || 1;

  const pat = $("#p-pattern").value.trim().toUpperCase().split(/[\s,]+/).filter(Boolean)
    .map((x) => (x === "SIANG" ? "MIDDLE" : x === "-" ? "" : x));
  if (!name) { err.textContent = "Pilih nama dulu."; return; }
  if (!pat.length) { err.textContent = "Pola belum diisi."; return; }
  const bad = pat.find((x) => x !== "" && !SHIFTS.includes(x));
  if (bad) { err.textContent = "Shift tidak dikenal: " + bad; return; }
  if (!(from >= 1 && to >= from && to <= maxDay)) { err.textContent = "Rentang tanggal harus 1 sampai " + maxDay + "."; return; }
  if (!(offset >= 1)) { err.textContent = "Urutan mulai harus 1 atau lebih."; return; }

  const patch = {};
  for (let d = from; d <= to; d++) {
    patch[d] = { [name]: pat[(offset - 1 + d - from) % pat.length] };
  }
  const btn = $("#p-save");
  btn.disabled = true; btn.textContent = "Menyimpan...";
  try {
    await setDoc(S.ref, { cells: patch }, { merge: true });   // satu kali tulis untuk semua tanggal
    pdlg.close();
  } catch (x) {
    err.textContent = writeMsg(x);
  } finally {
    btn.disabled = false; btn.textContent = "Terapkan";
  }
});

/* ---------- Langganan data bulan yang dipilih ---------- */
function subscribe() {
  if (S.unsub) { S.unsub(); S.unsub = null; }
  if (!db) return;
  S.status = "loading";
  render();
  S.ref = doc(db, COLLECTION, S.year + "-" + pad(S.month + 1));
  S.unsub = onSnapshot(S.ref, (snap) => {
    const d = snap.exists() ? snap.data() : {};
    S.hasDoc = snap.exists();
    const names = Array.isArray(d.names)
      ? [...new Set(d.names.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean))].slice(0, MAX_NAMES)
      : [];
    S.names = names.length ? names : DEFAULT_NAMES.slice();
    S.cells = d.cells && typeof d.cells === "object" ? d.cells : {};
    S.notes = d.notes && typeof d.notes === "object" ? d.notes : {};
    S.status = "ok";
    render();
  }, (err) => {
    console.warn("[Jadwal] Gagal memuat:", err);
    S.status = err && err.code === "permission-denied" ? "denied" : "error";
    render();
  });
}

/* ---------- Mulai: tunggu Firebase dari index.html ---------- */
(async function start() {
  render();
  let app = null;
  for (let t = 0; t < 80 && !app; t++) {                  // maksimal ±8 detik
    if (getApps().length) app = getApp();
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!app) { S.status = "nofb"; render(); return; }
  db = getFirestore(app);
  onAuthStateChanged(getAuth(app), (u) => { S.edit = !!u; render(); });
  subscribe();
})();
