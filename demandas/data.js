// demandas/data.js — Firebase do domínio Cepêra (mesmo projeto do SERAC 1, caminhos exclusivos)
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

// Coleções EXCLUSIVAS deste sub-app (prefixo dm_ = Demandas) — não tocam no pcm_data/serac1
window.FB_COLS = {
  demandas: 'dm_demandas',
  responsaveis: 'dm_responsaveis',
  setores: 'dm_setores',
  opcoes: 'dm_opcoes'
};

window.db = null;
window.firebaseAtivo = false;
if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("COLE_") && typeof firebase !== "undefined") {
  try {
    firebase.initializeApp(firebaseConfig);
    window.db = firebase.firestore();
    window.firebaseAtivo = true;
  } catch (e) {
    console.error("Falha ao iniciar o Firebase:", e);
  }
}