// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comercio MercaDate
// ARCHIVO    : mensajes.js
// ═══════════════════════════════════════════════════
// mensajes.js — Bandeja de mensajes del comercio (hilo con MercaDate)
window.mensajes = (function () {
  const { STATE, $, toast } = app;
  let _lista = [];
  let _activa = null;

  function esc(s) { return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fh(s) { return s ? String(s).replace('T',' ').slice(0,16) : ''; }

  async function cargar() {
    if (!STATE.owner) return;
    const cont = $('cmsgList');
    cont.innerHTML = '<div class="cmsg-empty">Cargando…</div>';
    const r = await api.get('/comercio/conversaciones/' + encodeURIComponent(STATE.owner.username));
    _lista = (r.data && r.data.conversaciones) || [];
    actualizarBadge((r.data && r.data.no_leidas) || 0);
    if (!_lista.length) {
      cont.innerHTML = '<div class="cmsg-empty">📭 Sin mensajes</div>';
      return;
    }
    cont.innerHTML = _lista.map((c, i) => {
      const noLeido = c.no_leidos_origen > 0;
      const estado = c.estado === 'respondido' ? '🟢' : c.estado === 'cerrado' ? '⚪' : '🟡';
      return `
        <div class="cmsg-item${noLeido?' unread':''}${_activa===c.id?' active':''}" onclick="mensajes.abrir(${i})">
          <div class="cmsg-item-subj">${estado} ${esc(c.asunto||'')}${noLeido?' <span class="cmsg-dot"></span>':''}</div>
          <div class="cmsg-item-prev">${esc((c.ultimo_mensaje||'').slice(0,52))}</div>
          <div class="cmsg-item-fecha">${fh(c.fecha_actualizacion)}</div>
        </div>`;
    }).join('');
  }

  function actualizarBadge(n) {
    const b = $('cMensajesBadge');
    if (!b) return;
    if (n > 0) { b.textContent = n; b.style.display = 'inline'; }
    else b.style.display = 'none';
  }

  const QUICK_REPLIES = [
    '¡Gracias por contactarnos! 😊',
    'Ya actualizamos el precio.',
    'Pronto te respondemos.',
    'El producto está disponible.',
    'Por el momento no contamos con ese producto.',
    'Puedes venir en horario de atención.',
  ];

  function renderQuickChips() {
    const cont = $('cmsgQuickChips');
    if (!cont) return;
    cont.innerHTML = QUICK_REPLIES.map(txt =>
      `<button onclick="mensajes.usarChip(${JSON.stringify(txt)})"
        style="background:var(--card2,#1a2233);border:1px solid var(--border2,#2a3450);
        color:var(--text);border-radius:20px;padding:4px 12px;font-size:11.5px;
        cursor:pointer;font-family:inherit;transition:background .12s"
        onmouseover="this.style.background='rgba(255,138,0,.12)'"
        onmouseout="this.style.background='var(--card2,#1a2233)'">${esc(txt)}</button>`
    ).join('');
  }

  function usarChip(txt) {
    const input = $('cmsgReplyInput');
    if (input) { input.value = txt; input.focus(); }
  }

  async function abrir(i) {
    const c = _lista[i];
    if (!c) return;
    _activa = c.id;
    const r = await api.get('/conversaciones/' + c.id + '/hilo');
    const conv = r.data && r.data.conversacion;
    if (!conv) return;
    $('cmsgThreadEmpty').style.display = 'none';
    $('cmsgThreadView').style.display = 'flex';
    renderQuickChips();
    initContador();
    $('cmsgThreadHeader').innerHTML = `<strong>${esc(conv.asunto||'')}</strong>`;
    $('cmsgThreadBody').innerHTML = (conv.mensajes||[]).map(m => {
      const admin = m.autor_tipo === 'admin';
      return `<div class="cmsg-brow ${admin?'admin':'yo'}">
        <div class="cmsg-bubble ${admin?'admin':'yo'}">
          <div class="cmsg-bubble-autor">${esc(m.autor_nombre || (admin?'Ápale!':'Tú'))}</div>
          <div>${esc(m.contenido)}</div>
        </div></div>`;
    }).join('');
    const body = $('cmsgThreadBody');
    setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);
    cargar(); // refresca no leídos
  }

  function initContador() {
    const ta = document.getElementById('cmsgReplyInput');
    const cnt = document.getElementById('cmsgCharCount');
    if (!ta || !cnt) return;
    ta.addEventListener('input', () => {
      const n = ta.value.length;
      cnt.textContent = n + ' / 500';
      cnt.style.color = n > 450 ? '#ef4444' : 'var(--muted)';
      if (n > 500) ta.value = ta.value.slice(0, 500);
    });
  }

  async function responder() {
    if (!_activa) return;
    const input = $('cmsgReplyInput');
    const texto = input.value.trim();
    if (!texto) return toast('Escribe una respuesta', 'err');
    const r = await api.post('/conversaciones/' + _activa + '/responder', {
      contenido: texto, autor_tipo: 'comercio', autor_nombre: STATE.owner.username
    });
    if (r.data && r.data.success) {
      input.value = '';
      const idx = _lista.findIndex(c => c.id === _activa);
      if (idx >= 0) abrir(idx);
      toast('Mensaje enviado', 'ok');
    } else toast('No se pudo enviar', 'err');
  }

  return { cargar, abrir, responder, actualizarBadge, usarChip };
})();
