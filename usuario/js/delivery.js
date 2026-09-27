// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente MercaDate
// ARCHIVO    : delivery.js
// ═══════════════════════════════════════════════════
// delivery.js — Checkout (delivery/retiro), seguimiento del pedido, chat, QR y calificación.
// El radio y el costo los valida SIEMPRE el servidor; aquí solo se muestran.
window.Delivery = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));
  const clp = n => (window.formatoCLP ? window.formatoCLP(n) : '$' + (n || 0));

  let _cfg = null;        // config delivery del local en checkout
  let _localId = null;
  let _items = [];        // ítems del carrito de ese local
  let _subtotal = 0;
  let _tipo = 'delivery';
  let _dest = null;       // {lat,lng}
  let _valid = null;      // respuesta de validar-radio
  let _timer = null;      // polling seguimiento

  const ESTADOS = {
    pendiente:        { txt: 'Esperando confirmación del comercio', emoji: '🟡' },
    confirmado:       { txt: 'Confirmado',      emoji: '🔵' },
    en_preparacion:   { txt: 'En preparación',  emoji: '👨‍🍳' },
    en_camino:        { txt: 'En camino',       emoji: '🛵' },
    listo:            { txt: 'Listo para retiro', emoji: '📦' },
    entregado:        { txt: 'Entregado',       emoji: '✅' },
    rechazado:        { txt: 'Rechazado',       emoji: '❌' },
    rechazado_timeout:{ txt: 'Sin respuesta del comercio', emoji: '⏰' },
    cancelado:        { txt: 'Cancelado',       emoji: '⚪' },
  };

  // ── Modal base ───────────────────────────────────────────────────────────
  function modal() {
    let m = $('dlvModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'dlvModal';
    m.className = 'dlv-modal';
    m.innerHTML = `<div class="dlv-sheet">
        <div class="dlv-head"><b id="dlvTitulo">Pedido</b>
          <button class="dlv-x" onclick="Delivery.cerrar()">✕</button></div>
        <div class="dlv-body" id="dlvBody"></div>
      </div>`;
    document.body.appendChild(m);
    return m;
  }
  function abrir(titulo) {
    const m = modal();
    $('dlvTitulo').textContent = titulo;
    m.classList.add('open');
  }
  function cerrar() {
    $('dlvModal')?.classList.remove('open');
    detenerPolling();
  }

  // ── Checkout ─────────────────────────────────────────────────────────────
  async function abrirCheckout(localId) {
    _localId = localId; _tipo = 'delivery'; _dest = null; _valid = null;
    abrir('Finalizar pedido');
    $('dlvBody').innerHTML = '<div class="dlv-load">Cargando…</div>';

    const [rc, rcar] = await Promise.all([
      Api.get('/local/' + localId + '/delivery'),
      Api.get('/usuario/carrito'),
    ]);
    if (!rc.ok || !rc.data.success) { $('dlvBody').innerHTML = '<div class="dlv-load">No se pudo cargar el comercio.</div>'; return; }
    _cfg = rc.data.delivery;

    // Ítems de ese local desde el carrito ya cargado
    const grupo = ((rcar.data && rcar.data.comercios) || []).find(c => c.local_id === localId);
    if (!grupo) { $('dlvBody').innerHTML = '<div class="dlv-load">No hay productos de este comercio en tu carrito.</div>'; return; }
    _items = grupo.productos.map(p => ({
      producto_id: p.producto_id || p.id, nombre: p.nombre,
      categoria: p.categoria, precio_unit: p.precio, cantidad: p.cantidad,
    }));
    _subtotal = grupo.subtotal;
    renderPaso1(grupo);
  }

  function renderPaso1(grupo) {
    const hayDelivery = !!_cfg.activo;
    $('dlvBody').innerHTML = `
      <div class="dlv-resumen">
        <div class="dlv-local">📍 ${esc(grupo.local_nombre)}</div>
        <div class="dlv-sub">${_items.length} producto(s) · Subtotal ${clp(_subtotal)}</div>
      </div>
      <div class="dlv-opts">
        <button class="dlv-opt${hayDelivery ? ' sel' : ' off'}" id="dlvOptD"
          ${hayDelivery ? 'onclick="Delivery.elegirTipo(\'delivery\')"' : 'disabled'}>
          🛵 <b>Delivery</b><span>${hayDelivery ? 'A tu dirección' : 'No disponible en este comercio'}</span></button>
        <button class="dlv-opt${hayDelivery ? '' : ' sel'}" id="dlvOptR" onclick="Delivery.elegirTipo('retiro')">
          🏪 <b>Retiro en local</b><span>Vas tú a buscarlo</span></button>
      </div>
      <div id="dlvPaso2"></div>`;
    elegirTipo(hayDelivery ? 'delivery' : 'retiro');
  }

  function elegirTipo(t) {
    _tipo = t;
    $('dlvOptD')?.classList.toggle('sel', t === 'delivery');
    $('dlvOptR')?.classList.toggle('sel', t === 'retiro');
    const box = $('dlvPaso2');
    if (t === 'retiro') {
      box.innerHTML = totalesHtml(0) + tycHtml() + confirmarHtml();
      return;
    }
    box.innerHTML = `
      <div class="dlv-campo">
        <label>Dirección de entrega</label>
        <input type="text" id="dlvDir" placeholder="Calle, número, referencia" maxlength="300">
        <button class="dlv-gps" onclick="Delivery.usarMiUbicacion()">📍 Usar mi ubicación actual</button>
        <div class="dlv-msg" id="dlvGeoMsg"></div>
      </div>
      <div id="dlvTotales"></div>`;
  }

  // Toma el GPS y pide al SERVIDOR que valide radio y calcule costo.
  function usarMiUbicacion() {
    const msg = $('dlvGeoMsg');
    if (!navigator.geolocation) { msg.textContent = 'Tu dispositivo no permite ubicación.'; return; }
    msg.textContent = 'Obteniendo ubicación…';
    navigator.geolocation.getCurrentPosition(async pos => {
      _dest = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const r = await Api.post('/pedidos/validar-radio', {
        local_id: _localId, lat: _dest.lat, lng: _dest.lng, subtotal: _subtotal,
      });
      _valid = r.data || {};
      if (!_valid.disponible) {
        msg.innerHTML = '<span class="dlv-err">Este comercio no despacha a tu zona.</span>';
        $('dlvTotales').innerHTML = '';
        return;
      }
      msg.innerHTML = `<span class="dlv-ok">✅ Dentro del radio · ${_valid.distancia_km} km</span>`;
      $('dlvTotales').innerHTML = totalesHtml(_valid.costo_despacho) + tycHtml() + confirmarHtml();
    }, () => { msg.innerHTML = '<span class="dlv-err">No pudimos obtener tu ubicación.</span>'; },
      { enableHighAccuracy: true, timeout: 10000 });
  }

  function totalesHtml(costo) {
    const total = _subtotal + (costo || 0);
    const bajoMin = _cfg.minimo_pedido && _subtotal < _cfg.minimo_pedido;
    return `<div class="dlv-tot">
      <div><span>Subtotal</span><b>${clp(_subtotal)}</b></div>
      ${_tipo === 'delivery' ? `<div><span>Despacho</span><b>${costo ? clp(costo) : 'Gratis'}</b></div>` : ''}
      <div class="dlv-tot-final"><span>Total</span><b>${clp(total)}</b></div>
      ${bajoMin ? `<div class="dlv-err">El pedido mínimo es ${clp(_cfg.minimo_pedido)}.</div>` : ''}
      ${_cfg.metodos_pago ? `<div class="dlv-pago">Pago acordado con el comercio: ${esc(_cfg.metodos_pago)}</div>` : ''}
    </div>`;
  }

  function tycHtml() {
    return `<label class="dlv-tyc">
      <input type="checkbox" id="dlvTyc">
      <span>Acepto los <a href="legal/delivery-tos.html" target="_blank" rel="noopener">Términos del Servicio de Delivery</a>.
      El comercio es responsable del producto y de la entrega; MercaDate es el canal.</span></label>`;
  }
  function confirmarHtml() {
    return `<button class="dlv-btn" onclick="Delivery.confirmar()">Confirmar pedido</button>
      <div class="dlv-msg" id="dlvConfMsg"></div>`;
  }

  async function confirmar() {
    const msg = $('dlvConfMsg');
    if (!$('dlvTyc')?.checked) { msg.innerHTML = '<span class="dlv-err">Debes aceptar los Términos del Delivery.</span>'; return; }
    if (_tipo === 'delivery' && !_dest) { msg.innerHTML = '<span class="dlv-err">Indica tu ubicación de entrega.</span>'; return; }
    msg.textContent = 'Enviando pedido…';
    const body = {
      local_id: _localId, tipo: _tipo, items: _items,
      metodo_pago: _cfg.metodos_pago || null,
      notas: null,
    };
    if (_tipo === 'delivery') {
      body.dest_lat = _dest.lat; body.dest_lng = _dest.lng;
      body.direccion_entrega = ($('dlvDir')?.value || '').trim();
    }
    const r = await Api.post('/pedidos', body);
    if (r.ok && r.data.success) { seguir(r.data.pedido.id); }
    else msg.innerHTML = `<span class="dlv-err">${esc((r.data && r.data.message) || 'No se pudo crear el pedido.')}</span>`;
  }

  // ── Seguimiento del pedido (polling 15s) ─────────────────────────────────
  async function seguir(id) {
    abrir('Mi pedido #' + id);
    await pintarPedido(id);
    detenerPolling();
    _timer = setInterval(() => {
      if (!$('dlvModal')?.classList.contains('open')) return detenerPolling();
      pintarPedido(id, true);
    }, 15000);
  }

  async function pintarPedido(id, silencioso) {
    const body = $('dlvBody');
    if (!silencioso) body.innerHTML = '<div class="dlv-load">Cargando…</div>';
    const r = await Api.get('/pedidos/' + id);
    if (!r.ok || !r.data.success) { body.innerHTML = '<div class="dlv-load">No se pudo cargar el pedido.</div>'; return; }
    const p = r.data.pedido;
    const e = ESTADOS[p.estado] || { txt: p.estado, emoji: '•' };

    let extra = '';
    if (p.estado === 'en_camino' && p.qr_token) {
      extra = `<div class="dlv-qr">
        <p>Muestra este código al recibir tu pedido:</p>
        <div id="dlvQrBox"></div>
        <small>Código de un solo uso.</small>
        <button class="dlv-btn" onclick="Delivery.confirmarEntrega(${p.id},'${esc(p.qr_token)}')">Ya recibí mi pedido</button>
      </div>`;
    }
    if (p.estado === 'entregado' && !p.calificacion) {
      extra = `<div class="dlv-cal">
        <p>¿Cómo estuvo tu pedido?</p>
        <div class="dlv-stars" id="dlvStars">
          ${[1,2,3,4,5].map(n => `<span onclick="Delivery.setEstrellas(${n})" data-n="${n}">☆</span>`).join('')}
        </div>
        <textarea id="dlvOpinion" placeholder="Cuéntanos (opcional)" maxlength="500"></textarea>
        <button class="dlv-btn" onclick="Delivery.calificar(${p.id})">Enviar calificación</button>
      </div>`;
    }
    if (p.motivo_rechazo) extra += `<div class="dlv-err" style="margin-top:8px">${esc(p.motivo_rechazo)}</div>`;

    body.innerHTML = `
      <div class="dlv-estado"><span class="dlv-emoji">${e.emoji}</span><b>${esc(e.txt)}</b></div>
      <div class="dlv-resumen">
        <div class="dlv-local">📍 ${esc(p.local_nombre || '')}</div>
        <div class="dlv-sub">${p.tipo === 'retiro' ? '🏪 Retiro en local' : '🛵 Delivery'} · Total ${clp(p.total)}</div>
        ${p.direccion_entrega ? `<div class="dlv-sub">${esc(p.direccion_entrega)}</div>` : ''}
      </div>
      ${extra}
      <div class="dlv-chatbox">
        <b>Chat con el comercio</b>
        <div class="dlv-msgs" id="dlvMsgs"></div>
        <div class="dlv-msg-form">
          <input type="text" id="dlvMsgIn" placeholder="Escribe al comercio…" maxlength="1000">
          <button class="dlv-btn-sm" onclick="Delivery.enviarMsg(${p.id})">Enviar</button>
        </div>
      </div>`;

    if (p.estado === 'en_camino' && p.qr_token && window.QRCode) {
      try { new QRCode($('dlvQrBox'), { text: p.qr_token, width: 160, height: 160 }); } catch (_) {}
    }
    cargarMensajes(p.id);
  }

  async function cargarMensajes(id) {
    const r = await Api.get('/pedidos/' + id + '/mensajes');
    const msgs = (r.data && r.data.mensajes) || [];
    const box = $('dlvMsgs');
    if (!box) return;
    box.innerHTML = msgs.map(m => `<div class="dlv-msg-b ${m.autor_tipo === 'usuario' ? 'mio' : ''}">
      ${esc(m.contenido)}</div>`).join('') || '<div class="dlv-sub">Sin mensajes aún</div>';
    box.scrollTop = box.scrollHeight;
  }

  async function enviarMsg(id) {
    const inp = $('dlvMsgIn');
    const contenido = (inp.value || '').trim();
    if (!contenido) return;
    const r = await Api.post('/pedidos/' + id + '/mensajes', { contenido });
    if (r.ok && r.data.success) { inp.value = ''; cargarMensajes(id); }
  }

  // Confirmar entrega: envía el token del QR + GPS actual (el servidor valida ambos).
  function confirmarEntrega(id, token) {
    const enviar = (lat, lng) => Api.post('/pedidos/' + id + '/confirmar-entrega', {
      token_qr: token, gps_lat: lat, gps_lng: lng,
    }).then(r => {
      if (r.ok && r.data.success) pintarPedido(id);
      else alert((r.data && r.data.message) || 'No se pudo confirmar la entrega.');
    });
    if (!navigator.geolocation) return enviar(null, null);
    navigator.geolocation.getCurrentPosition(
      pos => enviar(pos.coords.latitude, pos.coords.longitude),
      () => enviar(null, null), { timeout: 8000 });
  }

  let _estrellas = 0;
  function setEstrellas(n) {
    _estrellas = n;
    document.querySelectorAll('#dlvStars span').forEach(s => {
      s.textContent = Number(s.dataset.n) <= n ? '★' : '☆';
    });
  }
  async function calificar(id) {
    if (!_estrellas) { alert('Elige de 1 a 5 estrellas.'); return; }
    const r = await Api.post('/pedidos/' + id + '/calificar', {
      calificacion: _estrellas, opinion: ($('dlvOpinion')?.value || '').trim(),
    });
    if (r.ok && r.data.success) { _estrellas = 0; pintarPedido(id); }
    else alert('No se pudo enviar la calificación.');
  }

  // ── Mis pedidos ──────────────────────────────────────────────────────────
  async function misPedidos() {
    abrir('Mis pedidos');
    $('dlvBody').innerHTML = '<div class="dlv-load">Cargando…</div>';
    const r = await Api.get('/pedidos');
    const lista = (r.data && r.data.pedidos) || [];
    if (!lista.length) { $('dlvBody').innerHTML = '<div class="dlv-load">Aún no tienes pedidos.</div>'; return; }
    $('dlvBody').innerHTML = lista.map(p => {
      const e = ESTADOS[p.estado] || { txt: p.estado, emoji: '•' };
      return `<button class="dlv-ped" onclick="Delivery.seguir(${p.id})">
        <b>#${p.id} · ${e.emoji} ${esc(e.txt)}</b>
        <span>${esc(p.local_nombre || '')} · ${clp(p.total)}</span></button>`;
    }).join('');
  }

  function detenerPolling() { if (_timer) { clearInterval(_timer); _timer = null; } }

  return { abrirCheckout, elegirTipo, usarMiUbicacion, confirmar, seguir,
           enviarMsg, confirmarEntrega, setEstrellas, calificar, misPedidos, cerrar };
})();
