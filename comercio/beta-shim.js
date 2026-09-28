// PLATAFORMA : App Comercio beta — responde /api en MODO DEMOSTRACIÓN y avisa actualizaciones de la APK
// Se carga ANTES que todo el resto. No hay servidor: el panel entra solo a un local
// FICTICIO ("Almacén Demo"); inventario, stock y códigos de barras se guardan en el
// propio teléfono (localStorage) para probar el flujo completo. Ningún dato real de
// comercios viaja ni se publica (Ley 21.719). Planes/flags/TyC = foto de endpoints públicos.
(function () {
  'use strict';

  var APP_VERSION = window.MD_APP_VERSION || 0;
  var URL_VERSION = 'https://ttolabs.github.io/mercadate-web/comercio/version.json';
  var URL_APK = 'https://github.com/TToLabs/mercadate-web/releases/download/latest/mercadate-comercio.apk';
  var CLAVE = 'md_comercio_demo_v1';

  window.MERCADATE_APP = true;
  window.MERCADATE_BETA = true;

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var fetchOriginal = window.fetch.bind(window);
  var cache = {};

  // localStorage envuelto: en contextos restringidos tira SecurityError (regla CLAUDE.md)
  function leerLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guardarLocal(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function datos(nombre) {
    if (!cache[nombre]) {
      cache[nombre] = fetchOriginal(BASE + 'datos/' + nombre + '.json').then(function (r) {
        if (!r.ok) throw new Error('sin datos ' + nombre);
        return r.json();
      });
    }
    return cache[nombre];
  }
  function responder(cuerpo, estado) {
    return new Response(JSON.stringify(cuerpo), { status: estado || 200, headers: { 'Content-Type': 'application/json' } });
  }

  // ── Local ficticio (se crea una vez y después vive en el teléfono) ──
  var HOY = new Date().toISOString();
  function prod(id, nombre, categoria, marca, peso, precio, codigo, stock) {
    return { id: id, nombre: nombre, categoria: categoria, marca: marca, peso: peso, precio: precio,
      descripcion: '', disponible: 1, estado: 'habilitado', tiempo_preparacion: null,
      etiquetas_dieteticas: null, destacado: 0, agotado: 0, ultima_actualizacion: HOY,
      imagenes: [], codigo_barras: codigo, stock: stock };
  }
  function localInicial() {
    return {
      id: 1, owner_id: 1, comercio_id: 1, usuario: 'demo', whatsapp_admin: null,
      nombre: 'Almacén Demo', nombre_sucursal: 'Almacén Demo', categoria: 'Almacén',
      tipo_negocio: 'productos', rubro_secundario: null, direccion: 'Calle Ejemplo 123',
      comuna: 'Santiago', region: 'Metropolitana', lat: -33.4489, lng: -70.6693,
      horario: 'Lun a Sáb 9:00 a 21:00', telefono: null, whatsapp_publico: null, instagram: null,
      plan: 35, plan_nombre: 'Básico', plan_precio: 4990, plan_ilimitado: false, cupo_efectivo: 35,
      promo_activa: null, es_cliente_nuevo: false, email: null, plan_pendiente: null,
      fecha_efectiva_downgrade: null, plan_solicitado: null, pago_pendiente: 0,
      fecha_vencimiento: null, downgrade_programado: 0, estado_suscripcion: 'activa', aprobado: 1,
      ultima_actualizacion: HOY, estado_operativo: 'abierto',
      productos: [
        prod(1, 'Arroz grado 1', 'Abarrotes', 'Demo', '1 kg', 1290, null, 24),
        prod(2, 'Aceite vegetal', 'Abarrotes', 'Demo', '1 L', 2490, null, 12),
        prod(3, 'Fideos espagueti', 'Abarrotes', 'Demo', '400 g', 890, null, 30),
        prod(4, 'Azúcar blanca', 'Abarrotes', 'Demo', '1 kg', 1190, null, null),
        prod(5, 'Leche entera', 'Lácteos', 'Demo', '1 L', 1090, null, 18),
        prod(6, 'Pan amasado', 'Panadería', 'Demo', 'por kg', 2400, null, null),
        prod(7, 'Bebida cola', 'Bebidas', 'Demo', '1,5 L', 1690, null, 20),
        prod(8, 'Detergente líquido', 'Limpieza', 'Demo', '1 L', 3290, null, 6)
      ]
    };
  }
  var estado = null;
  function local() {
    if (!estado) {
      try { estado = JSON.parse(leerLocal(CLAVE) || 'null'); } catch (e) { estado = null; }
      if (!estado || !estado.productos) estado = localInicial();
    }
    return estado;
  }
  function persistir() { guardarLocal(CLAVE, JSON.stringify(estado)); }
  function sigId() { return local().productos.reduce(function (m, p) { return Math.max(m, p.id || 0); }, 0) + 1; }
  function normalizarCodigo(v) { var s = String(v == null ? '' : v).replace(/\D/g, ''); return s.length >= 6 && s.length <= 18 ? s : null; }

  var OWNER = { username: 'demo', whatsapp_admin: null, tyc_version: '2.3' };
  function misLocales() { return { success: true, locales: [local()], owner: OWNER, token: 'beta' }; }

  function dashboard() {
    var l = local(), ps = l.productos;
    var activos = ps.filter(function (p) { return p.estado === 'habilitado'; }).length;
    var pausados = ps.filter(function (p) { return p.estado === 'pausado'; }).length;
    return {
      local: { id: l.id, comuna: l.comuna, direccion: l.direccion, tipo_negocio: l.tipo_negocio,
        estado_operativo: l.estado_operativo || 'abierto', estado_mensaje: null,
        plan_actual: { cupo: 35, nombre: 'Básico', precio: 4990, ilimitado: false, requiereDesde: null },
        cupo_max: 35, fecha_vencimiento: null, lat: l.lat, lng: l.lng, horario_apertura: null, horario_cierre: null },
      productos: { activos: activos, pausados: pausados, restringidos: 0, total: ps.length },
      sin_foto: ps.filter(function (p) { return !(p.imagenes && p.imagenes.length); }).slice(0, 5)
        .map(function (p) { return { id: p.id, nombre: p.nombre }; }),
      desactualizados: [],
      clicks_wsp: { ultimos_7d: 0, ultimos_30d: 0, por_dia: [] },
      top_clicks_productos: [],
      demanda_zona: null,
      dias_hasta_renovacion: 30
    };
  }

  var DEMO = { success: false, beta: true, message: 'Modo demostración: esta acción se habilita con el servidor.' };

  function leerCuerpo(opciones) {
    try { return opciones && typeof opciones.body === 'string' ? JSON.parse(opciones.body) : {}; } catch (e) { return {}; }
  }

  function rutaApi(ruta, q, metodo, cuerpo) {
    var m;
    if (metodo === 'GET') {
      if (ruta === '/flags') return datos('flags').then(responder);
      if (ruta === '/tyc-version') return datos('tyc-version').then(responder);
      if (ruta === '/planes') return datos('planes').then(responder);
      if (ruta === '/comercio/mis-locales') return Promise.resolve(responder(misLocales()));
      if (/^\/comercio\/dashboard\//.test(ruta)) return Promise.resolve(responder(dashboard()));
      if (/reportes|conversaciones|historial-soporte|pedidos/.test(ruta)) return Promise.resolve(responder([]));
      return Promise.resolve(responder(DEMO, 503));
    }
    if (ruta === '/owner-login') return Promise.resolve(responder(misLocales()));
    if (ruta === '/owner-logout' || ruta === '/comercio/aceptar-tyc' || ruta === '/clicks/whatsapp') {
      return Promise.resolve(responder({ success: true }));
    }
    // Stock (escáner): igual que el servidor — delta suma, stock fija, nunca < 0
    if ((m = ruta.match(/^\/productos\/(\d+)\/stock$/)) && metodo === 'PATCH') {
      var p = local().productos.find(function (x) { return x.id === +m[1]; });
      if (!p) return Promise.resolve(responder({ success: false, message: 'Producto no encontrado.' }, 404));
      var n = (cuerpo.stock !== undefined && cuerpo.stock !== null && cuerpo.stock !== '')
        ? parseInt(cuerpo.stock, 10) : (p.stock || 0) + (parseInt(cuerpo.delta, 10) || 0);
      if (!isFinite(n)) return Promise.resolve(responder({ success: false, message: 'Cantidad inválida.' }, 400));
      p.stock = Math.max(0, n); p.ultima_actualizacion = new Date().toISOString(); persistir();
      return Promise.resolve(responder({ success: true, stock: p.stock }));
    }
    if ((m = ruta.match(/^\/productos\/(\d+)\/estado$/)) && metodo === 'PATCH') {
      var pe = local().productos.find(function (x) { return x.id === +m[1]; });
      if (pe) { pe.estado = cuerpo.estado || pe.estado; persistir(); }
      return Promise.resolve(responder({ success: !!pe }));
    }
    if ((m = ruta.match(/^\/productos\/(\d+)\/duplicar$/))) {
      var pd = local().productos.find(function (x) { return x.id === +m[1]; });
      if (!pd) return Promise.resolve(responder({ success: false }, 404));
      var copia = Object.assign({}, pd, { id: sigId(), nombre: pd.nombre + ' (copia)', estado: 'pausado', codigo_barras: null });
      local().productos.push(copia); persistir();
      return Promise.resolve(responder({ success: true, nuevo_id: copia.id }));
    }
    // Guardado completo del local (alta/edición/eliminación de productos)
    if (ruta === '/locales' && metodo === 'POST') {
      var l = local(), lista = (cuerpo.local && cuerpo.local.productos) || [];
      var usados = {};
      l.productos = lista.map(function (x) {
        var id = x.id && !usados[x.id] ? x.id : null;
        var nuevo = Object.assign({ descripcion: '', disponible: 1, estado: 'habilitado', imagenes: [] }, x);
        nuevo.id = id || 0; if (id) usados[id] = true;
        nuevo.codigo_barras = normalizarCodigo(x.codigo_barras);
        nuevo.stock = x.stock === null || x.stock === undefined || x.stock === '' ? null : Math.max(0, parseInt(x.stock, 10) || 0);
        return nuevo;
      });
      l.productos.forEach(function (x) { if (!x.id) { x.id = sigId(); } });
      persistir();
      return Promise.resolve(responder({ success: true, local: l }));
    }
    if ((m = ruta.match(/^\/locales\/\d+\/estado-operativo$/))) {
      local().estado_operativo = cuerpo.estado || 'abierto'; persistir();
      return Promise.resolve(responder({ success: true }));
    }
    return Promise.resolve(responder(DEMO, 503));
  }

  window.fetch = function (entrada, opciones) {
    var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || String(entrada);
    var u;
    try { u = new URL(url, location.href); } catch (e) { return fetchOriginal(entrada, opciones); }
    if (u.origin !== location.origin) return fetchOriginal(entrada, opciones);
    var metodo = String((opciones && opciones.method) || (entrada && entrada.method) || 'GET').toUpperCase();
    if (u.pathname.indexOf('/api/') === 0 || u.pathname.indexOf(BASE + 'api/') === 0) {
      var ruta = u.pathname.replace(BASE === '/' ? /^\/api/ : new RegExp('^' + BASE + 'api|^/api'), '');
      return rutaApi(ruta, u.searchParams, metodo, leerCuerpo(opciones));
    }
    if (BASE !== '/' && u.pathname.indexOf(BASE) !== 0) {
      return fetchOriginal(BASE + u.pathname.replace(/^\//, '') + u.search, opciones);
    }
    return fetchOriginal(entrada, opciones);
  };

  // ── Actualización de la APK (mismo patrón que usuario / Rumbo: ApkInstalador) ──
  function esNativa() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function mostrarAviso(nueva) {
    var caja = document.createElement('div');
    caja.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;' +
      'align-items:center;justify-content:center;padding:24px;font-family:inherit';
    caja.innerHTML = '<div style="background:#fff;color:#14161C;border-radius:16px;padding:24px;max-width:340px;' +
      'width:100%;text-align:center"><h3 style="margin:0 0 8px">Nueva versión disponible</h3>' +
      '<p style="margin:0 0 18px;color:#5C6270">Versión ' + nueva + ' (tienes la ' + APP_VERSION + ').</p>' +
      '<button id="mdBtnActualizar" style="width:100%;min-height:48px;border:0;border-radius:12px;' +
      'background:#14161C;color:#fff;font-weight:700;font-size:15px">Descargar actualización</button></div>';
    document.body.appendChild(caja);
    document.getElementById('mdBtnActualizar').addEventListener('click', function () {
      var boton = this;
      var plugin = window.Capacitor.Plugins && window.Capacitor.Plugins.ApkInstalador;
      if (!plugin) { window.open(URL_APK, '_system'); return; }
      boton.disabled = true; boton.textContent = 'Descargando… 0 %';
      var escucha = plugin.addListener
        ? plugin.addListener('progreso', function (e) { boton.textContent = 'Descargando… ' + e.porcentaje + ' %'; })
        : Promise.resolve({ remove: function () {} });
      plugin.descargarEInstalar({ url: URL_APK })
        .then(function () { boton.textContent = 'Abriendo instalador…'; })
        .catch(function () { boton.disabled = false; boton.textContent = 'No se pudo descargar. Reintentar'; })
        .finally(function () { Promise.resolve(escucha).then(function (h) { h && h.remove && h.remove(); }); });
    });
  }
  function revisarActualizacion() {
    if (!esNativa()) return;
    fetchOriginal(URL_VERSION + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (v && v.version > APP_VERSION) mostrarAviso(v.version); })
      .catch(function () {});
  }
  async function pedirPermisoNotificaciones() {
    if (!esNativa()) return;
    try {
      var LN = window.Capacitor.Plugins.LocalNotifications;
      if (!LN) return;
      var e = await LN.checkPermissions();
      if (e.display !== 'granted') await LN.requestPermissions();
    } catch (e) { /* no bloquea el arranque */ }
  }
  window.addEventListener('load', function () {
    setTimeout(revisarActualizacion, 1500);
    setTimeout(pedirPermisoNotificaciones, 4000);
  });
})();
