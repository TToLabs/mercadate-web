// ═══════════════════════════════════════════════════════════════════════════
// PLATAFORMA : Usuario — MercaDate
// ARCHIVO    : voz-mercadate.js
// ═══════════════════════════════════════════════════════════════════════════
// Voz propia de MercaDate. Motor TTS neuronal (Piper / VITS) corriendo en WASM
// DENTRO del navegador, con el mismo modelo en todos los dispositivos → la voz
// suena idéntica en Chrome, Edge, Safari, Android y en la APK (online u offline
// una vez cacheado el modelo). Si el motor aún no está listo o el dispositivo no
// lo soporta, cae automáticamente a la voz del sistema (SpeechSynthesis).
//
// El modelo se descarga UNA sola vez (~20-40 MB) y queda cacheado en el
// dispositivo. En la APK se empaqueta para que no descargue nada.
// ═══════════════════════════════════════════════════════════════════════════
window.VozMercaDate = (function () {
  'use strict';

  // CDN del motor (ya permitido por la CSP). El paquete trae onnxruntime-web.
  const LIB_URL = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';

  // ── VOZ PRIMARIA: Catalina (chilena, femenina) vía /api/tts (Edge TTS) ──
  const VOZ_CL = 'es-CL-CatalinaNeural';
  const CATALINA_ON = true;
  // ── VOZ DE RESPALDO embebida (Piper, mexicana, offline) ──
  const VOZ_ID = 'es_MX-claude-high';

  // ── Config dinámica (la define el admin en /api/voz-config?panel=usuario) ──
  let _velocidad = 1.2;   // 0.7–1.6
  let _tono = 0;          // -30..30 (%)
  let _reemplazos = [];   // correcciones manuales de modismos [{de,a}]
  let _frases = {};         // overrides de frases del asistente { clave: texto }

  let _tts = null;          // módulo vits-web cargado (respaldo Piper)
  let _voiceId = null;      // id de la voz Piper elegida
  let _estado = 'idle';     // idle | cargando | listo | error  (estado de Piper)
  let _promesaInit = null;  // para no inicializar dos veces
  let _audioActual = null;  // <audio> en reproducción (para poder cortarlo)
  let _finPendiente = null; // callback onEnd del audio en curso (para no perderlo al cortar)
  let _onProgreso = null;   // callback opcional de progreso de descarga
  let _ultimoError = null;  // último error (diagnóstico)
  let _ultimoModo = null;   // 'catalina' | 'neuronal' | 'sistema'
  let _catalinaCooldown = 0;      // si Catalina falla (offline), no reintentar por un rato
  let _avisoOfflineDado = false;  // ya se avisó "sin internet" en este episodio offline
  const _cacheCatalina = new Map(); // texto → objectURL (audios Catalina ya bajados)
  const _STATIC_RATE = 1.2;        // velocidad usada al generar los MP3 estáticos
  let _staticMap = {};              // textoAdulto → URL de MP3 estático (desde manifest.json)

  // ── Voz del sistema (respaldo) ───────────────────────────────────────────
  const SYNTH = window.speechSynthesis;

  // ── Desbloqueo de audio (Chrome autoplay policy) ─────────────────────────
  // Chrome bloquea audio.play() llamado desde una cadena async (await fetch + await blob).
  // Solución: desbloquear el AudioContext en el primer gesto del usuario. Una vez
  // el contexto está en estado "running", new Audio().play() funciona sin restricciones.
  let _audioDesbloqueado = false;
  function _desbloquearAudio() {
    if (_audioDesbloqueado) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume().then(() => {
        _audioDesbloqueado = true;
        console.info('[VozMercaDate] 🔓 AudioContext desbloqueado por gesto de usuario');
        setTimeout(() => ctx.close(), 500);
      }).catch(() => {});
    } catch (_) {}
  }
  // Escucha en capture para que se ejecute antes que cualquier handler de la app.
  document.addEventListener('click',    _desbloquearAudio, { passive: true, capture: true });
  document.addEventListener('touchend', _desbloquearAudio, { passive: true, capture: true });
  document.addEventListener('keydown',  _desbloquearAudio, { passive: true, capture: true });

  function _hablarNativo(texto, onEnd) {
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(wd); onEnd && onEnd(); };
    if (!SYNTH) { setTimeout(fin, 0); return; }
    SYNTH.cancel();
    const est = 1200 + (texto ? (texto.length / Math.max(0.7, _velocidad)) * 80 : 0);
    const wd = setTimeout(fin, est + 3000); // watchdog generoso
    // Chrome bug: SYNTH.speak() inmediato después de cancel() a veces no suena.
    // Solución: esperar 60ms antes de crear y lanzar la utterance.
    setTimeout(() => {
      if (done) return; // ya terminó por watchdog
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'es-CL'; u.rate = _velocidad; u.pitch = Math.max(0, Math.min(2, 1 + _tono / 100));
      const voces = SYNTH.getVoices();
      const v = voces.find(x => /es[-_]CL/i.test(x.lang)) ||
                voces.find(x => /es[-_]MX/i.test(x.lang)) ||
                voces.find(x => x.lang.toLowerCase().startsWith('es') && x.localService) ||
                voces.find(x => x.lang.toLowerCase().startsWith('es'));
      if (v) u.voice = v;
      u.onend = fin;
      u.onerror = fin;
      try { SYNTH.speak(u); } catch(_) { fin(); }
    }, 60);
  }

  // ── Normalización de frases (modismos chilenos → trato neutro) ─────────────
  // Se aplican EN ORDEN. El admin puede editarlos desde el panel. Por defecto
  // Lila habla en chileno informal; estas sustituciones lo normalizan para
  // que suene bien con cualquier usuario.
  let _MODISMOS = [
    ["No te caché bien", "No te entendí bien"], ["no te caché", "no te entendí"],
    ["No pillé", "No encontré"], ["no pillé", "no encontré"], ["pillé", "encontré"],
    ["andái buscando", "estás buscando"], ["¿Qué andái", "¿Qué estás"],
    ["cerquita", "cerca"], ["Altiro,", "Enseguida,"], ["altiro", "enseguida"],
    ["querís", "quieres"], ["tenís", "tienes"], ["Acá tenís", "Aquí tienes"],
    ["el carro", "el carrito"],
    ["pa'rriba", "hacia arriba"], ["pa' ", "para "],
    ["Ya po, ", ""], ["Ya, ", ""], [" po.", "."], [" po,", ","], [" po ", " "],
    ["¡nos vemos!", "hasta luego"], ["¡nos vimos!", "hasta luego"],
  ];

  function _aplicarRegistro(texto) {
    let t = String(texto || '');
    for (const [de, a] of _MODISMOS) t = t.split(de).join(a);
    // Correcciones manuales del admin (tienen prioridad final).
    for (const r of _reemplazos) { if (r && r.de) t = t.split(r.de).join(r.a != null ? r.a : ''); }
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  // Porcentaje para prosody de Edge TTS (rate/pitch). 1.2 → "+20%", 0.9 → "-10%".
  function _pctVel(v) { const n = Math.round((v - 1) * 100); return (n >= 0 ? '+' : '') + n + '%'; }
  function _pctTono(t) { const n = Math.round(t); return (n >= 0 ? '+' : '') + n + '%'; }

  // Baja la config del panel usuario y la aplica.
  async function cargarConfig() {
    try {
      const res = await fetch('/api/voz-config?panel=usuario', { credentials: 'same-origin' });
      if (!res.ok) return;
      const d = await res.json();
      const c = d && d.config;
      if (!c) return;
      // Modismos editables por el admin (reemplaza los defaults si el server los envía).
      if (Array.isArray(d.modismos) && d.modismos.length) _MODISMOS = d.modismos;
      // Overrides de frases del asistente (editadas por el admin).
      if (d.frases && typeof d.frases === 'object') _frases = d.frases;
      if (typeof c.velocidad === 'number') _velocidad = Math.max(0.7, Math.min(1.6, c.velocidad));
      if (typeof c.tono === 'number') _tono = Math.max(-30, Math.min(30, c.tono));
      if (Array.isArray(c.reemplazos)) _reemplazos = c.reemplazos;
      // Preferencias del usuario (Perfil → Lila) pisan la config del admin.
      _aplicarPrefsUsuario(false);
      // La config invalida los audios Catalina cacheados (cambia rate/pitch/texto).
      _cacheCatalina.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
      _cacheCatalina.clear();
      console.info('[VozMercaDate] config: velocidad=' + _velocidad + ' tono=' + _tono);
    } catch (_) {}
  }

  // Aplica las preferencias personales (localStorage) sobre la config base.
  function _aplicarPrefsUsuario(limpiarCache) {
    try {
      const raw = (window.SafeStorage ? window.SafeStorage.get('mercadate_voz_user') : localStorage.getItem('mercadate_voz_user'));
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.velocidad === 'number') _velocidad = Math.max(0.7, Math.min(1.6, p.velocidad));
      if (typeof p.tono === 'number') _tono = Math.max(-30, Math.min(30, p.tono));
      if (limpiarCache) { _cacheCatalina.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} }); _cacheCatalina.clear(); }
    } catch (_) {}
  }

  // ── Inicialización del motor neuronal ──────────────────────────────────────
  function inicializar(onProgreso) {
    if (_onProgreso == null && typeof onProgreso === 'function') _onProgreso = onProgreso;
    if (_promesaInit) return _promesaInit;

    _promesaInit = (async () => {
      // Soporte mínimo: WebAssembly. Si no, queda en modo "voz del sistema".
      if (typeof WebAssembly !== 'object') { _estado = 'error'; return false; }
      try {
        _estado = 'cargando';
        console.info('[VozMercaDate] 1/3 importando motor neuronal…', LIB_URL);
        _tts = await import(/* @vite-ignore */ LIB_URL);
        console.info('[VozMercaDate] motor importado. Exports:', Object.keys(_tts || {}));

        // Voz oficial fija. Si por algún motivo no estuviera en el catálogo,
        // cae a la primera mexicana disponible y luego a cualquier español.
        _voiceId = VOZ_ID;
        try {
          const voces = await _tts.voices();         // [{ key, language, ... }]
          const catalogo = (voces || []).map(v => v.key || v.id || v).filter(Boolean);
          if (catalogo.length && !catalogo.includes(VOZ_ID)) {
            _voiceId = catalogo.find(k => /^es_MX/i.test(k)) ||
                       catalogo.find(k => /^es_/i.test(k)) || VOZ_ID;
          }
        } catch (_) { /* se usa VOZ_ID */ }
        console.info('[VozMercaDate] 2/3 voz elegida:', _voiceId);

        // ¿Ya está el modelo en el almacenamiento del dispositivo (OPFS)?
        // Si sí, NO re-descargar (vits-web baja los 63 MB cada vez si no se
        // chequea) → carga instantánea y el saludo ya suena neuronal.
        let yaGuardado = false;
        try {
          const g = _tts.stored ? await _tts.stored() : [];
          yaGuardado = (g || []).map(v => (v && (v.key || v.id)) || v).includes(_voiceId);
        } catch (_) {}

        if (yaGuardado) {
          console.info('[VozMercaDate] modelo ya en OPFS → sin descarga, carga instantánea.');
        } else if (_tts.download) {
          let _ultPct = -1;
          console.info('[VozMercaDate] descargando modelo (~63 MB, solo la 1ª vez)…');
          await _tts.download(_voiceId, (p) => {
            const pct = p && p.loaded && p.total ? Math.round((p.loaded / p.total) * 100) : null;
            if (pct != null && pct !== _ultPct && pct % 10 === 0) { _ultPct = pct; console.info('[VozMercaDate] descarga ' + pct + '%'); }
            if (_onProgreso) _onProgreso(pct, _voiceId);
          });
        }
        _estado = 'listo';
        console.info('[VozMercaDate] 3/3 ✅ modelo LISTO. La voz de MercaDate ya está activa:', _voiceId);
        return true;
      } catch (e) {
        _ultimoError = (e && (e.message || e.name)) || String(e);
        console.error('[VozMercaDate] ❌ motor neuronal NO disponible → uso voz del sistema. Causa:', _ultimoError, e);
        _estado = 'error';
        return false;
      }
    })();

    return _promesaInit;
  }

  // Reproduce un <audio>. rate = playbackRate (1 cuando el server ya aplicó la
  // velocidad, p.ej. Catalina; _velocidad para Piper/sistema).
  function _reproducir(objurl, onEnd, etiqueta, revocarAlTerminar, rate) {
    const pr = rate || 1;
    const audio = new Audio(objurl);
    const aplicarVel = () => {
      try { audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true; } catch (_) {}
      audio.playbackRate = pr;
    };
    aplicarVel();
    audio.addEventListener('loadedmetadata', aplicarVel);
    audio.addEventListener('play', aplicarVel);
    _audioActual = audio;
    let done = false;
    const fin = () => {
      if (done) return; done = true;
      if (_finPendiente === fin) _finPendiente = null;
      if (revocarAlTerminar) { try { URL.revokeObjectURL(objurl); } catch (_) {} }
      if (_audioActual === audio) _audioActual = null;
      onEnd && onEnd();
    };
    _finPendiente = fin;         // si algo corta el audio, este callback igual se dispara
    audio.onended = fin; audio.onerror = fin;
    console.info('[VozMercaDate] ▶ ' + etiqueta);
    return audio.play().then(() => { aplicarVel(); return true; })
      .catch((err) => {
        console.error('[VozMercaDate] ❌ audio.play() rechazado:', err && (err.name + ': ' + err.message));
        audio.onended = audio.onerror = null;
        if (_audioActual === audio) _audioActual = null;
        return false;
      });
  }

  // Carga el manifest de audios estáticos (generado por prebuild-audio.js).
  async function _cargarManifestStatico() {
    try {
      const res = await fetch('audio/lila/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const m = await res.json();
      _staticMap = {};
      for (const entry of Object.values(m)) {
        if (entry && entry.adulto && entry.file) _staticMap[entry.adulto] = entry.file;
      }
    } catch (_) {}
  }

  // VOZ PRIMARIA: Catalina (chilena) generada en el servidor (/api/tts) con la
  // velocidad y el tono de la config. Devuelve true si reprodujo.
  async function _reproducirCatalina(texto, onEnd) {
    try {
      let objurl = _cacheCatalina.get(texto);
      if (!objurl) {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 7000);
        const url = '/api/tts?text=' + encodeURIComponent(texto) + '&voice=' + VOZ_CL +
                    '&rate=' + encodeURIComponent(_pctVel(_velocidad)) +
                    '&pitch=' + encodeURIComponent(_pctTono(_tono));
        const res = await fetch(url, { signal: ctrl.signal, credentials: 'same-origin' });
        clearTimeout(to);
        if (!res.ok) return false;
        const blob = await res.blob();
        if (!blob || blob.size < 200) return false;
        objurl = URL.createObjectURL(blob);
        _cacheCatalina.set(texto, objurl);
        if (_cacheCatalina.size > 40) {
          const k = _cacheCatalina.keys().next().value;
          try { URL.revokeObjectURL(_cacheCatalina.get(k)); } catch (_) {}
          _cacheCatalina.delete(k);
        }
      }
      _ultimoModo = 'catalina';
      // El server ya aplicó velocidad+tono → playbackRate 1. No revocar (caché).
      return await _reproducir(objurl, onEnd, 'REPRODUCIENDO VOZ CATALINA (es-CL)', false, 1);
    } catch (e) {
      return false;
    }
  }

  // Reproduce un MP3 pre-generado al momento del deploy. Ajusta playbackRate
  // proporcionalmente a la velocidad configurada vs. la del archivo generado.
  async function _reproducirStatico(url, onEnd) {
    return _reproducir(url, onEnd, 'REPRODUCIENDO VOZ ESTÁTICA ' + url, false, _velocidad / _STATIC_RATE);
  }

  // Respaldo: Piper mexicano embebido (si está cargado) → voz del sistema.
  async function _hablarRespaldo(texto, onEnd) {
    if (_estado === 'listo' && _tts && _tts.predict) {
      try {
        const wav = await _tts.predict({ text: texto, voiceId: _voiceId });
        const url = URL.createObjectURL(wav);
        _ultimoModo = 'neuronal';
        const ok = await _reproducir(url, onEnd, 'REPRODUCIENDO VOZ NEURONAL (' + _voiceId + ')', true, _velocidad);
        if (ok) return;
      } catch (e) {
        _ultimoError = (e && (e.message || e.name)) || String(e);
        console.error('[VozMercaDate] ❌ fallo Piper → voz del sistema:', _ultimoError);
      }
    }
    _ultimoModo = 'sistema';
    console.warn('[VozMercaDate] ⚠ usando VOZ DEL SISTEMA.');
    _hablarNativo(texto, onEnd);
  }

  // ── Síntesis + reproducción ────────────────────────────────────────────────
  async function hablar(texto, onEnd) {
    if (!texto) { onEnd && onEnd(); return; }
    detener();

    // Ajustar las palabras al registro elegido (joven/adulto/mayor/neutro) +
    // correcciones manuales del admin.
    texto = _aplicarRegistro(texto);

    // 0) MP3 pre-generado (sin red; se sirve desde disco o CDN cache).
    if (_staticMap[texto]) {
      const ok = await _reproducirStatico(_staticMap[texto], onEnd);
      if (ok) { _ultimoModo = 'static'; return; }
    }

    // 1) VOZ PRIMARIA: Catalina (chilena, remota). Necesita internet.
    if (CATALINA_ON && Date.now() > _catalinaCooldown) {
      const ok = await _reproducirCatalina(texto, onEnd);
      if (ok) { _avisoOfflineDado = false; return; }   // online OK → resetea aviso
      _catalinaCooldown = Date.now() + 30000;

      // ¿Falló por FALTA DE INTERNET? Entonces la voz de respaldo se usa SOLO
      // para avisar y sugerir conectarse (no para responder normalmente).
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (window.mostrarToast) window.mostrarToast("📶 Sin internet — conéctate al wifi o a tus datos para usar la voz", 4000, 'err');
        if (_avisoOfflineDado) { onEnd && onEnd(); return; }  // ya avisado este episodio
        _avisoOfflineDado = true;
        return _hablarRespaldo("Oye, parece que no tienes internet. Conéctate al wifi o a tus datos móviles para poder usar la voz.", onEnd);
      }
      // Hay internet pero Catalina falló (servicio caído) → responder con respaldo normal.
      console.info('[VozMercaDate] Catalina no disponible (con internet) → respaldo (reintento en 30s)');
    }

    _hablarRespaldo(texto, onEnd);
  }

  // Al recuperar conexión: permitir Catalina de nuevo y volver a avisar si cae.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { _catalinaCooldown = 0; _avisoOfflineDado = false; });
  }

  function detener() {
    // Rescatar el callback del audio en curso: pause() NO dispara 'ended', así que
    // sin esto el que espera (p.ej. el mic de Lila) quedaría colgado para siempre.
    const f = _finPendiente; _finPendiente = null;
    if (_audioActual) { try { _audioActual.pause(); } catch (_) {} _audioActual = null; }
    if (SYNTH) { try { SYNTH.cancel(); } catch (_) {} }
    if (f) { try { f(); } catch (_) {} }
  }

  // Diagnóstico manual: VozMercaDate.probar() desde la consola.
  // Reproduce una frase con la prioridad real (Catalina → Piper → sistema) y
  // deja claro en consola qué voz se usó.
  async function probar(texto) {
    console.info('[VozMercaDate] probar(): probando prioridad Catalina → Piper → sistema…');
    hablar(texto || 'Hola, soy Catalina, la voz chilena de MercaDate.', () => {
      console.info('[VozMercaDate] fin de la prueba. Modo usado:', _ultimoModo);
    });
  }

  function diagnostico() {
    return { estado: _estado, vozId: _voiceId, ultimoModo: _ultimoModo, ultimoError: _ultimoError };
  }

  // Reinicia el cooldown de Catalina (útil al iniciar la demo o cuando se sabe que hay internet).
  function reiniciarCatalina() {
    _catalinaCooldown = 0;
    console.info('[VozMercaDate] cooldown de Catalina reiniciado');
  }

  // Pre-carga el audio de un texto en caché para que la reproducción posterior
  // no tenga espera de red. Llamar antes de mostrar la slide.
  async function precargar(texto) {
    if (!texto || !CATALINA_ON) return;
    const textoFinal = _aplicarRegistro(texto);
    if (_cacheCatalina.has(textoFinal)) return;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10000);
      const url = '/api/tts?text=' + encodeURIComponent(textoFinal) + '&voice=' + VOZ_CL +
                  '&rate=' + encodeURIComponent(_pctVel(_velocidad)) +
                  '&pitch=' + encodeURIComponent(_pctTono(_tono));
      const res = await fetch(url, { signal: ctrl.signal, credentials: 'same-origin' });
      clearTimeout(to);
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob || blob.size < 200) return;
      const objurl = URL.createObjectURL(blob);
      _cacheCatalina.set(textoFinal, objurl);
      if (_cacheCatalina.size > 40) {
        const k = _cacheCatalina.keys().next().value;
        try { URL.revokeObjectURL(_cacheCatalina.get(k)); } catch (_) {}
        _cacheCatalina.delete(k);
      }
      console.info('[VozMercaDate] ✔ pre-cargado:', textoFinal.slice(0, 50) + '…');
    } catch (_) {}
  }

  // Resuelve true cuando la voz neuronal está lista, o false si pasa el tiempo
  // límite o falla. Dispara la inicialización si aún no arrancó.
  function esperarListo(ms) {
    if (_estado === 'listo') return Promise.resolve(true);
    if (_estado === 'idle') inicializar();
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (_estado === 'listo') { clearInterval(iv); resolve(true); }
        else if (_estado === 'error' || Date.now() - t0 > (ms || 6000)) { clearInterval(iv); resolve(false); }
      }, 120);
    });
  }

  // Si el modelo YA está cacheado en el dispositivo, lo carga en memoria al
  // instante (sin descargar) para que la voz esté lista antes de hablar.
  // Si NO está cacheado, no descarga nada (espera a que el usuario use la voz).
  async function precargarSiCacheado() {
    try {
      if (!_tts) _tts = await import(/* @vite-ignore */ LIB_URL);
      const guardadas = _tts.stored ? await _tts.stored() : [];
      const ids = (guardadas || []).map(v => (v && (v.key || v.id)) || v).filter(Boolean);
      if (ids.includes(VOZ_ID)) {
        console.info('[VozMercaDate] modelo en caché → precargando voz neuronal…');
        inicializar();
      }
    } catch (_) { /* sin pre-carga; se inicializa al primer uso */ }
  }

  // Cargar config y manifest de audios estáticos al inicio (paralelo, no bloquea).
  cargarConfig();
  _cargarManifestStatico();

  return {
    inicializar,
    hablar,
    detener,
    probar,
    diagnostico,
    esperarListo,
    precargarSiCacheado,
    cargarConfig,
    aplicarPrefsUsuario: function () { _aplicarPrefsUsuario(true); },
    fraseOverride: function (clave) { return _frases && _frases[clave] != null ? _frases[clave] : null; },
    reiniciarCatalina,
    precargar,
    get estado() { return _estado; },
    get vozId() { return _voiceId; },
    get listo() { return _estado === 'listo'; },
    get ultimoModo() { return _ultimoModo; },
    get ultimoError() { return _ultimoError; },
    get config() { return { velocidad: _velocidad, tono: _tono, reemplazos: _reemplazos }; },
  };
})();
