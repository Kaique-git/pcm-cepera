// demandas/data.js — Firebase do domínio Cepêra (mesmo projeto do SERAC 1, caminhos exclusivos)
const firebaseConfig = {
  apiKey: "AIzaSyAGbFTCgbqe9XFKFSb6ltB5lYj506QipE",
  authDomain: "pcm-cepera.firebaseapp.com",
  projectId: "pcm-cepera",
  storageBucket: "pcm-cepera.firebasestorage.app",
  messagingSenderId: "483278589909",
  appId: "1:483278589909:web:9f69f8a32f50e4e186f75c"
};

// Coleções EXCLUSIVAS deste sub-app (prefixo dm_ = Demandas) — não tocam no pcm_data/serac1
window.FB_COLS = {
  demandas: 'dm_demandas',
  responsaveis: 'dm_responsaveis',
  setores: 'dm_setores',
  opcoes: 'dm_opcoes'
};

window.db = null;
window.firebaseAtivo = false;
// Guard: só pula o init se a chave for placeholder — nunca bloqueia a chave real
if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("AIzaSyAGbFTCgbqe9XFKFSb6ltB5lYj506QipE") && typeof firebase !== "undefined") {
  try {
    firebase.initializeApp(firebaseConfig);
    window.db = firebase.firestore();
    window.firebaseAtivo = true;
  } catch (e) {
    console.error("Falha ao iniciar o Firebase:", e);
  }
}