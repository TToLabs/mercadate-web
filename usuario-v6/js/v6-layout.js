// PLATAFORMA : Usuario V6 — capa de interacción del layout
// Panel único desde 04-sep-2026 (la maqueta standalone web/preview-v6/ se
// eliminó: no tenía login/Lila/carrito/delivery y su diseño ya está acá).
// Reutiliza funciones y elementos REALES ya existentes (window.MiCuenta,
// window.toggleGPS, window.abrirNivelPopup, #mapToggle, #lilaFab, .md-mother).
// No duplica lógica de negocio: solo dispara lo que ya funciona en app.js.
(function () {
  'use strict';

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function clickReal(sel) { var el = $(sel); if (el) el.click(); }

  // ⚠️ DEMO — marcas y promociones de EJEMPLO, no son avisos contratados.
  // Reemplazar por el inventario real antes de promover el clon a producción.
  var ADS_DEMO = [
    { m:'Copec',      ini:'C', g:['#e5484d','#7a1418'], t:'$30/L de descuento',       s:'Pagando con Copec Pay · hasta el 31/07', cta:'Ver oferta' },
    { m:'Shell',      ini:'S', g:['#f2b945','#a06a00'], t:'Lavado gratis',            s:'Cargando 20 L o más de V-Power',        cta:'Ver oferta' },
    { m:'Aramco',     ini:'A', g:['#18C7CE','#0a5f63'], t:'Puntos dobles',            s:'En tienda Full Market · fin de semana', cta:'Ver oferta' },
    { m:'Petrobras',  ini:'P', g:['#35d07f','#146c3f'], t:'2x1 en café',              s:'Con cualquier carga de bencina',        cta:'Ver oferta' },
    { m:'Unimarc',    ini:'U', g:['#3d7bff','#12307a'], t:'3x2 en aceites',           s:'Santa Isabel · hasta agotar stock',     cta:'Ver promo' },
    { m:'Don Italo',  ini:'D', g:['#d63384','#6d1442'], t:'2x1 en pizzas los martes', s:'Retiro en local o delivery',            cta:'Pedir' },
    { m:'Amigo Fiel', ini:'V', g:['#7fb28a','#2f5c3d'], t:'20% en vacunas',           s:'Veterinaria · agenda online',           cta:'Agendar' }
  ];

  var toastT;
  function toast(msg) {
    var t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ═══════════ Sheet: colapsado (carrusel) ↔ expandido (lista real) ═══════════ */
  var sheet, dragging = false;

  function marcarNavActivo(view) {
    $$('.md-bn-item').forEach(function (el) { el.classList.toggle('active', el.dataset.view === view); });
  }

  // Tres estados: 'mapa' (sheet oculto, mapa completo) · 'carrusel' (tarjetas
  // abajo, aparece al llegar resultados de una búsqueda) · 'lista' (expandido).
  var hayResultados = false;
  window.v6SwitchView = function (view) {
    if (!sheet) return;
    // "Mapa" con el mapa ya completo y resultados cargados → vuelve el carrusel
    if (view === 'mapa' && sheet.classList.contains('oculto') && hayResultados) view = 'carrusel';
    sheet.classList.toggle('expanded', view === 'lista');
    sheet.classList.toggle('oculto', view === 'mapa');
    marcarNavActivo(view === 'lista' ? 'lista' : 'mapa');
    // #mapToggle real: mantiene vivo el mecanismo que exige CLAUDE.md
    // (body.map-collapsed), aunque en V6 el mapa es fullscreen y no depende
    // de esa clase para su tamaño.
    var quiereColapsado = view === 'lista';
    var estaColapsado = document.body.classList.contains('map-collapsed');
    if (quiereColapsado !== estaColapsado) clickReal('#mapToggle');
    setTimeout(function () { try { window.map && window.map.invalidateSize(); } catch (e) {} }, 300);
  };

  function initDrag() {
    var grabber = $('#sheetGrabber');
    if (!grabber || !sheet) return;
    grabber.addEventListener('click', function () {
      window.v6SwitchView(sheet.classList.contains('expanded') ? 'carrusel' : 'lista');
    });
    grabber.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); grabber.click(); }
    });
    // Arrastre táctil simple: swipe hacia arriba expande, hacia abajo colapsa
    var y0 = null;
    grabber.addEventListener('touchstart', function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    grabber.addEventListener('touchend', function (e) {
      if (y0 === null) return;
      var dy = e.changedTouches[0].clientY - y0;
      y0 = null;
      if (dy < -30) window.v6SwitchView('lista');
      else if (dy > 30) window.v6SwitchView(sheet.classList.contains('expanded') ? 'carrusel' : 'mapa');
    });
  }

  /* ═══════════ Búsqueda: overlay real (.search-section) ═══════════ */
  function abrirBusqueda() { var ov = $('#searchOverlay'); if (ov) ov.classList.add('open'); }
  function cerrarBusqueda() {
    var ov = $('#searchOverlay'); if (ov) ov.classList.remove('open');
    var input = $('#headerSearchInput'); if (input) input.blur();
  }

  /* ═══════════ Fuel bar flotante: dispara y refleja el .fuel-chip real ═══════════ */
  function initFuelBar() {
    var bar = $('#fuelTypeBar'), fuelRow = $('#fuelRow');
    if (!bar) return;

    bar.addEventListener('click', function (e) {
      var b = e.target.closest('.fuel-type-btn');
      if (!b) return;
      var chip = document.querySelector('.fuel-chip[data-val="' + b.dataset.fuel + '"]');
      if (chip) chip.click();
    });

    function syncActivo() {
      var chipActivo = document.querySelector('.fuel-chip.active');
      $$('.fuel-type-btn').forEach(function (b) {
        b.classList.toggle('active', !!chipActivo && chipActivo.dataset.val === b.dataset.fuel);
      });
    }
    var chips = $('#fuelChips');
    if (chips) {
      try { new MutationObserver(syncActivo).observe(chips, { attributes: true, subtree: true, attributeFilter: ['class'] }); } catch (e) {}
    }
    syncActivo();

    // Visible solo con Combustibles activo (mismo gate real que #fuelRow)
    if (fuelRow) {
      var syncVisible = function () { bar.hidden = getComputedStyle(fuelRow).display === 'none'; };
      try { new MutationObserver(syncVisible).observe(fuelRow, { attributes: true, attributeFilter: ['style'] }); } catch (e) {}
      syncVisible();
    }
  }

  /* ═══════════ GPS: mismo toggle real (toggleGPS), mismo estado reflejado ═══════════ */
  function mirrorGps() {
    var dotReal = $('#gpsDot'), labelReal = $('#gpsLabel');
    var chip = $('#gpsChip');
    if (!dotReal || !labelReal || !chip) return;
    var activo = dotReal.classList.contains('active') || /activo/i.test(labelReal.textContent || '');
    chip.classList.toggle('off', !activo);
    var estado = $('#v6GpsEstado'), detalle = $('#v6GpsDetalle');
    if (estado) estado.textContent = activo ? 'GPS activo' : 'GPS desactivado';
    if (detalle) detalle.textContent = activo ? (labelReal.textContent || 'Activo') : 'Toca para activar';
  }

  /* ═══════════ Badge de avisos: espejo del real #notifBadge ═══════════ */
  function mirrorBell() {
    var real = $('#notifBadge'), badge = $('#v6BellBadge');
    if (!real || !badge) return;
    var visible = getComputedStyle(real).display !== 'none';
    var v = (real.textContent || '').trim();
    badge.hidden = !(visible && v && v !== '0');
    badge.textContent = v;
  }

  /* ═══════════ Badge de carrito: espejo del real #cartBadge ═══════════ */
  function mirrorCart() {
    var real = $('#cartBadge'), badge = $('#v6CartBadge');
    if (!real || !badge) return;
    var visible = getComputedStyle(real).display !== 'none';
    var v = (real.textContent || '').trim();
    badge.hidden = !(visible && v && v !== '0');
    badge.textContent = v;
  }

  /* ═══════════ Tarjetas del carrusel: espejo del DOM real de la app ═══════════ */
  function montarTarjetas() {
    var titulo = $('#resultsTitle'), cuenta = $('#resultCount'), estado = $('#statusBar');

    function syncResultado() {
      var visible = cuenta && getComputedStyle(cuenta).display !== 'none';
      var n = cuenta ? (cuenta.textContent || '').trim() : '';
      var t = titulo ? (titulo.textContent || '').trim() : '';
      var e = estado ? (estado.textContent || '').trim() : '';
      var elCount = $('#v6ResCount'), elTit = $('#v6ResTitulo'), elEst = $('#v6ResEstado'), elZona = $('#v6ZonaCount');
      if (elCount) elCount.textContent = visible && n ? n : '—';
      if (elZona) elZona.textContent = visible && n ? n : '—';
      if (elTit) elTit.textContent = t || 'Elegí una categoría';
      if (elEst) elEst.textContent = e || (visible && n ? '' : (t ? 'Activa el GPS o busca para ver precios' : 'para empezar a buscar'));
    }
    [titulo, cuenta, estado].forEach(function (el) {
      if (!el) return;
      try { new MutationObserver(syncResultado).observe(el, { attributes: true, childList: true, characterData: true, subtree: true }); } catch (err) {}
    });
    syncResultado();

    // Eco del radio real
    var radioEl = $('#radiusValMap'), echo = $('#v6RadioEcho');
    if (radioEl && echo) {
      var syncRadio = function () { echo.textContent = radioEl.textContent; };
      syncRadio();
      try { new MutationObserver(syncRadio).observe(radioEl, { childList: true, characterData: true, subtree: true }); } catch (e) {}
    }

    // Comparativa: primeras filas reales de #resultsList, con textContent (nunca
    // innerHTML con datos de comercios, para no abrir XSS)
    var lista = $('#resultsList'), comp = $('#v6CompList');
    function syncComparativa() {
      if (!lista || !comp) return;
      var cards = lista.querySelectorAll('.commerce-card, .card-item'); // .card-item = combustibles
      // Llegan resultados nuevos → aparece el carrusel (solo en el cambio 0 → N,
      // así los re-render no reabren un sheet que la persona ocultó con "Mapa").
      var habia = hayResultados;
      hayResultados = cards.length > 0;
      if (hayResultados && !habia && sheet.classList.contains('oculto')) window.v6SwitchView('carrusel');
      comp.textContent = '';
      if (!cards.length) {
        var vacio = document.createElement('div');
        vacio.className = 'cp-sub';
        vacio.textContent = 'Sin resultados todavía';
        comp.appendChild(vacio);
        return;
      }
      Array.prototype.slice.call(cards, 0, 3).forEach(function (card) {
        var nombre = card.querySelector('.cc-name, .cv2-l1, .cv2-nombre');
        var precio = card.querySelector('.card-price-main, .cv2-precio, .cc-dist');
        var fila = document.createElement('div');
        fila.className = 'nr';
        var ini = document.createElement('div');
        ini.className = 'nr-ini';
        ini.textContent = ((nombre ? nombre.textContent : card.textContent || '').trim()[0] || '?').toUpperCase();
        var main = document.createElement('div');
        main.className = 'nr-main';
        var n = document.createElement('div'); n.className = 'nr-n';
        n.textContent = (nombre ? nombre.textContent : card.textContent || '').trim().slice(0, 40);
        var m = document.createElement('div'); m.className = 'nr-m';
        m.textContent = precio ? '' : '';
        main.appendChild(n); main.appendChild(m);
        var r = document.createElement('div'); r.className = 'nr-r';
        r.textContent = precio ? (precio.textContent || '').trim() : '';
        fila.appendChild(ini); fila.appendChild(main); fila.appendChild(r);
        fila.addEventListener('click', function () { card.click(); });
        comp.appendChild(fila);
      });
    }
    if (lista) {
      try { new MutationObserver(syncComparativa).observe(lista, { childList: true, subtree: true }); } catch (e) {}
      syncComparativa();
    }
  }

  /* ═══════════ Publicidad: franja + tarjeta destacada (DEMO) ═══════════ */
  function montarPublicidad() {
    var track = $('#adsTrack');
    if (track) {
      track.textContent = '';
      for (var vuelta = 0; vuelta < 2; vuelta++) {
        ADS_DEMO.forEach(function (a) {
          var el = document.createElement('div');
          el.className = 'ad';
          var logo = document.createElement('span'); logo.className = 'ad-logo';
          logo.style.background = a.g[0]; logo.textContent = a.ini;
          var txt = document.createElement('span'); txt.className = 'ad-t';
          txt.textContent = a.m + ' · ' + a.t;
          var cta = document.createElement('span'); cta.className = 'ad-cta';
          cta.textContent = a.cta;
          el.appendChild(logo); el.appendChild(txt); el.appendChild(cta);
          el.addEventListener('click', function () { toast('Aviso de ' + a.m + ' — demo'); });
          track.appendChild(el);
        });
      }
    }

    var card = $('#adCard');
    if (!card) return;
    var i = 0, timer;
    function pintar() {
      var a = ADS_DEMO[i % ADS_DEMO.length];
      var img = $('#adxImg');
      img.style.setProperty('--adx-a', a.g[0]);
      img.style.setProperty('--adx-b', a.g[1]);
      $('#adxMark').textContent = a.ini;
      $('#adxT').textContent = a.m + ' · ' + a.t;
      $('#adxS').textContent = a.s;
      $('#adxCta').textContent = a.cta;
      card.dataset.marca = a.m;
    }
    function arrancar() { timer = setInterval(function () { i++; pintar(); }, 6000); }
    pintar(); arrancar();
    card.addEventListener('mouseenter', function () { clearInterval(timer); });
    card.addEventListener('mouseleave', arrancar);
    card.addEventListener('click', function () { toast('Aviso de ' + card.dataset.marca + ' — demo'); });
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter') card.click(); });
  }

  /* ═══════════ Init ═══════════ */
  function init() {
    sheet = $('#bottomSheet');
    if (sheet) sheet.classList.add('oculto'); // al abrir: mapa completo, sin carrusel
    // Empezar una búsqueda (categoría o buscador) muestra el carrusel: ahí vive
    // "Activar GPS", sin el cual vistaGeneral() no devuelve resultados.
    document.addEventListener('click', function (e) {
      if (!sheet || !sheet.classList.contains('oculto')) return;
      if (e.target.closest('#catNav .cat-tab, #headerSearchInput')) window.v6SwitchView('carrusel');
    }, true);
    initDrag();
    // Leaflet no se entera solo si el contenedor cambia de tamaño (ventana,
    // rotación, header que cambia de alto): quedaba el mapa "corrido" con una
    // franja sin teselas. Se recalcula cada vez que #map cambia.
    var mapEl = $('#map');
    if (mapEl && window.ResizeObserver) {
      try { new ResizeObserver(function () { try { window.map && window.map.invalidateSize(); } catch (e) {} }).observe(mapEl); } catch (e) {}
    }
    montarTarjetas();
    montarPublicidad();
    initFuelBar();

    // Buscador del header
    var search = $('#headerSearchInput');
    if (search) search.addEventListener('focus', abrirBusqueda);

    // Elegir categoría DEBE revelar el selector de combustible (93/95/97).
    // app.js:687-724 (actualizarUIporModo) solo cambia el display de #fuelRow /
    // #commerceRow, que en V6 viven dentro del overlay: sin esto el usuario
    // toca "Combustibles" y no ve nada. Es el flujo principal de la app.
    // Va en setTimeout(0) para correr DESPUÉS del handler de app.js.
    $$('.cat-tab').forEach(function (tab) {
      if (tab.disabled) return;
      tab.addEventListener('click', function () { setTimeout(abrirBusqueda, 0); });
    });
    var cerrar = $('#v6CerrarBusqueda');
    if (cerrar) cerrar.addEventListener('click', cerrarBusqueda);
    var overlay = $('#searchOverlay');
    if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) cerrarBusqueda(); });
    [$('#btnBuscar'), $('#btnBuscarFuel'), $('#btnBuscarCommerce')].forEach(function (b) {
      if (b) b.addEventListener('click', function () { setTimeout(cerrarBusqueda, 120); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') cerrarBusqueda();
    });

    // GPS: chip real → toggleGPS(); estado reflejado desde los nodos reales
    var gpsChip = $('#gpsChip');
    if (gpsChip) gpsChip.addEventListener('click', function () { if (window.toggleGPS) window.toggleGPS(); });
    ['#gpsDot', '#gpsLabel'].forEach(function (sel) {
      var el = $(sel); if (!el) return;
      try { new MutationObserver(mirrorGps).observe(el, { attributes: true, childList: true, characterData: true, subtree: true }); } catch (e) {}
    });
    mirrorGps();

    // Badge de avisos
    var notifBadge = $('#notifBadge');
    if (notifBadge) {
      try { new MutationObserver(mirrorBell).observe(notifBadge, { attributes: true, childList: true, characterData: true, subtree: true }); } catch (e) {}
    }
    mirrorBell();

    // Badge de carrito
    var cartBadgeReal = $('#cartBadge');
    if (cartBadgeReal) {
      try { new MutationObserver(mirrorCart).observe(cartBadgeReal, { attributes: true, childList: true, characterData: true, subtree: true }); } catch (e) {}
    }
    mirrorCart();

    // Bottom nav
    var navMapa = $('#v6NavMapa'); if (navMapa) navMapa.addEventListener('click', function () { window.v6SwitchView('mapa'); });
    var navLista = $('#v6NavLista'); if (navLista) navLista.addEventListener('click', function () { window.v6SwitchView('lista'); });
    // abrir() fuerza tab('perfil') por dentro (micuenta.js:90) → hay que
    // pedir el tab DESPUÉS de abrir, si no Favoritos siempre termina en Perfil.
    var navFav = $('#v6NavFavoritos'); if (navFav) navFav.addEventListener('click', function () { window.MiCuenta && (window.MiCuenta.abrir(), window.MiCuenta.tab('favoritos')); });
    var navPerfil = $('#v6NavPerfil'); if (navPerfil) navPerfil.addEventListener('click', function () { window.MiCuenta && window.MiCuenta.abrir(); });

    marcarNavActivo('mapa');
    window.addEventListener('resize', function () { try { window.map && window.map.invalidateSize(); } catch (e) {} });

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
