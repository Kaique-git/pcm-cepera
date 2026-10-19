// js/rotulos.js — Troca "Pendente" por "No prazo" em toda a tela
(function () {
  const traduzTexto = t => t
    .replace(/Pendente\(s\)/g, 'No Prazo')
    .replace(/Pendentes/g, 'No Prazo')
    .replace(/Pendente/g, 'No prazo')
    .replace(/pendente\(s\)/g, 'no prazo')
    .replace(/pendentes/g, 'no prazo')
    .replace(/pendente/g, 'no prazo');
  function traduz() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      if (t && t.indexOf('endente') !== -1) {
        const novo = traduzTexto(t);
        if (novo !== t) n.nodeValue = novo;
      }
    }
  }
  let agendado = false;
  new MutationObserver(() => {
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => { agendado = false; traduz(); });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  traduz();
})();