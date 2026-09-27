// ═══════════════════════════════════════════════════════════════════════════
// PLATAFORMA : Usuario — MercaDate
// ARCHIVO    : voz-calibracion.js
// ═══════════════════════════════════════════════════════════════════════════
// Reduce errores de reconocimiento de voz SIN poder entrenar el reconocedor del
// navegador (que es cerrado). Dos capas:
//   A) Runtime: corrige el texto reconocido contra un vocabulario (productos,
//      comandos) por similitud, y elige la mejor de las N alternativas.
//   B) Calibración: "Probá tu voz" — el usuario lee frases conocidas, se miden
//      sus errores sistemáticos y se arma un diccionario de correcciones PERSONAL
//      (guardado por usuario en localStorage).
// ═══════════════════════════════════════════════════════════════════════════
window.VozCorr = (function () {
  'use strict';

  // ── Utilidades de texto ────────────────────────────────────────────────────
  function normalizar(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function levenshtein(a, b) {
    a = a || ''; b = b || '';
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  function similar(a, b) {
    a = normalizar(a); b = normalizar(b);
    if (!a || !b) return 0;
    const d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length);
  }

  // ── Diccionario de correcciones por usuario ────────────────────────────────
  function _clave() {
    const id = (window.usuarioActivo != null ? window.usuarioActivo : 'anon');
    return 'mercadate_voz_corr_' + id;
  }
  function cargarMapa() {
    try { return JSON.parse(localStorage.getItem(_clave()) || '{}'); } catch (_) { return {}; }
  }
  function guardarMapa(m) {
    try { localStorage.setItem(_clave(), JSON.stringify(m || {})); } catch (_) {}
  }
  // m = { frases:{ heardNorm: textoCorrecto }, palabras:{ heardNorm: palabra } }
  let _mapa = cargarMapa();
  function recargar() { _mapa = cargarMapa(); }

  // Aplica las correcciones aprendidas a un texto reconocido.
  function aplicar(texto) {
    let t = String(texto || '');
    const norm = normalizar(t);
    if (_mapa.frases && _mapa.frases[norm]) return _mapa.frases[norm];
    if (_mapa.palabras) {
      t = t.split(/\s+/).map(w => {
        const c = _mapa.palabras[normalizar(w)];
        return c || w;
      }).join(' ');
    }
    return t;
  }

  // ── Corrección de término contra un vocabulario (Capa A) ───────────────────
  // vocab: array de palabras conocidas (productos, comercios). Corrige cada
  // palabra del término a la más parecida del vocab si supera el umbral.
  function corregirTermino(texto, vocab, umbral) {
    if (!vocab || !vocab.length) return texto;
    umbral = umbral || 0.72;
    const setVocab = new Set(vocab.map(normalizar));
    return String(texto || '').split(/\s+/).map(w => {
      const wn = normalizar(w);
      if (wn.length < 3 || setVocab.has(wn)) return w; // ya es válida o muy corta
      let mejor = null, mejorSim = 0;
      for (const v of vocab) {
        const s = similar(wn, v);
        if (s > mejorSim) { mejorSim = s; mejor = v; }
      }
      return (mejor && mejorSim >= umbral) ? mejor : w;
    }).join(' ');
  }

  // Elige la mejor de las alternativas del reconocedor: la que más se parece a
  // algún comando/vocabulario conocido; si no, la de mayor confianza (la 1ª).
  function mejorAlternativa(alts, pistas) {
    if (!alts || !alts.length) return '';
    if (!pistas || !pistas.length) return aplicar(alts[0]);
    let mejor = alts[0], mejorSim = -1;
    for (const a of alts) {
      const an = normalizar(aplicar(a));
      let s = 0;
      for (const p of pistas) {
        for (const w of an.split(' ')) s = Math.max(s, similar(w, p));
      }
      if (s > mejorSim) { mejorSim = s; mejor = a; }
    }
    return aplicar(mejor);
  }

  // ── Calibración "Probá tu voz" (Capa B) ────────────────────────────────────
  const FRASES_CAL = ['buscar leche', 'mostrar combustibles', 'más barato', 'abrir el primero', 'buscar pan', 'amplía la búsqueda', 'buscar almacenes'];

  function calibrar() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Tu navegador no soporta reconocimiento de voz.'); return; }
    if (document.getElementById('vozCalModal')) return;

    // MODO ENTRENAMIENTO: pausar el asistente para que no escuche ni procese las
    // frases de prueba como comandos (antes "hablaba" sobre la calibración).
    if (window._voiceAssistant && window._voiceAssistant.pausar) window._voiceAssistant.pausar();

    const mapa = cargarMapa();
    mapa.frases = mapa.frases || {};
    mapa.palabras = mapa.palabras || {};
    let idx = 0, aciertos = 0;

    const ov = document.createElement('div');
    ov.id = 'vozCalModal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(5,8,15,.92);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(6px)';
    ov.innerHTML = `
      <div style="background:#0e1424;border:1px solid #24304d;border-radius:18px;max-width:380px;width:100%;padding:24px;text-align:center;color:#e2e8f0;font-family:inherit">
        <div style="font-size:18px;font-weight:700;margin-bottom:4px">🎤 Probá tu voz</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:18px">Lee en voz alta cada frase. Aprendo cómo hablas para entenderte mejor.</div>
        <div id="vcProg" style="font-size:11px;color:#64748b;margin-bottom:8px"></div>
        <div id="vcFrase" style="font-size:22px;font-weight:700;color:#a855f7;margin:10px 0 18px;min-height:30px"></div>
        <div id="vcEstado" style="font-size:13px;color:#94a3b8;min-height:20px;margin-bottom:18px">Tocá "Empezar" cuando estés listo.</div>
        <div style="display:flex;gap:10px">
          <button id="vcBtn" style="flex:1;background:#a855f7;border:none;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Empezar</button>
          <button id="vcCerrar" style="background:none;border:1px solid #2a3150;color:#94a3b8;border-radius:10px;padding:12px 16px;cursor:pointer;font-family:inherit">Salir</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const $f = ov.querySelector('#vcFrase'), $e = ov.querySelector('#vcEstado'),
          $b = ov.querySelector('#vcBtn'), $p = ov.querySelector('#vcProg');
    const cerrar = () => {
      try { ov.remove(); } catch (_) {}
      // Reanudar el asistente al salir del modo entrenamiento.
      if (window._voiceAssistant && window._voiceAssistant.reanudar) window._voiceAssistant.reanudar();
    };
    ov.querySelector('#vcCerrar').onclick = cerrar;

    function pintarFrase() {
      $p.textContent = 'Frase ' + (idx + 1) + ' de ' + FRASES_CAL.length;
      $f.textContent = '«' + FRASES_CAL[idx] + '»';
    }

    function escuchar() {
      const esperado = FRASES_CAL[idx];
      $e.textContent = '🔴 Escuchando… decí la frase';
      $b.disabled = true; $b.style.opacity = '.5';
      const r = new SR();
      r.lang = 'es-CL'; r.interimResults = false; r.maxAlternatives = 1;
      let listo = false;
      r.onresult = e => {
        listo = true;
        const oido = e.results[0][0].transcript;
        const okFrase = similar(oido, esperado) >= 0.85;
        if (okFrase) { aciertos++; }
        else {
          // Aprende la corrección frase-nivel y palabra-nivel.
          mapa.frases[normalizar(oido)] = esperado;
          const po = normalizar(oido).split(' '), pe = esperado.split(' ');
          if (po.length === pe.length) {
            po.forEach((w, i) => { if (w && pe[i] && w !== normalizar(pe[i])) mapa.palabras[w] = pe[i]; });
          }
        }
        $e.innerHTML = okFrase ? '✅ ¡Perfecto!' : '📝 Anotado: oí «' + oido + '»';
        idx++;
        setTimeout(siguiente, 900);
      };
      r.onerror = () => { if (!listo) { $e.textContent = '⚠️ No te escuché. Toca "Repetir".'; $b.textContent = 'Repetir'; $b.disabled = false; $b.style.opacity = '1'; $b.onclick = escuchar; } };
      r.onend = () => { if (!listo) { $b.disabled = false; $b.style.opacity = '1'; } };
      try { r.start(); } catch (_) {}
    }

    function siguiente() {
      if (idx >= FRASES_CAL.length) {
        guardarMapa(mapa); recargar();
        try { if (window._ulEvento) window._ulEvento('lila_calibracion', { aciertos: aciertos }); } catch (_) {}
        $f.textContent = '🎉';
        $e.innerHTML = 'Listo. Aprendí tu forma de hablar (' + aciertos + '/' + FRASES_CAL.length + ' perfectas). El asistente ahora te va a entender mejor.';
        $p.textContent = '';
        $b.textContent = 'Cerrar'; $b.disabled = false; $b.style.opacity = '1'; $b.onclick = cerrar;
        return;
      }
      pintarFrase();
      $e.textContent = 'Toca "Hablar" y lee la frase.';
      $b.textContent = 'Hablar'; $b.disabled = false; $b.style.opacity = '1'; $b.onclick = escuchar;
    }

    $b.onclick = () => { pintarFrase(); siguiente(); };
  }

  return { normalizar, similar, aplicar, corregirTermino, mejorAlternativa, calibrar, recargar,
           get tieneCalibracion() { const m = cargarMapa(); return !!(m.frases && Object.keys(m.frases).length) || !!(m.palabras && Object.keys(m.palabras).length); } };
})();
