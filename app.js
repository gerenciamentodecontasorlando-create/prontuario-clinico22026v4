/* BTX Clinic PWA
   - Login simples (senha local) sem dicas/sugestões.
   - Dados em IndexedDB.
   - Agenda com bloqueio de sábado/domingo + feriados configuráveis.
   - Prontuário com anamnese + evolução por data.
   - PDFs A4 individualizados por documento.
*/

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const toastEl = $("#toast");
function toast(msg){
  toastEl.textContent = msg;
  toastEl.style.display = "block";
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=> toastEl.style.display="none", 2600);
}

function formatDateBR(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function todayISO(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function monthKey(dateObj){
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}

function safeId(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// -------------------- SETTINGS (local) --------------------
const LS = {
  password: "btx_pw",
  session: "btx_session",
  pro: "btx_pro",
  holidays: "btx_holidays"
};

function getPassword(){
  return localStorage.getItem(LS.password) || "1212";
}
function setPassword(pw){
  localStorage.setItem(LS.password, pw);
}
function isLogged(){
  return localStorage.getItem(LS.session) === "1";
}
function setLogged(v){
  localStorage.setItem(LS.session, v ? "1" : "0");
}

function getPro(){
  const raw = localStorage.getItem(LS.pro);
  const def = {
    name: "Dr. Orlando Abreu Gomes da Silva",
    reg: "",
    phone: "(91) 99987-3835",
    email: "orlandodentista@outlook.com",
    address: "Belém • Pará • Brasil",
    publicBio: "Odontologia • Cirurgia e Traumatologia Buco Maxilo Facial • Saúde Coletiva • Tecnologia"
  };
  try { return raw ? { ...def, ...JSON.parse(raw) } : def; }
  catch { return def; }
}
function setPro(obj){
  localStorage.setItem(LS.pro, JSON.stringify(obj));
}

function getHolidays(){
  const raw = localStorage.getItem(LS.holidays);
  // padrão: alguns nacionais (você edita no painel)
  const y = new Date().getFullYear();
  const def = [
    `${y}-01-01`,
    `${y}-04-21`,
    `${y}-05-01`,
    `${y}-09-07`,
    `${y}-10-12`,
    `${y}-11-02`,
    `${y}-11-15`,
    `${y}-12-25`,
  ];
  try {
    const arr = raw ? JSON.parse(raw) : def;
    return Array.isArray(arr) ? arr : def;
  } catch { return def; }
}
function setHolidays(arr){
  localStorage.setItem(LS.holidays, JSON.stringify(arr));
}

// -------------------- IndexedDB --------------------
const DB_NAME = "btxClinicDB";
const DB_VERSION = 1;
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;

      if(!d.objectStoreNames.contains("patients")){
        const s = d.createObjectStore("patients", { keyPath: "id" });
        s.createIndex("name", "name", { unique: false });
      }
      if(!d.objectStoreNames.contains("records")){
        d.createObjectStore("records", { keyPath: "patientId" });
      }
      if(!d.objectStoreNames.contains("appointments")){
        const s = d.createObjectStore("appointments", { keyPath: "id" });
        s.createIndex("date", "date", { unique: false });
        s.createIndex("patientId", "patientId", { unique: false });
      }
    };

    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode="readonly"){
  return db.transaction(store, mode).objectStore(store);
}

function idbGetAll(store){
  return new Promise((resolve,reject)=>{
    const req = tx(store).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}
function idbGet(store, key){
  return new Promise((resolve,reject)=>{
    const req = tx(store).get(key);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  });
}
function idbPut(store, value){
  return new Promise((resolve,reject)=>{
    const req = tx(store, "readwrite").put(value);
    req.onsuccess = ()=> resolve(true);
    req.onerror = ()=> reject(req.error);
  });
}
function idbDel(store, key){
  return new Promise((resolve,reject)=>{
    const req = tx(store, "readwrite").delete(key);
    req.onsuccess = ()=> resolve(true);
    req.onerror = ()=> reject(req.error);
  });
}

// -------------------- UI state --------------------
let state = {
  activeTab: "dashboard",
  selectedPatientId: null,
  calDate: new Date(),
  selectedDayISO: null
};

// elements
const publicView = $("#publicView");
const appView = $("#appView");

const loginBtn = $("#loginBtn");
const logoutBtn = $("#logoutBtn");
const modal = $("#modal");
const closeModal = $("#closeModal");
const pwInput = $("#pwInput");
const doLogin = $("#doLogin");

const installBtn = $("#installBtn");
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if(!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

// -------------------- navigation --------------------
function setTab(tab){
  state.activeTab = tab;
  $$(".navBtn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$("[data-panel]").forEach(p => p.hidden = (p.dataset.panel !== tab));
  if(tab === "calendar") renderCalendar();
  if(tab === "patients") renderPatients();
  if(tab === "records") renderRecords();
  if(tab === "docs") renderDocs();
  if(tab === "settings") renderSettings();
  if(tab === "dashboard") renderDashboard();
}

$$(".navBtn").forEach(b => b.addEventListener("click", ()=> setTab(b.dataset.tab)));

// -------------------- login logic --------------------
function openLogin(){
  modal.hidden = false;
  pwInput.value = "";
  pwInput.focus();
}
function closeLogin(){
  modal.hidden = true;
}

loginBtn.addEventListener("click", openLogin);
closeModal.addEventListener("click", closeLogin);
modal.addEventListener("click", (e)=>{ if(e.target === modal) closeLogin(); });

doLogin.addEventListener("click", () => {
  const pw = pwInput.value.trim();
  if(!pw) return toast("Digite a senha.");
  if(pw === getPassword()){
    setLogged(true);
    closeLogin();
    updateAuthUI();
    toast("Bem-vindo. Sistema liberado.");
  } else {
    toast("Senha incorreta.");
  }
});

logoutBtn.addEventListener("click", ()=>{
  setLogged(false);
  updateAuthUI();
  toast("Sessão encerrada.");
});

function updateAuthUI(){
  const logged = isLogged();
  publicView.hidden = logged;
  appView.hidden = !logged;
  loginBtn.hidden = logged;
  logoutBtn.hidden = !logged;

  // atualiza público com dados salvos
  const pro = getPro();
  $("#publicName").textContent = pro.name || "—";
  $("#publicTitle").textContent = pro.publicBio || "";
  $("#publicPhone").textContent = pro.phone || "";
  $("#publicEmail").textContent = pro.email || "";
  $("#publicCity").textContent = pro.address || "";

  if(logged){
    setTab(state.activeTab || "dashboard");
  }
}

// -------------------- calendar rules --------------------
function isWeekend(dateObj){
  const day = dateObj.getDay(); // 0=domingo
  return day === 0 || day === 6;
}

function isHoliday(iso){
  return new Set(getHolidays()).has(iso);
}

function isBlockedDay(iso){
  const d = new Date(iso + "T00:00:00");
  return isWeekend(d) || isHoliday(iso);
}

// -------------------- dashboard --------------------
async function renderDashboard(){
  $("#dashToday").textContent = `Hoje: ${formatDateBR(todayISO())}`;

  const patients = await idbGetAll("patients");
  const appts = await idbGetAll("appointments");
  const recs = await idbGetAll("records");

  $("#kpiPatients").textContent = patients.length;

  const mk = monthKey(new Date());
  const monthAppts = appts.filter(a => (a.date || "").startsWith(mk));
  $("#kpiMonthAppts").textContent = monthAppts.length;

  let recentNotes = 0;
  recs.forEach(r => recentNotes += (r.visits?.length || 0));
  $("#kpiRecentNotes").textContent = Math.min(recentNotes, 99);

  // next appts (sorted)
  const nowIso = todayISO();
  const next = appts
    .filter(a => a.date >= nowIso)
    .sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time))
    .slice(0,6);

  $("#dashNextAppts").innerHTML = next.length ? next.map(a => {
    const p = patients.find(x => x.id === a.patientId);
    return `
      <div class="item">
        <div class="title">${formatDateBR(a.date)} • ${a.time || "--:--"}</div>
        <div class="sub">${p ? p.name : "Paciente"} — ${a.note ? a.note : ""}</div>
      </div>
    `;
  }).join("") : `<div class="muted">— sem agendamentos próximos</div>`;

  const recentP = [...patients].sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0)).slice(0,6);
  $("#dashRecentPatients").innerHTML = recentP.length ? recentP.map(p => `
    <div class="item">
      <div class="title">${p.name}</div>
      <div class="sub">${p.phone || ""} ${p.cpf ? "• " + p.cpf : ""}</div>
    </div>
  `).join("") : `<div class="muted">—</div>`;
}

// -------------------- patients --------------------
const patientSearch = $("#patientSearch");
const newPatientBtn = $("#newPatientBtn");
const patientsList = $("#patientsList");
const patientDetail = $("#patientDetail");

patientSearch.addEventListener("input", renderPatients);

newPatientBtn.addEventListener("click", async ()=>{
  const name = prompt("Nome do paciente:");
  if(!name) return;
  const phone = prompt("Telefone (opcional):") || "";
  const cpf = prompt("CPF (opcional):") || "";
  const id = safeId();
  const now = Date.now();
  const p = { id, name: name.trim(), phone: phone.trim(), cpf: cpf.trim(), createdAt: now, updatedAt: now };
  await idbPut("patients", p);
  state.selectedPatientId = id;
  toast("Paciente criado.");
  await syncPatientSelects();
  renderPatients();
});

async function renderPatients(){
  const q = (patientSearch.value || "").trim().toLowerCase();
  const patients = await idbGetAll("patients");
  const filtered = patients
    .filter(p => !q || (p.name||"").toLowerCase().includes(q) || (p.phone||"").toLowerCase().includes(q) || (p.cpf||"").toLowerCase().includes(q))
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "pt-BR"));

  patientsList.innerHTML = filtered.length ? filtered.map(p => `
    <div class="item">
      <div class="title">${p.name}</div>
      <div class="sub">${p.phone || ""} ${p.cpf ? "• " + p.cpf : ""}</div>
      <div class="actions">
        <button class="btn ghost" data-open="${p.id}">Abrir</button>
        <button class="btn ghost" data-edit="${p.id}">Editar</button>
        <button class="btn danger" data-del="${p.id}">Excluir</button>
      </div>
    </div>
  `).join("") : `<div class="muted">Nenhum paciente.</div>`;

  patientsList.querySelectorAll("[data-open]").forEach(btn => btn.addEventListener("click", async ()=>{
    state.selectedPatientId = btn.dataset.open;
    await syncPatientSelects();
    renderPatients();
  }));

  patientsList.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", async ()=>{
    const id = btn.dataset.edit;
    const p = await idbGet("patients", id);
    if(!p) return;
    const name = prompt("Nome:", p.name) ?? p.name;
    const phone = prompt("Telefone:", p.phone || "") ?? (p.phone || "");
    const cpf = prompt("CPF:", p.cpf || "") ?? (p.cpf || "");
    p.name = (name||"").trim();
    p.phone = (phone||"").trim();
    p.cpf = (cpf||"").trim();
    p.updatedAt = Date.now();
    await idbPut("patients", p);
    toast("Paciente atualizado.");
    await syncPatientSelects();
    renderPatients();
  }));

  patientsList.querySelectorAll("[data-del]").forEach(btn => btn.addEventListener("click", async ()=>{
    const id = btn.dataset.del;
    if(!confirm("Excluir paciente e seus dados?")) return;
    await idbDel("patients", id);
    await idbDel("records", id);

    // remove appointments
    const appts = await idbGetAll("appointments");
    const toDel = appts.filter(a => a.patientId === id);
    for(const a of toDel) await idbDel("appointments", a.id);

    if(state.selectedPatientId === id) state.selectedPatientId = null;
    toast("Excluído.");
    await syncPatientSelects();
    renderPatients();
  }));

  await renderPatientDetail();
}

async function renderPatientDetail(){
  const id = state.selectedPatientId;
  if(!id){
    patientDetail.innerHTML = `<div class="muted">Selecione um paciente.</div>`;
    return;
  }
  const p = await idbGet("patients", id);
  if(!p){
    patientDetail.innerHTML = `<div class="muted">Paciente não encontrado.</div>`;
    return;
  }

  const rec = await idbGet("records", id);
  const visits = rec?.visits || [];
  const appts = (await idbGetAll("appointments")).filter(a => a.patientId === id).sort((a,b)=> (b.date+b.time).localeCompare(a.date+b.time));

  patientDetail.innerHTML = `
    <div class="item">
      <div class="title">${p.name}</div>
      <div class="sub">${p.phone || ""} ${p.cpf ? "• " + p.cpf : ""}</div>
    </div>

    <div class="hr"></div>

    <div class="item">
      <div class="title">Ficha clínica</div>
      <div class="sub">Evoluções: <b>${visits.length}</b></div>
      <div class="actions">
        <button class="btn primary" id="goRecord">Abrir ficha</button>
        <button class="btn ghost" id="goDocs">Gerar documentos</button>
      </div>
    </div>

    <div class="hr"></div>

    <div class="item">
      <div class="title">Agendamentos</div>
      <div class="sub">Total: <b>${appts.length}</b></div>
      <div class="actions">
        <button class="btn ghost" id="goCalendar">Ir para agenda</button>
      </div>
    </div>
  `;

  $("#goRecord")?.addEventListener("click", ()=> setTab("records"));
  $("#goDocs")?.addEventListener("click", ()=> setTab("docs"));
  $("#goCalendar")?.addEventListener("click", ()=> setTab("calendar"));
}

async function syncPatientSelects(){
  const patients = await idbGetAll("patients");
  const opt = (p) => `<option value="${p.id}">${p.name}</option>`;
  const sorted = [...patients].sort((a,b)=> (a.name||"").localeCompare(b.name||"", "pt-BR"));

  const selects = [ $("#apptPatient"), $("#recordPatientSelect"), $("#docsPatientSelect") ].filter(Boolean);
  selects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = sorted.length ? sorted.map(opt).join("") : `<option value="">(sem pacientes)</option>`;
    // prefer state selected
    if(state.selectedPatientId && sorted.find(p => p.id === state.selectedPatientId)){
      sel.value = state.selectedPatientId;
    } else if(current && sorted.find(p => p.id === current)){
      sel.value = current;
    }
  });

  // update state
  const rp = $("#recordPatientSelect");
  if(rp && rp.value) state.selectedPatientId = rp.value;
}

// -------------------- records (ficha clínica) --------------------
const recordPatientSelect = $("#recordPatientSelect");
const saveRecordBtn = $("#saveRecordBtn");
const addVisitBtn = $("#addVisitBtn");
const visitsList = $("#visitsList");

recordPatientSelect.addEventListener("change", async ()=>{
  state.selectedPatientId = recordPatientSelect.value || null;
  await syncPatientSelects();
  renderRecords();
});

saveRecordBtn.addEventListener("click", async ()=>{
  if(!state.selectedPatientId) return toast("Selecione um paciente.");
  const r = await buildRecordFromForm();
  await idbPut("records", r);
  toast("Ficha salva.");
  renderRecords();
});

addVisitBtn.addEventListener("click", async ()=>{
  if(!state.selectedPatientId) return toast("Selecione um paciente.");
  const date = $("#visitDate").value || todayISO();
  const note = ($("#visitNote").value || "").trim();
  if(!note) return toast("Digite a evolução/procedimento.");
  const r = await idbGet("records", state.selectedPatientId) || { patientId: state.selectedPatientId, anamnese:{}, visits:[] };
  r.visits = r.visits || [];
  r.visits.unshift({ id: safeId(), date, note, createdAt: Date.now() });
  await idbPut("records", r);
  $("#visitDate").value = date;
  $("#visitNote").value = "";
  toast("Evolução adicionada.");
  renderRecords();
});

async function buildRecordFromForm(){
  const patientId = state.selectedPatientId;
  const r = await idbGet("records", patientId) || { patientId, anamnese:{}, visits:[] };
  r.anamnese = {
    chief: $("#anamneseChief").value || "",
    hda: $("#anamneseHda").value || "",
    hx: $("#anamneseHx").value || "",
    allergies: $("#anamneseAllergies").value || "",
    meds: $("#anamneseMeds").value || "",
    vitals: $("#anamneseVitals").value || ""
  };
  r.updatedAt = Date.now();
  return r;
}

async function renderRecords(){
  await syncPatientSelects();
  const id = state.selectedPatientId || recordPatientSelect.value;
  if(!id){
    visitsList.innerHTML = `<div class="muted">Crie/Selecione um paciente.</div>`;
    return;
  }

  // load record
  const r = await idbGet("records", id) || { patientId:id, anamnese:{}, visits:[] };
  $("#anamneseChief").value = r.anamnese?.chief || "";
  $("#anamneseHda").value = r.anamnese?.hda || "";
  $("#anamneseHx").value = r.anamnese?.hx || "";
  $("#anamneseAllergies").value = r.anamnese?.allergies || "";
  $("#anamneseMeds").value = r.anamnese?.meds || "";
  $("#anamneseVitals").value = r.anamnese?.vitals || "";
  $("#visitDate").value = todayISO();

  const visits = r.visits || [];
  visitsList.innerHTML = visits.length ? visits.map(v => `
    <div class="item">
      <div class="title">${formatDateBR(v.date)}</div>
      <div class="sub" style="white-space:pre-wrap">${escapeHtml(v.note)}</div>
      <div class="actions">
        <button class="btn ghost" data-editv="${v.id}">Editar</button>
        <button class="btn danger" data-delv="${v.id}">Excluir</button>
      </div>
    </div>
  `).join("") : `<div class="muted">Sem evoluções ainda.</div>`;

  visitsList.querySelectorAll("[data-editv]").forEach(btn => btn.addEventListener("click", async ()=>{
    const vid = btn.dataset.editv;
    const item = visits.find(x => x.id === vid);
    if(!item) return;
    const newText = prompt("Editar evolução:", item.note);
    if(newText === null) return;
    item.note = newText;
    await idbPut("records", r);
    toast("Evolução atualizada.");
    renderRecords();
  }));

  visitsList.querySelectorAll("[data-delv]").forEach(btn => btn.addEventListener("click", async ()=>{
    const vid = btn.dataset.delv;
    if(!confirm("Excluir esta evolução?")) return;
    r.visits = (r.visits||[]).filter(x => x.id !== vid);
    await idbPut("records", r);
    toast("Excluída.");
    renderRecords();
  }));
}

function escapeHtml(str){
  return (str||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

// -------------------- calendar render + appointments --------------------
const calTitle = $("#calTitle");
const calendarGrid = $("#calendarGrid");
const calPrev = $("#calPrev");
const calNext = $("#calNext");
const calToday = $("#calToday");

const apptDate = $("#apptDate");
const apptTime = $("#apptTime");
const apptPatient = $("#apptPatient");
const apptNote = $("#apptNote");
const addApptBtn = $("#addApptBtn");

const dayApptsTitle = $("#dayApptsTitle");
const dayApptsList = $("#dayApptsList");

calPrev.addEventListener("click", ()=>{ state.calDate.setMonth(state.calDate.getMonth()-1); renderCalendar(); });
calNext.addEventListener("click", ()=>{ state.calDate.setMonth(state.calDate.getMonth()+1); renderCalendar(); });
calToday.addEventListener("click", ()=>{ state.calDate = new Date(); renderCalendar(); });

addApptBtn.addEventListener("click", async ()=>{
  const date = apptDate.value;
  const time = apptTime.value;
  const pid = apptPatient.value;
  const note = (apptNote.value || "").trim();

  if(!date) return toast("Escolha a data.");
  if(isBlockedDay(date)) return toast("Dia bloqueado (fds/feriado).");
  if(!time) return toast("Escolha a hora.");
  if(!pid) return toast("Escolha o paciente.");

  const appt = {
    id: safeId(),
    date,
    time,
    patientId: pid,
    note,
    createdAt: Date.now()
  };

  await idbPut("appointments", appt);
  toast("Agendamento salvo.");
  apptNote.value = "";

  state.selectedDayISO = date;
  renderCalendar();
  renderDayAppointments(date);
  renderDashboard();
});

async function renderCalendar(){
  await syncPatientSelects();

  const d = new Date(state.calDate);
  d.setDate(1);

  const year = d.getFullYear();
  const month = d.getMonth();
  const monthName = d.toLocaleString("pt-BR", { month:"long" });
  calTitle.textContent = `${monthName.charAt(0).toUpperCase()+monthName.slice(1)} ${year}`;

  const startDay = d.getDay(); // 0 sunday
  const daysInMonth = new Date(year, month+1, 0).getDate();

  const appts = await idbGetAll("appointments");
  const mk = `${year}-${String(month+1).padStart(2,"0")}`;
  const monthAppts = appts.filter(a => (a.date||"").startsWith(mk));
  const setHas = new Set(monthAppts.map(a => a.date));

  calendarGrid.innerHTML = "";

  // labels row
  const labels = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  labels.forEach(l=>{
    const el = document.createElement("div");
    el.className = "day";
    el.style.minHeight = "54px";
    el.style.cursor = "default";
    el.innerHTML = `<div class="dnum" style="opacity:.8">${l}</div>`;
    calendarGrid.appendChild(el);
  });

  // blanks
  for(let i=0;i<startDay;i++){
    const el = document.createElement("div");
    el.className = "day";
    el.style.opacity = ".18";
    el.style.cursor = "default";
    el.innerHTML = `<div class="dnum"> </div>`;
    calendarGrid.appendChild(el);
  }

  for(let day=1; day<=daysInMonth; day++){
    const iso = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const dateObj = new Date(iso+"T00:00:00");
    const blocked = isWeekend(dateObj) || isHoliday(iso);
    const has = setHas.has(iso);

    const el = document.createElement("div");
    el.className = "day" + (blocked ? " disabled" : "");
    el.innerHTML = `
      <div class="dnum">${day}</div>
      <span class="badge ${blocked ? "disabled" : (has ? "has" : "")}"></span>
      <div class="muted small" style="margin-top:10px">
        ${isHoliday(iso) ? "Feriado" : (blocked ? "Bloqueado" : (has ? "Agendado" : ""))}
      </div>
    `;

    el.addEventListener("click", ()=>{
      if(blocked){
        toast("Dia bloqueado (fds/feriado).");
        return;
      }
      state.selectedDayISO = iso;
      apptDate.value = iso;
      renderDayAppointments(iso);
    });

    calendarGrid.appendChild(el);
  }

  // preselect today or selected
  const pick = state.selectedDayISO || todayISO();
  if(!isBlockedDay(pick)){
    apptDate.value = pick;
    state.selectedDayISO = pick;
    renderDayAppointments(pick);
  } else {
    dayApptsTitle.textContent = "Selecione um dia útil.";
    dayApptsList.innerHTML = `<div class="muted">—</div>`;
  }

  // KPI update
  const apptsAll = await idbGetAll("appointments");
  const mkNow = monthKey(new Date());
  $("#kpiMonthAppts").textContent = apptsAll.filter(a => (a.date||"").startsWith(mkNow)).length;
}

async function renderDayAppointments(iso){
  const appts = (await idbGetAll("appointments"))
    .filter(a => a.date === iso)
    .sort((a,b)=> (a.time||"").localeCompare(b.time||""));

  const patients = await idbGetAll("patients");
  dayApptsTitle.textContent = `Agendamentos em ${formatDateBR(iso)}`;

  dayApptsList.innerHTML = appts.length ? appts.map(a=>{
    const p = patients.find(x => x.id === a.patientId);
    return `
      <div class="item">
        <div class="title">${a.time || "--:--"} — ${p ? p.name : "Paciente"}</div>
        <div class="sub">${a.note ? escapeHtml(a.note) : ""}</div>
        <div class="actions">
          <button class="btn ghost" data-editappt="${a.id}">Editar</button>
          <button class="btn danger" data-delappt="${a.id}">Excluir</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="muted">Sem agendamentos nesse dia.</div>`;

  dayApptsList.querySelectorAll("[data-editappt]").forEach(btn => btn.addEventListener("click", async ()=>{
    const id = btn.dataset.editappt;
    const appt = (await idbGetAll("appointments")).find(x => x.id === id);
    if(!appt) return;
    const newTime = prompt("Hora (HH:MM):", appt.time || "") ?? appt.time;
    const newNote = prompt("Observações:", appt.note || "") ?? appt.note;
    appt.time = (newTime||"").trim();
    appt.note = (newNote||"").trim();
    await idbPut("appointments", appt);
    toast("Agendamento atualizado.");
    renderDayAppointments(iso);
    renderCalendar();
  }));

  dayApptsList.querySelectorAll("[data-delappt]").forEach(btn => btn.addEventListener("click", async ()=>{
    const id = btn.dataset.delappt;
    if(!confirm("Excluir agendamento?")) return;
    await idbDel("appointments", id);
    toast("Agendamento removido.");
    renderDayAppointments(iso);
    renderCalendar();
    renderDashboard();
  }));
}

// -------------------- docs & PDF --------------------
const docsPatientSelect = $("#docsPatientSelect");
const refreshDocPreviewBtn = $("#refreshDocPreviewBtn");
const docType = $("#docType");
const docSubject = $("#docSubject");
const docBody = $("#docBody");
const fillTemplateBtn = $("#fillTemplateBtn");
const makePdfBtn = $("#makePdfBtn");
const docPreview = $("#docPreview");

docsPatientSelect.addEventListener("change", ()=>{
  state.selectedPatientId = docsPatientSelect.value || null;
  renderDocs();
});
docType.addEventListener("change", renderDocPreview);
docSubject.addEventListener("input", renderDocPreview);
docBody.addEventListener("input", renderDocPreview);
refreshDocPreviewBtn.addEventListener("click", renderDocPreview);

fillTemplateBtn.addEventListener("click", async ()=>{
  const type = docType.value;
  const patient = await getSelectedPatient();
  const pro = getPro();

  if(!patient) return toast("Selecione um paciente.");

  if(type === "prescription"){
    docSubject.value = docSubject.value || "Receituário";
    docBody.value = `Paciente: ${patient.name}\n\n1) ________________________________________________\n   Posologia: ______________________________________\n   Duração: ________________________________________\n\n2) ________________________________________________\n   Posologia: ______________________________________\n   Duração: ________________________________________\n\nObservações:\n- ${pro.name}\n- Assinatura e carimbo`;
  } else if(type === "certificate"){
    docSubject.value = docSubject.value || "Atestado";
    docBody.value = `Atesto para os devidos fins que o(a) paciente ${patient.name} esteve sob meus cuidados profissionais nesta data, necessitando de ________ (afastamento/repouso) por _____ dia(s), a contar de ${formatDateBR(todayISO())}.\n\nCID (opcional): ________\n\nBelém/PA, ${formatDateBR(todayISO())}.`;
  } else if(type === "budget"){
    docSubject.value = docSubject.value || "Orçamento";
    docBody.value = `Descrição dos procedimentos:\n- ________________________________________________\n- ________________________________________________\n\nValor total: R$ ____________\n\nForma de pagamento: ______________________________\nValidade do orçamento: ______ dias.\n\nObservações: ______________________________________`;
  } else {
    docSubject.value = docSubject.value || "Ficha clínica";
    const rec = await idbGet("records", patient.id) || { anamnese:{}, visits:[] };
    const a = rec.anamnese || {};
    const v = (rec.visits||[]).slice(0,12).map(x => `- ${formatDateBR(x.date)}: ${x.note}`).join("\n\n");
    docBody.value =
`ANAMNESE
Queixa principal: ${a.chief || ""}
HDA: ${a.hda || ""}
Antecedentes/Comorbidades: ${a.hx || ""}
Alergias: ${a.allergies || ""}
Medicações em uso: ${a.meds || ""}
Sinais vitais/Obs.: ${a.vitals || ""}

EVOLUÇÃO (últimas)
${v || "(sem evoluções)"}
`;
  }

  renderDocPreview();
  toast("Modelo carregado.");
});

makePdfBtn.addEventListener("click", async ()=>{
  const patient = await getSelectedPatient();
  if(!patient) return toast("Selecione um paciente.");
  await renderDocPreview();

  // gera PDF A4 em páginas (slice)
  try {
    await makePdfFromPreview({
      filename: buildDocFilename(patient),
      node: docPreview
    });
    toast("PDF gerado.");
  } catch (e) {
    console.error(e);
    toast("Falha ao gerar PDF (verifique conexão/CDN).");
  }
});

function buildDocFilename(patient){
  const type = docType.value;
  const map = {
    prescription: "Receituario",
    certificate: "Atestado",
    budget: "Orcamento",
    clinical: "Ficha_Clinica"
  };
  const t = map[type] || "Documento";
  const dt = todayISO();
  const safeName = (patient.name||"Paciente").replaceAll(" ", "_").replace(/[^\w\-À-ÿ]/g, "");
  return `${t}_${safeName}_${dt}.pdf`;
}

async function getSelectedPatient(){
  const id = state.selectedPatientId || docsPatientSelect.value || recordPatientSelect.value;
  if(!id) return null;
  return await idbGet("patients", id);
}

async function renderDocs(){
  await syncPatientSelects();
  renderDocPreview();
}

function buildDocHtml({pro, patient, type, subject, body}){
  const now = formatDateBR(todayISO());
  const typeLabel = ({
    prescription: "Receituário",
    certificate: "Atestado",
    budget: "Orçamento",
    clinical: "Ficha clínica"
  })[type] || "Documento";

  const headerRight = `
    <div class="meta">
      <div><b>${typeLabel}</b></div>
      <div>${now}</div>
    </div>
  `;

  const proBlock = `
    <div class="pro">
      ${escapeHtml(pro.name || "")}<br/>
      <span style="font-weight:600;opacity:.85">${escapeHtml(pro.reg || "")}</span><br/>
      <span style="font-weight:600;opacity:.85">${escapeHtml(pro.phone || "")}</span><br/>
      <span style="font-weight:600;opacity:.85">${escapeHtml(pro.email || "")}</span>
    </div>
  `;

  const patientLine = patient ? `<div style="margin-top:8px"><b>Paciente:</b> ${escapeHtml(patient.name || "")}</div>` : "";

  return `
    <div class="docHeader">
      ${proBlock}
      ${headerRight}
    </div>

    ${patientLine}

    <div class="docTitle">${escapeHtml(subject || typeLabel)}</div>
    <div class="docBody">${escapeHtml(body || "")}</div>

    <div class="docFooter">
      <div><b>Local:</b> ${escapeHtml(pro.address || "")}</div>
    </div>
  `;
}

async function renderDocPreview(){
  const pro = getPro();
  const patient = await getSelectedPatient();
  const html = buildDocHtml({
    pro,
    patient,
    type: docType.value,
    subject: docSubject.value,
    body: docBody.value
  });
  docPreview.innerHTML = html;
}

async function makePdfFromPreview({filename, node}){
  const { jsPDF } = window.jspdf || {};
  if(!jsPDF) throw new Error("jsPDF not loaded");
  if(!window.html2canvas) throw new Error("html2canvas not loaded");

  // render high-res canvas
  const canvas = await window.html2canvas(node, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff"
  });

  const imgData = canvas.toDataURL("image/png");

  // A4 in pt
  const pdf = new jsPDF("p", "pt", "a4");
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // scale image to fit width
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;

  // If content exceeds one page, slice vertically
  let y = 0;
  let remaining = imgH;

  // We add same image but shifted upward to emulate slicing.
  // This preserves "border" in the captured node and avoids breaking layout.
  while(remaining > 0){
    pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
    remaining -= pageH;
    if(remaining > 0){
      pdf.addPage();
      y -= pageH;
    }
  }

  pdf.save(filename);
}

// -------------------- settings --------------------
const proName = $("#proName");
const proReg = $("#proReg");
const proPhone = $("#proPhone");
const proEmail = $("#proEmail");
const proAddress = $("#proAddress");
const publicBio = $("#publicBio");
const saveProBtn = $("#saveProBtn");

const pwCurrent = $("#pwCurrent");
const pwNew = $("#pwNew");
const pwNew2 = $("#pwNew2");
const changePwBtn = $("#changePwBtn");

const holidaysEl = $("#holidays");
const saveHolidaysBtn = $("#saveHolidaysBtn");

const exportBtn = $("#exportBtn");
const importBtn = $("#importBtn");
const importFile = $("#importFile");
const wipeBtn = $("#wipeBtn");

saveProBtn.addEventListener("click", ()=>{
  const p = {
    name: (proName.value||"").trim(),
    reg: (proReg.value||"").trim(),
    phone: (proPhone.value||"").trim(),
    email: (proEmail.value||"").trim(),
    address: (proAddress.value||"").trim(),
    publicBio: (publicBio.value||"").trim()
  };
  setPro(p);
  updateAuthUI();
  toast("Dados do profissional salvos.");
});

changePwBtn.addEventListener("click", ()=>{
  const cur = (pwCurrent.value||"").trim();
  const nw = (pwNew.value||"").trim();
  const nw2 = (pwNew2.value||"").trim();

  if(cur !== getPassword()) return toast("Senha atual incorreta.");
  if(!nw || nw.length < 4) return toast("Nova senha muito curta (mín. 4).");
  if(nw !== nw2) return toast("Confirmação não confere.");
  setPassword(nw);
  pwCurrent.value = pwNew.value = pwNew2.value = "";
  toast("Senha atualizada.");
});

saveHolidaysBtn.addEventListener("click", ()=>{
  const lines = (holidaysEl.value || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  // validate basic ISO yyyy-mm-dd
  const ok = lines.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  setHolidays(ok);
  toast("Feriados salvos.");
  renderCalendar();
});

exportBtn.addEventListener("click", async ()=>{
  const dump = {
    version: 1,
    exportedAt: new Date().toISOString(),
    pro: getPro(),
    holidays: getHolidays(),
    patients: await idbGetAll("patients"),
    records: await idbGetAll("records"),
    appointments: await idbGetAll("appointments")
  };

  const blob = new Blob([JSON.stringify(dump, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `btx_backup_${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Backup exportado.");
});

importBtn.addEventListener("click", ()=> importFile.click());
importFile.addEventListener("change", async ()=>{
  const file = importFile.files?.[0];
  if(!file) return;
  try{
    const text = await file.text();
    const dump = JSON.parse(text);

    if(dump.pro) setPro(dump.pro);
    if(dump.holidays) setHolidays(dump.holidays);

    if(Array.isArray(dump.patients)){
      for(const p of dump.patients) await idbPut("patients", p);
    }
    if(Array.isArray(dump.records)){
      for(const r of dump.records) await idbPut("records", r);
    }
    if(Array.isArray(dump.appointments)){
      for(const a of dump.appointments) await idbPut("appointments", a);
    }

    toast("Backup restaurado.");
    await syncPatientSelects();
    renderDashboard();
    renderCalendar();
    renderPatients();
    renderRecords();
    renderDocs();
    updateAuthUI();
  }catch(e){
    console.error(e);
    toast("Falha ao importar backup.");
  }finally{
    importFile.value = "";
  }
});

wipeBtn.addEventListener("click", async ()=>{
  if(!confirm("Apagar TODOS os dados do aparelho?")) return;

  // clear IndexedDB
  await new Promise((resolve,reject)=>{
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = ()=> resolve(true);
    req.onerror = ()=> reject(req.error);
    req.onblocked = ()=> resolve(true);
  });

  // clear settings
  localStorage.removeItem(LS.pro);
  localStorage.removeItem(LS.holidays);

  toast("Dados apagados. Recarregue a página.");
});

// -------------------- settings render --------------------
function renderSettings(){
  const p = getPro();
  proName.value = p.name || "";
  proReg.value = p.reg || "";
  proPhone.value = p.phone || "";
  proEmail.value = p.email || "";
  proAddress.value = p.address || "";
  publicBio.value = p.publicBio || "";

  holidaysEl.value = getHolidays().join("\n");
}

// -------------------- init --------------------
async function init(){
  // service worker
  if("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("./sw.js");
    }catch(e){
      console.warn("SW fail", e);
    }
  }

  await openDB();
  await syncPatientSelects();

  // default date fields
  apptDate.value = todayISO();
  $("#visitDate").value = todayISO();

  // initial dashboard
  await renderDashboard();
  await renderCalendar();
  await renderPatients();
  await renderRecords();
  await renderDocs();

  updateAuthUI();
}

init();
