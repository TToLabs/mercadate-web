// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente
// ARCHIVO    : micuenta.js
// ═══════════════════════════════════════════════════
// micuenta.js — Módulo "Mi Cuenta" del portal usuario
// Tabs: Perfil · Seguridad · Avatar · Reseñas · Ayuda

window.MiCuenta = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let tipoAyudaActual = null;
  let _avGenero = 'neutro'; // 'hombre' | 'mujer' | 'neutro'
  let _avEdad   = 'adulto'; // 'joven' | 'adulto' | 'mayor'
  let _avTono   = '';       // '' | 🏻 | 🏼 | 🏽 | 🏾 | 🏿
  let _avPelo   = '';       // '' | rojo | rizado | canoso | calvo
  let _modoAvatar = 'avatar'; // 'avatar' | 'foto'
  let _fotoBase64 = null;
  let _fotoQuitada = false;
  // Estado del recortador de foto
  let _cropImg = null, _cropX = 0, _cropY = 0, _cropScale = 1;
  let _cropDrag = false, _cropLX = 0, _cropLY = 0, _cropPinch = 0;
  const CROP_S = 300;

  function user() { return window.usuarioActual; }

  // Genera el HTML del avatar del usuario (foto, emoji, personaje o iniciales).
  function _avatarHtml(u, redondo) {
    const rad = redondo ? 'border-radius:50%;' : '';
    if (u.avatar_url && (u.avatar_url.startsWith('data:image') || u.avatar_url.startsWith('http'))) {
      return `<img src="${u.avatar_url}" style="width:100%;height:100%;object-fit:cover;${rad}" alt="" referrerpolicy="no-referrer">`;
    }
    if (u.avatar_url && u.avatar_url.startsWith('emoji:')) {
      return `<span style="font-size:1.1em;line-height:1">${u.avatar_url.slice(6)}</span>`;
    }
    if (u.personaje && u.personaje.genero) {
      return `<span style="font-size:1.1em;line-height:1">${window.componerAvatarEmoji(u.personaje)}</span>`;
    }
    return window.renderAvatarHtml(window.parsearAvatar(u.avatar_url, u.nombre || u.username));
  }

  function saveUsuario(u) {
    if (!u) return;
    window.SafeStorage.set('mercadate_user', u);
    // Avatar en el header del modal Mi Cuenta…
    const av = $('mcAvatarHeader');
    if (av) av.innerHTML = _avatarHtml(u, false);
    // Top bar: solo el nombre, sin foto.
    const lbl = $('mcNombreHeader');
    if (lbl) lbl.textContent = (u.nombre || u.username || 'Usuario').split(' ')[0];
  }

  // Refrescar el avatar cuando la sesión se confirma con datos frescos del server.
  document.addEventListener('sesion-lista', () => { const u = user(); if (u) saveUsuario(u); });

  // ─── Apertura del modal ───────────────────────────────────────────────────
  function abrir() {
    const u = user();
    if (!u) { if (window._ulMostrar) window._ulMostrar(); else window.location.href = 'index.html'; return; }
    // Pre-llenar perfil
    $('mc_nombre').value   = u.nombre   || '';
    $('mc_email').value    = u.email    || '';
    $('mc_telefono').value = u.telefono || '';
    $('mc_comuna').value   = u.comuna   || '';
    // Reset campos
    ['mc_nuevo_user','mc_pass_actual_u','mc_pass_actual','mc_pass_nueva','mc_pass_conf','mc_review_titulo','mc_review_comentario','mc_ayuda_asunto','mc_ayuda_mensaje']
      .forEach(id => { const e=$(id); if(e) e.value=''; });
    // Avatar inicial — restaurar ejes desde personaje (o mapear avatar antiguo)
    const per = u.personaje || {};
    if (per.genero) {
      _avGenero = per.genero; _avEdad = per.edad || 'adulto';
      _avTono = per.tono || ''; _avPelo = per.pelo || '';
    } else {
      // Compatibilidad con avatares viejos (avatar:<key> + avatarKey)
      const LEGACY = {
        nino:{g:'neutro',e:'joven'}, nina:{g:'mujer',e:'joven'},
        joven_m:{g:'hombre',e:'joven'}, joven_f:{g:'mujer',e:'joven'},
        hombre:{g:'hombre',e:'adulto'}, mujer:{g:'mujer',e:'adulto'},
        tio:{g:'hombre',e:'adulto'}, tia:{g:'mujer',e:'adulto'},
        abuelo:{g:'hombre',e:'mayor'}, abuela:{g:'mujer',e:'mayor'},
      };
      const pAv = window.parsearAvatar(u.avatar_url, u.nombre || u.username);
      const leg = (pAv.tipo === 'preset' && LEGACY[pAv.valor]) || LEGACY[per.avatarKey] || { g:'neutro', e:'adulto' };
      _avGenero = leg.g; _avEdad = leg.e;
      _avTono = per.avatarTono || ''; _avPelo = per.avatarPelo || '';
    }
    _fotoBase64  = (u.avatar_url&&(u.avatar_url.startsWith('data:image')||u.avatar_url.startsWith('http'))) ? u.avatar_url : null;
    _fotoQuitada = false;
    _modoAvatar  = _fotoBase64 ? 'foto' : 'avatar';
    renderAvatarPicker();
    tab('perfil');
    $('miCuentaModal').classList.add('open');
    cargarReseñas();
  }

  function cerrar() { $('miCuentaModal').classList.remove('open'); }

  function tab(name) {
    document.querySelectorAll('.mc-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.mc-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    if (name === 'notificaciones') cargarNotificaciones();
    if (name === 'reseñas') cargarReseñas();
    if (name === 'ayuda') { volverAyuda(); cargarMisConversaciones(); }
    if (name === 'avatar') renderAvatarPicker();
    if (name === 'perfil') { renderNivelBarra(); }
    if (name === 'config') { marcarTemaActivo(); renderAvatarPicker(); renderLilaConfig(); renderMapaPref(); }
    if (name === 'compras') cargarMisCompras();
    if (name === 'alertas') cargarAlertas();
    if (name === 'favoritos') cargarFavoritos();
  }

  async function cargarAlertas() {
    const cont = document.getElementById('mcAlertasLista');
    if (!cont) return;
    const uid = window.usuarioActivo;
    if (!uid) { cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Inicia sesión para ver tus alertas.</p>'; return; }
    cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Cargando…</p>';
    try {
      const r = await window.Api.get('/usuario/alertas-precio?user_id=' + uid);
      const alertas = (r.data && r.data.alertas) || [];
      if (!alertas.length) { cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No tienes alertas de precio activas.<br><span style="font-size:12px">Busca un producto y toca 🔔 para agregar una alerta.</span></p>'; return; }
      cont.innerHTML = alertas.map(a => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border,#1e2a3a)">
          <div>
            <div style="font-weight:600;font-size:14px">${a.producto_nombre || a.nombre || 'Producto'}</div>
            <div style="font-size:12px;color:var(--muted)">Alerta cuando baje de <strong>$${(a.precio_objetivo||0).toLocaleString('es-CL')}</strong></div>
            ${a.comercio_nombre ? `<div style="font-size:11px;color:var(--muted)">${a.comercio_nombre}</div>` : ''}
          </div>
          <button onclick="window._eliminarAlerta(${a.id})" style="background:none;border:1px solid #ef4444;color:#ef4444;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px">🗑 Eliminar</button>
        </div>`).join('');
    } catch (e) { cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Error al cargar alertas.</p>'; }
  }

  window._eliminarAlerta = async function(id) {
    if (!confirm('¿Eliminar esta alerta?')) return;
    try {
      await window.Api.delete('/usuario/alertas-precio/' + id);
      cargarAlertas();
    } catch (_) {}
  };

  async function cargarFavoritos() {
    const cont = document.getElementById('mcFavLista');
    if (!cont) return;
    const uid = window.usuarioActivo;
    if (!uid) { cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Inicia sesión para ver tus favoritos.</p>'; return; }
    cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Cargando…</p>';
    try {
      const r = await window.Api.get('/usuario/favoritos?user_id=' + uid);
      const favs = (r.data && r.data.favoritos) || [];
      if (!favs.length) { cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">No tienes comercios favoritos.<br><span style="font-size:12px">Toca ❤️ en cualquier comercio para guardarlo.</span></p>'; return; }
      cont.innerHTML = favs.map(f => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--border,#1e2a3a)">
          <div>
            <div style="font-weight:600;font-size:14px">${f.nombre || f.comercio_nombre || 'Comercio'}</div>
            ${f.direccion ? `<div style="font-size:12px;color:var(--muted)">📍 ${f.direccion}</div>` : ''}
          </div>
          <button onclick="window._eliminarFavorito(${f.id||f.local_id})" style="background:none;border:1px solid #ef4444;color:#ef4444;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px">🗑</button>
        </div>`).join('');
    } catch (e) { cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Error al cargar favoritos.</p>'; }
  }

  window._eliminarFavorito = async function(id) {
    if (!confirm('¿Quitar de favoritos?')) return;
    try { await window.Api.delete('/usuario/favoritos/' + id); cargarFavoritos(); } catch (_) {}
  };

  // ─── MIS COMPRAS (Fase 5) ──────────────────────────────────────────────────
  let _comprasCache = [];
  async function cargarMisCompras() {
    const cont = document.getElementById('comprasLista');
    if (!cont) return;
    const uid = window.usuarioActivo;
    if (!uid) { cont.innerHTML = '<div class="compras-empty">Inicia sesión para ver tus compras.</div>'; return; }
    cont.innerHTML = '<div class="compras-loading">Cargando tus compras…</div>';
    try {
      const r = await window.Api.get('/transacciones/usuario/' + uid);
      _comprasCache = (r.data && r.data.transacciones) || [];
      const _uComp = window.auth && auth.getUser ? auth.getUser() : null;
      const _nivelComp = _uComp?.nivel || 1;
      const _enLibreComp = window._esPeriodoLibre && window._esPeriodoLibre(_uComp);
      const _limitarCompras = _nivelComp === 2 && !_enLibreComp && _comprasCache.length > 3;
      if (_limitarCompras) _comprasCache = _comprasCache.slice(0, 3);
      if (!_comprasCache.length) {
        cont.innerHTML = `<div class="compras-empty">
          <div style="font-size:40px;margin-bottom:8px">🧾</div>
          <div style="font-weight:700;margin-bottom:4px">Aún no tienes compras</div>
          <div style="font-size:13px;color:var(--text2,#94a3b8)">Registra una visita escaneando el QR de un local.</div>
        </div>`;
        return;
      }
      const _bannerLimite = _limitarCompras ? '<div style="text-align:center;padding:10px 0;font-size:12px;color:#eab308;border-bottom:1px solid #1e2a3a;margin-bottom:8px">🔒 Últimas 3 compras. Sube a <strong>Cazador de Precios</strong> para ver todo tu historial.</div>' : '';
      cont.innerHTML = _bannerLimite + _comprasCache.map((t, i) => {
        const fecha = (t.fecha_hora_compra || t.fecha_registro_sistema || '').slice(0,10);
        const monto = t.monto_total ? '$' + Number(t.monto_total).toLocaleString('es-CL') : 'Sin monto';
        const nombre = t.comercio_nombre || t.local_nombre || 'Comercio';
        return `
          <div class="compra-card">
            <div class="compra-info">
              <div class="compra-nombre">${escHtml(nombre)}</div>
              <div class="compra-meta">📅 ${fecha} · 🧾 ${escHtml(t.numero_boleta || '—')}</div>
              ${t.local_direccion ? `<div class="compra-dir">📍 ${escHtml(t.local_direccion)}</div>` : ''}
            </div>
            <div class="compra-right">
              <div class="compra-monto">${monto}</div>
              <button class="compra-btn-boleta" onclick="MiCuenta.descargarBoleta(${i})">📄 Boleta</button>
            </div>
          </div>`;
      }).join('');
    } catch (e) {
      cont.innerHTML = '<div class="compras-empty">No pudimos cargar tus compras. Intenta más tarde.</div>';
    }
  }

  function escHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Generar boleta virtual en PDF (sin GPS)
  async function descargarBoleta(idx) {
    const t = _comprasCache[idx];
    if (!t) return;
    if (!window.jspdf || !window.jspdf.jsPDF) {
      window.mostrarToast && window.mostrarToast('Librería PDF no cargó, recarga la página', 3000, 'err');
      return;
    }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: [320, 480] });
    const W = 320;
    let y = 36;
    const center = (txt, size, bold, color) => {
      pdf.setFontSize(size);
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      if (color) pdf.setTextColor(...color); else pdf.setTextColor(40,40,40);
      pdf.text(txt, W/2, y, { align: 'center' });
    };
    const line = () => { pdf.setDrawColor(210,210,210); pdf.line(24, y, W-24, y); };

    // Cabecera marca
    center('MercaDate', 20, true, [255,138,0]); y += 18;
    center('Boleta Virtual', 10, false, [120,120,120]); y += 22;
    line(); y += 22;

    // Comercio
    center(t.comercio_nombre || t.local_nombre || 'Comercio', 14, true); y += 18;
    if (t.local_direccion) { center(t.local_direccion, 9, false, [120,120,120]); y += 14; }
    if (t.comercio_rut) { center('RUT ' + t.comercio_rut, 9, false, [120,120,120]); y += 14; }
    y += 8; line(); y += 22;

    // Datos transacción
    pdf.setFontSize(10); pdf.setTextColor(60,60,60); pdf.setFont('helvetica','normal');
    const row = (k, v) => {
      pdf.setFont('helvetica','normal'); pdf.text(k, 28, y);
      pdf.setFont('helvetica','bold'); pdf.text(String(v), W-28, y, { align:'right' });
      y += 18;
    };
    row('N° Boleta', t.numero_boleta || '—');
    row('Fecha', (t.fecha_hora_compra || t.fecha_registro_sistema || '').slice(0,10));

    // Detalle productos si existe
    let detalle = [];
    try { detalle = t.detalle_productos ? JSON.parse(t.detalle_productos) : []; } catch(e) {}
    if (Array.isArray(detalle) && detalle.length) {
      y += 6; line(); y += 18;
      pdf.setFont('helvetica','bold'); pdf.text('Detalle', 28, y); y += 16;
      pdf.setFont('helvetica','normal'); pdf.setFontSize(9);
      detalle.forEach(d => {
        const nom = (d.nombre || d.descripcion || 'Producto').slice(0, 26);
        const pr = d.precio ? '$' + Number(d.precio).toLocaleString('es-CL') : '';
        pdf.text(`${d.cantidad||1}x ${nom}`, 28, y);
        if (pr) pdf.text(pr, W-28, y, { align:'right' });
        y += 14;
      });
      pdf.setFontSize(10);
    }

    y += 6; line(); y += 24;
    // Total
    pdf.setFont('helvetica','bold'); pdf.setFontSize(15); pdf.setTextColor(255,138,0);
    pdf.text('TOTAL', 28, y);
    pdf.text(t.monto_total ? '$' + Number(t.monto_total).toLocaleString('es-CL') : '—', W-28, y, { align:'right' });
    y += 30;

    // Pie (sin GPS, como exige el reporte)
    pdf.setFont('helvetica','normal'); pdf.setFontSize(8); pdf.setTextColor(150,150,150);
    pdf.text('Comprobante generado por MercaDate', W/2, y, { align:'center' }); y += 12;
    pdf.text('Válido para garantías y rendiciones personales', W/2, y, { align:'center' });

    pdf.save('Boleta_' + (t.numero_boleta || 'mercadate') + '.pdf');
    window.mostrarToast && window.mostrarToast('Boleta descargada', 2500, 'ok');
  }

  // ─── TEMA ────────────────────────────────────────────────────────────────
  function aplicarTema(modo) {
    // modo: 'light' (Día = slate) | 'dark' (Noche) | 'auto' (por horario)
    const root = document.documentElement;
    // Día y Noche comparten el motor del tema oscuro; la clase .theme-dia
    // sólo cambia la paleta base a gris pizarra (más claro).
    const setDia   = () => { root.setAttribute('data-theme', 'dark'); root.classList.add('theme-dia'); };
    const setNoche = () => { root.setAttribute('data-theme', 'dark'); root.classList.remove('theme-dia'); };
    if (modo === 'auto') {
      window.SafeStorage.set('mercadate_theme', 'auto');
      const h = new Date().getHours();
      (h >= 7 && h < 19) ? setDia() : setNoche();
    } else if (modo === 'light') {
      window.SafeStorage.set('mercadate_theme', 'light');
      setDia();
    } else {
      window.SafeStorage.set('mercadate_theme', 'dark');
      setNoche();
    }
    marcarTemaActivo();
  }

  function marcarTemaActivo() {
    const guardado = window.SafeStorage.get('mercadate_theme') || 'auto';
    document.querySelectorAll('.theme-opt').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === guardado);
    });
  }

  // Re-evalúa el horario cada 10 min por si la app queda abierta cruzando
  // el límite día/noche (7am / 7pm) — solo aplica si el modo es 'auto' (default).
  setInterval(() => {
    const modo = window.SafeStorage.get('mercadate_theme') || 'auto';
    if (modo === 'auto') aplicarTema('auto');
  }, 10 * 60 * 1000);

  // ── Configuración del asistente de voz (Lila) — preferencias del usuario ───
  function _ssGet(k) { try { return window.SafeStorage ? window.SafeStorage.get(k) : localStorage.getItem(k); } catch (_) { return null; } }
  function _ssSet(k, v) { try { window.SafeStorage ? window.SafeStorage.set(k, v) : localStorage.setItem(k, v); } catch (_) {} }

  // ── Preferencia de mapa (Google Maps / Waze) ─────────────────────────────
  function renderMapaPref() {
    const pref = _ssGet('mercadate_mapa_pref') || 'google';
    const el = $('mapaPrefSeg'); if (!el) return;
    el.innerHTML = [['google', '🗺️ Google Maps'], ['waze', '🔵 Waze']].map(([v, l]) => {
      const on = v === pref;
      return `<button onclick="MiCuenta.setMapaPref('${v}')" style="padding:9px 4px;border-radius:9px;cursor:pointer;font-size:12.5px;font-family:inherit;`
        + (on ? 'background:#a855f7;color:#fff;border:none;font-weight:700' : 'background:var(--bg2,#0f1320);color:var(--muted);border:1px solid var(--border2,#2a3450)') + '">' + l + '</button>';
    }).join('');
  }
  function setMapaPref(v) {
    _ssSet('mercadate_mapa_pref', v);
    renderMapaPref();
    if (window.mostrarToast) window.mostrarToast(v === 'waze' ? '🔵 Waze seleccionado' : '🗺️ Google Maps seleccionado', 2000);
  }
  function _lilaPrefs() { try { return JSON.parse(_ssGet('mercadate_voz_user') || '{}'); } catch (_) { return {}; } }
  function _lilaPintarSwitch(on) {
    const s = $('lilaSwitch'); if (!s) return;
    s.style.background = on ? '#a855f7' : '#2a3450';
    s.innerHTML = '<span style="position:absolute;top:3px;left:' + (on ? '23px' : '3px') + ';width:18px;height:18px;background:#fff;border-radius:50%;transition:.2s"></span>';
  }

  function renderLilaConfig() {
    const activa = _ssGet('mercadate_lila_activa') !== '0';
    const sw = $('lilaActivar'); if (sw) sw.checked = activa;
    _lilaPintarSwitch(activa);
    const ctrl = $('lilaControles'); if (ctrl) { ctrl.style.opacity = activa ? '1' : '.45'; ctrl.style.pointerEvents = activa ? 'auto' : 'none'; }
  }

  function lilaToggle(on) {
    _ssSet('mercadate_lila_activa', on ? '1' : '0');
    _lilaPintarSwitch(on);
    const ctrl = $('lilaControles'); if (ctrl) { ctrl.style.opacity = on ? '1' : '.45'; ctrl.style.pointerEvents = on ? 'auto' : 'none'; }
    if (!on) {
      if (window._voiceAssistant && window._voiceAssistant.desactivarSiempre) window._voiceAssistant.desactivarSiempre();
    } else {
      // Al activar desde config: saludar y quedar esperando instrucciones.
      // No se exige _sesionConfirmada: si el usuario está en Mi Cuenta, ya está logueado.
      if (window._voiceAssistant && window._voiceAssistant.iniciarConSaludo) {
        window._voiceSaludoHecho = false;
        setTimeout(() => window._voiceAssistant.iniciarConSaludo(), 400);
      }
    }
    try { if (window._ulEvento) window._ulEvento(on ? 'lila_on' : 'lila_off'); } catch (_) {}
    if (window.mostrarToast) window.mostrarToast(on ? '🎙️ Lila activada' : 'Lila desactivada', 2500);
  }

  function lilaSet() { /* registro unificado, sin opciones */ }

  function renderNivelBarra() {
    const barra = $('mcNivelBarra');
    if (!barra) return;
    const est = window.gamifEstado || null;
    if (!est) { barra.style.display = 'none'; return; }
    barra.style.display = 'block';
    const COLORES = { 1:'#22c55e', 2:'#eab308', 3:'#f97316', 4:'#3b82f6', 5:'#a855f7', 6:'#ef4444' };
    const EMOJIS  = { 1:'🟢', 2:'🟡', 3:'🟠', 4:'🔵', 5:'🟣', 6:'🔴' };
    const color = COLORES[est.nivel] || '#22c55e';
    const emoji = EMOJIS[est.nivel]  || '🟢';
    const el = id => $(id);
    if (el('mcNivelEmoji'))   el('mcNivelEmoji').textContent   = emoji;
    if (el('mcNivelNombre'))  el('mcNivelNombre').textContent  = est.nivel_nombre || 'Explorador';
    if (el('mcNivelPuntos'))  el('mcNivelPuntos').textContent  = (est.puntos || 0).toLocaleString('es-CL') + ' puntos';
    const fill = el('mcNivelBarFill');
    if (fill) { fill.style.width = (est.progreso_pct || 0) + '%'; fill.style.background = color; }
    const lbl = el('mcNivelBarLabel');
    if (lbl) lbl.textContent = est.siguiente_nivel
      ? `Faltan ${est.puntos_para_siguiente} pts para ${est.siguiente_nivel}`
      : '¡Nivel máximo alcanzado! 🎉';
  }

  // ─── PERFIL ───────────────────────────────────────────────────────────────
  async function guardarPerfil() {
    const u = user(); if (!u) return;
    const datos = {
      nombre:   window.limitarTexto($('mc_nombre').value.trim(), 80),
      email:    window.limitarTexto($('mc_email').value.trim(), 120),
      telefono: window.limitarTexto($('mc_telefono').value.trim(), 20),
      comuna:   window.limitarTexto($('mc_comuna').value.trim(), 60)
    };
    if (datos.email && !window.esEmailValido(datos.email)) {
      return window.mostrarToast('Email inválido', 3000, 'err');
    }
    const r = await window.Api.patch('/usuario/' + u.id, datos);
    if (r.ok && r.data.success) {
      saveUsuario(r.data.usuario);
      window.mostrarToast('✅ Perfil actualizado');
    } else {
      window.mostrarToast(r.data.message || 'Error al guardar', 3000, 'err');
    }
  }

  // ─── SEGURIDAD ────────────────────────────────────────────────────────────
  async function cambiarUsername() {
    const u = user(); if (!u) return;
    const nuevo = $('mc_nuevo_user').value.trim();
    const pass  = $('mc_pass_actual_u').value;
    if (!nuevo || nuevo.length < 3) return window.mostrarToast('Mínimo 3 caracteres', 3000, 'err');
    if (!/^[a-zA-Z0-9._-]+$/.test(nuevo)) return window.mostrarToast('Solo letras, números, . _ -', 3000, 'err');
    const r = await window.Api.post('/usuario/' + u.id + '/cambiar-username',
      { nuevo_username: nuevo, password_actual: pass });
    if (r.data.success) {
      const updated = { ...u, username: nuevo };
      saveUsuario(updated);
      $('mc_nuevo_user').value=''; $('mc_pass_actual_u').value='';
      window.mostrarToast('✅ Usuario actualizado');
    } else window.mostrarToast(r.data.message || 'Error', 3000, 'err');
  }

  async function cambiarPassword() {
    const u = user(); if (!u) return;
    const actual = $('mc_pass_actual').value;
    const nueva  = $('mc_pass_nueva').value;
    const conf   = $('mc_pass_conf').value;
    if (!nueva || nueva.length < 6) return window.mostrarToast('Mínimo 6 caracteres', 3000, 'err');
    if (nueva !== conf) return window.mostrarToast('Las contraseñas no coinciden', 3000, 'err');
    const r = await window.Api.post('/usuario/' + u.id + '/cambiar-password',
      { password_actual: actual, password_nueva: nueva });
    if (r.data.success) {
      ['mc_pass_actual','mc_pass_nueva','mc_pass_conf'].forEach(id => $(id).value = '');
      window.mostrarToast('✅ Contraseña actualizada');
    } else window.mostrarToast(r.data.message || 'Error', 3000, 'err');
  }


  // Bases emoji por clave (sin tono ni pelo) — solo 👨/👩 soportan ZWJ+pelo fiable
  const _AB = {
    nino:    { b:'\u{1F9D2}', h:'' },
    nina:    { b:'\u{1F467}', h:'' },
    joven_m: { b:'\u{1F466}', h:'' },
    joven_f: { b:'\u{1F469}', h:'\u200D\u{1F9B1}' },
    hombre:  { b:'\u{1F468}', h:'' },
    mujer:   { b:'\u{1F469}', h:'' },
    tio:     { b:'\u{1F9D4}', h:'' },
    tia:     { b:'\u{1F469}', h:'\u200D\u{1F9B0}' },
    abuelo:  { b:'\u{1F474}', h:'' },
    abuela:  { b:'\u{1F475}', h:'' },
  };
  const _GENEROS = [
    { val:'hombre', lbl:'Hombre', emoji:'\u{1F468}' },
    { val:'mujer',  lbl:'Mujer',  emoji:'\u{1F469}' },
    { val:'neutro', lbl:'Neutro', emoji:'\u{1F9D1}' },
  ];
  const _EDADES = [
    { val:'joven',  lbl:'Joven'  },
    { val:'adulto', lbl:'Adulto' },
    { val:'mayor',  lbl:'Mayor'  },
  ];
  const _TONOS = [
    { val:'',         bg:'#fce0c8', lbl:'A' },
    { val:'\u{1F3FB}', bg:'#f6dec6', lbl:'B' },
    { val:'\u{1F3FC}', bg:'#e8c39e', lbl:'C' },
    { val:'\u{1F3FD}', bg:'#d29b6b', lbl:'D' },
    { val:'\u{1F3FE}', bg:'#9e6a3a', lbl:'E' },
    { val:'\u{1F3FF}', bg:'#5e3a1f', lbl:'F' },
  ];
  const _PELOS_UI = [
    { val:'',       lbl:'Natural'    },
    { val:'rojo',   lbl:'Pelirrojo'  },
    { val:'rizado', lbl:'Rizado'     },
    { val:'canoso', lbl:'Canoso'     },
    { val:'calvo',  lbl:'Sin pelo'   },
  ];

  // Compositor: delega en el helper compartido (utils.js)
  function componerEmoji(p) {
    return window.componerAvatarEmoji ? window.componerAvatarEmoji(p) : '\u{1F9D1}';
  }

  // ─── AVATAR ───────────────────────────────────────────────────────────────
  function renderAvatarPicker() {
    const grid = document.getElementById('mcAvatarGrid');
    if (!grid) return;
    if (!window.AVATARS || !Object.keys(window.AVATARS).length) {
      setTimeout(renderAvatarPicker, 150); return;
    }

    // ── Selector Avatar / Foto (se inserta una vez, antes del grid) ──
    let toggle = document.getElementById('mcAvatarToggle');
    if (!toggle) {
      toggle = document.createElement('div');
      toggle.id = 'mcAvatarToggle';
      toggle.style.cssText = 'display:flex;gap:8px;margin-bottom:14px';
      grid.parentNode.insertBefore(toggle, grid);
    }
    const _tb = (act) =>
      'flex:1;padding:9px 4px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:.18s;' +
      'border:2px solid ' + (act ? 'var(--accent,#f0b429)' : 'var(--border,#2a3342)') + ';' +
      'background:' + (act ? 'rgba(240,180,41,.12)' : 'transparent') + ';' +
      'color:' + (act ? 'var(--accent,#f0b429)' : 'var(--muted,#94a3b8)');
    const esFoto = _modoAvatar === 'foto';
    toggle.innerHTML =
      '<button type="button" onclick="MiCuenta.modoAvatar(\'avatar\')" style="' + _tb(!esFoto) + '">🎭 Avatar</button>' +
      '<button type="button" onclick="MiCuenta.modoAvatar(\'foto\')" style="' + _tb(esFoto) + '">📷 Mi foto</button>';

    // ── Combinador (solo en modo avatar): preview + género + edad ──
    if (esFoto) {
      grid.style.display = 'none';
    } else {
      grid.style.display = 'block';
      grid.style.marginTop = '4px';
      const preview = componerEmoji({ genero:_avGenero, edad:_avEdad, tono:_avTono, pelo:_avPelo });
      const seg = (act, label, on) =>
        `<button type="button" ${on} style="flex:1;padding:9px 4px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;transition:.18s;` +
        `border:2px solid ${act?'var(--accent,#f0b429)':'var(--border,#2a3342)'};` +
        `background:${act?'rgba(240,180,41,.12)':'transparent'};` +
        `color:${act?'var(--accent,#f0b429)':'var(--muted,#94a3b8)'}">${label}</button>`;
      grid.innerHTML =
        `<div style="display:flex;justify-content:center;margin-bottom:16px">
           <div style="width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;
                background:linear-gradient(135deg,#1b2433,#151c28);border:3px solid var(--accent,#f0b429)">
             <span style="font-size:54px;line-height:1">${preview}</span>
           </div>
         </div>
         <div style="font-size:11px;font-weight:700;color:var(--muted,#94a3b8);margin-bottom:7px">👤 Género</div>
         <div style="display:flex;gap:8px;margin-bottom:14px">
           ${_GENEROS.map(g => seg(_avGenero===g.val, g.emoji+' '+g.lbl, `onclick="MiCuenta.seleccionarGenero('${g.val}')"`)).join('')}
         </div>
         <div style="font-size:11px;font-weight:700;color:var(--muted,#94a3b8);margin-bottom:7px">🎂 Edad</div>
         <div style="display:flex;gap:8px">
           ${_EDADES.map(e => seg(_avEdad===e.val, e.lbl, `onclick="MiCuenta.seleccionarEdad('${e.val}')"`)).join('')}
         </div>`;
    }

    // ── Extras (debajo del grid): tono+pelo en modo avatar, foto en modo foto ──
    let extras = document.getElementById('mcAvatarExtras');
    if (!extras) {
      extras = document.createElement('div');
      extras.id = 'mcAvatarExtras';
      grid.parentNode.insertBefore(extras, grid.nextSibling);
    }

    if (esFoto) {
      extras.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px">
          <div id="mcFotoPreview" style="width:64px;height:64px;border-radius:50%;overflow:hidden;border:3px solid var(--accent,#f0b429);
               background:var(--card,#1e2837);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:24px">
            ${_fotoBase64 ? `<img src="${_fotoBase64}" style="width:100%;height:100%;object-fit:cover" alt="">` : '📷'}
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            <button type="button" onclick="MiCuenta.elegirFoto()" class="mc-btn-action mc-btn-primary"
                    style="font-size:13px;padding:8px 16px">📷 Elegir foto</button>
            ${_fotoBase64 ? `<button type="button" onclick="MiCuenta.quitarFoto()" class="mc-btn-action"
                    style="font-size:12px;padding:5px 12px;color:#ef4444;border-color:#ef4444">✕ Quitar foto</button>` : ''}
          </div>
        </div>
        <p style="font-size:11px;color:var(--muted,#94a3b8);margin:10px 0 0">
          Arrastra y pellizca para encuadrar tu rostro. Solo se sube el recorte (~5 KB). La original nunca se sube.
        </p>
        <input type="file" id="mcFotoInput" accept="image/*" style="display:none" onchange="MiCuenta.procesarFoto(this)">
      `;
    } else {
      const peloVisible = (_avEdad === 'adulto'); // el pelo solo combina bien en adultos
      extras.innerHTML = `
        <div style="margin-top:16px">
          <div style="font-size:11px;font-weight:700;color:var(--muted,#94a3b8);margin-bottom:7px">🎨 Tono de piel</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${_TONOS.map(t => `<button type="button" onclick="MiCuenta.seleccionarTono('${t.val}')" title="${t.lbl}"
              style="width:34px;height:34px;border-radius:50%;background:${t.bg};cursor:pointer;transition:.18s;flex-shrink:0;
                     border:3px solid ${_avTono===t.val ? 'var(--accent,#f0b429)' : 'transparent'}"></button>`).join('')}
          </div>
        </div>
        <div style="margin-top:12px${peloVisible ? '' : ';display:none'}">
          <div style="font-size:11px;font-weight:700;color:var(--muted,#94a3b8);margin-bottom:7px">💈 Pelo (color y estilo) <span style="font-weight:500;opacity:.8">· combina con cualquier tono de piel</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${_PELOS_UI.map(p => `<button type="button" onclick="MiCuenta.seleccionarPelo('${p.val}')"
              style="padding:5px 12px;border-radius:100px;font-size:12px;cursor:pointer;transition:.18s;
                     border:2px solid ${_avPelo===p.val ? 'var(--accent,#f0b429)' : 'var(--border,#2a3342)'};
                     background:${_avPelo===p.val ? 'rgba(240,180,41,.12)' : 'transparent'};
                     color:${_avPelo===p.val ? 'var(--accent,#f0b429)' : 'var(--muted,#94a3b8)'}">${p.lbl}</button>`).join('')}
          </div>
        </div>
      `;
    }
  }

  async function _guardarConfig() {
    const u = user(); if (!u) return;
    if (_modoAvatar === 'foto' && _fotoBase64) return; // en modo foto no se pisa la foto
    const emoji = componerEmoji({ genero:_avGenero, edad:_avEdad, tono:_avTono, pelo:_avPelo });
    const avatar_url = 'emoji:' + emoji;
    const personaje = Object.assign({}, u.personaje || {}, {
      genero:_avGenero, edad:_avEdad, tono:_avTono, pelo:_avPelo,
    });
    delete personaje.avatarKey; delete personaje.avatarTono; delete personaje.avatarPelo; // limpiar esquema viejo
    try {
      const [rPerfil, rPers] = await Promise.all([
        window.Api.patch('/usuario/' + u.id, { avatar_url }),
        window.Api.post('/usuario/personaje', { user_id: u.id, personaje }),
      ]);
      const okPerfil = rPerfil && (rPerfil.ok || (rPerfil.data && rPerfil.data.success));
      const okPers   = rPers   && (rPers.ok   || (rPers.data   && rPers.data.success));
      if (okPerfil && okPers) {
        u.avatar_url = avatar_url; u.personaje = personaje;
        saveUsuario(u);
        if (window.actualizarPersonajeUsuario) window.actualizarPersonajeUsuario();
        window.mostrarToast && window.mostrarToast('✅ Avatar guardado', 1800, 'ok');
      } else if ((rPerfil && rPerfil.status === 401) || (rPers && rPers.status === 401)) {
        window.mostrarToast && window.mostrarToast('Tu sesión expiró. Vuelve a iniciar sesión.', 3000, 'err');
      } else {
        window.mostrarToast && window.mostrarToast('No se pudo guardar el avatar. Reintenta.', 3000, 'err');
      }
    } catch (e) {
      window.mostrarToast && window.mostrarToast('Error de conexión al guardar el avatar', 3000, 'err');
    }
  }

  async function guardarAvatar() { await _guardarConfig(); }

  function modoAvatar(modo) { _modoAvatar = modo; renderAvatarPicker(); }

  async function seleccionarGenero(g) {
    _avGenero = g;
    if (_modoAvatar === 'foto') { _modoAvatar = 'avatar'; _fotoBase64 = null; }
    renderAvatarPicker(); await _guardarConfig();
  }
  async function seleccionarEdad(e) {
    _avEdad = e;
    if (_avEdad !== 'adulto') _avPelo = ''; // el pelo solo aplica a adultos
    renderAvatarPicker(); await _guardarConfig();
  }
  async function seleccionarTono(tono) { _avTono = tono; renderAvatarPicker(); await _guardarConfig(); }
  async function seleccionarPelo(pelo) { _avPelo = pelo; renderAvatarPicker(); await _guardarConfig(); }

  // ─── Foto de perfil con recortador ───────────────────────────────────────
  function elegirFoto() { const i=document.getElementById('mcFotoInput'); if(i) i.click(); }

  function procesarFoto(input) {
    const file=input.files&&input.files[0]; if(!file||!file.type.startsWith('image/')) return;
    const reader=new FileReader();
    reader.onload=e=>abrirCrop(e.target.result);
    reader.readAsDataURL(file); input.value='';
  }

  function abrirCrop(src) {
    if (!document.getElementById('mcCropOverlay')) {
      const ov=document.createElement('div'); ov.id='mcCropOverlay';
      ov.style.cssText='position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
      ov.innerHTML='<p style="color:#fff;font-size:13px;margin:0 0 14px;opacity:.75;text-align:center">☝️ Arrastra para encuadrar · Pellizca / rueda para zoom</p>'+
        '<div style="position:relative;width:'+CROP_S+'px;height:'+CROP_S+'px">'+
        '<canvas id="mcCropCanvas" width="'+CROP_S+'" height="'+CROP_S+'" style="display:block;border-radius:50%;cursor:grab;touch-action:none;box-shadow:0 0 0 9999px rgba(0,0,0,.85)"></canvas>'+
        '<div style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(255,255,255,.6);pointer-events:none"></div></div>'+
        '<div style="display:flex;gap:12px;margin-top:20px">'+
        '<button onclick="MiCuenta.cancelarCrop()" style="padding:12px 24px;border-radius:100px;border:2px solid #fff;background:transparent;color:#fff;font-size:14px;font-weight:700;cursor:pointer">✕ Cancelar</button>'+
        '<button onclick="MiCuenta.confirmarCrop()" style="padding:12px 28px;border-radius:100px;border:none;background:#22c55e;color:#fff;font-size:14px;font-weight:700;cursor:pointer">✓ Usar esta foto</button></div>';
      document.body.appendChild(ov);
      const cv=ov.querySelector('#mcCropCanvas');
      cv.addEventListener('mousedown',e=>{_cropDrag=true;_cropLX=e.clientX;_cropLY=e.clientY;cv.style.cursor='grabbing';});
      window.addEventListener('mousemove',e=>{if(!_cropDrag)return;_cropX+=e.clientX-_cropLX;_cropY+=e.clientY-_cropLY;_cropLX=e.clientX;_cropLY=e.clientY;_renderCrop();});
      window.addEventListener('mouseup',()=>{_cropDrag=false;cv.style.cursor='grab';});
      cv.addEventListener('wheel',e=>{e.preventDefault();_cropScale=Math.max(.3,Math.min(6,_cropScale*(1-e.deltaY*.0008)));_renderCrop();},{passive:false});
      cv.addEventListener('touchstart',e=>{e.preventDefault();if(e.touches.length===1){_cropDrag=true;_cropLX=e.touches[0].clientX;_cropLY=e.touches[0].clientY;}if(e.touches.length===2)_cropPinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);},{passive:false});
      cv.addEventListener('touchmove',e=>{e.preventDefault();if(e.touches.length===1&&_cropDrag){_cropX+=e.touches[0].clientX-_cropLX;_cropY+=e.touches[0].clientY-_cropLY;_cropLX=e.touches[0].clientX;_cropLY=e.touches[0].clientY;}if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);_cropScale=Math.max(.3,Math.min(6,_cropScale*(d/_cropPinch)));_cropPinch=d;}_renderCrop();},{passive:false});
      cv.addEventListener('touchend',()=>{_cropDrag=false;});
    }
    document.getElementById('mcCropOverlay').style.display='flex';
    const img=new Image();
    img.onload=()=>{_cropImg=img;_cropScale=Math.max(CROP_S/img.width,CROP_S/img.height);_cropX=(CROP_S-img.width*_cropScale)/2;_cropY=(CROP_S-img.height*_cropScale)/2;_renderCrop();};
    img.src=src;
  }

  function _renderCrop(){const cv=document.getElementById('mcCropCanvas');if(!cv||!_cropImg)return;const ctx=cv.getContext('2d');ctx.clearRect(0,0,CROP_S,CROP_S);ctx.drawImage(_cropImg,_cropX,_cropY,_cropImg.width*_cropScale,_cropImg.height*_cropScale);}
  function cancelarCrop(){const ov=document.getElementById('mcCropOverlay');if(ov)ov.style.display='none';_cropImg=null;}

  async function confirmarCrop() {
    if(!_cropImg) return;
    const out=document.createElement('canvas'); out.width=out.height=80;
    const octx=out.getContext('2d'),r=80/CROP_S;
    octx.drawImage(_cropImg,_cropX*r,_cropY*r,_cropImg.width*_cropScale*r,_cropImg.height*_cropScale*r);
    const webp=out.toDataURL('image/webp',.82);
    _fotoBase64=webp.startsWith('data:image/webp')?webp:out.toDataURL('image/jpeg',.85);
    _fotoQuitada=false; cancelarCrop(); renderAvatarPicker();
    const u=user(); if(!u) return;
    try {
      const res=await window.Api.patch('/usuario/'+u.id,{avatar_url:_fotoBase64});
      const ok = res && (res.ok || (res.data && res.data.success));
      if(ok){
        u.avatar_url=_fotoBase64; saveUsuario(u);
        if(window.actualizarPersonajeUsuario)window.actualizarPersonajeUsuario();
        window.mostrarToast&&window.mostrarToast('✅ Foto guardada',2000,'ok');
      } else if (res && res.status===401){
        window.mostrarToast&&window.mostrarToast('Tu sesión expiró. Vuelve a iniciar sesión.',3000,'err');
      } else {
        window.mostrarToast&&window.mostrarToast('No se pudo guardar la foto. Reintenta.',3000,'err');
      }
    } catch(e){
      window.mostrarToast&&window.mostrarToast('Error de conexión al guardar la foto',3000,'err');
    }
  }

  async function quitarFoto() {
    _fotoBase64=null;_fotoQuitada=true;_modoAvatar='avatar';
    const u=user(); if(!u) return;
    const emoji=componerEmoji({genero:_avGenero,edad:_avEdad,tono:_avTono,pelo:_avPelo});
    const av='emoji:'+emoji;
    await window.Api.patch('/usuario/'+u.id,{avatar_url:av});
    u.avatar_url=av; saveUsuario(u);
    if(window.actualizarPersonajeUsuario)window.actualizarPersonajeUsuario();
    renderAvatarPicker();
    window.mostrarToast&&window.mostrarToast('✅ Foto eliminada',2000,'ok');
  }

  // ─── RESEÑAS ──────────────────────────────────────────────────────────────
  async function publicarResena() {
    const u = user(); if (!u) return window.mostrarToast('Inicia sesión para reseñar', 3000, 'err');
    if ((u.nivel || 1) < 3 && !(window._esPeriodoLibre && window._esPeriodoLibre(u))) return window.mostrarToast('🔒 Necesitas Nivel 3 (Cazador de Precios) para dejar reseñas', 3000, 'err');
    const comentario = window.limitarTexto($('mc_review_comentario').value.trim(), 2000);
    if (comentario.length < 5) return window.mostrarToast('Tu reseña debe tener al menos 5 caracteres', 3000, 'err');
    const titulo = window.limitarTexto($('mc_review_titulo').value.trim(), 120);
    const r = await window.Api.post('/reviews', {
      user_id: u.id, user_nombre: u.nombre || u.username,
      rating: 0, titulo, comentario
    });
    if (r.data && r.data.success) {
      $('mc_review_titulo').value=''; $('mc_review_comentario').value='';
      window.mostrarToast('🙌 Gracias por tu reseña');
      cargarReseñas();
    } else window.mostrarToast((r.data && r.data.message) || 'No se pudo enviar la reseña', 3000, 'err');
  }

  async function cargarReseñas() {
    const u = user(); if (!u) return;
    const r = await window.Api.get('/reviews?user_id=' + u.id + '&limit=10');
    const cont = $('mcMisResenas');
    if (!cont) return;
    if (!r.ok || !Array.isArray(r.data) || !r.data.length) {
      cont.innerHTML = '<p style="color:#64748b;font-size:13px;text-align:center;padding:14px">Aún no has dejado reseñas</p>';
      return;
    }
    const esc = window.escapeHtml;
    cont.innerHTML = r.data.map(rev => {
      const fecha = new Date(rev.fecha).toLocaleDateString('es-CL', { day:'2-digit', month:'short', year:'numeric' });
      const estrellas = '⭐'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);
      return `<div class="mc-review-item">
        <div class="mc-review-stars">${estrellas}</div>
        ${rev.titulo ? `<strong style="font-size:13px;display:block;margin-top:4px">${esc(rev.titulo)}</strong>` : ''}
        <p style="font-size:13px;color:#e2e8f0;margin-top:4px;white-space:pre-wrap">${esc(rev.comentario)}</p>
        <div class="mc-review-fecha">${fecha}${rev.visible_publico ? '' : ' · oculta'}</div>
        ${rev.respuesta_admin ? `<div class="mc-review-resp"><strong>Respuesta del equipo:</strong><br>${esc(rev.respuesta_admin)}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ─── AYUDA ────────────────────────────────────────────────────────────────
  async function cerrarSesion() {
    if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
    try { await fetch('/api/usuario/logout', { method:'POST', credentials:'same-origin' }); } catch(_) {}
    try { localStorage.removeItem('mercadate_user'); } catch(_) {}
    location.reload();
  }

  async function eliminarCuenta() {
    const u = user();
    if (!confirm('¿Solicitar eliminación de tu cuenta?\n\nTus datos serán eliminados permanentemente. Esta acción no se puede deshacer.')) return;
    if (!confirm('Confirma nuevamente: ¿eliminar cuenta de ' + (u?.nombre || u?.username || 'usuario') + '?')) return;
    try {
      await fetch('/api/usuario/soporte', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: u?.id, asunto: 'Solicitud de eliminación de cuenta', mensaje: 'El usuario solicita la eliminación permanente de su cuenta y todos sus datos.' })
      });
      window.mostrarToast && window.mostrarToast('✅ Solicitud enviada. Te contactaremos para confirmar.', 5000, 'ok');
    } catch(_) {
      window.mostrarToast && window.mostrarToast('Error al enviar solicitud. Intenta más tarde.', 3000, 'err');
    }
  }

  function abrirFormAyuda(tipo) {
    tipoAyudaActual = tipo;
    const titulos = { comentario_usuario: '💬 Enviar comentarios', soporte_usuario: '🛠️ Soporte Técnico' };
    $('mcAyudaTitulo').textContent = titulos[tipo];
    $('mcAyudaOpciones').style.display = 'none';
    $('mcAyudaFormulario').style.display = 'block';
  }

  function volverAyuda() {
    $('mcAyudaOpciones').style.display = 'block';
    $('mcAyudaFormulario').style.display = 'none';
    const hilo = $('mcHilo'); if (hilo) hilo.style.display = 'none';
    cargarMisConversaciones();
  }

  async function cargarNotificaciones() {
    const u = user(); if (!u) return;
    const r = await window.Api.get('/usuario/notificaciones?user_id=' + u.id);
    const lista = (r.data?.notificaciones) || [];
    const cont = $('mcNotifLista');
    if (!cont) return;
    // Marcar leídas
    if (r.data?.no_leidas > 0) {
      window.Api.post('/usuario/notificaciones/leer', { user_id: u.id });
      actualizarBadgeNotif(0);
    }
    if (!lista.length) {
      cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Sin notificaciones por ahora.</p>';
      return;
    }
    const iconos = { reporte_ok: '✅', nivel_up: '🎉', limite_diario: '🔄', info: 'ℹ️' };
    cont.innerHTML = lista.map(n => {
      const ico = iconos[n.tipo] || '🔔';
      const fecha = new Date(n.fecha).toLocaleDateString('es-CL', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<div class="mc-notif-item${n.leido ? '' : ' unread'}">
        <span class="mc-notif-ico">${ico}</span>
        <div class="mc-notif-body">
          <div class="mc-notif-titulo">${escHtml(n.titulo)}</div>
          ${n.mensaje ? `<div class="mc-notif-msg">${escHtml(n.mensaje)}</div>` : ''}
          <div class="mc-notif-fecha">${fecha}</div>
        </div>
      </div>`;
    }).join('');
  }

  function actualizarBadgeNotif(n) {
    ['notifBadge','mcNotifBadge'].forEach(id => {
      const el = $(id); if (!el) return;
      if (n > 0) { el.textContent = n; el.style.display = 'inline'; }
      else el.style.display = 'none';
    });
  }

  async function cargarBadgeNotificaciones() {
    const u = user(); if (!u) return;
    const r = await window.Api.get('/usuario/notificaciones?user_id=' + u.id + '&limit=1');
    if (r.data?.no_leidas > 0) actualizarBadgeNotif(r.data.no_leidas);
  }

  async function abrirNotificaciones() {
    const popup = document.getElementById('avisosPopup');
    if (!popup) { abrir(); setTimeout(() => tab('notificaciones'), 120); return; }
    popup.style.display = 'flex';
    const cont = document.getElementById('avisosLista');
    if (cont) cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:16px">Cargando…</p>';
    const u = user(); if (!u) return;
    const r = await window.Api.get('/usuario/notificaciones?user_id=' + u.id);
    const lista = r.data?.notificaciones || [];
    if (r.data?.no_leidas > 0) {
      window.Api.post('/usuario/notificaciones/leer', { user_id: u.id });
      actualizarBadgeNotif(0);
    }
    if (!cont) return;
    if (!lista.length) {
      cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:24px">Sin avisos por ahora.</p>';
      return;
    }
    const iconos = { reporte_ok:'✅', nivel_up:'🎉', limite_diario:'🔄', info:'ℹ️' };
    cont.innerHTML = lista.map(n => {
      const ico = iconos[n.tipo] || '🔔';
      const fecha = new Date(n.fecha).toLocaleDateString('es-CL', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<div class="mc-notif-item${n.leido ? '' : ' unread'}">
        <span class="mc-notif-ico">${ico}</span>
        <div class="mc-notif-body">
          <div class="mc-notif-titulo">${escHtml(n.titulo)}</div>
          ${n.mensaje ? `<div class="mc-notif-msg">${escHtml(n.mensaje)}</div>` : ''}
          <div class="mc-notif-fecha">${fecha}</div>
        </div>
      </div>`;
    }).join('');
  }

  window.cerrarAvisosPopup = function() {
    const p = document.getElementById('avisosPopup');
    if (p) p.style.display = 'none';
  };
  let _convCache = [];
  let _hiloActivo = null;

  async function cargarMisConversaciones() {
    const cont = $('mcConversaciones');
    if (!cont) return;
    const u = user();
    if (!u) { cont.innerHTML = '<div style="font-size:13px;color:var(--text2)">Inicia sesión para ver tus mensajes.</div>'; return; }
    try {
      const r = await window.Api.get('/conversaciones/usuario/' + u.id);
      _convCache = (r.data && r.data.conversaciones) || [];
      if (!_convCache.length) {
        cont.innerHTML = '<div style="font-size:13px;color:var(--text2)">Aún no tienes conversaciones.</div>';
        return;
      }
      cont.innerHTML = _convCache.map((c, i) => {
        const noLeido = c.no_leidos_origen > 0;
        const estado = c.estado === 'respondido' ? '🟢 Respondido' : c.estado === 'cerrado' ? '⚪ Cerrado' : '🟡 Abierto';
        return `
          <button class="mc-conv-item" onclick="MiCuenta.abrirHilo(${i})">
            <div style="flex:1;text-align:left">
              <div style="font-weight:${noLeido?700:600};font-size:13px;color:var(--text)">${escHtml(c.asunto || '')}${noLeido ? ' <span class="mc-conv-dot"></span>' : ''}</div>
              <div style="font-size:11px;color:var(--text2);margin-top:2px">${escHtml((c.ultimo_mensaje||'').slice(0,48))}</div>
            </div>
            <span style="font-size:10px;color:var(--text2);white-space:nowrap">${estado}</span>
          </button>`;
      }).join('');
    } catch (e) {
      cont.innerHTML = '<div style="font-size:13px;color:var(--text2)">No se pudieron cargar tus mensajes.</div>';
    }
  }

  async function abrirHilo(idx) {
    const c = _convCache[idx];
    if (!c) return;
    _hiloActivo = c.id;
    const r = await window.Api.get('/conversaciones/' + c.id + '/hilo');
    const conv = r.data && r.data.conversacion;
    if (!conv) return;
    $('mcAyudaOpciones').style.display = 'none';
    $('mcHilo').style.display = 'block';
    $('mcHiloAsunto').textContent = conv.asunto || 'Conversación';
    $('mcHiloBody').innerHTML = (conv.mensajes || []).map(m => {
      const esAdmin = m.autor_tipo === 'admin';
      return `
        <div class="mc-bubble-row ${esAdmin ? 'admin' : 'yo'}">
          <div class="mc-bubble ${esAdmin ? 'admin' : 'yo'}">
            <div class="mc-bubble-autor">${escHtml(m.autor_nombre || (esAdmin ? 'Soporte MercaDate' : 'Tú'))}</div>
            <div>${escHtml(m.contenido)}</div>
          </div>
        </div>`;
    }).join('');
    const body = $('mcHiloBody');
    setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);
  }

  async function responderHilo() {
    if (!_hiloActivo) return;
    const u = user();
    const texto = $('mc_hilo_respuesta').value.trim();
    if (!texto) return window.mostrarToast('Escribe una respuesta', 3000, 'err');
    const r = await window.Api.post('/conversaciones/' + _hiloActivo + '/responder', {
      contenido: texto, autor_tipo: 'usuario', autor_nombre: u.nombre || u.username
    });
    if (r.data && r.data.success) {
      $('mc_hilo_respuesta').value = '';
      // Recargar el hilo
      const idx = _convCache.findIndex(c => c.id === _hiloActivo);
      if (idx >= 0) abrirHilo(idx);
      window.mostrarToast('Mensaje enviado', 2000, 'ok');
    } else {
      window.mostrarToast('No se pudo enviar', 3000, 'err');
    }
  }

  async function enviarAyuda() {
    const u = user(); if (!u) return;
    const mensaje = window.limitarTexto($('mc_ayuda_mensaje').value.trim(), 2000);
    if (!mensaje) return window.mostrarToast('Escribe un mensaje', 3000, 'err');
    const r = await window.Api.post('/usuario/soporte', {
      user_id: u.id, user_nombre: u.nombre || u.username,
      tipo: tipoAyudaActual,
      asunto: window.limitarTexto($('mc_ayuda_asunto').value.trim(), 120),
      mensaje
    });
    if (r.data.success) {
      $('mc_ayuda_asunto').value=''; $('mc_ayuda_mensaje').value='';
      window.mostrarToast(tipoAyudaActual === 'soporte_usuario' ? '✅ Ticket enviado' : '✅ ¡Gracias por tu comentario!');
      setTimeout(cerrar, 1200);
    } else window.mostrarToast(r.data.message || 'Error', 3000, 'err');
  }

  // ─── Inicialización ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const u = user();
    if (u) saveUsuario(u);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
    $('miCuentaModal')?.addEventListener('click', e => {
      if (e.target.id === 'miCuentaModal') cerrar();
    });
  });

  function copiarEmailInvitacion() {
    var el = document.getElementById('mcInviteEmail');
    var email = el ? (el.textContent || '').trim() : '';
    if (!email || email === '—') return;
    var ok = function () { try { (window.mostrarToast || function(){})('📋 Email copiado'); } catch (_) {} };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(email).then(ok).catch(function () { _copiarFallback(email); ok(); });
    } else { _copiarFallback(email); ok(); }
  }
  function _copiarFallback(txt) {
    try {
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    } catch (_) {}
  }

  return {
    abrir, cerrar, tab,
    guardarPerfil, cambiarUsername, cambiarPassword,
    seleccionarGenero, seleccionarEdad, guardarAvatar, seleccionarTono, seleccionarPelo,
    elegirFoto, procesarFoto, cancelarCrop, confirmarCrop, quitarFoto, modoAvatar,
    publicarResena, cargarReseñas,
    cerrarSesion, eliminarCuenta,
    abrirFormAyuda, volverAyuda, enviarAyuda,
    aplicarTema, marcarTemaActivo,
    lilaToggle, lilaSet, renderLilaConfig,
    setMapaPref, renderMapaPref,
    saveUsuario,
    cargarMisCompras, descargarBoleta,
    cargarMisConversaciones, abrirHilo, responderHilo,
    cargarNotificaciones, actualizarBadgeNotif, cargarBadgeNotificaciones, abrirNotificaciones,
    copiarEmailInvitacion, cargarAlertas, cargarFavoritos
  };
})();
