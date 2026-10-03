// app.js — Demandas PCM · Cepêra | sincronizado 1:1 com o index.html em produção
/* Camada de dados: localStorage + Firestore (compat) nas coleções dm_*
   Autenticação anônima obrigatória (regras do Firestore exigem request.auth) */

/* ================= 1. UTILITÁRIOS ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = t => (t ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
// toISOString() é UTC — entre 00h e 03h (Brasil) retornava "ontem". Fix com hora local:
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtData = d => { if (!d) return '—'; const [a, m, dia] = d.slice(0, 10).split('-'); return `${dia}/${m}/${a}`; };

function toast(msg, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
function abrirModal(titulo, corpoHTML, acoesHTML = '') {
  $('#modalTitulo').textContent = titulo;
  $('#modalCorpo').innerHTML = corpoHTML;
  $('#modalAcoes').innerHTML = acoesHTML;
  $('#modal').classList.add('aberto');
}
function fecharModal() { $('#modal').classList.remove('aberto'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
function confirmarModal(titulo, msg, aoConfirmar, rotulo = 'Confirmar') {
  window._cbConfirmar = aoConfirmar;
  abrirModal(titulo, `<p style="font-size:.9rem">${msg}</p>`,
    `<button onclick="fecharModal()">Cancelar</button>
     <button class="primario" onclick="fecharModal();window._cbConfirmar()">${rotulo}</button>`);
}

/* ================= 2. ESTADO E PADRÕES ================= */
const CORES = { vermelho:'#ef4444', laranja:'#f97316', amarelo:'#eab308', verde:'#22c55e', azul:'#3b82f6', cinza:'#94a3b8' };
const OPCOES_PADRAO = {
  status: [
    { nome:'Aberta', cor:'azul' }, { nome:'Em Execução', cor:'laranja' },
    { nome:'Aguardando Peça', cor:'amarelo' }, { nome:'Concluída', cor:'verde' },
    { nome:'Cancelada', cor:'cinza' }
  ],
  prioridade: [
    { nome:'Urgente', cor:'vermelho' }, { nome:'Alta', cor:'laranja' },
    { nome:'Média', cor:'amarelo' }, { nome:'Baixa', cor:'verde' }
  ]
};
const CHAVES = { demandas:'pcm_demandas', responsaveis:'pcm_responsaveis', setores:'pcm_setores', opcoes:'pcm_opcoes' };
const PRIOR_ORDEM = { 'Urgente':0, 'Alta':1, 'Média':2, 'Baixa':3 };
let demandas = [], responsaveis = [], setores = [];
let opcoes = JSON.parse(JSON.stringify(OPCOES_PADRAO));
let modoFirebase = false;
let editandoId = null, anexosPendentes = [];
let consultaModo = 'resp', consultaAberto = {};
let filaSync = [];
const achar = id => demandas.find(d => d.id === id);
const isConcluida = d => d.status === 'Concluída';
const isCancelada = d => d.status === 'Cancelada';
const isPendente = d => !isConcluida(d) && !isCancelada(d);
const estaAtrasada = d => isPendente(d) && d.prazo && d.prazo < hojeISO();

/* ================= 3. CAMADA DE DADOS ================= */
// Coleções EXCLUSIVAS deste sub-app: dm_demandas, dm_responsaveis, dm_setores, dm_opcoes
const colName = c => (window.FB_COLS && FB_COLS[c]) || c;
function salvarLocal(col) {
  const dado = col === 'opcoes' ? opcoes
    : col === 'demandas' ? demandas
    : col === 'responsaveis' ? responsaveis : setores;
  try { localStorage.setItem(CHAVES[col], JSON.stringify(dado)); } catch (e) {
    toast('Armazenamento local cheio — remova anexos antigos', 'erro');
  }
}
function lerLocal(col) {
  try { return JSON.parse(localStorage.getItem(CHAVES[col])); } catch (e) { return null; }
}
const semId = o => { const c = { ...o }; delete c.id; return c; };
// Batch do Firestore limita a 500 operações — fatiado em lotes de 400
async function salvarColecao(col, lista) {
  salvarLocal(col);
  if (!modoFirebase || !window.db) return;
  try {
    const ref = window.db.collection(colName(col));
    if (col === 'opcoes') { await ref.doc('config').set(opcoes); return; }
    const snap = await ref.get();
    const ids = new Set(lista.map(x => x.id));
    const remover = snap.docs.filter(d => !ids.has(d.id)).map(d => d.ref);
    const alvo = lista.map(x => ({ ref: ref.doc(x.id), dado: semId(x) }))
      .concat(remover.map(r => ({ ref: r, dado: null })));
    for (let i = 0; i < alvo.length; i += 400) {
      const batch = window.db.batch();
      alvo.slice(i, i + 400).forEach(({ ref, dado }) => dado ? batch.set(ref, dado) : batch.delete(ref));
      await batch.commit();
    }
  } catch (e) {
    console.error(e);
    if (!filaSync.includes(col)) filaSync.push(col);
    toast('Falha ao sincronizar com o Firebase — dados salvos localmente', 'aviso');
  }
}
// Fila de sincronização: reenvia coleções pendentes
setInterval(() => {
  if (modoFirebase && filaSync.length) {
    const cols = [...new Set(filaSync)]; filaSync = [];
    cols.forEach(c => salvarColecao(c, c === 'demandas' ? demandas : c === 'responsaveis' ? responsaveis : c === 'setores' ? setores : opcoes));
  }
}, 15000);
function setIndicador(estado) {
  const el = $('#indConexao'); if (!el) return;
  if (estado === 'ok') el.textContent = '🟢 Firebase conectado • Sincronização em tempo real';
  else if (estado === 'local') el.textContent = '🟡 Modo local (localStorage)';
  else el.textContent = '🔴 Reconectando...';
}
function ouvir(col) {
  window.db.collection(colName(col)).onSnapshot(snap => {
    if (col === 'opcoes') {
      const o = snap.docs.map(d => d.data())[0];
      if (o && o.status && o.status.length) opcoes = o;
    } else {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const local = col === 'demandas' ? demandas : col === 'responsaveis' ? responsaveis : setores;
      // Migração: nuvem vazia + dados locais existentes → sobe o local pra nuvem
      if (!snap.empty || !local.length) {
        if (col === 'demandas') demandas = lista;
        else if (col === 'responsaveis') responsaveis = lista;
        else setores = lista;
      } else salvarColecao(col, local);
    }
    salvarLocal(col);
    modoFirebase = true;
    setIndicador('ok');
    renderTudo();
  }, err => {
    console.error(err);
    modoFirebase = false;
    setIndicador('erro');
  });
}
function initDados() {
  demandas = lerLocal('demandas') || [];
  responsaveis = lerLocal('responsaveis') || [];
  setores = lerLocal('setores') || [];
  const op = lerLocal('opcoes');
  if (op && op.status && op.status.length) opcoes = op;
  if (window.firebaseAtivo) {
    setIndicador('erro');
    // Regras do Firestore exigem request.auth — sem sign-in a nuvem nega leitura/escrita
    firebase.auth().signInAnonymously()
      .then(() => ['demandas', 'responsaveis', 'setores', 'opcoes'].forEach(ouvir))
      .catch(err => {
        console.error(err);
        modoFirebase = false;
        setIndicador('local');
        toast('Firebase indisponível — operando em modo local', 'aviso');
      });
  } else {
    setIndicador('local');
  }
  renderTudo();
}

/* ================= 4. TEMA ================= */
function aplicarTema(t) {
  document.body.classList.toggle('claro', t === 'claro');
  const b = $('#btnTema'); if (b) b.textContent = t === 'claro' ? '🌙' : '☀️';
  localStorage.setItem('pcm_tema', t);
}
function alternarTema() {
  aplicarTema(document.body.classList.contains('claro') ? 'escuro' : 'claro');
}

/* ================= 5. NAVEGAÇÃO ================= */
function trocarAba(nome) {
  $$('.aba').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
  $$('.tab').forEach(t => t.classList.toggle('ativa', t.id === 'tab-' + nome));
  if (nome === 'graficos') renderGraficos();
  if (nome === 'consulta') renderConsulta();
}

/* ================= 6. HELPERS DE OPÇÕES ================= */
const corOpt = (nome, tipo) => {
  const o = (opcoes[tipo] || []).find(x => x.nome === nome);
  return CORES[o ? o.cor : 'cinza'];
};
const badge = (tipo, nome) => {
  const c = corOpt(nome, tipo);
  return `<span class="badge" style="background:${c}22;color:${c};border:1px solid ${c}66">${esc(nome)}</span>`;
};
function selectOpcoes(tipo, atual, onchange) {
  const opts = (opcoes[tipo] || []).map(o =>
    `<option ${o.nome === atual ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
  return `<select onchange="${onchange}">${opts}</select>`;
}
function selectOpcoesHTML(tipo, vazio) {
  return (vazio ? '<option value="">Todos</option>' : '') +
    (opcoes[tipo] || []).map(o => `<option>${esc(o.nome)}</option>`).join('');
}
const respOptionsHTML = vazio => (vazio ? '<option value="">Todos</option>' : '<option value="">— Selecione —</option>') +
  responsaveis.map(r => `<option value="${esc(r.nome)}">${esc(r.nome)}</option>`).join('');
const setorOptionsHTML = vazio => (vazio ? '<option value="">Todos</option>' : '<option value="">— Selecione —</option>') +
  setores.map(s => `<option value="${esc(s.nome)}">${esc(s.nome)}</option>`).join('');

/* ================= 7. FILTROS ================= */
const filtros = { busca:'', status:'', prior:'', resp:'', setor:'', prazo:'', anexos:'', ordenar:'prazo', de:'', ate:'' };
const MAPA_FILTROS = { fBusca:'busca', fStatus:'status', fPrior:'prior', fResp:'resp', fSetor:'setor', fPrazo:'prazo', fAnexos:'anexos', fOrdenar:'ordenar', fDe:'de', fAte:'ate' };
function bindFiltros() {
  Object.entries(MAPA_FILTROS).forEach(([id, chave]) => {
    const el = $('#' + id); if (!el) return;
    el.addEventListener('input', () => { filtros[chave] = el.value; renderDemandas(); });
    el.addEventListener('change', () => { filtros[chave] = el.value; renderDemandas(); });
  });
}
function resetFiltros() {
  Object.assign(filtros, { busca:'', status:'', prior:'', resp:'', setor:'', prazo:'', anexos:'', ordenar:'prazo', de:'', ate:'' });
  Object.entries(MAPA_FILTROS).forEach(([id, k]) => { const el = $('#' + id); if (el) el.value = filtros[k]; });
  renderDemandas();
}
function limparDatas() {
  filtros.de = ''; filtros.ate = '';
  $('#fDe').value = ''; $('#fAte').value = '';
  renderDemandas();
}
function renderFiltros() {
  const pop = (id, html, val) => { const el = $('#' + id); if (!el) return; el.innerHTML = html; el.value = val || ''; };
  pop('fStatus', selectOpcoesHTML('status', true), filtros.status);
  pop('fPrior', selectOpcoesHTML('prioridade', true), filtros.prior);
  pop('fResp', respOptionsHTML(true), filtros.resp);
  pop('fSetor', setorOptionsHTML(true), filtros.setor);
}
function demandasFiltradas() {
  const t = filtros.busca.toLowerCase().trim();
  const lista = demandas.filter(d => {
    if (t && !((d.titulo || '') + ' ' + (d.descricao || '')).toLowerCase().includes(t)) return false;
    if (filtros.status && d.status !== filtros.status) return false;
    if (filtros.prior && d.prior !== filtros.prior) return false;
    if (filtros.resp && d.resp !== filtros.resp) return false;
    if (filtros.setor && d.setor !== filtros.setor) return false;
    if (filtros.prazo === 'atrasadas' && !estaAtrasada(d)) return false;
    if (filtros.prazo === 'hoje' && d.prazo !== hojeISO()) return false;
    if (filtros.prazo === 'semana') {
      if (!d.prazo) return false;
      const dias = (new Date(d.prazo + 'T12:00:00') - new Date(hojeISO() + 'T12:00:00')) / 86400000;
      if (dias < 0 || dias > 7) return false;
    }
    if (filtros.prazo === 'prazo' && (!d.prazo || d.prazo < hojeISO())) return false;
    const temAnex = d.anexos && d.anexos.length;
    if (filtros.anexos === 'com' && !temAnex) return false;
    if (filtros.anexos === 'sem' && temAnex) return false;
    if (filtros.de && d.prazo && d.prazo < filtros.de) return false;
    if (filtros.ate && d.prazo && d.prazo > filtros.ate) return false;
    return true;
  });
  const ord = {
    prazo: (a, b) => (a.prazo || '9999') < (b.prazo || '9999') ? -1 : 1,
    prioridade: (a, b) => (PRIOR_ORDEM[a.prior] ?? 9) - (PRIOR_ORDEM[b.prior] ?? 9),
    recente: (a, b) => (b.criadaEm || '').localeCompare(a.criadaEm || ''),
    titulo: (a, b) => (a.titulo || '').localeCompare(b.titulo || '')
  };
  lista.sort(ord[filtros.ordenar] || ord.prazo);
  return lista;
}

/* ================= 8. KPIs / RENDER GERAL ================= */
function renderTudo() {
  renderFiltros();
  renderKPIs();
  renderDemandas();
  renderCadastros();
  renderOpcoes();
  if ($('#tab-consulta').classList.contains('ativa')) renderConsulta();
  if ($('#tab-graficos').classList.contains('ativa')) renderGraficos();
  atualizarEspaco();
}
function renderKPIs() {
  const mes = hojeISO().slice(0, 7);
  $('#kpiAtivas').textContent = demandas.filter(isPendente).length;
  $('#kpiExec').textContent = demandas.filter(d => d.status === 'Em Execução').length;
  $('#kpiAtras').textContent = demandas.filter(estaAtrasada).length;
  $('#kpiMes').textContent = demandas.filter(d => isConcluida(d) && (d.concluidaEm || '').slice(0, 7) === mes).length;
  const ab = $('#abTotal'); if (ab) ab.textContent = demandas.filter(isPendente).length;
  const ab2 = $('#abTotal2'); if (ab2) ab2.textContent = demandas.length;
}

/* ================= 9. ABA DEMANDAS — LISTA ================= */
function renderDemandas() {
  const wrap = $('#listaDemandas'); if (!wrap) return;
  const lista = demandasFiltradas();
  if (!lista.length) {
    wrap.innerHTML = `<div class="vazio"><h3>Nenhuma demanda encontrada</h3>
      <p>Ajuste os filtros ou cadastre uma nova demanda de manutenção.</p></div>`;
  } else {
    wrap.innerHTML = lista.map(d => {
      const atras = estaAtrasada(d);
      const anexos = (d.anexos || []).map(a =>
        `<span class="anexo-chip"><a href="${a.dado}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">📎 ${esc(a.nome)}</a></span>`).join('');
      return `<div class="demanda" style="border-left-color:${corOpt(d.status, 'status')}">
        <div class="demanda-topo">
          <h4>${esc(d.titulo)}</h4>
          <div>${badge('status', d.status)} ${badge('prioridade', d.prior)}</div>
        </div>
        <div class="demanda-meta">
          <span>👤 ${esc(d.resp || '—')}</span>
          <span>🏭 ${esc(d.setor || '—')}</span>
          <span>📅 Criada: ${fmtData(d.criadaEm)}</span>
          <span class="${atras ? 'prazo-atrasado' : ''}">⏰ Prazo: ${fmtData(d.prazo)}${atras ? ' • ATRASADA' : ''}</span>
        </div>
        ${d.descricao ? `<div class="demanda-desc">${esc(d.descricao)}</div>` : ''}
        ${anexos ? `<div>${anexos}</div>` : ''}
        <div class="demanda-acoes">
          <span class="rotulo">Status:</span>${selectOpcoes('status', d.status, `mudarStatus('${d.id}', this.value)`)}
          <span class="rotulo">Prior:</span>${selectOpcoes('prioridade', d.prior, `mudarPrior('${d.id}', this.value)`)}
          <button onclick="editarDemanda('${d.id}')">📝 Editar</button>
          <button onclick="verHistorico('${d.id}')">🕘 Histórico</button>
          <button onclick="excluirDemanda('${d.id}')">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }
  const cont = $('#fContador'); if (cont) cont.textContent = `Exibindo ${lista.length} de ${demandas.length} demanda(s)`;
  $('#rkTotal').textContent = demandas.length;
  $('#rkAtras').textContent = demandas.filter(estaAtrasada).length;
  $('#rkAndam').textContent = demandas.filter(d => d.status === 'Em Execução').length;
  $('#rkConcl').textContent = demandas.filter(isConcluida).length;
}
function mudarStatus(id, valor) {
  const d = achar(id); if (!d) return;
  d.status = valor;
  if (valor === 'Concluída') d.concluidaEm = hojeISO();
  else delete d.concluidaEm;
  registrarHist(d, `Status alterado para "${valor}"`);
  salvarColecao('demandas', demandas); renderTudo();
  toast(`Status atualizado: ${valor}`);
}
function mudarPrior(id, valor) {
  const d = achar(id); if (!d) return;
  d.prior = valor;
  registrarHist(d, `Prioridade alterada para "${valor}"`);
  salvarColecao('demandas', demandas); renderTudo();
}
function registrarHist(d, texto) {
  d.historico = d.historico || [];
  d.historico.push({ data: hojeISO(), texto });
  d.atualizadaEm = hojeISO();
}
function excluirDemanda(id) {
  confirmarModal('Excluir Demanda', 'Esta ação não pode ser desfeita. Confirmar exclusão?', () => {
    demandas = demandas.filter(d => d.id !== id);
    salvarColecao('demandas', demandas); renderTudo();
    toast('Demanda excluída', 'aviso');
  }, 'Excluir');
}

/* ================= 10. MODAL DEMANDA / ANEXOS / HISTÓRICO ================= */
function abrirMDemanda(id = null) {
  editandoId = id;
  const d = id ? achar(id) : null;
  anexosPendentes = d ? [...(d.anexos || [])] : [];
  $('#mdTitulo').textContent = d ? 'Editar Demanda' : 'Nova Demanda de Manutenção';
  $('#dTitulo').value = d?.titulo || '';
  $('#dDesc').value = d?.descricao || '';
  $('#dPrazo').value = d?.prazo || '';
  $('#dResp').innerHTML = respOptionsHTML(false);
  $('#dResp').value = d?.resp || '';
  $('#dSetor').innerHTML = setorOptionsHTML(false);
  $('#dSetor').value = d?.setor || '';
  $('#dStatus').innerHTML = (opcoes.status || []).map(o => `<option ${o.nome === (d?.status || 'Aberta') ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
  $('#dPrior').innerHTML = (opcoes.prioridade || []).map(o => `<option ${o.nome === (d?.prior || 'Média') ? 'selected' : ''}>${esc(o.nome)}</option>`).join('');
  renderAnexosPendentes();
  $('#mDemanda').classList.add('aberto');
}
function editarDemanda(id) { abrirMDemanda(id); }
function fecharMDemanda() { $('#mDemanda').classList.remove('aberto'); }
function salvarDemanda() {
  const titulo = $('#dTitulo').value.trim();
  if (!titulo) { toast('Informe o título da demanda', 'erro'); return; }
  const resp = $('#dResp').value, setor = $('#dSetor').value;
  let d = editandoId ? achar(editandoId) : null;
  const novo = !d;
  if (novo) {
    d = { id: uid(), criadaEm: hojeISO(), anexos: [], historico: [] };
    demandas.push(d);
  }
  const mudouResp = d.resp !== resp && !!resp;
  Object.assign(d, {
    titulo, descricao: $('#dDesc').value.trim(), resp, setor,
    status: $('#dStatus').value, prior: $('#dPrior').value, prazo: $('#dPrazo').value,
    anexos: anexosPendentes, atualizadaEm: hojeISO()
  });
  if (d.status === 'Concluída' && !d.concluidaEm) d.concluidaEm = hojeISO();
  if (d.status !== 'Concluída') delete d.concluidaEm;
  registrarHist(d, novo ? 'Demanda criada' : 'Demanda editada');
  if (mudouResp) registrarHist(d, `Responsável definido: ${resp}`);
  salvarColecao('demandas', demandas);
  fecharMDemanda(); renderTudo();
  toast(novo ? 'Demanda criada com sucesso' : 'Demanda atualizada');
}
function notificarDoForm() {
  const r = responsaveis.find(x => x.nome === $('#dResp').value);
  if (!r || !r.email) { toast('Responsável sem e-mail cadastrado', 'aviso'); return; }
  const corpo = `Demanda: ${$('#dTitulo').value}\nPrioridade: ${$('#dPrior').value}\nPrazo: ${fmtData($('#dPrazo').value)}\nSetor: ${$('#dSetor').value}\n\n${$('#dDesc').value}`;
  window.location.href = `mailto:${r.email}?subject=${encodeURIComponent('[PCM] ' + $('#dTitulo').value)}&body=${encodeURIComponent(corpo)}`;
}
/* --- Anexos (limite pensado p/ doc Firestore de 1 MB: base64 infla 4/3) --- */
const MAX_ANEXO = 600 * 1024;
const MAX_TOTAL = 900 * 1024;
function bindDropzone() {
  const dz = $('#dropZone'), inp = $('#dArquivos');
  if (!dz || !inp) return;
  dz.onclick = e => { if (e.target === inp) return; inp.click(); }; // guarda anti-loop (input está dentro do dropzone)
  inp.onchange = () => { [...inp.files].forEach(addAnexoFile); inp.value = ''; };
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('sobre'); };
  dz.ondragleave = () => dz.classList.remove('sobre');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('sobre'); [...e.dataTransfer.files].forEach(addAnexoFile); };
}
document.addEventListener('paste', e => {
  if (!$('#mDemanda').classList.contains('aberto')) return;
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) { addAnexoFile(item.getAsFile()); break; }
  }
});
function totalAnexosKB() { return anexosPendentes.reduce((s, a) => s + Math.ceil((a.dado || '').length * 0.75 / 1024), 0); }
function addAnexoFile(file) {
  if (!file) return;
  if (file.size > MAX_ANEXO) { toast(`"${file.name}" excede 600 KB — não anexado`, 'erro'); return; }
  const fr = new FileReader();
  fr.onload = () => {
    anexosPendentes.push({ nome: file.name, tipo: file.type, dado: fr.result });
    renderAnexosPendentes();
    if (totalAnexosKB() > MAX_TOTAL / 1024) toast('Total de anexos grande — pode não sincronizar na nuvem', 'aviso');
  };
  fr.readAsDataURL(file);
}
function removerAnexoPendente(i) { anexosPendentes.splice(i, 1); renderAnexosPendentes(); }
function renderAnexosPendentes() {
  const el = $('#dListaAnexos'); if (!el) return;
  el.innerHTML = anexosPendentes.map((a, i) =>
    `<span class="anexo-chip">📎 ${esc(a.nome)}<button onclick="removerAnexoPendente(${i})">✖</button></span>`).join('');
}
function verHistorico(id) {
  const d = achar(id); if (!d) return;
  const evs = [...(d.historico || [])].reverse().map(h =>
    `<div class="evento"><div>${esc(h.texto)}</div><div class="data-ev">${fmtData(h.data)}</div></div>`).join('');
  abrirModal(`Histórico — ${d.titulo}`, evs ? `<div class="linha-tempo">${evs}</div>` : '<p class="sub">Nenhum evento registrado.</p>',
    `<button class="primario" onclick="fecharModal()">Fechar</button>`);
}

/* ================= 11. ABA CONSULTA ================= */
function setModoConsulta(m) { consultaModo = m; renderConsulta(); }
function expandirTodos(abrir) {
  if (abrir) {
    demandas.forEach(d => {
      const k = consultaModo === 'resp' ? (d.resp || '— Sem responsável —') : (d.setor || '— Sem setor —');
      consultaAberto[k] = true;
    });
  } else consultaAberto = {};
  renderConsulta();
}
function toggleConsulta(k) { consultaAberto[k] = !consultaAberto[k]; renderConsulta(); }
function renderConsulta() {
  const mr = $('#cModoResp'), ms = $('#cModoSetor');
  if (!mr || !ms) return;
  mr.classList.toggle('ativo', consultaModo === 'resp');
  ms.classList.toggle('ativo', consultaModo === 'setor');
  const alvoEl = $('#cAlvo');
  const fonte = consultaModo === 'resp' ? responsaveis : setores;
  const atualSel = alvoEl.value || '';
  alvoEl.innerHTML = '<option value="">Todos</option>' +
    fonte.map(x => `<option value="${esc(x.nome)}" ${x.nome === atualSel ? 'selected' : ''}>${esc(x.nome)}</option>`).join('');
  const alvo = alvoEl.value || '';
  const busca = ($('#cBusca').value || '').toLowerCase().trim();
  const base = demandas.filter(d => {
    if (alvo && (consultaModo === 'resp' ? d.resp : d.setor) !== alvo) return false;
    if (busca && !((d.titulo || '') + ' ' + (d.descricao || '')).toLowerCase().includes(busca)) return false;
    return true;
  });
  const grupos = {};
  base.forEach(d => {
    const chave = consultaModo === 'resp' ? (d.resp || '— Sem responsável —') : (d.setor || '— Sem setor —');
    (grupos[chave] = grupos[chave] || []).push(d);
  });
  const chaves = Object.keys(grupos).sort((a, b) => a.localeCompare(b));
  $('#consultaLista').innerHTML = chaves.map(k => {
    const lista = grupos[k];
    const pend = lista.filter(isPendente).length, atras = lista.filter(estaAtrasada).length, conc = lista.filter(isConcluida).length;
    const aberto = consultaAberto[k];
    const itens = lista.map(d => `<div class="mini-demanda">
      <div class="mini-topo"><b>${esc(d.titulo)}</b>${badge('status', d.status)}</div>
      <div class="mini-meta"><span>${badge('prioridade', d.prior)}</span>
      <span>👤 ${esc(d.resp || '—')}</span><span>⏰ ${fmtData(d.prazo)}${estaAtrasada(d) ? ' • atrasada' : ''}</span></div>
    </div>`).join('');
    return `<div class="bloco-consulta">
      <div class="bc-cab" onclick="toggleConsulta(this.dataset.k)" data-k="${esc(k)}">
        <b>${esc(k)}</b>
        <div class="bc-kpis"><span>Total: <b>${lista.length}</b></span><span>Pendentes: <b>${pend}</b></span>
        <span>Atrasadas: <b>${atras}</b></span><span>Concluídas: <b>${conc}</b></span><span>${aberto ? '▲' : '▼'}</span></div>
      </div>
      ${aberto ? `<div class="bc-corpo">${itens}</div>` : ''}
    </div>`;
  }).join('') || '<div class="vazio"><h3>Sem demandas para agrupar</h3></div>';
}

/* ================= 12. ABA GRÁFICOS ================= */
function barraRow(rotulo, val, max, cor) {
  const pct = max ? Math.round(val / max * 100) : 0;
  return `<div class="barra-linha"><span>${esc(rotulo)}</span>
    <div class="barra-fundo" title="${val}"><div class="barra" style="width:${pct}%;background:${cor}"></div></div>
    <span class="barra-valor">${val}</span></div>`;
}
function renderGraficos() {
  const ind = $('#gIndicadores'), wrap = $('#gContainer');
  if (!ind || !wrap) return;
  if (!demandas.length) {
    ind.innerHTML = '';
    wrap.innerHTML = '<div class="vazio"><h3>Sem dados para gráficos</h3></div>';
    return;
  }
  const total = demandas.length, pend = demandas.filter(isPendente).length,
    atras = demandas.filter(estaAtrasada).length, conc = demandas.filter(isConcluida).length;
  ind.innerHTML = `
    <div class="kpi"><span>${total}</span><small>Total de Demandas</small></div>
    <div class="kpi"><span>${pend}</span><small>Ativas</small></div>
    <div class="kpi atras"><span>${atras}</span><small>Atrasadas</small></div>
    <div class="kpi ok"><span>${total ? Math.round(conc / total * 100) : 0}%</span><small>Conclusão</small></div>`;
  const contar = chave => {
    const m = {};
    demandas.forEach(d => { const k = d[chave] || '—'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const bloco = (titulo, pares, cor) => {
    const max = Math.max(...pares.map(p => p[1]), 1);
    return `<div class="grafico-card"><h3>${titulo}</h3>${pares.map(([k, v]) => barraRow(k, v, max, cor)).join('')}</div>`;
  };
  // Por responsável: barra + overlay vermelho de atrasadas
  const porResp = contar('resp');
  const maxResp = Math.max(...porResp.map(p => p[1]), 1);
  const linhasResp = porResp.map(([k, v]) => {
    const atr = demandas.filter(d => (d.resp || '—') === k && estaAtrasada(d)).length;
    const pct = Math.round(v / maxResp * 100), pctA = Math.round(atr / maxResp * 100);
    return `<div class="barra-linha"><span>${esc(k)}</span>
      <div><div class="barra-fundo" title="${v}"><div class="barra" style="width:${pct}%;background:#3b82f6"></div></div>
      ${atr ? `<div class="barra-seg" style="width:${pctA}%"></div>` : ''}</div>
      <span class="barra-valor">${v}</span></div>`;
  }).join('');
  // Últimos 6 meses: criadas vs concluídas
  const meses = [];
  const base = new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(base.getFullYear(), base.getMonth() - i, 1);
    meses.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }
  const criadasMes = meses.map(m => demandas.filter(d => (d.criadaEm || '').startsWith(m)).length);
  const concMes = meses.map(m => demandas.filter(d => (d.concluidaEm || '').startsWith(m)).length);
  const maxMes = Math.max(...criadasMes, ...concMes, 1);
  const barrasMes = meses.map((m, i) => {
    const hC = Math.max(Math.round(criadasMes[i] / maxMes * 100), criadasMes[i] ? 6 : 2);
    const hK = Math.max(Math.round(concMes[i] / maxMes * 100), concMes[i] ? 6 : 2);
    const rot = m.slice(5) + '/' + m.slice(2, 4);
    return `<div class="grupo-mes" title="${rot}: ${criadasMes[i]} criadas, ${concMes[i]} concluídas">
      <div class="col-mes" style="height:${hK}%;background:#22c55e">${concMes[i] || ''}</div>
      <div class="col-mes" style="height:${hC}%;background:#3b82f6">${criadasMes[i] || ''}</div>
    </div>`;
  }).join('');
  wrap.innerHTML = `
    ${bloco('📊 Demandas por Status', contar('status'), '#3b82f6')}
    ${bloco('🔺 Demandas por Prioridade', contar('prior'), '#f97316')}
    <div class="grafico-card"><h3>👤 Demandas por Responsável <small style="color:var(--muted)">(vermelho = atrasadas)</small></h3>${linhasResp}</div>
    ${bloco('🏭 Demandas por Setor', contar('setor'), '#22c55e')}
    <div class="grafico-card"><h3>📅 Criadas vs Concluídas — últimos 6 meses</h3>
      <div class="barras-mes">${barrasMes}</div>
      <div class="legenda-mes">
        <span class="legenda-item"><span class="legenda-dot" style="background:#3b82f6"></span> Criadas</span>
        <span class="legenda-item"><span class="legenda-dot" style="background:#22c55e"></span> Concluídas</span>
      </div>
    </div>`;
}

/* ================= 13. ABA CADASTROS ================= */
function renderCadastros() {
  const cr = $('#cResp'); if (cr) cr.textContent = `(${responsaveis.length})`;
  const cs = $('#cSet'); if (cs) cs.textContent = `(${setores.length})`;
  $('#lResp').innerHTML = responsaveis.map((r, i) => `
    <div class="item-linha">
      <div><b>${esc(r.nome)}</b>${r.email ? `<div class="mini-meta"><span>✉️ ${esc(r.email)}</span></div>` : ''}</div>
      <button onclick="excluirResp(${i})">🗑️</button>
    </div>`).join('') || '<p class="sub">Nenhum responsável cadastrado.</p>';
  $('#lSetores').innerHTML = setores.map((s, i) => `
    <div class="item-linha"><b>${esc(s.nome)}</b>
      <button onclick="excluirSetor(${i})">🗑️</button></div>`).join('') || '<p class="sub">Nenhum setor cadastrado.</p>';
}
function addResp() {
  const nome = $('#rNome').value.trim();
  if (!nome) { toast('Informe o nome do responsável', 'erro'); return; }
  if (responsaveis.some(r => r.nome.toLowerCase() === nome.toLowerCase())) { toast('Responsável já cadastrado', 'aviso'); return; }
  responsaveis.push({ id: uid(), nome, email: $('#rEmail').value.trim() });
  $('#rNome').value = ''; $('#rEmail').value = '';
  salvarColecao('responsaveis', responsaveis); renderTudo();
  toast('Responsável cadastrado');
}
function excluirResp(i) {
  const r = responsaveis[i]; if (!r) return;
  confirmarModal('Excluir Responsável', `Remover "${r.nome}"? As demandas existentes mantêm o nome salvo.`, () => {
    responsaveis.splice(i, 1);
    salvarColecao('responsaveis', responsaveis); renderTudo();
    toast('Responsável removido', 'aviso');
  }, 'Excluir');
}
function addSetor() {
  const nome = $('#sNome').value.trim();
  if (!nome) { toast('Informe o nome do setor', 'erro'); return; }
  if (setores.some(s => s.nome.toLowerCase() === nome.toLowerCase())) { toast('Setor já cadastrado', 'aviso'); return; }
  setores.push({ id: uid(), nome });
  $('#sNome').value = '';
  salvarColecao('setores', setores); renderTudo();
  toast('Setor cadastrado');
}
function excluirSetor(i) {
  const s = setores[i]; if (!s) return;
  confirmarModal('Excluir Setor', `Remover "${s.nome}"? As demandas existentes mantêm o nome salvo.`, () => {
    setores.splice(i, 1);
    salvarColecao('setores', setores); renderTudo();
    toast('Setor removido', 'aviso');
  }, 'Excluir');
}

/* ================= 14. OPÇÕES DE STATUS / PRIORIDADE ================= */
function renderOpcoes() {
  const st = $('#lOptStatus'), pr = $('#lOptPrioridade');
  if (!st || !pr) return;
  st.innerHTML = (opcoes.status || []).map((o, i) => `
    <div class="item-linha"><span>${badge('status', o.nome)}</span>
     <button onclick="excluirOpcao('status', ${i})">🗑️</button></div>`).join('');
  pr.innerHTML = (opcoes.prioridade || []).map((o, i) => `
    <div class="item-linha"><span>${badge('prioridade', o.nome)}</span>
     <button onclick="excluirOpcao('prioridade', ${i})">🗑️</button></div>`).join('');
  const cores = Object.keys(CORES);
  const optsCor = sel => cores.map(c => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
  const sc = $('#oStatusCor'), pc = $('#oPriorCor');
  if (sc) sc.innerHTML = optsCor('azul');
  if (pc) pc.innerHTML = optsCor('verde');
}
function addOpcao(tipo) {
  const inp = tipo === 'status' ? $('#oStatusNome') : $('#oPriorNome');
  const corSel = tipo === 'status' ? ($('#oStatusCor').value || 'azul') : ($('#oPriorCor').value || 'verde');
  const nome = inp.value.trim();
  if (!nome) { toast('Informe o nome da opção', 'erro'); return; }
  if (opcoes[tipo].some(o => o.nome.toLowerCase() === nome.toLowerCase())) { toast('Opção já existe', 'aviso'); return; }
  opcoes[tipo].push({ nome, cor: corSel });
  inp.value = '';
  salvarColecao('opcoes', opcoes); renderTudo();
  toast('Opção adicionada');
}
function excluirOpcao(tipo, i) {
  const o = (opcoes[tipo] || [])[i]; if (!o) return;
  const campo = tipo === 'status' ? 'status' : 'prior';
  if (demandas.some(d => d[campo] === o.nome)) {
    toast('Opção em uso por demandas — não pode ser removida', 'erro'); return;
  }
  opcoes[tipo].splice(i, 1);
  salvarColecao('opcoes', opcoes); renderTudo();
  toast('Opção removida', 'aviso');
}
function restaurarOpcoes() {
  confirmarModal('Restaurar Padrão', 'Voltar às opções padrão de status e prioridade?', () => {
    opcoes = JSON.parse(JSON.stringify(OPCOES_PADRAO));
    salvarColecao('opcoes', opcoes); renderTudo();
    toast('Padrões restaurados');
  });
}

/* ================= 15. NOTIFICAÇÕES ================= */
function notificarPendentes() {
  const pend = demandas.filter(isPendente);
  if (!pend.length) { toast('Nenhuma pendência ativa', 'aviso'); return; }
  const porResp = {};
  pend.forEach(d => { (porResp[d.resp || '—'] = porResp[d.resp || '—'] || []).push(d); });
  const semEmail = [];
  Object.entries(porResp).forEach(([nome, lista]) => {
    const r = responsaveis.find(x => x.nome === nome);
    if (!r || !r.email) { semEmail.push(nome); return; }
    const corpo = lista.map(d =>
      `• [${d.prior}] ${d.titulo} — prazo ${fmtData(d.prazo)}${estaAtrasada(d) ? ' (ATRASADA)' : ''}`).join('\n');
    window.location.href = `mailto:${r.email}?subject=${encodeURIComponent('[PCM] Pendências ativas (' + lista.length + ')')}&body=${encodeURIComponent(corpo)}`;
  });
  if (semEmail.length) toast(`Sem e-mail cadastrado: ${semEmail.join(', ')}`, 'aviso');
  else toast('E-mails gerados no cliente padrão');
}

/* ================= 16. EXPORTAR EXCEL / IMPRIMIR ================= */
function exportarExcel() {
  const cols = ['Título', 'Descrição', 'Responsável', 'Setor', 'Status', 'Prioridade', 'Prazo', 'Criada', 'Concluída'];
  const linha = d => [d.titulo, d.descricao, d.resp, d.setor, d.status, d.prior, d.prazo, d.criadaEm, d.concluidaEm];
  const csv = [cols, ...demandasFiltradas().map(linha)]
    .map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pcm_demandas_${hojeISO()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('Arquivo gerado — abre direto no Excel');
}

/* ================= 17. ESPAÇO LOCAL ================= */
function atualizarEspaco() {
  let bytes = 0;
  Object.values(CHAVES).forEach(k => { bytes += (localStorage.getItem(k) || '').length; });
  const el = $('#usoArm');
  if (el) el.textContent = `💾 ${(bytes / 1024).toFixed(0)} KB usados (local)`;
}

/* ================= 18. INICIALIZAÇÃO ================= */
aplicarTema(localStorage.getItem('pcm_tema') || 'escuro');
bindFiltros();
bindDropzone();
$('#cBusca').addEventListener('input', renderConsulta);
$('#cAlvo').addEventListener('change', renderConsulta);
[['#rNome', addResp], ['#sNome', addSetor], ['#oStatusNome', () => addOpcao('status')], ['#oPriorNome', () => addOpcao('prioridade')]]
  .forEach(([sel, fn]) => { const el = $(sel); if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); }); });
initDados();