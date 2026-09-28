// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comerciante
// ARCHIVO    : app.js
// ═══════════════════════════════════════════════════
// app.js — Estado global, navegación, utilidades compartidas
// Punto de entrada que orquesta los demás módulos.

window.app = (function () {

  // ── Planes (cargados desde el backend al iniciar para reflejar cambios del admin) ──
  let PLANES = [
    { cupo: 0,    nombre: 'Gratuito', precio: 0,     ilimitado: false, requiereDesde: null, icon: '🆓', color: '#64748b' },
    { cupo: 25,   nombre: 'Básico',   precio: 4990,  ilimitado: false, requiereDesde: null, icon: '🌱', color: '#10b981' },
    { cupo: 50,   nombre: 'Pro',      precio: 12990, ilimitado: false, requiereDesde: null, icon: '⚡', color: '#3b82f6' },
    { cupo: 100,  nombre: 'Premium',  precio: 24990, ilimitado: false, requiereDesde: null, icon: '👑', color: '#8b5cf6' },
    { cupo: 9999, nombre: 'Deluxe',   precio: 39990, ilimitado: true,  requiereDesde: 100,  icon: '💎', color: '#f59e0b' }
  ];

  // Carga los planes vigentes desde el backend (refleja cambios del admin)
  async function cargarPlanes() {
    try {
      const r = await api.get('/planes');
      // El endpoint retorna { planes: [...], cupo_gratuito, promociones_activas }
      const lista = r.ok ? (Array.isArray(r.data) ? r.data : r.data?.planes) : null;
      if (Array.isArray(lista) && lista.length) {
        PLANES = lista.map(p => ({
          cupo: p.cupo, nombre: p.nombre, precio: p.precio,
          ilimitado: !!p.ilimitado, requiereDesde: p.requiereDesde ?? p.requiere_desde ?? null, // null = sin requisito (undefined marcaba todos como "Solo desde Premium")
          icon: p.icon || '🆓', color: p.color || '#64748b'
        }));
      }
    } catch (e) { console.warn('[cargarPlanes]', e.message); }
  }

  const CUPO_GRATUITO = { productos: 14, servicios: 7, gastronomia: 10 };

  // ── Estado global compartido ─────────────────────────────────────────────
  const STATE = {
    owner: null,            // { username, password, whatsapp_admin }
    allLocales: [],
    activeLocal: null,      // el local actualmente seleccionado
    importBuffer: [],
    planPendienteCambio: null,  // {nuevoCupo, prorrateo, pagoId}
    conflictoPayload: null      // payload de local que pidió crear con nombre duplicado
  };

  // ── Utilidades ───────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  function clp(n) {
    if (n === null || n === undefined || isNaN(n)) return '$0';
    return '$' + Number(n).toLocaleString('es-CL');
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function toast(msg, tipo) {
    const t = $('toast');
    t.textContent = msg;
    t.style.background = tipo === 'ok' ? '#065f46' : tipo === 'err' ? '#991b1b' : '#1e293b';
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
  }

  function cerrarModal(id) { $(id).classList.remove('open'); }
  function abrirModal(id)  { $(id).classList.add('open'); }

  // ── Helpers de planes ────────────────────────────────────────────────────
  function getPlan(cupo) {
    if (!cupo || cupo <= 0) return PLANES[0];
    return PLANES.find(p => p.cupo === cupo) || PLANES[0];
  }

  function getCupoGratuito(tipo) {
    return CUPO_GRATUITO[tipo] || CUPO_GRATUITO.productos;
  }

  // Cupo efectivo del local: si tiene plan pagado usa ese; si está en gratuito (0), usa el cupo según tipo
  function cupoEfectivo(local) {
    if (!local) return 0;
    if (local.plan_ilimitado) return Infinity;
    if (local.plan && local.plan > 0) return local.plan;
    return getCupoGratuito(local.tipo_negocio || 'productos');
  }

  // ── Navegación entre secciones ───────────────────────────────────────────
  function mostrar(sec) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    $(sec)?.classList.add('active');
    $('nav-' + sec)?.classList.add('active');

    if (sec === 'cdashboard') cdashboard.cargar();
    if (sec === 'productos')  productos.renderTabla();
    if (sec === 'alertas')    productos.cargarAlertas();
    if (sec === 'locales')    locales.render();
    if (sec === 'membresia')  cargarPlanes().then(() => membresia.render()); // refresca desde admin
    if (sec === 'cuenta')     cuenta.render();
    if (sec === 'mensajes')   window.mensajes && mensajes.cargar();
    if (sec === 'delivery')   window.cdelivery && cdelivery.cargar();
    else                      window.cdelivery && cdelivery.detenerPolling();
  }

  // ── Refresca UI cuando cambia el local activo o sus productos ────────────
  function actualizarUI() {
    const local = STATE.activeLocal;
    if (!local) return;

    const plan = getPlan(local.plan || 0);
    const cupoMax = cupoEfectivo(local);
    const habilitados = (local.productos || []).filter(p => p.estado === 'habilitado').length;
    const perc = cupoMax === Infinity ? 100 : Math.min((habilitados / cupoMax) * 100, 100);

    // Sidebar
    $('sideLocalName').textContent = `📍 ${local.nombre} · ${local.comuna || '—'}`;
    $('sidePlanName').textContent = plan.icon + ' ' + plan.nombre;
    $('sidePlanBar').style.width = perc + '%';
    $('sidePlanBar').style.background = plan.color;
    $('sidePlanCount').textContent = `${habilitados} / ${cupoMax === Infinity ? '∞' : cupoMax} activos`;

    // Estado operativo del local (Sprint 1)
    const estado = local.estado_operativo || 'abierto';
    const badgeMap = {
      abierto: { txt: '🟢 Abierto', color: 'var(--ok)' },
      pausado: { txt: '🟡 Pausado', color: 'var(--warn)' },
      cerrado: { txt: '🔴 Cerrado', color: 'var(--err)' }
    };
    const b = badgeMap[estado] || badgeMap.abierto;
    const badge = $('sideEstadoBadge');
    if (badge) { badge.textContent = b.txt; badge.style.color = b.color; }

    // Header inventario
    $('mainLocalTitle').textContent = local.nombre;
    $('mainLocalSub').textContent = `${local.direccion ? local.direccion + ' · ' : ''}${local.comuna || ''} · ${plan.icon} ${plan.nombre}`;

    // Stats
    const prods = local.productos || [];
    $('statTotal').textContent       = prods.length;
    $('statActivos').textContent     = prods.filter(p => p.estado === 'habilitado').length;
    $('statPausados').textContent    = prods.filter(p => p.estado === 'pausado').length;
    $('statRestringidos').textContent = prods.filter(p => p.estado === 'restringido').length;

    // Botón nuevo producto
    const limitado = habilitados >= cupoMax;
    $('btnNuevoProd').disabled = limitado && (local.plan || 0) === 0;
    $('btnNuevoProd').title = limitado ? `Límite del plan ${window.escapeHtml(plan.nombre)} alcanzado` : '';

    productos.renderTabla();
  }

  // ── Recargar locales desde el servidor ───────────────────────────────────
  async function recargarLocales() {
    if (!STATE.owner) return;
    const r = await api.get('/comercio/mis-locales');
    if (r.ok && r.data?.success) {
      STATE.allLocales = r.data.locales || [];
      if (r.data.owner) STATE.owner.whatsapp_admin = r.data.owner.whatsapp_admin || null;
      if (STATE.activeLocal) {
        const updated = STATE.allLocales.find(l => l.id === STATE.activeLocal.id);
        if (updated) STATE.activeLocal = updated;
      }
      actualizarUI();
    }
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  async function init() {
    const boot = () => { const b = document.getElementById('bootScreen'); if (b) b.remove(); };
    const showLogin = () => { const ls = document.getElementById('loginScreen'); if (ls) ls.style.display = 'flex'; };

    // ── Enlace de recuperación de contraseña (?token=...) ──────────────────
    const _tokenReset = new URLSearchParams(location.search).get('token');
    if (_tokenReset) {
      boot();
      if (auth.iniciarReset) auth.iniciarReset(_tokenReset);
      return; // no seguimos al login/sesión; el flujo es solo resetear
    }

    try { await cargarPlanes(); } catch (_) { /* continuar aunque no carguen planes */ }

    // ── Resume de sesión por cookie ─────────────────────────────────────
    try {
      const r = await api.get('/comercio/mis-locales');
      if (r.ok && r.data?.success && r.data.locales?.length) {
        const owner = r.data.owner || {};
        STATE.owner = { username: owner.username || '', whatsapp_admin: owner.whatsapp_admin || null };
        STATE.allLocales = r.data.locales;
        boot();
        if (STATE.allLocales.length === 1) {
          auth.seleccionarLocal(0);
        } else {
          auth.renderSelectorLocales();
        }
        return; // sesión restaurada
      }
    } catch (_) { /* sin sesión — mostrar login */ }

    // Sin sesión activa
    boot();
    showLogin();

    // Listeners del formulario
    try {
      const drop = $('dropCSV');
      if (drop) {
        drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
        drop.addEventListener('drop', e => {
          e.preventDefault(); drop.classList.remove('drag');
          if (e.dataTransfer.files.length) {
            $('fileCSV').files = e.dataTransfer.files;
            productos.onFileCSV({ target: { files: e.dataTransfer.files } });
          }
        });
        $('fileCSV').addEventListener('change', productos.onFileCSV);
      }
      ['loginUser','loginPass'].forEach(id => {
        $(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') auth.login(); });
      });
    } catch (_) {}
  }

  return {
    get PLANES() { return PLANES; }, CUPO_GRATUITO, STATE, $,
    clp, toast, escapeHtml, cerrarModal, abrirModal,
    getPlan, getCupoGratuito, cupoEfectivo, cargarPlanes,
    mostrar, actualizarUI, recargarLocales, init
  };
})();
