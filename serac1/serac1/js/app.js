// js/app.js — PCM SERAC 1 · Command Center Cepêra
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAGbFTTCgbqe9XFKFSb6ltB5lYj5O6QipE",
  authDomain: "pcm-cepera.firebaseapp.com",
  projectId: "pcm-cepera",
  storageBucket: "pcm-cepera.firebasestorage.app",
  messagingSenderId: "483278589909",
  appId: "1:483278589909:web:9f69f8a32f50e4e186f75c",
  measurementId: "G-LW29TG8TJ4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const MAIN_DOC = doc(db, "pcm_data", "serac1");

let dbData = {};
let imgFlags = {};
let undoStack = [];
let currentView = 'menu';
let undoTimer = null;

function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function jsStr(s) { return esc(String(s)).replace(/'/g, "\\'"); }
function statusCol(status) {
    if (status === 'Em Andamento') return 'Andamento';
    if (status === 'Concluído') return 'Concluido';
    return 'Pendente';
}
function statusOptions(sel) {
    return ['Pendente','Em Andamento','Concluído'].map(s => `<option value="${esc(s)}" ${s===sel?'selected':''}>${esc(s)}</option>`).join('');
}
function fmtPrazo(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return null;
    return d.toLocaleDateString('pt-BR');
}
function prazoState(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return null;
    const diff = Math.ceil((d - new Date()) / 86400000);
    if (diff < 0) return { cls: 'late', txt: 'ATRASADO', diff };
    if (diff <= 30) return { cls: 'soon', txt: diff + 'd', diff };
    return null;
}
function getDisciplina(execucao) {
    const nome = String(execucao || '').toLowerCase();
    if (nome.includes('orivaldo') || nome.includes('orivado')) return 'Mecânica';
    if (nome.includes('henrique')) return 'Elétrica';
    return 'Mecânica';
}
function discTag(d) {
    const map = { 'Mecânica': '<span class="tag tag-mec">🔧 Mecânica</span>', 'Elétrica': '<span class="tag tag-ele">⚡ Elétrica</span>' };
    return map[d] || map['Mecânica'];
}

function pushUndo(msg) {
    undoStack.push({ snapshot: JSON.parse(JSON.stringify({ dbData, imgFlags })), msg });
    if (undoStack.length > 20) undoStack.shift();
    showToast(msg);
}
function showToast(msg) {
    const t = document.getElementById('undoToast');
    document.getElementById('toastMsg').textContent = msg + '  ';
    t.classList.add('show');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => t.classList.remove('show'), 8000);
}
window.doUndo = function () {
    const last = undoStack.pop();
    if (!last) return;
    dbData = last.snapshot.dbData;
    imgFlags = last.snapshot.imgFlags;
    saveData();
    document.getElementById('undoToast').classList.remove('show');
};

function initApp() {
    signInAnonymously(auth).then(() => {
        onSnapshot(MAIN_DOC, async (snap) => {
            if (snap.exists()) {
                const raw = snap.data();
                imgFlags = raw._imgFlags || {};
                const { _imgFlags, ...sheets } = raw;
                dbData = sheets;
                for (const items of Object.values(dbData)) {
                    (items || []).forEach(it => {
                        if (it.imagem === true && !imgFlags[it.id]) imgFlags[it.id] = { antes: true };
                        it.disciplina = getDisciplina(it.execucao);
                        if (!it.prazo && it.previsao) {
                            const m = String(it.previsao).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                            if (m) {
                                const iso = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
                                const d = new Date(iso + 'T12:00:00');
                                if (!isNaN(d)) { it.prazo = iso; it.previsao = fmtPrazo(iso); }
                            }
                        }
                        if (!it.previsao) it.previsao = it.prazo ? fmtPrazo(it.prazo) : 'A DECIDIR';
                    });
                }
            } else {
                dbData = JSON.parse(JSON.stringify(initialData));
                imgFlags = {};
                for (const items of Object.values(dbData)) {
                    (items || []).forEach(it => {
                        it.disciplina = getDisciplina(it.execucao);
                        if (!it.previsao) it.previsao = it.prazo ? fmtPrazo(it.prazo) : 'A DECIDIR';
                    });
                }
                await setDoc(MAIN_DOC, { ...dbData, _imgFlags: imgFlags });
            }
            buildNav();
            refreshUI();
        }, () => alert("Erro de conexão com a nuvem. Verifique a internet e recarregue a página."));
    }).catch((e) => {
        alert("Falha ao autenticar. Código: " + (e.code || '?') + "\n" + (e.message || ''));
    });
}
function refreshUI() {
    buildMenu();
    updateDashboard();
    fillExecList();
    if (currentView !== 'menu' && currentView !== 'dashboard') buildEquipView(currentView);
}
async function saveData() {
    try {
        await setDoc(MAIN_DOC, { ...dbData, _imgFlags: imgFlags });
        updateDashboard();
        buildMenu();
    } catch (e) {
        console.error(e);
        alert("Erro ao gravar na nuvem. Tente novamente.");
    }
}

window.toggleSidebar = () => document.getElementById('sidebar').classList.toggle('open');

function buildNav() {
    const nav = document.getElementById('nav-equipamentos');
    const key = Object.keys(dbData).join('|');
    if (nav.dataset.built !== key) {
        nav.dataset.built = key;
        const icons = ['🏷️','⚙️','📦','💧','🔧','🛠️','🔩','🟢'];
        nav.innerHTML = Object.keys(dbData).map((s, i) => `<button class="nav-btn ${s === currentView ? 'active' : ''}" data-view="${esc(s)}" data-label="${esc(s)}"><span>${icons[i % icons.length]}</span> ${esc(s)}</button>`).join('');
    }
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => activateView(btn));
    });
}

function activateView(btn) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.getElementById('pageTitle').textContent = btn.dataset.label || 'Visão Geral';
    document.getElementById('view-menu').classList.toggle('active', currentView === 'menu');
    document.getElementById('view-dashboard').classList.toggle('active', currentView === 'dashboard');
    document.querySelectorAll('.equip-view').forEach(v => v.classList.remove('active'));
    document.getElementById('sidebar').classList.remove('open');
    if (currentView !== 'menu' && currentView !== 'dashboard') buildEquipView(currentView);
}

window.gotoView = function (view) {
    const btn = [...document.querySelectorAll('.nav-btn')].find(b => b.dataset.view === view);
    if (btn) btn.click();
};
window.goMenuAction = function (what) {
    if (what === 'dashboard') gotoView('dashboard');
    else if (what === 'novo') openAddModal(null);
};
function buildMenu() {
    const wrap = document.getElementById('menu-equipamentos');
    if (!wrap) return;
    const icons = ['🏷️','⚙️','📦','💧','🔧','🛠️','🔩','🟢'];
    let atrasadas = 0, radar = 0;
    const cards = Object.entries(dbData).map(([sheet, items], i) => {
        const con = items.filter(x => x.status === 'Concluído').length;
        const pend = items.filter(x => x.status === 'Pendente').length;
        const late = items.filter(x => { const s = prazoState(x.prazo); return s && s.cls === 'late' && x.status !== 'Concluído'; }).length;
        const soon = items.filter(x => { const s = prazoState(x.prazo); return s && s.cls === 'soon' && x.status !== 'Concluído'; }).length;
        atrasadas += late; radar += soon;
        const pct = items.length ? Math.round(con / items.length * 100) : 0;
        return `<button class="menu-card glass-card" onclick="gotoView('${jsStr(sheet)}')"><span class="menu-ico">${icons[i % icons.length]}</span><span class="menu-name">${esc(sheet)}</span><div class="ring menu-ring" style="--p:${pct}"><span>${pct}%</span></div><div class="menu-badges">${pend ? `<span class="tag tag-p-Alta">${pend} pendente(s)</span>` : '<span class="tag tag-p-Baixa">em dia</span>'}${late ? `<span class="tag tag-p-Crítica">⏰ ${late} atrasada(s)</span>` : ''}${soon ? `<span class="tag tag-p-Alta">${soon} no radar</span>` : ''}</div></button>`;
    }).join('');
    wrap.innerHTML = cards;
    const resumo = document.getElementById('menu-resumo');
    if (resumo) {
        const total = Object.values(dbData).reduce((s, i) => s + i.length, 0);
        resumo.innerHTML = `<div class="mr-item"><strong>${total}</strong><span>ações</span></div><div class="mr-item mr-red"><strong>${atrasadas}</strong><span>atrasadas</span></div><div class="mr-item mr-amber"><strong>${radar}</strong><span>no radar</span></div>`;
    }
}

const PALETA = ['#84cc16','#4ade80','#facc15','#f87171','#60a5fa','#a78bfa','#fb923c','#2dd4bf'];
let charts = {};
function renderChartPie(canvasId, labels, values, colors, doughnut) {
    const el = document.getElementById(canvasId);
    if (!el || typeof Chart === 'undefined') return;
    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(el, {
        type: doughnut ? 'doughnut' : 'pie',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: 'rgba(13,43,22,.6)', borderWidth: 2 }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#f1f5f9', font: { size: 11 }, padding: 12 } } } }
    });
}

function updateDashboard() {
    let total=0, pend=0, and=0, con=0;
    const conj={}, exec={}, disc={};
    for (const [sheet, items] of Object.entries(dbData)) {
        items.forEach(it => {
            total++;
            if (it.status==='Pendente') pend++;
            else if (it.status==='Em Andamento') and++;
            else con++;
            const ex = it.execucao || 'Não Definido';
            exec[ex] = (exec[ex]||0)+1;
            disc[getDisciplina(it.execucao)] = (disc[getDisciplina(it.execucao)]||0)+1;
        });
        conj[sheet] = items.length;
    }
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('chip-total',total); set('chip-pendente',pend); set('chip-emandamento',and); set('chip-concluido',con);
    const pct = total ? Math.round(con/total*100) : 0;
    const ring = document.getElementById('ring-progress');
    if (ring) {
        ring.style.setProperty('--p', pct);
        document.getElementById('ring-num').textContent = pct + '%';
    }
    renderChartPie('pieStatus', ['Pendente','Em Andamento','Concluído'], [pend, and, con], ['#f87171','#facc15','#4ade80'], false);
    renderChartPie('pieConjuntos', Object.keys(conj), Object.values(conj), Object.keys(conj).map((_, i) => PALETA[i % PALETA.length]), true);
    const discOrder = ['Mecânica','Elétrica'].filter(d => disc[d]);
    renderChartPie('pieDisciplina', discOrder, discOrder.map(d => disc[d]), discOrder.map(d => d === 'Mecânica' ? '#84cc16' : '#facc15'), true);
    renderBars('chart-executores', exec, 'var(--success)');

    const dl = [];
    for (const [sheet, items] of Object.entries(dbData)) {
        items.forEach(it => {
            const st = prazoState(it.prazo);
            if (st && it.status !== 'Concluído') dl.push({ sheet, it, st });
        });
    }
    dl.sort((a,b) => a.st.diff - b.st.diff);
    const dlEl = document.getElementById('deadlines-list');
    const sumEl = document.getElementById('dlSummary');
    const tgl = document.getElementById('dlToggle');
    if (dlEl) {
        if (!dl.length) {
            dlEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Nenhum prazo crítico. Operação em dia. ✅</div>';
            if (sumEl) sumEl.style.display = 'none';
            dlEl.classList.remove('collapsed');
            if (tgl) tgl.style.display = 'none';
        } else {
            const atrasados = dl.filter(x => x.st.cls === 'late').length;
            if (sumEl) {
                sumEl.style.display = 'block';
                sumEl.innerHTML = `Você tem <strong>${atrasados} atrasada(s)</strong> e <strong>${dl.length - atrasados} no radar</strong> dos próximos 30 dias. ${atrasados ? 'Priorize as atrasadas. 🔴' : 'Tudo dentro do prazo. 🟢'}`;
            }
            dlEl.innerHTML = dl.map(x => `<div class="deadline-item ${x.st.cls==='late'?'late':''}"><div><strong>${esc(x.it.acao)}</strong><div style="font-size:11px;color:var(--text-muted)">${esc(x.sheet)} · ${esc(x.execucao||'Sem executor')}</div></div><div class="dl-when ${x.st.cls}">${x.st.txt}${x.it.prazo?' · '+fmtPrazo(x.it.prazo):''}</div></div>`).join('');
            dlEl.classList.toggle('collapsed', dl.length > 5);
            if (tgl) {
                tgl.style.display = dl.length > 5 ? 'inline-block' : 'none';
                tgl.textContent = dlEl.classList.contains('collapsed') ? `👁️ Ver todas (${dl.length})` : '🙈 Ocultar';
            }
        }
    }
}
function renderBars(id, data, color) {
    const el = document.getElementById(id); if (!el) return;
    const entries = Object.entries(data).sort((a,b)=>b[1]-a[1]);
    const max = entries.length ? entries[0][1] : 1;
    el.innerHTML = entries.map(([k,v]) => `<div class="bar-row"><span class="bar-label">${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%;background:${color}"></div></div><span class="bar-value">${v}</span></div>`).join('');
}

window.toggleDeadlines = function () {
    const list = document.getElementById('deadlines-list');
    const b = document.getElementById('dlToggle');
    if (!list || !b) return;
    list.classList.toggle('collapsed');
    b.textContent = list.classList.contains('collapsed') ? `👁️ Ver todas (${list.querySelectorAll('.deadline-item').length})` : '🙈 Ocultar';
};

function buildEquipView(sheet) {
    const items = dbData[sheet] || [];
    const container = document.getElementById('view-tables');
    container.querySelectorAll('.equip-view').forEach(v => v.remove());
    const sec = document.createElement('section');
    sec.className = 'view equip-view active';
    sec.id = 'view-equip-' + sheet.replace(/ /g,'_');
    const con = items.filter(i=>i.status==='Concluído').length;
    const pct = items.length ? Math.round(con/items.length*100) : 0;
    sec.innerHTML = `
        <div class="equip-head">
            <div class="equip-title">${esc(sheet)} <span style="color:var(--text-muted);font-size:13px">· ${con}/${items.length} concluídas (${pct}%)</span></div>
            <div style="display:flex;gap:10px;">
                <div class="view-toggle">
                    <button class="active" onclick="toggleView(this,'kanban','${jsStr(sheet)}')">Kanban</button>
                    <button onclick="toggleView(this,'lista','${jsStr(sheet)}')">Lista</button>
                </div>
                <button class="btn btn-primary" onclick="openAddModal('${jsStr(sheet)}')">+ Novo Plano</button>
            </div>
        </div>
        <div id="kb-${sheet.replace(/ /g,'_')}" class="kanban">${renderKanban(sheet, items)}</div>
        <div id="lt-${sheet.replace(/ /g,'_')}" style="display:none;" class="glass-card">${renderList(sheet, items)}</div>`;
    container.appendChild(sec);
    enableDrag(sheet);
}
function prioTag(p) { return `<span class="tag tag-p-${esc(p||'Média')}">${esc(p||'Média')}</span>`; }
function renderKanban(sheet, items) {
    const cols = { 'Pendente':[], 'Em Andamento':[], 'Concluído':[] };
    items.forEach(it => (cols[it.status]||cols['Pendente']).push(it));
    const colMap = { 'Pendente':'Pendente', 'Em Andamento':'Andamento', 'Concluído':'Concluido' };
    return Object.entries(cols).map(([st, arr]) => `
        <div class="kanban-col col-${colMap[st]}" data-status="${esc(st)}">
            <h4><span>${esc(st)}</span><span>${arr.length}</span></h4>
            ${arr.map(it => {
                const ph = imgFlags[it.id];
                const ps = prazoState(it.prazo);
                return `<div class="kcard" draggable="true" data-id="${esc(it.id)}"><div class="kcard-title">${esc(it.acao)}</div><div class="kcard-meta">${discTag(getDisciplina(it.execucao))}${prioTag(it.prioridade)}${ph && (ph.antes || ph.depois) ? '<span class="tag tag-photo">🖼️ foto</span>' : ''}${ps ? `<span class="tag tag-p-${ps.cls==='late'?'Crítica':'Alta'}">${ps.cls==='late'?'⏰ ATRASADO':'⏰ '+ps.txt}</span>` : ''}</div><div class="kcard-status"><select class="status-select status-${statusCol(it.status)}" onchange="updateStatus('${jsStr(sheet)}','${jsStr(it.id)}',this.value)">${statusOptions(it.status)}</select></div><div class="kcard-foot"><span>👤 ${esc(it.execucao||'—')}</span><div class="kcard-actions"><button class="btn-icon" onclick="openImageModal('${jsStr(sheet)}','${jsStr(it.id)}')" title="Fotos">📷</button><button class="btn-icon" onclick="deleteAction('${jsStr(sheet)}','${jsStr(it.id)}')" title="Excluir">🗑️</button></div></div></div>`;
            }).join('')}
        </div>`).join('');
}
window.updateStatus = function (sheet, id, newStatus) {
    const it = dbData[sheet]?.find(i => i.id === id);
    if (!it || it.status === newStatus) return;
    pushUndo(`Status alterado: "${it.acao}" → ${newStatus}`);
    it.status = newStatus;
    saveData();
    buildEquipView(sheet);
};
function renderList(sheet, items) {
    return `<table class="list-table"><thead><tr><th>Ação</th><th>Procedimento</th><th>Executor</th><th>Especialidade</th><th>Prioridade</th><th>Previsão</th><th>Status</th><th></th></tr></thead><tbody>
    ${items.map(it => `<tr>
        <td data-label="Ação"><strong>${esc(it.acao)}</strong></td>
        <td data-label="Procedimento" style="color:var(--text-muted);font-size:12px">${esc(it.detalhamento||'-')}</td>
        <td data-label="Executor"><input class="edit-input" value="${esc(it.execucao)}" onchange="updateField('${jsStr(sheet)}','${jsStr(it.id)}','execucao',this.value)"></td>
        <td data-label="Especialidade">${discTag(getDisciplina(it.execucao))}</td>
        <td data-label="Prioridade"><select class="cell-ctl prio-select" onchange="updateField('${jsStr(sheet)}','${jsStr(it.id)}','prioridade',this.value)">${['Baixa','Média','Alta','Crítica'].map(p => `<option value="${p}" ${p===(it.prioridade||'Média')?'selected':''}>${p}</option>`).join('')}</select></td>
        <td data-label="Previsão"><span class="date-cell ${it.prazo ? '' : 'is-empty'}"><input type="date" class="cell-ctl date-input" value="${esc(it.prazo||'')}" onchange="updatePrevisao('${jsStr(sheet)}','${jsStr(it.id)}',this.value)">${!it.prazo ? `<span class="date-fallback">${esc((it.previsao && it.previsao !== 'A DECIDIR') ? it.previsao : 'A DECIDIR')}</span>` : ''}</span></td>
        <td data-label="Status"><select class="cell-ctl status-select status-${statusCol(it.status)}" onchange="updateField('${jsStr(sheet)}','${jsStr(it.id)}','status',this.value)">${statusOptions(it.status)}</select></td>
        <td data-nolabel="1" style="display:flex;gap:6px;justify-content:flex-end;"><button class="btn-icon" onclick="openImageModal('${jsStr(sheet)}','${jsStr(it.id)}')">📷</button><button class="btn-icon" onclick="deleteAction('${jsStr(sheet)}','${jsStr(it.id)}')">🗑️</button></td>
    </tr>`).join('')}
    </tbody></table>`;
}
window.updatePrevisao = function (sheet, id, value) {
    const it = dbData[sheet]?.find(i => i.id === id);
    if (!it) return;
    pushUndo(`Alteração em "${it.acao}"`);
    if (value) { it.prazo = value; it.previsao = fmtPrazo(value); }
    else { it.prazo = ''; it.previsao = 'A DECIDIR'; }
    saveData();
    buildEquipView(sheet);
};
window.toggleView = function (btn, mode, sheet) {
    const wrap = btn.parentElement;
    wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const id = sheet.replace(/ /g,'_');
    document.getElementById('kb-'+id).style.display = mode==='kanban' ? 'grid' : 'none';
    document.getElementById('lt-'+id).style.display = mode==='lista' ? 'block' : 'none';
};

function enableDrag(sheet) {
    const sec = document.getElementById('view-equip-' + sheet.replace(/ /g,'_'));
    if (!sec) return;
    sec.querySelectorAll('.kcard').forEach(card => {
        card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.dataset.id); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    sec.querySelectorAll('.kanban-col').forEach(col => {
        col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drag-over'); });
        col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
        col.addEventListener('drop', e => {
            e.preventDefault(); col.classList.remove('drag-over');
            const id = e.dataTransfer.getData('text/plain');
            const it = dbData[sheet]?.find(i => i.id === id);
            if (it && it.status !== col.dataset.status) {
                pushUndo(`Status alterado: "${it.acao}" → ${col.dataset.status}`);
                it.status = col.dataset.status;
                saveData(); buildEquipView(sheet);
            }
        });
    });
}

window.updateField = function (sheet, id, field, value) {
    const it = dbData[sheet]?.find(i => i.id === id);
    if (!it || it[field] === value) return;
    pushUndo(`Alteração em "${it.acao}"`);
    it[field] = value;
    if (field === 'execucao') it.disciplina = getDisciplina(value);
    saveData();
    buildEquipView(sheet);
};
window.deleteAction = function (sheet, id) {
    const it = dbData[sheet]?.find(i => i.id === id);
    if (!it) return;
    if (!confirm(`Excluir o plano "${it.acao}"?`)) return;
    pushUndo(`Plano excluído: "${it.acao}"`);
    dbData[sheet] = dbData[sheet].filter(i => i.id !== id);
    if (imgFlags[id]) delete imgFlags[id];
    saveData(); buildEquipView(sheet);
};
window.openAddModal = function (sheet) {
    const picker = document.getElementById('conjunto-picker');
    const sel = document.getElementById('novaConjuntoSel');
    if (sheet) {
        if (picker) picker.style.display = 'none';
        if (sel) sel.value = '';
        document.getElementById('novaConjunto').value = sheet;
        document.getElementById('modalConjuntoLabel').textContent = 'Novo Plano — ' + sheet;
    } else {
        if (picker) picker.style.display = 'block';
        if (sel) sel.innerHTML = Object.keys(dbData).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
        document.getElementById('novaConjunto').value = '';
        document.getElementById('modalConjuntoLabel').textContent = 'Novo Plano de Ação';
    }
    ['novaAcao','novoDetalhe','novoLev','novoExec','novoPrazo'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('novoPrioridade').value = 'Média';
    document.getElementById('addModal').classList.add('open');
};
window.saveNewAction = function () {
    const selEl = document.getElementById('novaConjuntoSel');
    if (selEl && selEl.value) document.getElementById('novaConjunto').value = selEl.value;
    const sheet = document.getElementById('novaConjunto').value;
    const acao = document.getElementById('novaAcao').value.trim();
    if (!acao) { alert('A Ação Necessária é obrigatória.'); return; }
    if (!sheet || !dbData[sheet]) { alert('Selecione um equipamento válido.'); return; }
    const execucao = document.getElementById('novoExec').value.trim() || 'Não Definido';
    const prazo = document.getElementById('novoPrazo').value || '';
    pushUndo(`Novo plano criado: "${acao}"`);
    dbData[sheet].push({
        id: sheet.replace(/ /g,'') + '_' + Date.now(),
        acao,
        detalhamento: document.getElementById('novoDetalhe').value.trim(),
        levantamento: document.getElementById('novoLev').value.trim(),
        execucao,
        disciplina: getDisciplina(execucao),
        prioridade: document.getElementById('novoPrioridade').value,
        prazo,
        previsao: prazo ? fmtPrazo(prazo) : 'A DECIDIR',
        status: 'Pendente'
    });
    closeModal('addModal'); saveData();
    if (currentView !== 'menu' && currentView !== 'dashboard') buildEquipView(sheet);
};
window.closeModal = (id) => document.getElementById(id).classList.remove('open');

window.openImageModal = async function (sheet, id) {
    document.getElementById('imageSheetRef').value = sheet;
    document.getElementById('imageIdRef').value = id;
    document.getElementById('imageInput').value = '';
    await renderSlot('antes', id);
    await renderSlot('depois', id);
    const flags = imgFlags[id] || {};
    document.getElementById('compareZone').style.display = (flags.antes && flags.depois) ? 'block' : 'none';
    document.getElementById('imageModal').classList.add('open');
};
async function renderSlot(slot, id) {
    const body = document.getElementById(slot === 'antes' ? 'slotBefore' : 'slotAfter');
    const flags = imgFlags[id] || {};
    if (!flags[slot]) { body.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Sem foto</span>'; return; }
    try {
        const docId = slot === 'antes' ? await resolveBeforeDocId(id) : id + '__depois';
        const s = await getDoc(doc(db, 'pcm_images', docId));
        if (s.exists() && s.data().data) {
            body.innerHTML = `<img src="${s.data().data}" onclick="openLightbox(this.src)" alt="${slot}"><button class="btn-slot-del" onclick="removeImageSlot('${slot}')" title="Excluir foto">✕</button>`;
        } else body.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Sem foto</span>';
    } catch { body.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Sem foto</span>'; }
}
async function resolveBeforeDocId(id) {
    try {
        const sfx = await getDoc(doc(db, 'pcm_images', id + '__antes'));
        if (sfx.exists()) return id + '__antes';
        return id;
    } catch { return id + '__antes'; }
}
window.processImageUpload = async function () {
    const file = document.getElementById('imageInput').files[0];
    const slot = document.getElementById('uploadSlot').value;
    const sheet = document.getElementById('imageSheetRef').value;
    const id = document.getElementById('imageIdRef').value;
    if (!file) { alert('Selecione uma foto.'); return; }
    if (file.size > 5*1024*1024) { alert('Foto muito grande (máx. 5MB).'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = async () => {
            const MAX = 800; let w = img.width, h = img.height;
            if (w > h && w > MAX) { h = h * MAX/w; w = MAX; }
            else if (h > MAX) { w = w * MAX/h; h = MAX; }
            const cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            cv.getContext('2d').drawImage(img, 0, 0, w, h);
            try {
                await setDoc(doc(db, 'pcm_images', id + '__' + slot), { data: cv.toDataURL('image/jpeg', .6), conjunto: sheet, tipo: slot, atualizadoEm: Date.now() });
                imgFlags[id] = imgFlags[id] || {};
                imgFlags[id][slot] = true;
                await saveData();
                closeModal('imageModal');
                window.openImageModal(sheet, id);
            } catch { alert('Erro ao gravar a foto na nuvem.'); }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};
window.removeImageSlot = async function (slot) {
    const id = document.getElementById('imageIdRef').value;
    const sheet = document.getElementById('imageSheetRef').value;
    if (!confirm('Excluir esta foto?')) return;
    try { await setDoc(doc(db, 'pcm_images', id + '__' + slot), { data: '' }); } catch {}
    if (imgFlags[id]) delete imgFlags[id][slot];
    await saveData();
    window.openImageModal(sheet, id);
};

let zScale = 1, zPan = { x:0, y:0 }, dragging = null;
window.openLightbox = (src) => {
    document.getElementById('lbImg').src = src;
    zoomReset();
    document.getElementById('lightbox').classList.add('open');
};
window.closeLightbox = () => document.getElementById('lightbox').classList.remove('open');
window.zoomReset = () => { zScale = 1; zPan = {x:0,y:0}; applyZoom(); };
window.zoomSet = (d) => { zScale = Math.min(5, Math.max(.5, zScale + d)); applyZoom(); };
function applyZoom() {
    const img = document.getElementById('lbImg');
    if (img) img.style.transform = `scale(${zScale}) translate(${zPan.x}px, ${zPan.y}px)`;
}
const stage = document.getElementById('lbStage');
stage.addEventListener('wheel', e => { e.preventDefault(); zoomSet(e.deltaY < 0 ? .3 : -.3); }, { passive:false });
stage.addEventListener('mousedown', e => { dragging = { x:e.clientX - zPan.x, y:e.clientY - zPan.y }; stage.style.cursor = 'grabbing'; });
window.addEventListener('mousemove', e => {
    if (!dragging) return;
    zPan = { x:e.clientX - dragging.x, y:e.clientY - dragging.y };
    applyZoom();
});
window.addEventListener('mouseup', () => { dragging = null; if (stage) stage.style.cursor = 'grab'; });

window.openCompare = async function () {
    const id = document.getElementById('imageIdRef').value;
    const beforeDoc = await getDoc(doc(db, 'pcm_images', await resolveBeforeDocId(id)));
    const afterDoc = await getDoc(doc(db, 'pcm_images', id + '__depois'));
    if (!beforeDoc.exists() || !beforeDoc.data().data || !afterDoc.exists() || !afterDoc.data().data) {
        alert('São necessárias as duas fotos (ANTES e DEPOIS) para comparar.');
        return;
    }
    document.getElementById('cmpBefore').src = beforeDoc.data().data;
    document.getElementById('cmpAfter').src = afterDoc.data().data;
    document.getElementById('cmpRange').value = 50;
    moveCompare(50);
    document.getElementById('compareOverlay').classList.add('open');
};
window.moveCompare = (v) => { document.getElementById('cmpBeforeWrap').style.width = v + '%'; };
window.closeCompare = () => document.getElementById('compareOverlay').classList.remove('open');

window.exportCSV = function () {
    const rows = [["Conjunto","Ação","Detalhamento","Levantamento","Executor","Especialidade","Prioridade","Previsão","Status","Fotos"]];
    for (const [sheet, items] of Object.entries(dbData)) {
        items.forEach(it => {
            const f = imgFlags[it.id] || {};
            rows.push([sheet, it.acao||'', it.detalhamento||'', it.levantamento||'', it.execucao||'', getDisciplina(it.execucao), it.prioridade||'', it.prazo ? fmtPrazo(it.prazo) : 'A DECIDIR', it.status||'', [f.antes?'ANTES':null, f.depois?'DEPOIS':null].filter(Boolean).join('+') || 'NÃO']);
        });
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')).join('\r\n');
    const blob = new Blob(["\uFEFF" + csv], { type:'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Relatorio_SERAC1.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
};

function fillExecList() {
    const set = new Set();
    Object.values(dbData).forEach(items => items.forEach(it => it.execucao && set.add(it.execucao)));
    const el = document.getElementById('execList');
    if (el) el.innerHTML = [...set].map(e => `<option value="${esc(e)}">`).join('');
}

window.onload = initApp;