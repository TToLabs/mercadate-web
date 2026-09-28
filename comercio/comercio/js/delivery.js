// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comercio MercaDate
// ARCHIVO    : delivery.js
// ═══════════════════════════════════════════════════
// delivery.js — Config de delivery del local + pedidos activos/historial + chat.
// El delivery requiere plan ≥ Básico (el gate real vive en el servidor).
window.cdelivery = (function () {
  const { STATE, $, toast, escapeHtml, clp } = app;

  let _cfg = null;          // config del local activo
  let _pedidos = [];
  let _abierto = null;      // id del pedido con el chat abierto
  let _timer = null;        // polling de pedidos activos (15s)

  const ESTADOS = {
    pendiente:        { txt: 'Pendiente',      emoji: '🟡' },
    confirmado:       { txt: 'Confirmado',     emoji: '🔵' },
    en_preparacion:   { txt: 'En preparación', emoji: '👨‍🍳' },
    en_camino:        { txt: 'En camino',      emoji: '🛵' },
    listo:            { txt: 'Listo p/ retiro',emoji: '📦' },
    entregado:        { txt: 'Entregado',      emoji: '✅' },
    rechazado:        { txt: 'Rechazado',      emoji: '❌' },
    rechazado_timeout:{ txt: 'Sin respuesta',  emoji: '⏰' },
    cancelado:        { txt: 'Cancelado',      emoji: '⚪' },
  };
  const fh = (s) => s ? String(s).replace('T', ' ').slice(0, 16) : '';

  // ── Carga principal ──────────────────────────────────────────────────────
  async function cargar() {
    await cargarConfig();
    await cargarPedidos();
    iniciarPolling();
  }

  async function cargarConfig() {
    const local = STATE.activeLocal;
    if (!local) return;
    const r = await api.get('/comercio/local/' + local.id + '/delivery-config');
    if (!r.ok) return;
    _cfg = r.data.config;
    renderConfig(r.data.puede_activar);
  }

  function renderConfig(puedeActivar) {
    const c = _cfg || {};
    const box = $('dlvConfig');
    if (!box) return;

    if (!puedeActivar) {
      box.innerHTML = `
        <div class="dlv-lock">
          <div class="dlv-lock-ic">🔒</div>
          <div>
            <b>El Delivery requiere plan Básico o superior.</b>
            <p>Activa tu membresía para recibir pedidos a domicilio y desbloquear todas las funciones de ese plan.</p>
            <button class="btn btn-primary" onclick="app.mostrar('membresia')">Ver planes</button>
          </div>
        </div>`;
      return;
    }

    box.innerHTML = `
      <div class="dlv-row">
        <label class="dlv-switch">
          <input type="checkbox" id="dlvActivo" ${c.delivery_activo ? 'checked' : ''}>
          <span>Delivery activado</span>
        </label>
      </div>
      <div class="dlv-grid">
        <div><label>Radio máximo (km)</label>
          <input type="number" id="dlvRadio" min="0" step="0.5" value="${c.radio_km ?? ''}"></div>
        <div><label>Pedido mínimo</label>
          <input type="number" id="dlvMinimo" min="0" step="500" value="${c.minimo_pedido ?? ''}"></div>
        <div><label>Tipo de costo</label>
          <select id="dlvCostoTipo">
            <option value="fijo"${c.costo_tipo === 'fijo' ? ' selected' : ''}>Fijo</option>
            <option value="gratis_desde"${c.costo_tipo === 'gratis_desde' ? ' selected' : ''}>Gratis desde un monto</option>
          </select></div>
        <div><label>Costo de despacho</label>
          <input type="number" id="dlvCosto" min="0" step="500" value="${c.costo ?? ''}"></div>
        <div><label>Gratis desde (monto)</label>
          <input type="number" id="dlvGratisDesde" min="0" step="1000" value="${c.costo_gratis_desde ?? ''}"></div>
        <div><label>Auto-rechazo si no confirmo (min)</label>
          <input type="number" id="dlvTimeout" min="1" max="120" value="${c.timeout_min ?? 10}"></div>
        <div class="dlv-wide"><label>Métodos de pago aceptados</label>
          <input type="text" id="dlvPagos" placeholder="efectivo, transferencia" value="${escapeHtml(c.metodos_pago || '')}"></div>
      </div>
      <p class="dlv-nota">MercaDate no procesa el pago ni el reparto: el despacho y el cobro son tuyos.
      Estos datos solo se le muestran al cliente.</p>
      <button class="btn btn-primary" onclick="cdelivery.guardarConfig()">Guardar configuración</button>`;
  }

  async function guardarConfig() {
    const local = STATE.activeLocal;
    if (!local) return;
    const body = {
      delivery_activo: $('dlvActivo').checked ? 1 : 0,
      radio_km:        $('dlvRadio').value,
      minimo_pedido:   $('dlvMinimo').value,
      costo_tipo:      $('dlvCostoTipo').value,
      costo:           $('dlvCosto').value,
      costo_gratis_desde: $('dlvGratisDesde').value,
      timeout_min:     $('dlvTimeout').value,
      metodos_pago:    $('dlvPagos').value,
    };
    const r = await api.post('/comercio/local/' + local.id + '/delivery-config', body);
    if (r.ok && r.data.success) {
      _cfg = r.data.config;
      toast('Configuración de delivery guardada.', 'ok');
    } else if (r.data && r.data.codigo === 'plan_insuficiente') {
      toast('El delivery requiere plan Básico o superior.', 'err');
      cargarConfig();
    } else {
      toast('No se pudo guardar.', 'err');
    }
  }

  // ── Pedidos ──────────────────────────────────────────────────────────────
  async function cargarPedidos(filtro) {
    const f = filtro || (document.querySelector('.dlv-tab.active')?.dataset.filtro) || 'activos';
    const r = await api.get('/comercio/pedidos?estado=' + encodeURIComponent(f));
    _pedidos = (r.data && r.data.pedidos) || [];
    renderPedidos();
    cargarStats();
  }

  function filtrar(f, btn) {
    document.querySelectorAll('.dlv-tab').forEach(b => b.classList.remove('active'));
    btn && btn.classList.add('active');
    cargarPedidos(f);
  }

  function renderPedidos() {
    const cont = $('dlvPedidos');
    if (!cont) return;
    if (!_pedidos.length) {
      cont.innerHTML = '<div class="dlv-empty">📭 Sin pedidos por ahora</div>';
      return;
    }
    cont.innerHTML = _pedidos.map(p => {
      const e = ESTADOS[p.estado] || { txt: p.estado, emoji: '•' };
      const items = (p.items || []).length;
      const noLeidos = p.no_leidos_comercio > 0
        ? `<span class="dlv-badge">${p.no_leidos_comercio}</span>` : '';
      return `
        <div class="dlv-card">
          <div class="dlv-card-top">
            <b>#${p.id} · ${e.emoji} ${e.txt}</b>
            <span class="dlv-tipo">${p.tipo === 'retiro' ? '🏪 Retiro' : '🛵 Delivery'}</span>
          </div>
          <div class="dlv-card-body">
            <div>👤 ${escapeHtml(p.usuario_nombre || p.usuario_username || 'Cliente')}</div>
            ${p.direccion_entrega ? `<div>📍 ${escapeHtml(p.direccion_entrega)}${p.distancia_km != null ? ` · ${p.distancia_km} km` : ''}</div>` : ''}
            <div>🧾 ${items} ítem(s) · Total ${clp(p.total)} ${p.costo_despacho ? `(despacho ${clp(p.costo_despacho)})` : ''}</div>
            <div class="dlv-fecha">${fh(p.fecha_creacion)}</div>
            ${p.motivo_rechazo ? `<div class="dlv-motivo">${escapeHtml(p.motivo_rechazo)}</div>` : ''}
          </div>
          <div class="dlv-acciones">${botonesDe(p)}
            <button class="btn btn-sm" onclick="cdelivery.abrirChat(${p.id})">💬 Chat ${noLeidos}</button>
          </div>
          <div class="dlv-chat" id="dlvChat${p.id}" style="display:none"></div>
        </div>`;
    }).join('');
  }

  // Botones según el estado actual (espejo de la máquina de estados del servidor).
  function botonesDe(p) {
    const b = [];
    if (p.estado === 'pendiente') {
      b.push(`<button class="btn btn-sm btn-primary" onclick="cdelivery.confirmar(${p.id})">✅ Confirmar</button>`);
      b.push(`<button class="btn btn-sm btn-danger" onclick="cdelivery.rechazar(${p.id})">❌ Rechazar</button>`);
    } else if (p.estado === 'confirmado') {
      b.push(`<button class="btn btn-sm btn-primary" onclick="cdelivery.estado(${p.id},'en_preparacion')">👨‍🍳 En preparación</button>`);
    } else if (p.estado === 'en_preparacion') {
      b.push(p.tipo === 'retiro'
        ? `<button class="btn btn-sm btn-primary" onclick="cdelivery.estado(${p.id},'listo')">📦 Listo para retiro</button>`
        : `<button class="btn btn-sm btn-primary" onclick="cdelivery.estado(${p.id},'en_camino')">🛵 En camino</button>`);
    } else if (p.estado === 'en_camino') {
      b.push('<span class="dlv-hint">El cliente confirma con el QR al recibir.</span>');
    }
    return b.join('');
  }

  async function confirmar(id) {
    const r = await api.post('/comercio/pedidos/' + id + '/confirmar', {});
    if (r.ok && r.data.success) { toast('Pedido confirmado.', 'ok'); cargarPedidos(); }
    else toast('No se pudo confirmar.', 'err');
  }

  async function rechazar(id) {
    const motivo = prompt('Motivo del rechazo (lo verá el cliente):', 'Sin stock disponible');
    if (motivo === null) return;
    const r = await api.post('/comercio/pedidos/' + id + '/rechazar', { motivo });
    if (r.ok && r.data.success) { toast('Pedido rechazado.', 'ok'); cargarPedidos(); }
    else toast('No se pudo rechazar.', 'err');
  }

  async function estado(id, nuevo) {
    const r = await api.post('/comercio/pedidos/' + id + '/estado', { estado: nuevo });
    if (r.ok && r.data.success) { cargarPedidos(); }
    else toast((r.data && r.data.message) || 'No se pudo cambiar el estado.', 'err');
  }

  // ── Chat del pedido ──────────────────────────────────────────────────────
  async function abrirChat(id) {
    const box = $('dlvChat' + id);
    if (!box) return;
    if (_abierto === id && box.style.display !== 'none') {
      box.style.display = 'none'; _abierto = null; return;
    }
    _abierto = id;
    box.style.display = 'block';
    const r = await api.get('/comercio/pedidos/' + id + '/mensajes');
    const msgs = (r.data && r.data.mensajes) || [];
    box.innerHTML = `
      <div class="dlv-msgs">${msgs.map(m => `
        <div class="dlv-msg ${m.autor_tipo === 'comercio' ? 'mio' : ''}">
          <span>${escapeHtml(m.contenido)}</span><em>${fh(m.fecha)}</em>
        </div>`).join('') || '<div class="dlv-empty">Sin mensajes</div>'}</div>
      <div class="dlv-msg-form">
        <input type="text" id="dlvMsg${id}" placeholder="Escribe al cliente…" maxlength="1000">
        <button class="btn btn-sm btn-primary" onclick="cdelivery.enviarMsg(${id})">Enviar</button>
      </div>`;
    $('dlvMsg' + id)?.addEventListener('keydown', e => { if (e.key === 'Enter') enviarMsg(id); });
  }

  async function enviarMsg(id) {
    const inp = $('dlvMsg' + id);
    const contenido = (inp.value || '').trim();
    if (!contenido) return;
    const r = await api.post('/comercio/pedidos/' + id + '/mensajes', { contenido });
    if (r.ok && r.data.success) { inp.value = ''; _abierto = null; abrirChat(id); }
    else toast('No se pudo enviar.', 'err');
  }

  // ── Stats ────────────────────────────────────────────────────────────────
  async function cargarStats() {
    const r = await api.get('/comercio/delivery/stats');
    const s = (r.data && r.data.stats) || {};
    const box = $('dlvStats');
    if (!box) return;
    box.innerHTML = `
      <div class="dlv-kpi"><b>${s.total || 0}</b><span>Pedidos</span></div>
      <div class="dlv-kpi"><b>${s.entregados || 0}</b><span>Entregados</span></div>
      <div class="dlv-kpi"><b>${s.tasa_cancelacion || 0}%</b><span>Cancelación</span></div>
      <div class="dlv-kpi"><b>${clp(s.ticket_promedio || 0)}</b><span>Ticket prom.</span></div>
      <div class="dlv-kpi"><b>${s.rating_promedio || '—'}</b><span>Calificación</span></div>`;
  }

  // ── Polling 15s solo mientras la sección está visible ─────────────────────
  function iniciarPolling() {
    detenerPolling();
    _timer = setInterval(() => {
      const sec = document.getElementById('delivery');
      if (!sec || !sec.classList.contains('active')) return detenerPolling();
      cargarPedidos();
    }, 15000);
  }
  function detenerPolling() { if (_timer) { clearInterval(_timer); _timer = null; } }

  return { cargar, guardarConfig, cargarPedidos, filtrar, confirmar, rechazar, estado,
           abrirChat, enviarMsg, detenerPolling };
})();
