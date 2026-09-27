// PLATAFORMA : App beta — responde /api con la foto de datos y avisa actualizaciones de la APK
// Se carga ANTES que todo el resto: la app corre igual que con servidor, pero sin él
// (APK empaquetada + GitHub Pages). Lo que escribe datos queda en modo demostración.
(function () {
  'use strict';

  var APP_VERSION = window.MD_APP_VERSION || 0;
  var URL_VERSION = 'https://ttolabs.github.io/mercadate-web/version.json';
  var URL_APK = 'https://github.com/TToLabs/mercadate-web/releases/download/latest/mercadate.apk';

  window.MERCADATE_APP = true;   // sin service worker; la app no depende de cookies
  window.MERCADATE_BETA = true;

  var BASE = location.pathname.replace(/[^/]*$/, '');
  var fetchOriginal = window.fetch.bind(window);
  var cache = {};

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
    return new Response(JSON.stringify(cuerpo), {
      status: estado || 200, headers: { 'Content-Type': 'application/json' }
    });
  }
  function distancia(lat1, lng1, lat2, lng2) {
    var R = 6371000, r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function cercanos(lista, q, campoLng) {
    var lat = parseFloat(q.get('lat')), lng = parseFloat(q.get('lng'));
    var radio = parseFloat(q.get('radio') || 5000);
    if (isNaN(lat) || isNaN(lng)) return [];
    return lista.map(function (x) {
      return Object.assign({}, x, { distanciaM: distancia(lat, lng, x.lat, x[campoLng]) });
    }).filter(function (x) { return x.distanciaM <= radio; })
      .sort(function (a, b) { return a.distanciaM - b.distanciaM; });
  }

  var USUARIO_DEMO = {
    id: 1, username: 'beta', nombre: 'Usuario Beta', email: '', telefono: '', comuna: '',
    fecha_registro: '2026-09-27 00:00:00', ultimo_acceso: '2026-09-27 00:00:00',
    puntos: 0, nivel: 1, voz_registro: null, google_sub: null, personaje: null,
    tyc_version: '2.3', fecha_nacimiento: null, edad: null, es_menor: false,
    tramo_edad: null, periodo_libre: true, avatar_url: null
  };
  var SOLO_LECTURA = {
    success: false, beta: true,
    message: 'Versión beta sin servidor: esta acción se habilita en el lanzamiento.'
  };

  function rutaApi(ruta, q, metodo) {
    if (metodo !== 'GET') {
      if (ruta === '/usuario/login' || ruta === '/usuario/logout' || ruta === '/usuario/aceptar-tyc') {
        return Promise.resolve(responder({ success: true, usuario: USUARIO_DEMO, token: 'beta' }));
      }
      if (ruta === '/log-busqueda') return Promise.resolve(responder({ success: true }));
      return Promise.resolve(responder(SOLO_LECTURA, 503));
    }
    if (ruta === '/usuario/me') return Promise.resolve(responder(USUARIO_DEMO));
    if (ruta.indexOf('/gamificacion/') === 0) {
      return Promise.resolve(responder({ success: true, puntos: 0, nivel: 1, nivel_nombre: 'Explorador Novato',
        nivel_color: '#22c55e', siguiente_nivel: 'Rastreador Experto', puntos_para_siguiente: 201,
        progreso_pct: 0, puntos_hoy: 0, limite_diario: 50 }));
    }
    if (/^\/cart\/[^/]+\/count$/.test(ruta)) return Promise.resolve(responder({ count: 0 }));
    if (ruta === '/usuario/notificaciones') {
      return Promise.resolve(responder({ success: true, notificaciones: [], no_leidas: 0 }));
    }

    var fijos = {
      '/flags': 'flags', '/categorias': 'categorias', '/rubros': 'rubros', '/tyc-version': 'tyc-version',
      '/voz-config': 'voz-config', '/estaciones/ultimo-archivo': 'estaciones-ultimo-archivo',
      '/estaciones/todas': 'estaciones-todas', '/locales': 'locales',
      '/usuario/comercios/por-comunas': 'por-comunas'
    };
    if (fijos[ruta]) return datos(fijos[ruta]).then(function (d) { return responder(d); });

    if (ruta === '/estaciones/cerca') {
      return datos('estaciones-precios').then(function (d) {
        var radio = Math.min(Math.max(parseFloat(q.get('radio')) || 10000, 1000), 50000) + 2000;
        q.set('radio', radio);
        var lista = cercanos(d.estaciones, q, 'lng').map(function (e) {
          e.distanciaM = Math.round(e.distanciaM); return e;
        });
        return responder({ success: true, estaciones: lista, total: lista.length, archivo: d.archivo,
          centro: { lat: parseFloat(q.get('lat')), lng: parseFloat(q.get('lng')) }, radio: radio });
      });
    }
    if (ruta === '/estaciones/zona') {
      return datos('estaciones-precios').then(function (d) {
        var comuna = (q.get('comuna') || '').trim().toLowerCase();
        var region = (q.get('region') || '').trim().toLowerCase();
        var lista = d.estaciones.filter(function (e) {
          return (comuna && String(e.comuna || '').toLowerCase() === comuna) ||
            (region && String(e.region || '').toLowerCase() === region);
        });
        return responder({ success: true, estaciones: lista, total: lista.length, archivo: d.archivo });
      });
    }
    if (ruta === '/usuario/comercios/nearby') {
      return datos('comercios').then(function (d) { return responder(cercanos(d, q, 'lng')); });
    }
    if (ruta === '/usuario/comercios/potenciales/nearby') {
      return datos('potenciales').then(function (d) { return responder(cercanos(d, q, 'lon')); });
    }
    if (ruta.indexOf('/local/') === 0) {
      var id = parseInt(ruta.split('/')[2], 10);
      return datos('locales').then(function (d) {
        var l = d.filter(function (x) { return x.id === id; })[0];
        return l ? responder(Object.assign({ success: true, local: l }, l)) : responder({ success: false }, 404);
      });
    }
    if (/favoritos|alertas-precio|reviews|pedidos|carrito|conversaciones|transacciones/.test(ruta)) {
      return Promise.resolve(responder([]));
    }
    return Promise.resolve(responder(SOLO_LECTURA, 503));
  }

  window.fetch = function (entrada, opciones) {
    var url = typeof entrada === 'string' ? entrada : (entrada && entrada.url) || String(entrada);
    var u;
    try { u = new URL(url, location.href); } catch (e) { return fetchOriginal(entrada, opciones); }
    if (u.origin !== location.origin) return fetchOriginal(entrada, opciones);

    var metodo = String((opciones && opciones.method) || (entrada && entrada.method) || 'GET').toUpperCase();
    if (u.pathname.indexOf('/api/') === 0 || u.pathname.indexOf(BASE + 'api/') === 0) {
      var ruta = u.pathname.replace(BASE === '/' ? /^\/api/ : new RegExp('^' + BASE + 'api|^/api'), '');
      return rutaApi(ruta, u.searchParams, metodo);
    }
    if (BASE !== '/' && u.pathname.indexOf(BASE) !== 0) {
      return fetchOriginal(BASE + u.pathname.replace(/^\//, '') + u.search, opciones);
    }
    return fetchOriginal(entrada, opciones);
  };

  // ── Actualización de la APK (mismo patrón que Rumbo: ApkInstalador) ──
  function esNativa() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function mostrarAviso(nueva) {
    var caja = document.createElement('div');
    caja.id = 'mdAvisoActualizar';
    caja.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;' +
      'align-items:center;justify-content:center;padding:24px;font-family:inherit';
    caja.innerHTML = '<div style="background:#fff;color:#10131b;border-radius:16px;padding:24px;max-width:340px;' +
      'width:100%;text-align:center"><h3 style="margin:0 0 8px">Nueva versión disponible</h3>' +
      '<p style="margin:0 0 18px;color:#555">Versión ' + nueva + ' (tienes la ' + APP_VERSION + ').</p>' +
      '<button id="mdBtnActualizar" style="width:100%;min-height:48px;border:0;border-radius:12px;' +
      'background:#10131b;color:#fff;font-weight:700;font-size:15px">Descargar actualización</button></div>';
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
      var estado = await LN.checkPermissions();
      if (estado.display !== 'granted') await LN.requestPermissions();
    } catch (e) { /* no bloquea el arranque */ }
  }

  window.addEventListener('load', function () {
    setTimeout(revisarActualizacion, 1500);
    setTimeout(pedirPermisoNotificaciones, 4000);
  });
})();
