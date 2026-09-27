// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente
// ARCHIVO    : app.js
// ═══════════════════════════════════════════════════
// app.js — Lógica principal del portal usuario MercaDate
// Maneja: state, GPS, búsqueda, mapa, estaciones de combustible y locales.
// Verificación de sesión y header del usuario están en auth.js
// ==================== CÓDIGO COMPLETO Y CORREGIDO ====================

(function(){
  let currentRadius = 1000;
  let localData = [];
  let localDataFecha = '';

  const FUEL_LABEL = { '93':'Gasolina 93','95':'Gasolina 95','97':'Gasolina 97','DI':'Diésel','KE':'Parafina' };
  const FUEL_DISPLAY = {
    '93':'Gasolina 93','A93':'Gasolina 93 con Aditivo',
    '95':'Gasolina 95','A95':'Gasolina 95 con Aditivo',
    '97':'Gasolina 97','A97':'Gasolina 97 con Aditivo',
    'DI':'Diésel','ADI':'Diésel con Aditivo',
    'KE':'Parafina','AKE':'Parafina con Aditivo'
  };

  let state = {
    lat:-33.4489, lng:-70.6693,
    gpsActive:false, mode:null, fuelType:null,
    allStations:[], results:[],
    comercios: [],
    comerciosPotenciales: [],
    resultadosIds: new Set(),    // IDs de comercios actualmente en el listado del sidebar
    comercioActivo: null,
    categoriaProducto: null,
    subcatActiva: null,
    servicioEspecial: null,
    puntos: parseInt(localStorage.getItem('mercadate_pts')||'0')
  };
  document.getElementById('puntosCount').innerText = state.puntos;

  const dom = {
    gpsDot:              document.getElementById('gpsDot'),
    gpsLabel:            document.getElementById('gpsLabel'),
    gpsBtn:              document.getElementById('gpsBtn'),
    statusBar:           document.getElementById('statusBar'),
    fuelChips:           document.getElementById('fuelChips'),
    fuelRow:             document.getElementById('fuelRow'),
    commerceRow:         document.getElementById('commerceRow'),
    commerceAdvPanel:    document.getElementById('commerceAdvancedPanel'),
    resultsList:         document.getElementById('resultsList'),
    advancedPanel:       document.getElementById('advancedPanel'),
    regionSelect:        document.getElementById('regionSelect'),
    comunaSelect:        document.getElementById('comunaSelect'),
    marcaSelect:         document.getElementById('marcaSelect'),
    resultadoTitle:      document.getElementById('resultsTitle'),
    productoInput:       document.getElementById('productoInput'),
    addressInput:        document.getElementById('addressInput'),
    commerceAddressInput:    document.getElementById('commerceAddressInput'),
    radiusSlider:        document.getElementById('radiusSlider'),
    radiusVal:           document.getElementById('radiusVal'),
  };

  let map, markersGroup, sampleGroup, userMarker, radiusCircle;

  function calcularDistancia(lat1,lng1,lat2,lng2) {
    if(!lat2||!lng2) return Infinity;
    const R=6371e3,
          φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180,
          Δφ=(lat2-lat1)*Math.PI/180, Δλ=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  function filtrarYMapear(base, ft) {
    const fuelVariants = {
      '93':['93','A93'],'95':['95','A95'],'97':['97','A97'],
      'DI':['DI','ADI'],'KE':['KE','AKE']
    };
    const aditivoCode = { '93':'A93','95':'A95','97':'A97','DI':'ADI','KE':'AKE' }[ft] || ('A'+ft);
    const targets = fuelVariants[ft] || [ft];

    const filtradas = base.filter(s => {
      if(!s.combustible || !s.precio || s.precio <= 0) return false;
      return targets.includes((s.combustible||'').trim().toUpperCase());
    });

    const grupos = {};
    filtradas.forEach(s => {
      const key = s.idEstacion || (s.nombre + '|' + s.direccion);
      if(!grupos[key]) {
        grupos[key] = {
          nombre: s.nombre, direccion: s.direccion,
          lat: s.lat, lng: s.lng,
          region: s.region, comuna: s.comuna,
          idEstacion: s.idEstacion,
          precioBase:    null,
          precioAditivo: null
        };
      }
      const code = (s.combustible||'').trim().toUpperCase();
      const p = parseFloat(s.precio);
      if(code === ft)          grupos[key].precioBase    = p;
      else if(code === aditivoCode) grupos[key].precioAditivo = p;
    });

    return Object.values(grupos).map(g => ({
      nombre:        g.nombre,
      direccion:     g.direccion,
      lat:           g.lat,
      lng:           g.lng,
      region:        g.region,
      comuna:        g.comuna,
      precio:        g.precioBase ?? g.precioAditivo,
      precioAditivo: g.precioAditivo,
      combustible:   FUEL_DISPLAY[ft] || ft,
      distanciaM:    state.gpsActive ? calcularDistancia(state.lat,state.lng,g.lat,g.lng) : 0,
      comercioId:    g.idEstacion ? ('est_'+g.idEstacion) : ('est_'+g.nombre+g.direccion)
    }));
  }

  function registrarBusqueda(datos) {
    // Origen: 'voz' si la búsqueda vino del asistente, si no 'manual'. Se
    // consume una vez y se resetea (cada búsqueda marca su origen antes).
    const origen = window._origenBusqueda === 'voz' ? 'voz' : 'manual';
    window._origenBusqueda = 'manual';
    const entrada = { timestamp:new Date().toISOString(), usuario:window.usuarioActivo||'anon', origen, ...datos };
    fetch('/api/log-busqueda', {
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify([entrada])
    }).catch(() => {
      const p = JSON.parse(localStorage.getItem('logs_pendientes')||'[]');
      p.push(entrada);
      localStorage.setItem('logs_pendientes', JSON.stringify(p));
    });
    _tantearInvitacionComercio();
    try { window._refreshDesafios && window._refreshDesafios(); } catch (_) {}
  }

  // ── Invitación a sumar comercio (pop-up "fundador") ──────────────────────────
  // Audiencia fría: se ofrece tras varias búsquedas a quien podría ser dueño de
  // un negocio. SIN precios ni membresía. Una sola vez, descartable. Ancla la
  // ubicación del mapa al CTA para pre-llenar la dirección del comercio.
  function _tantearInvitacionComercio() {
    try {
      if (location.search.indexOf('demo=1') !== -1) return;       // no en modo demo
      if (localStorage.getItem('md_comercio_invite')) return;      // ya visto/descartado
      if (localStorage.getItem('md_es_comercio') === '1') return;  // ya es comercio
      const n = (parseInt(localStorage.getItem('md_busq_count') || '0', 10) || 0) + 1;
      localStorage.setItem('md_busq_count', String(n));
      if (n >= 3) _mostrarInvitacionComercio();
    } catch (_) {}
  }

  function _mostrarInvitacionComercio() {
    if (document.getElementById('mdCommerceInvite')) return;
    localStorage.setItem('md_comercio_invite', String(Date.now()));   // no repetir
    // Ubicación = la que se ve en el mapa (centro), o el GPS del usuario.
    let lat = state.userLat || state.lat, lng = state.userLng || state.lng;
    try { if (map && map.getCenter) { const c = map.getCenter(); lat = c.lat; lng = c.lng; } } catch (_) {}
    const url = `/comercio/?nuevo=1&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`;
    const benef = [['📍','Te encuentran cerca'],['💬','Te escriben por WhatsApp'],['🛒','Publica tus productos']]
      .map(([e,t]) => `<div style="display:flex;align-items:center;gap:9px;font-size:13.5px;color:#cdd6e6"><span style="font-size:18px">${e}</span>${t}</div>`).join('');
    const wrap = document.createElement('div');
    wrap.id = 'mdCommerceInvite';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(6,10,18,.72);display:flex;align-items:center;justify-content:center;padding:22px;backdrop-filter:blur(3px)';
    wrap.innerHTML = `
      <div style="max-width:360px;width:100%;background:linear-gradient(180deg,#161f30,#0e1726);border:1px solid #243044;border-radius:20px;padding:24px 22px;box-shadow:0 18px 60px rgba(0,0,0,.55);text-align:center;font-family:inherit">
        <div style="font-size:40px;line-height:1">🏪</div>
        <h3 style="margin:8px 0 4px;font-size:19px;font-weight:800;color:#fff">¿Tienes un negocio en el barrio?</h3>
        <p style="margin:0 0 16px;font-size:13.5px;color:#9aa6b8;line-height:1.5">Tus vecinos ya están buscando lo que vendes. Súmate gratis y aparece en MercaDate — sé de los primeros de tu zona.</p>
        <div style="display:flex;flex-direction:column;gap:8px;text-align:left;background:#0c1320;border:1px solid #223;border-radius:12px;padding:13px 14px;margin-bottom:18px">${benef}</div>
        <a href="${url}" target="_blank" rel="noopener" onclick="_cerrarInvitacionComercio()" style="display:block;padding:13px;border-radius:12px;font-weight:800;font-size:14px;text-decoration:none;background:linear-gradient(130deg,#ff9a3c,#f0801a);color:#0e1117;box-shadow:0 6px 18px rgba(240,128,26,.35)">Quiero sumar mi negocio →</a>
        <button onclick="_cerrarInvitacionComercio()" style="margin-top:10px;background:none;border:none;color:#7c879b;font-size:13px;font-family:inherit;cursor:pointer">Ahora no</button>
      </div>`;
    document.body.appendChild(wrap);
  }
  window._cerrarInvitacionComercio = function(){ const w = document.getElementById('mdCommerceInvite'); if (w) w.remove(); };

  window.addEventListener('online', () => {
    const p = JSON.parse(localStorage.getItem('logs_pendientes')||'[]');
    if(p.length > 0) {
      fetch('/api/log-busqueda', {
        method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(p)
      }).then(() => localStorage.removeItem('logs_pendientes')).catch(()=>{});
    }
  });

  // ── Carga de combustibles POR ZONA (bajo demanda) ────────────────────────
  // El usuario no necesita las 1.801 estaciones del país para echar bencina.
  // Medido: Santiago 22 KB · Valparaíso 3,7 KB · Cañete 0,5 KB (gzip),
  // contra 1.070 KB del CSV nacional. En un pueblo con 3G: 4,3 s → 0,4 s.
  // El CSV completo sigue disponible como respaldo y para búsqueda nacional.
  let _zonaCargada = null;   // { lat, lng, radio } de la última zona traída

  async function cargarZona(lat, lng, radio) {
    try {
      // Los precios de la CNE cambian una vez por semana (CSV del jueves).
      // Patrón manifiesto + recurso versionado:
      //  1) se pregunta la fecha vigente a un endpoint diminuto y de caché corto;
      //  2) se pide la zona con ?v=<esa fecha> → URL inmutable, 7 días de caché.
      // NO se puede usar una fecha guardada en localStorage: al pedir ?v=<vieja>
      // el navegador serviría su copia inmutable y el usuario vería precios de la
      // semana pasada hasta 7 días. La fecha SIEMPRE se consulta al servidor.
      let v = '';
      try {
        const rv = await fetch('/api/estaciones/ultimo-archivo');
        if (rv.ok) { const info = await rv.json(); v = (info && info.fecha) || ''; }
      } catch (_) {}
      const url = `/api/estaciones/cerca?lat=${lat}&lng=${lng}&radio=${radio || 10000}`
                + (v ? `&v=${encodeURIComponent(v)}` : '');
      const r = await fetch(url, { cache: 'default' });
      if (!r.ok) return false;
      const j = await r.json();
      if (!j || !j.success || !Array.isArray(j.estaciones)) return false;
      localData = j.estaciones;
      localDataFecha = (j.archivo && j.archivo.fecha) || localDataFecha;
      _zonaCargada = { lat, lng, radio: j.radio || radio };
      setStatusBar(`✅ ${j.total.toLocaleString()} precios de tu zona${localDataFecha ? ' · ' + localDataFecha : ''}`);
      return true;
    } catch (e) { return false; }
  }

  // ¿La zona en memoria cubre lo que se está pidiendo? Si no, hay que recargar.
  function _zonaCubre(lat, lng, radio) {
    if (!_zonaCargada) return false;
    const d = calcularDistancia(_zonaCargada.lat, _zonaCargada.lng, lat, lng);
    return (d + (radio || 10000)) <= _zonaCargada.radio;
  }

  // Espera breve al GPS para bajar solo la zona; si no llega, cae al CSV nacional.
  async function cargarEstacionesInicial() {
    for (let i = 0; i < 12 && !state.gpsActive; i++) await new Promise(r => setTimeout(r, 250));
    if (state.gpsActive && await cargarZona(state.lat, state.lng, Math.max(currentRadius, 10000))) return true;
    return cargarCSVDesdeServidor();
  }

  // Expuesto para que el cambio de radio pueda ampliar la zona si hace falta.
  window._asegurarZona = async function (radio) {
    if (!state.gpsActive) return false;
    if (_zonaCubre(state.lat, state.lng, radio)) return true;
    return cargarZona(state.lat, state.lng, Math.max(radio, 10000));
  };

  async function cargarCSVDesdeServidor() {
    setStatusBar('<span class="spinner"></span> Buscando datos en servidor...');

    // Estrategia rápida: pedir al backend cuál es el archivo más reciente.
    // Evita los 30 intentos con 404s que llenan la consola.
    try {
      const r0 = await fetch('/api/estaciones/ultimo-archivo', { cache: 'no-store' });
      if (r0.ok) {
        const info = await r0.json();
        if (info && info.url) {
          // Sin 'no-store': el CSV de una fecha dada NUNCA cambia, y el servidor ya
          // emite ETag (verificado: devuelve 304 con 0 bytes). Con no-store se
          // re-descargaban 1,07 MB en cada apertura. La frescura la garantiza el
          // manifiesto de arriba, que sí va sin caché.
          const r = await fetch(info.url);
          if (r.ok) {
            const texto = await r.text();
            localData = parsearCSV(texto);
            localDataFecha = info.fecha;
            setStatusBar(`✅ Datos del ${localDataFecha} — ${localData.length.toLocaleString()} registros cargados`);
            return true;
          }
        }
      }
    } catch (e) {}

    // Fallback (por si el endpoint nuevo no existe en server.js viejo)
    const hoy = new Date();
    for(let i=0; i<30; i++) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const nombreArchivo = `estaciones_servicio_precios_${yyyy}-${mm}-${dd}.csv`;
      const url = `/estaciones/${nombreArchivo}`;
      try {
        // Mismo criterio: el CSV de una fecha es inmutable, se deja cachear.
        const r = await fetch(url);
        if(r.ok) {
          const texto = await r.text();
          localData = parsearCSV(texto);
          localDataFecha = `${yyyy}-${mm}-${dd}`;
          setStatusBar(`✅ Datos del ${localDataFecha} — ${localData.length.toLocaleString()} registros cargados`);
          return true;
        }
      } catch(e) {}
    }
    setStatusBar('⚠️ Sin datos de combustibles disponibles. Ejecuta <code>python solicitud_combustibles_CNE.py</code> para descargar precios CNE actuales.');
    return false;
  }

  function parsearCSV(txt) {
    if(txt.charCodeAt(0)===0xFEFF) txt=txt.slice(1);
    const lineas = txt.split(/\r?\n/).filter(l=>l.trim());
    if(lineas.length < 2) return [];
    const sep = lineas[0].split(';').length > lineas[0].split(',').length ? ';' : ',';
    const norm = s => s.trim().replace(/["""]/g,'')
      .toLowerCase()
      .replace(/[áàâ]/g,'a').replace(/[éèê]/g,'e')
      .replace(/[íìî]/g,'i').replace(/[óòô]/g,'o').replace(/[úùû]/g,'u')
      .replace(/\s+/g,'_');
    // Divide respetando campos entrecomillados. SIN esto, las direcciones con
    // comas (" Ruta A-616, Manzana C, Lote A 0") corrían las columnas: la latitud
    // caía en un texto, parseFloat daba NaN y la fila se descartaba en silencio.
    // Medido en el CSV del 17-jul: 800 filas perdidas = 184 estaciones invisibles.
    // Misma lógica que `partir()` de parsearCSVNativo en js/server.js.
    const partir = (linea) => {
      const out = []; let cur = '', enComillas = false;
      for (let i = 0; i < linea.length; i++) {
        const ch = linea[i];
        if (ch === '"') {
          if (enComillas && linea[i + 1] === '"') { cur += '"'; i++; }
          else enComillas = !enComillas;
        } else if (ch === sep && !enComillas) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const hdrs = partir(lineas[0]).map(norm);
    const idx = (...keys) => { for(const k of keys){ const i=hdrs.indexOf(norm(k)); if(i>=0) return i; } return -1; };
    const iReg=idx('region'), iCom=idx('comuna');
    const iNom=idx('nombre_fantasia','nombre_comercial','nombre_distribuidor','distribuidor','razon_social','nombre','empresa');
    const iCal=idx('calle','direccion','domicilio','street'), iNum=idx('numero','num','nro','number');
    const iLat=idx('latitud','lat','latitude','y'), iLng=idx('longitud','lon','lng','longitude','x');
    const iComb=idx('combustible'), iPrecio=idx('precio'), iId=idx('id_estacion','id','ID Estación');
    const get=(c,i) => i>=0 ? (c[i]||'').trim().replace(/["""]/g,'') : '';
    return lineas.slice(1).flatMap(linea => {
      const c = partir(linea);
      const lat = parseFloat(get(c,iLat).replace(',','.'));
      const lng = parseFloat(get(c,iLng).replace(',','.'));
      if(!lat||!lng||isNaN(lat)||isNaN(lng)) return [];
      return [{ region:get(c,iReg), comuna:get(c,iCom), nombre:get(c,iNom)||'Sin nombre',
        direccion:[get(c,iCal),get(c,iNum)].filter(Boolean).join(' '),
        lat, lng, combustible:get(c,iComb),
        precio:parseFloat((get(c,iPrecio)||'0').replace(',','.')),
        idEstacion:get(c,iId) }];
    });
  }

  function init() {
    initMap();
    setupEvents();
    setupRegistroModal();
    setupPaseadoresEvents();
    cargarGamificacion();
    // Recargar nivel/puntos y avisos cuando la sesión esté confirmada.
    document.addEventListener('sesion-lista', function() {
      cargarGamificacion();
      try { if (window.MiCuenta && MiCuenta.cargarBadgeNotificaciones) MiCuenta.cargarBadgeNotificaciones(); } catch (_) {}
    });
    // Reintento de respaldo (por si el evento no llega).
    setTimeout(function() {
      if (!gamifEstado) cargarGamificacion();
      try { if (window.MiCuenta && MiCuenta.cargarBadgeNotificaciones) MiCuenta.cargarBadgeNotificaciones(); } catch (_) {}
    }, 1500);
    var _flujoLanzado = false;
    var _lanzar = function() {
      if (_flujoLanzado) return; _flujoLanzado = true;
      try { if (map && map.invalidateSize) map.invalidateSize(); } catch (_) {}
      _flujoPrimerIngreso();
    };
    document.addEventListener('sesion-lista', function() { setTimeout(_lanzar, 200); });
    setTimeout(_lanzar, 1200); // fallback
    _gpsAutoSiPermitido();
    actualizarCategoriasNav();
    cargarEstacionesInicial().then(() => { cargarTodasEstaciones(); });
  }

  function initMap() {
    map = L.map('map', { center:[state.lat,state.lng], zoom:13, zoomControl:false, attributionControl:false });
    window.map = map; // exponer para invalidateSize tras revelar sesión

    // Detectar tema y aplicar tile correspondiente.
    // Día = data-theme="dark" + clase .theme-dia (paleta slate clara) → tiles claros.
    // Noche = data-theme="dark" sin .theme-dia → tiles oscuros.
    const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark'
                      && !document.documentElement.classList.contains('theme-dia');
    // CartoDB pasó a exigir API key (sep-2026): teselas estándar de OpenStreetMap,
    // sin clave. El tono gris (día) / oscuro (noche) se da por CSS sobre el
    // tile-pane (v6-formal.css), así la misma URL sirve para ambos temas.
    // OSM exige atribución visible y uso moderado: al escalar, pasar a teselas propias o pagadas.
    const darkTileUrl  = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const lightTileUrl = darkTileUrl;
    const tileOpts = { attribution:'© OpenStreetMap', maxZoom:19 };

    let currentTileLayer = L.tileLayer(isDark() ? darkTileUrl : lightTileUrl, tileOpts).addTo(map);

    // Cambio de tema → cambio de tile (escucha data-theme Y la clase theme-dia)
    const observer = new MutationObserver(() => {
      const newUrl = isDark() ? darkTileUrl : lightTileUrl;
      if (currentTileLayer._url !== newUrl) {
        map.removeLayer(currentTileLayer);
        currentTileLayer = L.tileLayer(newUrl, tileOpts).addTo(map);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    L.control.zoom({ position:'bottomleft' }).addTo(map);
    L.control.attribution({ prefix:false, position:'bottomright' }).addTo(map);
    const GeoLocControl = L.Control.extend({
      onAdd: function() {
        const btn = L.DomUtil.create('button', 'leaflet-control-geoloc');
        btn.innerHTML = '📍'; btn.title = 'Mi ubicación';
        btn.onclick = () => startGPS();
        return btn;
      }
    });
    new GeoLocControl({ position:'bottomleft' }).addTo(map);
    // markersGroup = vistas de categoría: agrupa SOLO pines realmente encimados
    // (maxClusterRadius pequeño) mostrando un ícono + contador. Un mismo tipo abierto
    // se colapsa en un contador; sin superposición se ven individuales.
    // Con muchos comercios, agrupar más en zoom lejano y soltar al acercarse.
    markersGroup = L.markerClusterGroup({ chunkedLoading:true, spiderfyOnMaxZoom:false, showCoverageOnHover:false,
      maxClusterRadius: z => z <= 13 ? 64 : z <= 15 ? 44 : 24, disableClusteringAtZoom:17 }).addTo(map);
    // sampleGroup = muestra de INICIO (sin categoría): íconos individuales por categoría,
    // sin agrupar y sin contador — solo para mostrar qué hay en la zona.
    sampleGroup = L.layerGroup().addTo(map);
    userMarker = L.marker([state.lat,state.lng], { icon:crearIconoUsuario(), zIndexOffset:1000 }).addTo(map);
    const pj = getPersonajeUsuario();
    const _fotoP = (window.auth && auth.getUser && auth.getUser()?.avatar_url || '');
    const _popAvatar = (_fotoP.startsWith('data:image') || _fotoP.startsWith('http'))
      ? `<img src="${_fotoP}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:3px solid ${pj.color};margin-bottom:4px" referrerpolicy="no-referrer">`
      : `<div style="font-size:36px;line-height:1;margin-bottom:4px">${pj.emoji}</div>`;
    userMarker.bindPopup(`<div style="text-align:center;font-family:'DM Sans',sans-serif">${_popAvatar}<b style="color:${pj.color}">${pj.nombre}</b><br><span style="font-size:11px;color:#94a3b8">Nivel ${pj.nivel} · Tú estás aquí</span></div>`);
    radiusCircle = L.circle([state.lat,state.lng], { radius:currentRadius, color:'#f0b429', weight:2, dashArray:'6,4', fillOpacity:0.08, fillColor:'#f0b429' }).addTo(map);
    // Ajustar zoom inicial para mostrar el círculo completo
    try { map.fitBounds(radiusCircle.getBounds(), { padding:[24,24], maxZoom:16 }); } catch(_) {}
  }

  // Muestra de inicio: un cluster group por categoría (emoji), así el contador
  // agrupa SOLO el mismo tipo — categorías distintas quedan en contadores separados.
  let _muestraClusters = {};

  // Devuelve (creando si hace falta) el cluster group de la muestra para una categoría.
  // El ícono del cluster es el emoji de la categoría + un badge con el nº de negocios.
  function _grupoMuestra(emoji) {
    if (!_muestraClusters[emoji]) {
      const g = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: false,
        maxClusterRadius: 45,
        iconCreateFunction: (cluster) => L.divIcon({
          className: '',
          html: `<div style="position:relative;width:46px;height:46px;display:flex;align-items:center;justify-content:center">
            <div style="font-size:30px;filter:grayscale(0.25)">${emoji}</div>
            <span style="position:absolute;top:-2px;right:-2px;background:#6E56F8;color:#fff;font:700 11px 'DM Sans',sans-serif;min-width:18px;height:18px;padding:0 4px;border-radius:10px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)">${cluster.getChildCount()}</span>
          </div>`,
          iconSize: [46, 46]
        })
      });
      _muestraClusters[emoji] = g;
      sampleGroup.addLayer(g);
    }
    return _muestraClusters[emoji];
  }

  // Limpia AMBOS grupos (categoría + muestra de inicio): así al cambiar de vista
  // nunca quedan marcadores de la vista anterior mezclados.
  function limpiarMarcadores() {
    if (markersGroup) markersGroup.clearLayers();
    if (sampleGroup) sampleGroup.clearLayers();
    _muestraClusters = {}; // los sub-clusters se recrean en el próximo render de inicio
  }

  // Padding chico → el círculo del radio llena el mapa (toca los bordes). maxZoom alto
  // para que los radios pequeños igual llenen. Tras esto, el usuario ajusta con +/-.
  function _encuadrarRadio() {
    if(!map||!state.gpsActive||!radiusCircle) return;
    try { map.fitBounds(radiusCircle.getBounds(), { padding:[16,16], maxZoom:18, animate:false }); } catch(_) {}
  }
  function ajustarZoomPorRadio() { _encuadrarRadio(); }

  // Encuadre único tras un render: con GPS activo enmarca SIEMPRE el círculo del radio
  // (el zoom refleja el radio elegido, no la dispersión de marcadores); sin GPS
  // (búsqueda por dirección/comuna) enmarca los marcadores recibidos.
  function encuadrarMapa(boundsMarcadores) {
    if (!map) return;
    if (state.gpsActive && radiusCircle) { _encuadrarRadio(); return; }
    try { if (boundsMarcadores && boundsMarcadores.isValid()) map.fitBounds(boundsMarcadores, { padding:[24,24], maxZoom:16 }); } catch(_) {}
  }

  function actualizarCirculoRadio() {
    if(radiusCircle && state.gpsActive) {
      radiusCircle.setLatLng([state.lat,state.lng]);
      radiusCircle.setRadius(currentRadius);
    }
  }

  function setupEvents() {
    document.querySelectorAll('.cat-tab').forEach(btn => btn.onclick = () => {
      const yaActivo = btn.classList.contains('active');
      document.querySelectorAll('.cat-tab').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.fuel-chip').forEach(c => c.classList.remove('active'));
      state.fuelType = null;
      if(yaActivo) {
        state.mode = null;
        state.comercios = [];
        state.comercioActivo = null;
        state.categoriaProducto = null;
        if(document.getElementById('commerceDetailPanel').classList.contains('open')){document.getElementById('commerceDetailPanel').classList.remove('open');const _bd=document.getElementById('cdpBackdrop');if(_bd)_bd.classList.remove('open');}
        document.getElementById('paseadoresPanel').classList.remove('open');
        const cse = document.getElementById('prodCatSelect'); if(cse) cse.value = '';
        dom.fuelRow.style.display = 'none';
        dom.commerceRow.style.display = 'none';
        dom.advancedPanel.classList.remove('open');
        dom.commerceAdvPanel.classList.remove('open');
        dom.productoInput.value = '';
        dom.resultadoTitle.innerText = 'Estaciones en el área';
        vistaGeneral();
      } else {
        btn.classList.add('active');
        state.mode = btn.dataset.cat;
        actualizarUIporModo();
      }
    });

    document.getElementById('fuelChips').onclick = e => {
      const chip = e.target.closest('.fuel-chip');
      if(!chip) return;
      const yaActivo = chip.classList.contains('active');
      document.querySelectorAll('.fuel-chip').forEach(c => c.classList.remove('active'));
      if(yaActivo) {
        state.fuelType = null;
        vistaGeneral();
      } else {
        chip.classList.add('active');
        state.fuelType = chip.dataset.val;
        buscar();
      }
    };

    // Sincronizar los 3 sliders (combustible, comercio, mapa flotante)
    const sliderHandler = (sourceId) => {
      const slider = document.getElementById(sourceId);
      if (!slider) return;
      slider.oninput = () => {
        currentRadius = parseInt(slider.value);
        const txt = (currentRadius/1000).toFixed(1)+' km';
        // Sincronizar TODOS los displays
        ['radiusVal','radiusVal1','radiusValMap'].forEach(id => { const e = document.getElementById(id); if(e) e.textContent = txt; });
        ['radiusSlider','radiusSlider1','radiusSliderMap'].forEach(id => { const e = document.getElementById(id); if(e && e.id !== sourceId) e.value = slider.value; });
        // Actualizar badge de radio aplicado
        const badge = document.getElementById('appliedRadiusBadge');
        if (badge) badge.textContent = '📏 ' + txt;
        actualizarCirculoRadio(); ajustarZoomPorRadio();
        if(state.mode === 'combustible' && state.fuelType) {
          buscar();
        } else if(state.mode && state.mode !== 'combustible') {
          cargarComerciosCercanos();
        } else {
          vistaGeneral();
        }
      };
    };
    sliderHandler('radiusSlider');
    sliderHandler('radiusSlider1');
    sliderHandler('radiusSliderMap');

    document.getElementById('btnBuscar').onclick = () => buscar();
    // "Buscar" único: geocodifica la dirección (si hay) y busca, en un solo botón.
    document.getElementById('btnBuscarFuel').onclick = () => _buscarConDireccion(dom.addressInput);
    document.getElementById('btnBuscarCommerce').onclick = () => _buscarConDireccion(dom.commerceAddressInput);
    document.getElementById('btnLimpiar').onclick = () => limpiarFiltros();
    document.getElementById('btnToggleAdvanced').onclick = () => dom.advancedPanel.classList.toggle('open');
    document.getElementById('btnToggleCommerceAdvanced').onclick = () => dom.commerceAdvPanel.classList.toggle('open');
    document.getElementById('btnLimpiarCommerce').onclick = () => {
      state.categoriaProducto = null;
      state.servicioEspecial = null;
      dom.productoInput.value = '';
      dom.commerceAddressInput.value = '';
      document.getElementById('prodCatSelect').value = '';
      document.getElementById('paseadoresPanel').classList.remove('open');
      cargarComerciosCercanos();
    };

    document.getElementById('prodCatSelect').onchange = e => {
      const sel = e.target;
      const val = sel.value;
      const especial = sel.options[sel.selectedIndex]?.dataset?.especial || null;

      state.categoriaProducto = val || null;
      state.servicioEspecial = especial;

      if(!val) {
        document.getElementById('paseadoresPanel').classList.remove('open');
        cargarComerciosCercanos();
      } else if(especial) {
        abrirPanelEspecial(especial);
      } else {
        buscar();
      }
    };

    // Los botones "📍 Ir" se eliminaron: Enter en la dirección hace el flujo único
    // (geocodifica + busca), igual que el botón "Buscar".
    dom.addressInput.addEventListener('keydown', e => { if(e.key==='Enter') _buscarConDireccion(dom.addressInput); });
    dom.commerceAddressInput.addEventListener('keydown', e => { if(e.key==='Enter') _buscarConDireccion(dom.commerceAddressInput); });
    dom.productoInput.addEventListener('keydown', e => { if(e.key==='Enter') { window._buscarVoz ? window._buscarVoz() : buscar(); } });
    // Autocompletar de comuna/dirección en los campos de dirección.
    if (window._initAutocompletarUbicacion) window._initAutocompletarUbicacion();

    dom.regionSelect.onchange = () => sincronizarComunas();
    dom.marcaSelect.onchange  = () => {};
    dom.comunaSelect.onchange = () => {};
    document.getElementById('sortBy').onchange = () => renderResults();
    document.getElementById('puntosBadge').onclick = () => abrirNivelPopup();

    function closeCdp() {
      document.getElementById('commerceDetailPanel').classList.remove('open');
      const bd = document.getElementById('cdpBackdrop');
      if (bd) bd.classList.remove('open');
      state.comercioActivo = null;
    }

    async function toggleFavorito() {
      const u = auth.getUser();
      const com = state.comercioActivo;
      if (!u || !com) return;
      const btn = document.getElementById('cdpFavBtn');
      const r = await fetch('/api/usuario/favoritos/toggle', {
        method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'same-origin',
        body: JSON.stringify({ user_id: u.id, local_id: com.id, nombre: com.nombre, direccion: com.direccion })
      }).then(r => r.json()).catch(() => null);
      if (!r) return;
      if (!r.success && r.nivel_requerido) {
        return mostrarToast(`🔒 Necesitas Nivel 2 (Rastreador Experto) para guardar favoritos`);
      }
      if (!r.success && r.limite_alcanzado) {
        return mostrarToast(`❤️ Límite de 3 favoritos en Nivel 2. Sube a Cazador de Precios para ilimitados`);
      }
      if (r.success) {
        btn.textContent = r.guardado ? '❤️' : '🤍';
        btn.classList.toggle('activo', r.guardado);
        mostrarToast(r.guardado ? '❤️ Guardado en favoritos' : 'Eliminado de favoritos');
      }
    }
    window.toggleFavorito = toggleFavorito;

    async function actualizarBtnFavorito(local_id) {
      const u = auth.getUser();
      const btn = document.getElementById('cdpFavBtn');
      if (!btn) return;
      if (!u) { btn.style.display = 'none'; return; }
      btn.style.display = 'flex';
      try {
        const r = await fetch(`/api/usuario/favoritos/check?user_id=${u.id}&local_id=${local_id}`, { credentials: 'same-origin' }).then(r=>r.json());
        btn.textContent = r.es_favorito ? '❤️' : '🤍';
        btn.classList.toggle('activo', !!r.es_favorito);
      } catch (_) { btn.textContent = '🤍'; }
    }
    // mostrarComercio() (otro scope del IIFE) necesita esta función → exponerla.
    window.actualizarBtnFavorito = actualizarBtnFavorito;
    document.getElementById('cdpBack').onclick = closeCdp;
    const cdpBd = document.getElementById('cdpBackdrop');
    if (cdpBd) cdpBd.onclick = closeCdp;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.comercioActivo) closeCdp(); });
    document.getElementById('cdpSearch').oninput = e => {
      renderProductosComercio(e.target.value.trim());
    };

    dom.productoInput.oninput = e => {
      const q = e.target.value.trim();
      if(state.comercios.length) renderComerciosList(q);
    };
  }

  function limpiarFiltros() {
    state.mode = null;
    state.fuelType = null;
    state.comercios = [];
    state.comercioActivo = null;
    state.categoriaProducto = null;
    state.resultadosIds = new Set();
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.fuel-chip').forEach(c => c.classList.remove('active'));
    const cs = document.getElementById('prodCatSelect'); if(cs) cs.value = '';
    dom.marcaSelect.value = '';
    dom.regionSelect.value = '';
    dom.comunaSelect.value = '';
    dom.fuelRow.style.display = 'none';
    dom.commerceRow.style.display = 'none';
    dom.advancedPanel.classList.remove('open');
    dom.commerceAdvPanel.classList.remove('open');
    dom.productoInput.value = '';
    if(dom.commerceAddressInput) dom.commerceAddressInput.value = '';
    document.getElementById('commerceDetailPanel').classList.remove('open');
    dom.resultadoTitle.innerText = 'Estaciones en el área';
    dom.resultadoTitle.style.display = 'none';   // sin categoría seleccionada → ocultar título
    actualizarConteo(0, false);
    vistaGeneral();
  }

  function actualizarUIporModo() {
    const esComb = state.mode === 'combustible';

    dom.fuelRow.style.display        = esComb ? 'flex' : 'none';
    dom.commerceRow.style.display    = esComb ? 'none' : 'flex';

    if(!esComb) dom.advancedPanel.classList.remove('open');
    if(esComb)  dom.commerceAdvPanel.classList.remove('open');

    document.getElementById('commerceDetailPanel').classList.remove('open');
    state.comercioActivo = null;
    state.categoriaProducto = null;

    const catSelect = document.getElementById('prodCatSelect');
    catSelect.innerHTML = '<option value="">Todas las categorías</option>';
    if(!esComb && CATS_PRODUCTO[state.mode]) {
      CATS_PRODUCTO[state.mode].forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.val;
        opt.textContent = cat.label;
        if(cat.especial) opt.dataset.especial = cat.especial;
        catSelect.appendChild(opt);
      });
    }
    catSelect.value = '';

    dom.resultadoTitle.innerText = esComb ? 'Estaciones en el área' : 'Comercios en el área';
    dom.resultadoTitle.style.display = '';   // hay categoría seleccionada → mostrar título

    if(esComb) {
      state.comerciosPotenciales = []; // combustibles nunca muestra potenciales de otras categorías
      vistaGeneral();
    } else {
      dom.productoInput.value = '';
      cargarComerciosCercanos();
      cargarPotencialesCercanos();  // Cargar también potenciales (Google Maps)
    }
  }

  // Emoji según tipo de negocio (para pins del mapa) - Sincronizado con admin
  function getCategoryEmoji(tipo) {
    const t = (tipo || '').toLowerCase();
    if (t.includes('combust') || t.includes('estac')) return '⛽';
    if (t.includes('productos') || t.includes('almac')) return '🏪'; // ALMACÉN = Minimercado
    if (t.includes('servicios') || t.includes('belleza') || t.includes('barber') || t.includes('peluq')) return '🤲'; // SERVICIOS = Manos
    if (t.includes('gastronomia') || t.includes('restau') || t.includes('comid')) return '🍴'; // GASTRONOMÍA = Tenedor
    if (t.includes('super')) return '🛍️';
    if (t.includes('farma')) return '💊';
    if (t.includes('mascot') || t.includes('paseo') || t.includes('vetin')) return '🐕';
    if (t.includes('panad')) return '🍞';
    if (t.includes('carnic')) return '🥩';
    return '🏪';
  }

  // ── Personaje del usuario: 100% personalizable + nivel en anillo ──
  // El anillo y el badge muestran el nivel; el emoji lo elige el usuario
  const NIVEL_INFO = {
    1: { color:'#22c55e', nombre:'Explorador Novato' },
    2: { color:'#eab308', nombre:'Rastreador Experto' },
    3: { color:'#f97316', nombre:'Cazador de Precios' },
  };

  // ── Avatar SVG: generador de personaje realista 100% combinable ──────────
  // Reemplaza la composición por emoji (ZWJ), que no renderizaba todas las
  // combinaciones de género × pelo × tono de piel en todos los dispositivos.
  // Cada combinación se dibuja como formas SVG: piel = relleno, pelo = color
  // y estilo, género = silueta. Tamaño parametrizable.
  // género: 'm' | 'f' | 'n'
  // pelo:   'negro' | 'rubio' | 'pelirrojo' | 'rizado' | 'canoso' | 'calvo'
  // piel:   '' | '🏻' | '🏼' | '🏽' | '🏾' | '🏿'
  function componerPersonaje(cfg, size) {
    const c   = cfg  || {};
    const S   = size || 50;
    const uid = 'avc' + Math.random().toString(36).slice(2,8); // ID único p/ clipPath

    // ── Paleta de tonos de piel (mapea los 6 valores del selector) ──
    const SKIN = {
      '':   '#f1c9a8',   // A  claro
      '\u{1F3FB}': '#f0c4a0',   // B  muy claro  (🏻)
      '\u{1F3FC}': '#e3ad84',   // C  claro-medio (🏼)
      '\u{1F3FD}': '#c98e62',   // D  medio      (🏽)
      '\u{1F3FE}': '#9c6b45',   // E  oscuro     (🏾)
      '\u{1F3FF}': '#6d4a30',   // F  muy oscuro (🏿)
    };
    const skin = SKIN[c.piel] != null ? SKIN[c.piel] : SKIN[''];

    // ── Estilos de pelo (color + bandera de rizado / calvo) ──
    const HAIR = {
      negro:     { color: '#26222b', curly: false, bald: false },
      rubio:     { color: '#e6b54e', curly: false, bald: false },
      pelirrojo: { color: '#b14b2a', curly: false, bald: false },
      canoso:    { color: '#d2d6db', curly: false, bald: false },
      rizado:    { color: '#5a3b22', curly: true,  bald: false },
      calvo:     { color: 'none',   curly: false, bald: true  },
    };
    const h = HAIR[c.pelo] || HAIR.negro;
    const g = c.genero === 'm' ? 'm' : c.genero === 'f' ? 'f' : 'n';
    const ink = '#3a2d24'; // color de ojos y boca

    // ── Formas del pelo ─────────────────────────────────────────────────────
    let hair = '';
    if (!h.bald) {
      if (h.curly) {
        // Rizos: cluster de círculos a lo largo de la línea capilar
        const topRizos = [[20,15,5.2],[27,11,5.6],[34,11,5.6],[41,15,5.2],[16,21,4.6],[48,21,4.6]];
        let extra = '';
        if (g === 'f')
          extra = '<circle cx="16" cy="29" r="4.6" fill="'+h.color+'"/>'
                + '<circle cx="48" cy="29" r="4.6" fill="'+h.color+'"/>'
                + '<circle cx="16" cy="36" r="4"   fill="'+h.color+'"/>'
                + '<circle cx="48" cy="36" r="4"   fill="'+h.color+'"/>';
        else if (g === 'n')
          extra = '<circle cx="16" cy="29" r="4.2" fill="'+h.color+'"/>'
                + '<circle cx="48" cy="29" r="4.2" fill="'+h.color+'"/>';
        hair = topRizos.map(function(a){
          return '<circle cx="'+a[0]+'" cy="'+a[1]+'" r="'+a[2]+'" fill="'+h.color+'"/>';
        }).join('') + extra;
      } else {
        // Pelo liso: casquete suave + paneles laterales según género
        const cap = '<path d="M17 25 C17 7 47 7 47 25 C42 16 22 16 17 25 Z" fill="'+h.color+'"/>';
        let sides = '';
        if (g === 'f') {
          // Largo: cae a los lados de la cara
          sides = '<path d="M16 22 C12 35 14 44 18 48 L22 48 C19 40 19 30 21 23 Z" fill="'+h.color+'"/>'
                + '<path d="M48 22 C52 35 50 44 46 48 L42 48 C45 40 45 30 43 23 Z" fill="'+h.color+'"/>';
        } else if (g === 'm') {
          // Corto: solo patillas pequeñas
          sides = '<path d="M17 24 C16 28 17 31 18 32 L20 31 C19 28 19 26 20 23 Z" fill="'+h.color+'"/>'
                + '<path d="M47 24 C48 28 47 31 46 32 L44 31 C45 28 45 26 44 23 Z" fill="'+h.color+'"/>';
        } else {
          // Neutro: cobertura media sobre orejas
          sides = '<path d="M17 23 C15 30 16 35 18 37 L21 36 C19 31 19 26 20 23 Z" fill="'+h.color+'"/>'
                + '<path d="M47 23 C49 30 48 35 46 37 L43 36 C45 31 45 26 44 23 Z" fill="'+h.color+'"/>';
        }
        hair = cap + sides;
      }
    }

    // ── Ensamblar SVG (orden de capas: fondo → ropa → cuello → orejas → cara → pelo → rasgos) ──
    return '<svg width="'+S+'" height="'+S+'" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0">'
      + '<defs><clipPath id="'+uid+'"><circle cx="32" cy="32" r="32"/></clipPath></defs>'
      + '<g clip-path="url(#'+uid+')">'
      +   '<circle cx="32" cy="32" r="32" fill="#eef1f5"/>'                              // fondo
      +   '<ellipse cx="32" cy="61" rx="21" ry="15" fill="#4b566f"/>'                    // hombros/ropa
      +   '<rect x="27" y="37" width="10" height="12" rx="4" fill="'+skin+'"/>'          // cuello
      +   '<ellipse cx="32" cy="38" rx="9" ry="4" fill="#00000010"/>'                    // sombra cuello
      +   '<circle cx="18" cy="28" r="3.3" fill="'+skin+'"/>'                            // oreja izq
      +   '<circle cx="46" cy="28" r="3.3" fill="'+skin+'"/>'                            // oreja der
      +   '<ellipse cx="32" cy="27" rx="14" ry="16" fill="'+skin+'"/>'                   // cara
      +   hair                                                                            // pelo
      +   '<ellipse cx="32" cy="22" rx="8" ry="2.5" fill="#00000008"/>'                  // sombra frente
      +   '<circle cx="27" cy="27.5" r="1.7" fill="'+ink+'"/>'                           // ojo izq
      +   '<circle cx="37" cy="27.5" r="1.7" fill="'+ink+'"/>'                           // ojo der
      +   '<circle cx="27.5" cy="27" r="0.7" fill="#fff" opacity="0.6"/>'                // brillo ojo izq
      +   '<circle cx="37.5" cy="27" r="0.7" fill="#fff" opacity="0.6"/>'                // brillo ojo der
      +   '<path d="M28.5 33 q3.5 2.8 7 0" stroke="'+ink+'" stroke-width="1.4" fill="none" stroke-linecap="round"/>' // sonrisa
      + '</g>'
      + '</svg>';
  }

  function getPersonajeUsuario() {
    const u = (window.auth && auth.getUser) ? auth.getUser() : null;
    const nivel = Math.min(3, Math.max(1, (u?.nivel) || 1));
    // Emoji del avatar elegido. Soporta los esquemas:
    //   'emoji:<emoji>'  → avatar combinado (género/edad/piel/pelo)
    //   'avatar:<key>'   → preset antiguo
    //   personaje.genero → recompone el emoji si no hay avatar_url usable
    let emoji = '🧑';
    const av = u?.avatar_url || '';
    if (av.startsWith('emoji:')) {
      emoji = av.slice(6) || emoji;
    } else if (av.startsWith('avatar:') && window.AVATARS) {
      const key = av.slice(7);
      if (window.AVATARS[key]) emoji = window.AVATARS[key].emoji;
    } else if (u && u.personaje && u.personaje.genero && window.componerAvatarEmoji) {
      emoji = window.componerAvatarEmoji(u.personaje) || emoji;
    }
    return { emoji, nivel, ...NIVEL_INFO[nivel] };
  }

  function crearIconoUsuario() {
    const p = getPersonajeUsuario();
    // Si el usuario eligió foto real, usarla en el marcador
    const _u = (window.auth && auth.getUser) ? auth.getUser() : null;
    const fotoUrl = _u?.avatar_url &&
      (_u.avatar_url.startsWith('data:image') || _u.avatar_url.startsWith('http'))
      ? _u.avatar_url : null;
    const avatarInner = fotoUrl
      ? `<img src="${fotoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" alt="" referrerpolicy="no-referrer">`
      : `<span class="user-char-emoji">${p.emoji}</span>`;
    return L.divIcon({
      className: '',
      html: `<div class="user-char" style="--ring:${p.color}">
               <div class="user-char-pulse"></div>
               <div class="user-char-body">${avatarInner}</div>
               <div class="user-char-badge">${p.nivel}</div>
             </div>`,
      iconSize: [64, 64], iconAnchor: [32, 32]
    });
  }

  // Pin moderno tipo gota con emoji por categoría (para resultados de búsqueda)
  function crearPinComercio(local, tieneProd) {
    const tipo = local.tipo_negocio || local.categoria || local.tipo || state.mode || '';
    const emoji = getCategoryEmoji(tipo);
    const cls = tieneProd ? 'map-pin con-prod' : 'map-pin';
    return L.divIcon({
      className: '',
      html: `<div class="${cls}"><div class="map-pin-badge">${emoji}</div></div>`,
      iconSize: [56, 66], iconAnchor: [28, 64], popupAnchor: [0, -60]
    });
  }

  // Icono simple flotante (sin burbuja) — para comercios fuera de los resultados activos
  function crearIconoSimple(local, tieneProd) {
    const tipo = local.tipo_negocio || local.categoria || local.tipo || state.mode || '';
    const emoji = getCategoryEmoji(tipo);
    const cls = tieneProd ? 'map-icon-simple con-prod' : 'map-icon-simple';
    return L.divIcon({
      className: '',
      html: `<div class="${cls}">${emoji}</div>`,
      iconSize: [48, 48], iconAnchor: [24, 24]
    });
  }

  function actualizarConteo(n, visible) {
    const badge = document.getElementById('resultCount');
    if(!badge) return;
    badge.textContent = n.toLocaleString('es-CL');
    badge.style.display = visible && n > 0 ? 'inline-flex' : 'none';
  }

  function vistaGeneral() {
    if(!localData.length) {
      limpiarMarcadores();
      actualizarConteo(0, false);
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">⛽</span> Conectando con el servidor…</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Verifica que el servidor local esté activo en <strong style="color:var(--text)">localhost:3000</strong></span></div>
          <div class="es-step"><div class="es-num">2</div><span>Una vez conectado, los datos del CNE se cargarán automáticamente</span></div>
          <div class="es-step"><div class="es-num">3</div><span>También puedes presionar <strong style="color:var(--accent)">Buscar</strong> para usar Overpass API como respaldo</span></div>
        </div>
      </div>`;
      return;
    }

    // ── Sin GPS: mostrar instrucciones primero, luego opción de activar GPS ───────
    if (!state.gpsActive) {
      limpiarMarcadores();
      actualizarConteo(0, false);
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">🗺️</span> Bienvenido a MercaDate</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Selecciona una categoría en la barra superior (⛽ Combustibles, 🏪 Almacenes, 🍴 Gastronomía, etc.)</span></div>
          <div class="es-step"><div class="es-num">2</div><span>Presiona el botón <strong style="color:var(--calipso)">📍 Activar GPS</strong> para ver comercios cercanos a tu ubicación</span></div>
          <div class="es-step"><div class="es-num">3</div><span>Ajusta el radio de búsqueda según qué tan lejos quieras buscar</span></div>
          <div class="es-step"><div class="es-num">4</div><span>Toca cualquier icono en el mapa para ver detalles y precios</span></div>
        </div>
        <div class="es-note">📍 El mejor precio, a la vuelta de la esquina</div>
        <button type="button" onclick="toggleGPS()" style="margin-top:16px;padding:11px 18px;border:none;border-radius:11px;font-family:inherit;font-weight:700;font-size:14px;cursor:pointer;background:linear-gradient(130deg,var(--accent2),var(--accent));color:#0B0D13;box-shadow:0 4px 14px rgba(242,185,69,0.3)">📍 Activar GPS</button>
      </div>`;
      setStatusBar('🗺️ Selecciona una categoría y activa GPS para comenzar');
      return;
    }

    // ── Con GPS activo pero sin categoría: mostrar TODOS los comercios cercanos ───────
    if (state.gpsActive && !state.mode) {
      cargarComerciosAlInicio();
      return;
    }

    const seen = new Set();
    const estaciones = localData
      .filter(s => {
        const key = s.idEstacion || (s.nombre + '|' + s.direccion);
        if(seen.has(key)) return false;
        seen.add(key); return true;
      })
      .map(s => ({
        nombre:     s.nombre,
        direccion:  s.direccion,
        lat: s.lat, lng: s.lng,
        distanciaM: state.gpsActive ? calcularDistancia(state.lat,state.lng,s.lat,s.lng) : 0
      }))
      .filter(s => !state.gpsActive || s.distanciaM <= currentRadius)
      .sort((a,b) => (a.distanciaM||999999) - (b.distanciaM||999999));

    limpiarMarcadores();
    estaciones.forEach(item => {
      if(!item.lat || !item.lng) return;
      // Pin con emoji de categoría + nombre (marca)
      const emoji = getCategoryEmoji(item.tipo_negocio || item.tipo || state.mode || '');
      const isCyan = (state.mode === 'almacen' || state.mode === 'supermercado');
      const nombreCorto = item.nombre.length > 20 ? item.nombre.substring(0,18)+'…' : item.nombre;
      const icon = L.divIcon({
        className: 'brand-pin-icon',
        html: `<div class="brand-pin${isCyan?' cyan':''}"><span class="brand-emoji">${emoji}</span></div>`,
        iconSize: [44, 44], iconAnchor: [22, 44]
      });
      L.marker([item.lat, item.lng], { icon })
        .bindTooltip(nombreCorto, {
          permanent: true, direction: 'bottom',
          offset: [0, 4], className: 'brand-tooltip'
        })
        .bindPopup(`<b style="font-weight:700;font-size:14px">${item.nombre}</b>${item.direccion ? '<br><span style="color:#94a3b8;font-size:11.5px">'+item.direccion+'</span>' : ''}`)
        .addTo(markersGroup);
    });

    if(estaciones.length) {
      try {
        const validos = estaciones.filter(i => i.lat && i.lng);
        if(validos.length) {
          const bounds = L.latLngBounds(validos.slice(0, 30).map(i => [i.lat, i.lng]));
          if(state.gpsActive) bounds.extend([state.lat, state.lng]);
          encuadrarMapa(bounds);
        }
      } catch(e) {}
    }

    actualizarConteo(estaciones.length, true);

    state.results = [];
    dom.resultsList.innerHTML = mensajeVacio();

    // Status bar útil: ubicación + radio (NO duplicar el conteo que ya está en el título)
    if (state.gpsActive) {
      setStatusBar(`📍 Tu ubicación · Radio ${(currentRadius/1000).toFixed(1)} km`);
    } else {
      setStatusBar(`📡 Activa GPS para ver comercios cercanos`);
    }
  }

  async function cargarTodasEstaciones() {
    if(localData.length) {
      state.allStations = filtrarYMapear(localData, '93');
      poblarFiltrosDesdeEstaciones();
      setStatusBar(`✅ ${localData.length.toLocaleString()} registros cargados`);
      vistaGeneral(); return;
    }
    const cargado = await cargarCSVDesdeServidor();
    if(cargado) {
      state.allStations = filtrarYMapear(localData, '93');
      poblarFiltrosDesdeEstaciones();
      vistaGeneral();
    } else {
      setStatusBar('⚠️ Sin datos del servidor. Activa el GPS y presiona Buscar.');
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">⚠️</span> Sin conexión al servidor</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Inicia el servidor local en <strong style="color:var(--text)">localhost:3000</strong> para ver precios reales del CNE</span></div>
          <div class="es-step"><div class="es-num">2</div><span>Activa el GPS y presiona <strong style="color:var(--accent)">Buscar</strong> para usar Overpass API como respaldo (sin precios reales)</span></div>
        </div>
        <div class="es-note">💡 Los datos de Overpass API son de OpenStreetMap y pueden no tener precios actualizados</div>
      </div>`;
    }
  }

  function poblarFiltrosDesdeEstaciones() {
    if(!state.allStations.length) return;
    const marcas   = [...new Set(state.allStations.map(s=>s.nombre))].sort();
    const regiones = [...new Set(state.allStations.map(s=>s.region))].filter(Boolean).sort();
    llenarSelect(dom.marcaSelect,  marcas,   'Todas las marcas');
    llenarSelect(dom.regionSelect, regiones, 'Todas las regiones');
    sincronizarComunas();
  }

  function sincronizarComunas() {
    const reg = dom.regionSelect.value;
    const comunas = reg
      ? [...new Set(state.allStations.filter(s=>s.region===reg).map(s=>s.comuna))]
      : [...new Set(state.allStations.map(s=>s.comuna))];
    llenarSelect(dom.comunaSelect, comunas.filter(Boolean).sort(), 'Todas las comunas');
  }

  function llenarSelect(sel, items, ph) {
    sel.innerHTML = `<option value="">${ph}</option>`;
    items.forEach(i=>{ const o=document.createElement('option'); o.value=o.textContent=i; sel.appendChild(o); });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CATEGORÍAS DINÁMICAS — se leen del servidor (controladas desde Admin)
  // ════════════════════════════════════════════════════════════════════════
  async function actualizarCategoriasNav() {
    try {
      const [rCats, rRubros] = await Promise.all([
        fetch('/api/categorias').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/rubros').then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      const categorias = (rCats && rCats.categorias) ? rCats.categorias : {};
      const rubros = rRubros || {};
      const nav = document.querySelector('.category-nav');
      const FIJOS = ['combustible', 'almacen', 'servicio', 'restaurante', 'mascota'];
      const BASE  = ['productos', 'servicios', 'gastronomia'];

      // 1) Crear tabs para rubros PERSONALIZADOS activos que aún no existen en el HTML
      if (nav) {
        Object.entries(rubros).forEach(([key, r]) => {
          if (FIJOS.includes(key) || BASE.includes(key)) return;
          if (!categorias[key]) return;                              // solo si está activo
          if (nav.querySelector(`.cat-tab[data-cat="${key}"]`)) return; // ya existe
          const btn = document.createElement('button');
          btn.className = 'cat-tab';
          btn.dataset.cat = key;
          btn.innerHTML = `${r.icon || '🏷️'} ${r.nombre || key}`;
          btn.onclick = () => {
            document.querySelectorAll('.cat-tab').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            state.mode = btn.dataset.cat;
            actualizarUIporModo();
          };
          nav.appendChild(btn);
        });
      }

      // 2) Habilitar / deshabilitar / limpiar según estado activo
      document.querySelectorAll('.cat-tab[data-cat]').forEach(btn => {
        const cat = btn.dataset.cat;
        if (cat === 'combustible') return; // siempre activa
        const activa = !!categorias[cat];
        if (activa) {
          btn.disabled = false;
          btn.classList.remove('proximamente');
          const badge = btn.querySelector('.cat-soon');
          if (badge) badge.remove();
        } else {
          // Un rubro personalizado inactivo se quita del nav (los fijos quedan en "Próximamente")
          if (!FIJOS.includes(cat)) { btn.remove(); return; }
          btn.disabled = true;
          btn.classList.add('proximamente');
          if (!btn.querySelector('.cat-soon')) {
            const sp = document.createElement('span');
            sp.className = 'cat-soon';
            sp.textContent = 'Próximamente';
            btn.appendChild(sp);
          }
        }
      });
    } catch (e) { /* si falla, dejar las pestañas como están en el HTML */ }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PERMISO DE GPS — se pide UNA sola vez por usuario (guarda en localStorage)
  // ════════════════════════════════════════════════════════════════════════
  function _claveGPS() {
    try {
      const u = JSON.parse(localStorage.getItem('mercadate_user') || '{}');
      return 'md_gps_' + (u.id || u.email || 'dev');
    } catch { return 'md_gps_dev'; }
  }

  // ─── Primer ingreso: Términos y Condiciones → permiso GPS ───────────────
  // TYC_VERSION centralizada en server.js — se lee al arrancar
  let TYC_VERSION = '2.1'; // fallback si la API no responde
  (async () => { try { const r = await fetch('/api/tyc-version'); const d = await r.json(); if (d && d.version) TYC_VERSION = d.version; } catch (_) {} })();

  function _tycAceptado() {
    // El servidor es la fuente de verdad (viene en el usuario del login);
    // localStorage evita re-mostrar en el mismo dispositivo.
    const u = window.usuarioActual;
    if (u && u.tyc_version === TYC_VERSION) return true;
    return localStorage.getItem('md_tyc_v') === TYC_VERSION;
  }

  function _flujoPrimerIngreso() {
    if (window.MDOnboarding) {
      window.MDOnboarding.mostrarUnaVez('usuario', _continuarPrimerIngreso);
    } else {
      _continuarPrimerIngreso();
    }
  }

  function _continuarPrimerIngreso() {
    if (_tycAceptado()) { pedirPermisoGPS(); return; }
    _mostrarModalTyC();
  }

  function _mostrarModalTyC() {
    if (document.getElementById('tycModal')) return;
    const ov = document.createElement('div');
    ov.id = 'tycModal';
    ov.style.cssText = [
      'position:fixed','inset:0','z-index:99999',
      'background:rgba(15,19,32,.94)','display:flex',
      'align-items:center','justify-content:center',
      "font-family:'DM Sans',Inter,sans-serif"
    ].join(';');
    ov.innerHTML = `
      <div style="background:#1a2233;border-radius:20px;padding:28px 24px;width:330px;max-width:92%;box-shadow:0 24px 64px rgba(0,0,0,.6);text-align:center">
        <img src="img/Logo_MercaDate/Logo_MercaDate1.png" alt="MercaDate"
             style="height:52px;width:52px;object-fit:contain;border-radius:13px;margin-bottom:10px"
             onerror="this.style.display='none'">
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:21px;
                    background:linear-gradient(130deg,#f0b429,#f5c64d);
                    -webkit-background-clip:text;-webkit-text-fill-color:transparent;
                    background-clip:text;margin-bottom:14px">MercaDate</div>
        <div style="font-size:34px;margin-bottom:8px">📄</div>
        <h3 style="color:#fff;font-size:16px;margin:0 0 10px">Términos y Condiciones</h3>
        <p style="color:#94a3b8;font-size:12.5px;line-height:1.55;margin:0 0 14px">
          Para usar MercaDate necesitas aceptar nuestros Términos y Condiciones de Uso
          (versión ${TYC_VERSION}). Resumen: la plataforma conecta usuarios con comercios locales
          y muestra precios de combustibles con fines informativos; cada comercio es responsable
          de su contenido, y tus datos se tratan según nuestra política de privacidad.
        </p>
        <a href="legal/terminos.html" target="_blank" rel="noopener"
           style="display:block;color:#f0b429;font-size:13px;font-weight:700;margin-bottom:6px;text-decoration:underline">
          Leer los términos completos
        </a>
        <a href="legal/privacidad.html" target="_blank" rel="noopener"
           style="display:block;color:#94a3b8;font-size:12.5px;margin-bottom:14px;text-decoration:underline">
          🔒 Política de Privacidad y Protección de Datos (Ley 21.719)
        </a>
        <label style="display:flex;align-items:flex-start;gap:9px;text-align:left;margin-bottom:16px;cursor:pointer">
          <input type="checkbox" id="tycCheck" style="width:18px;height:18px;margin-top:1px;flex-shrink:0;cursor:pointer"
                 onchange="document.getElementById('tycBtn').disabled=!this.checked;
                           document.getElementById('tycBtn').style.opacity=this.checked?'1':'.45'">
          <span style="font-size:12.5px;color:#cbd5e1;line-height:1.5">
            He leído y acepto los Términos y Condiciones de Uso de MercaDate (versión ${TYC_VERSION}).
          </span>
        </label>
        <button id="tycBtn" onclick="window._aceptarTyC()" disabled
          style="width:100%;padding:13px;border-radius:10px;border:none;opacity:.45;
                 background:#f0b429;color:#1a1a1a;font-weight:800;font-size:14px;cursor:pointer">
          Continuar
        </button>
        <p style="color:#64748b;font-size:11px;margin:12px 0 0">
          Si no estás de acuerdo, puedes cerrar sesión desde Mi Cuenta.
        </p>
      </div>`;
    document.body.appendChild(ov);
  }

  window._aceptarTyC = async function() {
    const chk = document.getElementById('tycCheck');
    if (!chk || !chk.checked) return; // requiere marcar la casilla explícitamente
    localStorage.setItem('md_tyc_v', TYC_VERSION);
    document.getElementById('tycModal')?.remove();
    // Registrar en el servidor (no bloquea el flujo si falla; se reintenta en el próximo ingreso)
    try {
      await window.Api.post('/usuario/aceptar-tyc', {});
      const u = window.usuarioActual;
      if (u) { u.tyc_version = TYC_VERSION; try { localStorage.setItem('mercadate_user', JSON.stringify(u)); } catch(_){} }
    } catch (_) { localStorage.removeItem('md_tyc_v'); }
    pedirPermisoGPS();
  };

  // Arranca el GPS solo si el navegador ya tiene permiso concedido.
  // No muestra modal ni depende del flujo de onboarding/TyC.
  async function _gpsAutoSiPermitido() {
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') {
        setTimeout(startGPS, 400);
      }
      // Reaccionar si el usuario concede permiso después
      perm.onchange = () => { if (perm.state === 'granted' && !state.gpsActive) startGPS(); };
    } catch (_) {
      if (localStorage.getItem(_claveGPS()) === 'granted') setTimeout(startGPS, 400);
    }
  }

  async function pedirPermisoGPS() {
    // 1. Consultar el estado real del permiso en el navegador
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state === 'granted') {
        // Ya permitido → arrancar GPS directo, sin modal ni confirmación
        startGPS();
        return;
      }
      if (perm.state === 'denied') {
        // Ya denegado → solo informar
        setStatusBar('📍 GPS bloqueado. Habilítalo en la configuración del navegador.');
        return;
      }
      // 'prompt' → primera vez o indeterminado → mostrar modal propio
    } catch (_) {
      // Navegador sin Permissions API → intentar directo
      if (localStorage.getItem(_claveGPS()) === 'granted') { startGPS(); return; }
    }
    // Mostrar modal solo si el permiso es 'prompt' (no se ha decidido aún)
    if (localStorage.getItem(_claveGPS()) === 'granted') { startGPS(); return; }
    _mostrarModalGPS();
  }

  function _mostrarModalGPS() {
    if (document.getElementById('gpsPermModal')) return;
    const ov = document.createElement('div');
    ov.id = 'gpsPermModal';
    ov.style.cssText = [
      'position:fixed','inset:0','z-index:99998',
      'background:rgba(15,19,32,.92)','display:flex',
      'align-items:center','justify-content:center',
      "font-family:'DM Sans',Inter,sans-serif"
    ].join(';');
    ov.innerHTML = `
      <div style="background:#1a2233;border-radius:20px;padding:30px 26px;width:310px;max-width:90%;box-shadow:0 24px 64px rgba(0,0,0,.6);text-align:center">
        <img src="img/Logo_MercaDate/Logo_MercaDate1.png" alt="MercaDate"
             style="height:56px;width:56px;object-fit:contain;border-radius:14px;margin-bottom:12px"
             onerror="this.style.display='none'">
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:22px;
                    background:linear-gradient(130deg,#f0b429,#f5c64d);
                    -webkit-background-clip:text;-webkit-text-fill-color:transparent;
                    background-clip:text;margin-bottom:4px">MercaDate</div>
        <div style="font-size:11.5px;color:#94a3b8;margin-bottom:18px">
          El mejor precio, a la vuelta de la esquina
        </div>
        <div style="font-size:38px;margin-bottom:10px">📍</div>
        <h3 style="color:#fff;font-size:16px;margin:0 0 10px">¿Permitir acceso a tu ubicación?</h3>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 22px">
          MercaDate usa tu ubicación para mostrarte los mejores precios de combustibles
          y comercios <strong style="color:#e2e8f0">cerca de donde estás</strong>.
          Tu ubicación nunca se almacena.
        </p>
        <button onclick="window._aceptarGPS()"
          style="width:100%;padding:13px;border-radius:10px;border:none;
                 background:#f0b429;color:#1a1a1a;font-weight:800;font-size:14px;
                 cursor:pointer;margin-bottom:10px">
          📍 Sí, usar mi ubicación
        </button>
        <button onclick="window._rechazarGPS()"
          style="width:100%;padding:11px;border-radius:10px;
                 border:1px solid #2a3342;background:transparent;
                 color:#94a3b8;font-size:13px;cursor:pointer">
          Ahora no
        </button>
      </div>`;
    document.body.appendChild(ov);
  }

  window._aceptarGPS = function() {
    localStorage.setItem(_claveGPS(), 'granted');
    document.getElementById('gpsPermModal')?.remove();
    // Gesto del usuario → precargar la voz de MercaDate (descarga el modelo una
    // vez) para que esté lista cuando el GPS fije la posición y salude.
    if (window.VozMercaDate && window.VozMercaDate.inicializar) window.VozMercaDate.inicializar();
    startGPS();
  };
  window._rechazarGPS = function() {
    localStorage.setItem(_claveGPS(), 'denied');
    document.getElementById('gpsPermModal')?.remove();
    setStatusBar('📍 Puedes activar tu ubicación en cualquier momento tocando el botón GPS.');
  };

  // ── Modal in-app para reportar precio (reemplaza prompt(), bloqueado en WebView) ──
  function _modalReportarPrecio(precioMostrado, onConfirm) {
    document.getElementById('reportarPrecioModal')?.remove();
    const ov = document.createElement('div');
    ov.id = 'reportarPrecioModal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(11,13,19,.85);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    ov.innerHTML = `
      <div style="background:#161B27;border:1px solid #313850;border-radius:18px;padding:22px 20px 18px;width:320px;max-width:100%;box-shadow:0 20px 50px rgba(0,0,0,.6)">
        <div style="font-weight:800;font-size:16px;color:#ECEEF5;margin-bottom:6px">🔁 Reportar precio</div>
        <div style="font-size:13px;color:#8B91A7;margin-bottom:14px">Precio actual: <strong style="color:#F2B945">$${precioMostrado.toLocaleString('es-CL')}</strong><br>Ingresa el precio correcto:</div>
        <input id="reportarPrecioInput" type="number" inputmode="numeric" placeholder="$"
          style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid #313850;background:#0B0D13;color:#ECEEF5;font-size:16px;margin-bottom:16px;outline:none">
        <div style="display:flex;gap:8px">
          <button id="reportarPrecioOk" style="flex:1;padding:11px;border-radius:10px;border:none;background:#6E56F8;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Enviar reporte</button>
          <button id="reportarPrecioCancel" style="flex:0 0 90px;padding:11px;border-radius:10px;border:1px solid #313850;background:transparent;color:#8B91A7;font-size:13px;cursor:pointer">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const input = ov.querySelector('#reportarPrecioInput');
    const cerrar = () => ov.remove();
    setTimeout(() => input.focus(), 50);
    ov.addEventListener('click', e => { if (e.target === ov) cerrar(); });
    ov.querySelector('#reportarPrecioCancel').onclick = cerrar;
    const enviar = () => {
      const v = parseInt(input.value, 10);
      if (!input.value || isNaN(v) || v <= 0) { mostrarToast('Ingresa un precio válido.', 3000, 'warn'); return; }
      cerrar();
      onConfirm(v);
    };
    ov.querySelector('#reportarPrecioOk').onclick = enviar;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') enviar(); });
  }

  function startGPS() {
    if(!navigator.geolocation){ updateGPSStatus(false,'No soportado'); return; }
    setStatusBar('🛰️ Solicitando permiso de ubicación...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.lat=pos.coords.latitude; state.lng=pos.coords.longitude;
        state.gpsActive=true; updateGPSStatus(true,'GPS Activo');
        try { if (map && map.invalidateSize) map.invalidateSize(); } catch(_){}
        actualizarMarcadorUsuario(); actualizarCirculoRadio();
        _encuadrarRadio(); // enfocar el círculo del radio al activar GPS

        // Al iniciar (sin categoría seleccionada): cargar TODOS los comercios
        if (!state.mode) {
          cargarComerciosAlInicio();
        } else if(state.mode && state.mode !== 'combustible') {
          cargarComerciosCercanos();
        } else {
          vistaGeneral();
        }
        if(state.mode === 'almacen') setTimeout(() => cargarComerciosCercanos(), 500);
        // El saludo se dispara cuando hay login correcto + GPS conectado.
        _saludarSiListo();
      },
      () => {
        updateGPSStatus(false,'GPS Desactivado');
        setStatusBar('📍 No pude conectar tu ubicación. Activá el GPS y conectate a una red.');
        if (window.mostrarToast) window.mostrarToast('📍 No pude conectar tu ubicación. Activá el GPS y conectate a una red (wifi o datos).', 5000, 'err');
      },
      { timeout:8000 }
    );
  }

  // Saluda por voz solo cuando se cumplen las DOS condiciones: usuario logueado
  // y GPS conectado. Se puede llamar desde el éxito del GPS o desde 'sesion-lista'
  // (cubre cualquier orden). Una sola vez por sesión.
  // ── Período libre: 48h desde el registro — todo desbloqueado ────────────────
  function _esPeriodoLibre(u) {
    const usr = u || (window.auth && auth.getUser ? auth.getUser() : null);
    if (!usr) return false;
    if (usr.periodo_libre === true) return true; // flag del servidor
    if (!usr.fecha_registro) return false;
    return (Date.now() - new Date(usr.fecha_registro).getTime()) <= 48 * 60 * 60 * 1000;
  }
  window._esPeriodoLibre = _esPeriodoLibre;

  // Muestra el popup ilustrativo de progresión de niveles (una sola vez al expirar)
  function _mostrarPopupNiveles() {
    let popup = document.getElementById('nivelesProgrPopup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'nivelesProgrPopup';
      popup.className = 'nivel-popup';
      popup.innerHTML = `
        <div class="nivel-popup-backdrop" onclick="document.getElementById('nivelesProgrPopup').style.display='none'"></div>
        <div class="nivel-popup-card" style="top:50%;left:50%;right:auto;transform:translate(-50%,-50%);width:340px;padding:0;overflow:hidden">
          <button class="nivel-popup-close" onclick="document.getElementById('nivelesProgrPopup').style.display='none'">✕</button>
          <div style="background:linear-gradient(135deg,#f97316,#eab308);padding:22px 24px 18px;text-align:center">
            <div style="font-size:30px;margin-bottom:6px">🎯</div>
            <div style="font-weight:800;font-size:18px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3)">Tu período gratuito terminó</div>
            <div style="font-size:12.5px;color:#fff;opacity:0.9;margin-top:5px;font-weight:500">Sigue acumulando puntos para desbloquear funciones</div>
          </div>
          <div style="padding:16px 20px;display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:rgba(34,197,94,0.1);border-radius:10px;border:1px solid rgba(34,197,94,0.3)">
              <span style="font-size:20px">🟢</span>
              <div><div style="font-weight:700;font-size:13px;color:#22c55e">Explorador Novato · 0–200 pts</div><div style="font-size:11.5px;color:var(--text2,#94a3b8);margin-top:2px">Búsqueda, GPS, QR, Lila saludo</div></div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:rgba(234,179,8,0.1);border-radius:10px;border:1px solid rgba(234,179,8,0.3)">
              <span style="font-size:20px">🟡</span>
              <div><div style="font-weight:700;font-size:13px;color:#eab308">Rastreador Experto · 201–800 pts</div><div style="font-size:11.5px;color:var(--text2,#94a3b8);margin-top:2px">WhatsApp, carrito, favoritos, Lila por voz</div></div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:rgba(249,115,22,0.1);border-radius:10px;border:1px solid rgba(249,115,22,0.3)">
              <span style="font-size:20px">🟠</span>
              <div><div style="font-weight:700;font-size:13px;color:#f97316">Cazador de Precios · 801+ pts</div><div style="font-size:11.5px;color:var(--text2,#94a3b8);margin-top:2px">Todo desbloqueado · Lila al 100%</div></div>
            </div>
          </div>
          <div style="padding:0 20px 20px">
            <div style="font-size:11.5px;color:var(--text2,#64748b);text-align:center;margin-bottom:10px">Registra visitas con QR para ganar puntos más rápido 🏆</div>
            <button onclick="document.getElementById('nivelesProgrPopup').style.display='none'" style="width:100%;padding:12px;background:linear-gradient(90deg,#f97316,#eab308);border:none;border-radius:12px;color:#fff;font-weight:700;font-size:14px;cursor:pointer">¡Entendido!</button>
          </div>
        </div>`;
      document.body.appendChild(popup);
    }
    popup.style.display = 'flex';
  }
  window._mostrarPopupNiveles = _mostrarPopupNiveles;

  // Popup de bienvenida (primer ingreso): muestra funciones disponibles + 48h de trial.
  // onClose() se llama cuando el usuario lo cierra → se usa para encadenar el demo de Lila.
  function _mostrarBienvenida(onClose) {
    const CLAVE = 'md_bienvenida_v1';
    if (localStorage.getItem(CLAVE)) { if (onClose) onClose(); return; }
    const el = document.createElement('div');
    el.id = 'mdBienvenidaPopup';
    el.className = 'nivel-popup';
    el.innerHTML = `
      <div class="nivel-popup-backdrop"></div>
      <div class="nivel-popup-card" style="top:50%;left:50%;right:auto;transform:translate(-50%,-50%);width:340px;padding:0;overflow:hidden">
        <div style="background:linear-gradient(135deg,#a855f7,#7c3aed);padding:22px 24px 18px;text-align:center">
          <div style="font-size:32px;margin-bottom:6px">🎙️</div>
          <div style="font-weight:800;font-size:18px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.3)">¡Bienvenido a MercaDate!</div>
          <div style="font-size:12.5px;color:#fff;opacity:0.92;margin-top:6px;font-weight:500">Tienes <strong>48 horas de acceso completo</strong> gratis</div>
        </div>
        <div style="padding:14px 18px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:11px;color:var(--text2,#94a3b8);font-weight:700;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:2px">Funciones disponibles ahora</div>
          ${[
            ['⛽','Combustibles','El más barato y cercano en tiempo real'],
            ['🏪','Almacenes y comercios','Precios por producto en tu zona'],
            ['🎙️','Lila por voz','Búsqueda por comandos de voz'],
            ['🗺️','Mapa GPS','Resultados ordenados por cercanía'],
            ['🏆','Puntos y niveles','Acumula puntos registrando visitas con QR'],
          ].map(([ic,tt,dd]) => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(168,85,247,0.08);border-radius:9px;border:1px solid rgba(168,85,247,0.18)">
              <span style="font-size:17px;width:22px;text-align:center;flex-shrink:0">${ic}</span>
              <div><div style="font-weight:700;font-size:12.5px;color:var(--text,#e2e8f0)">${tt}</div><div style="font-size:11px;color:var(--text2,#94a3b8);margin-top:1px">${dd}</div></div>
            </div>`).join('')}
        </div>
        <div style="padding:4px 18px 18px">
          <button id="mdBienvenidaBtn" style="width:100%;padding:12px;background:linear-gradient(90deg,#a855f7,#7c3aed);border:none;border-radius:12px;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Entendido, ¡explorar la app! →</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.style.display = 'flex';
    el.querySelector('#mdBienvenidaBtn').onclick = () => {
      localStorage.setItem(CLAVE, '1');
      el.remove();
      if (onClose) onClose();
    };
  }
  window._mostrarBienvenida = _mostrarBienvenida;

  // Banner compacto de aviso cuando quedan pocas horas del período de prueba.
  function _mostrarAvisoFinTrial(horasRestantes) {
    const CLAVE = 'md_aviso_fin_trial';
    if (localStorage.getItem(CLAVE)) return;
    localStorage.setItem(CLAVE, '1');
    const h = Math.ceil(horasRestantes);
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10001;background:linear-gradient(90deg,#f97316,#eab308);color:#fff;font-size:13px;font-weight:600;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;box-shadow:0 2px 12px rgba(0,0,0,0.3)';
    banner.innerHTML = `<span>⏰ Tu período de prueba termina en <strong>${h} hora${h !== 1 ? 's' : ''}</strong>. ¡Acumula puntos para mantener las funciones!</span><button style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;line-height:1;flex-shrink:0">✕</button>`;
    banner.querySelector('button').onclick = () => banner.remove();
    document.body.prepend(banner);
    setTimeout(() => { try { banner.remove(); } catch(_) {} }, 10000);
  }

  // Abre navegación (Google Maps o Waze) según preferencia del usuario.
  function _abrirNavegacion(lat, lng) {
    const pref = (window.SafeStorage ? window.SafeStorage.get('mercadate_mapa_pref') : localStorage.getItem('mercadate_mapa_pref')) || 'google';
    const url = pref === 'waze'
      ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    window.open(url, '_blank', 'noopener');
  }
  window._abrirNavegacion = _abrirNavegacion;

  // ¿El usuario tiene a Lila activada? (preferencia en Perfil → Configuración)
  function _lilaHabilitada() {
    try { return (window.SafeStorage ? window.SafeStorage.get('mercadate_lila_activa') : localStorage.getItem('mercadate_lila_activa')) !== '0'; }
    catch (_) { return true; }
  }
  window._lilaHabilitada = _lilaHabilitada;

  function _loginVisible() {
    const ov = document.getElementById('usuarioLoginOverlay');
    return !!(ov && getComputedStyle(ov).display !== 'none');
  }

  function _saludarSiListo() {
    if (window._voiceSaludoHecho) return;
    if (window.usuarioActivo == null) return;    // sin usuario
    if (_loginVisible()) return;                 // login visible
    if (!_lilaHabilitada()) return;              // usuario apagó Lila
    if (!(window._voiceAssistant && window._voiceAssistant.iniciarConSaludo)) return;
    window._voiceSaludoHecho = true;
    const _u = window.auth && auth.getUser ? auth.getUser() : null;

    // Verificar si el período libre recién expiró (mostrar popup una sola vez)
    const _claveExpirVisto = 'mercadate_periodo_exp_visto';
    const _claveLibreAnuncio = 'mercadate_periodo_libre_anunciado';
    const _expVisto = localStorage.getItem(_claveExpirVisto);
    const _enLibre = _esPeriodoLibre(_u);

    if (!_enLibre && !_expVisto && _u && _u.fecha_registro) {
      const msPasados = Date.now() - new Date(_u.fecha_registro).getTime();
      if (msPasados <= 7 * 24 * 60 * 60 * 1000) { // solo si es usuario reciente (< 7 días)
        localStorage.setItem(_claveExpirVisto, '1');
        setTimeout(() => {
          _mostrarPopupNiveles();
          if (window._voiceAssistant && window._voiceAssistant.hablar) {
            window._voiceAssistant.hablar('Tu período de acceso completo terminó. Acumula puntos para ir desbloqueando funciones. ¡Registra visitas con QR para subir más rápido!');
          }
        }, 2000);
        return;
      }
    }

    // Primera vez (usuario nuevo): popup bienvenida → demo de Lila.
    // Si ?demo=1 está en la URL, el demo handler ya lo cubre — no interferir.
    const _esUrlDemo = (() => { try { return new URLSearchParams(location.search).get('demo') === '1'; } catch(_){return false;} })();
    if (!_esUrlDemo && window.LilaDemo && !window.LilaDemo.visto()) {
      setTimeout(() => {
        _mostrarBienvenida(() => {
          // Después del popup de bienvenida → Lila hace el tour
          setTimeout(() => window.LilaDemo.iniciar({ conLogin: true }), 400);
        });
      }, 800);
    } else if (_enLibre && !localStorage.getItem(_claveLibreAnuncio)) {
      // Usuarios que ya vieron el demo: Lila saluda y anuncia el acceso completo.
      localStorage.setItem(_claveLibreAnuncio, '1');
      setTimeout(() => window._voiceAssistant.iniciarConSaludo(), 600);
      setTimeout(() => {
        if (window.VozMercaDate && window.VozMercaDate.hablar) {
          const nombre = _u?.nombre ? ', ' + _u.nombre.split(' ')[0] : '';
          window.VozMercaDate.hablar('¡Bienvenido' + nombre + '! Tienes acceso completo a todas las funciones de MercaDate por 48 horas. ¡Aprovecha para explorar!');
        }
      }, 4000);
    } else {
      // Aviso fin de trial si quedan menos de 12 horas
      if (_enLibre && _u && _u.fecha_registro) {
        const msRestantes = (48 * 60 * 60 * 1000) - (Date.now() - new Date(_u.fecha_registro).getTime());
        if (msRestantes > 0 && msRestantes < 12 * 60 * 60 * 1000) {
          setTimeout(() => _mostrarAvisoFinTrial(msRestantes / (60 * 60 * 1000)), 2000);
        }
      }
      setTimeout(() => window._voiceAssistant.iniciarConSaludo(), 600);
    }
  }
  // Acceso al demo desde el splash (index.html?demo=1).
  // Solo corre el demo anónimo si NO hay sesión activa: es un flujo de marketing
  // para usuarios nuevos. Si el usuario ya está logueado, _saludarSiListo lo atiende.
  (function() {
    try {
      if (new URLSearchParams(location.search).get('demo') === '1') {
        window.addEventListener('load', () => setTimeout(() => {
          if (!window.LilaDemo) return;
          if (window.usuarioActivo || window._sesionConfirmada) return; // ya logueado
          window.LilaDemo.iniciar({ conLogin: false });
        }, 1200));
      }
    } catch (_) {}
  })();
  // La sesión quedó CONFIRMADA por el servidor → recién acá puede saludar.
  document.addEventListener('sesion-lista', () => {
    window._sesionConfirmada = true;
    setTimeout(_saludarSiListo, 400);
    setTimeout(_verificarRatingPopup, 8000);
    // Refrescar el ícono del marcador: puede haberse creado antes del login (demo anónimo).
    setTimeout(() => { if (window.actualizarPersonajeUsuario) window.actualizarPersonajeUsuario(); }, 300);
  });
  // Y cuando se oculta el overlay de login (login recién completado).
  (function() {
    const ov = document.getElementById('usuarioLoginOverlay');
    if (ov && window.MutationObserver) {
      new MutationObserver(() => { if (!_loginVisible()) setTimeout(_saludarSiListo, 500); })
        .observe(ov, { attributes: true, attributeFilter: ['style', 'class'] });
    }
  })();
  // Aviso al perder internet (la voz Catalina y los precios lo necesitan).
  window.addEventListener('offline', () => {
    if (window.mostrarToast) window.mostrarToast('📶 Sin internet. Conectate a wifi o datos móviles para usar la voz y ver precios.', 5000, 'err');
  });

  // Toggle GPS: si está activo lo apaga, si no lo activa
  function toggleGPS() {
    if (state.gpsActive) {
      // Apagar GPS
      state.gpsActive = false;
      updateGPSStatus(false, 'GPS Desactivado');
      setStatusBar('📡 GPS desactivado. Toca el botón para activar.');
      // Limpiar el círculo del radio
      if (radiusCircle) radiusCircle.setRadius(0);
      // Sin GPS no se muestra nada: refrescar a estado "activa GPS".
      try { vistaGeneral(); } catch (_) {}
    } else {
      // Encender GPS
      startGPS();
    }
  }
  // Exponer global para que el onclick funcione
  window.toggleGPS = toggleGPS;
  window.startGPS  = startGPS;

  function updateGPSStatus(active, text) {
    if (dom.gpsDot)   dom.gpsDot.className = 'gps-dot ' + (active ? 'active' : 'error');
    if (dom.gpsLabel) dom.gpsLabel.textContent = 'GPS';
    state.gpsActive = active;
    if (dom.gpsBtn) {
      dom.gpsBtn.className = 'gps-btn ' + (active ? 'gps-active' : 'gps-error');
      dom.gpsBtn.title = active ? 'GPS activo (clic para apagar)' : 'GPS apagado (clic para activar)';
    }
    if (radiusCircle) radiusCircle.setRadius(active ? currentRadius : 0);
  }

  function actualizarMarcadorUsuario() {
    if (!map) return;
    userMarker.setLatLng([state.lat,state.lng]);
    actualizarCirculoRadio();
    // Ajustar vista para mostrar el círculo de radio completo
    if (radiusCircle) {
      try { map.fitBounds(radiusCircle.getBounds(), { padding:[24,24], maxZoom:16, animate:true, duration:0.5 }); } catch(_) {}
    }
  }

  // Detecta entrecalles: "Calle1 y Calle2[, Comuna]" (y · e · con · esquina · esq · & · /).
  // Devuelve {a, b, lugar} o null si no parece una intersección.
  function _parseEntrecalles(addr) {
    const sep = /\s+(?:y|e|con|esquina|esq\.?)\s+|\s*[\/&]\s*/i;
    const m = addr.match(sep);
    if (!m) return null;
    const left = addr.slice(0, m.index).trim().replace(/,.*$/, '').trim();
    let right = addr.slice(m.index + m[0].length).trim();
    if (!left || !right) return null;
    let lugar = '';
    const coma = right.indexOf(',');
    if (coma >= 0) { lugar = right.slice(coma + 1).trim(); right = right.slice(0, coma).trim(); }
    if (!right) return null;
    return { a: left, b: right, lugar: lugar };
  }

  // Nombre de calle → regex tolerante a acentos/mayúsculas para Overpass (~ ,i).
  // Coincide como subcadena, así "Salvador" matchea "Avenida Salvador".
  function _reCalle(s) {
    const cls = { a:'[aáàä]', e:'[eéèë]', i:'[iíìï]', o:'[oóòö]', u:'[uúùü]', n:'[nñ]', c:'[cç]' };
    let out = '';
    for (const ch of s.trim()) {
      if (/[.*+?^${}()|[\]\\]/.test(ch)) { out += '\\' + ch; continue; }
      out += cls[ch.toLowerCase()] || ch;
    }
    return out;
  }

  // Busca la esquina (nodo común de dos calles) vía Overpass, dentro del bbox de
  // la comuna (o del entorno de la calle 1 si no se indicó comuna).
  async function buscarPorEntrecalles(p) {
    setStatusBar('<span class="spinner"></span> Buscando esquina...');
    let bbox = null;
    try {
      const q = (p.lugar ? p.lugar : p.a) + ', Chile';
      const r = await Api.externo(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { timeout: 8000 }
      );
      const d = await r.json();
      if (d.length && d[0].boundingbox) {
        const bb = d[0].boundingbox.map(parseFloat); // [S, N, W, E]
        bbox = [bb[0] - 0.01, bb[2] - 0.01, bb[1] + 0.01, bb[3] + 0.01]; // (S, W, N, E) + margen
      }
    } catch (e) {}
    if (!bbox) { setStatusBar('No ubiqué la zona. Prueba: "Calle 1 y Calle 2, Comuna"'); return false; }

    const re1 = _reCalle(p.a), re2 = _reCalle(p.b), bb = bbox.join(',');
    const fijar = function (lat, lng) {
      state.lat = lat; state.lng = lng;
      state.gpsActive = true; actualizarMarcadorUsuario();
      if (state.mode && state.mode !== 'combustible') cargarComerciosCercanos(); else vistaGeneral();
      setStatusBar('📍 Esquina ' + escapeHtml(p.a) + ' / ' + escapeHtml(p.b) + (p.lugar ? ', ' + escapeHtml(p.lugar) : ''));
    };

    // Estrategia 1: nodo común de ambas calles (cruce a nivel mapeado con nodo compartido).
    try {
      const oq =
        '[out:json][timeout:25];' +
        'way["name"~"' + re1 + '",i]["highway"](' + bb + ')->.w1;' +
        'way["name"~"' + re2 + '",i]["highway"](' + bb + ')->.w2;' +
        'node(w.w1)(w.w2);out;';
      const r = await Api.externo('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(oq), { timeout: 25000 });
      const d = await r.json();
      const nodos = (d.elements || []).filter(function (e) { return e.type === 'node'; });
      if (nodos.length) {
        let la = 0, lo = 0;
        nodos.forEach(function (n) { la += n.lat; lo += n.lon; });
        fijar(la / nodos.length, lo / nodos.length);
        return true;
      }
    } catch (e) {}

    // Estrategia 2 (fallback): punto donde ambas geometrías más se acercan.
    // Cubre cruces sin nodo común (la avenida cambia de nombre, unión en T, etc.).
    try {
      const oq2 =
        '[out:json][timeout:25];' +
        'way["name"~"' + re1 + '",i]["highway"](' + bb + ')->.w1;' +
        'way["name"~"' + re2 + '",i]["highway"](' + bb + ')->.w2;' +
        '.w1 out geom;.w2 out geom;';
      const r = await Api.externo('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(oq2), { timeout: 25000 });
      const d = await r.json();
      const rx1 = new RegExp(re1, 'i'), rx2 = new RegExp(re2, 'i');
      const A = [], B = [];
      (d.elements || []).forEach(function (w) {
        if (w.type !== 'way' || !w.geometry) return;
        const nm = (w.tags && w.tags.name) || '';
        const arr = rx1.test(nm) ? A : (rx2.test(nm) ? B : null);
        if (arr) w.geometry.forEach(function (g) { arr.push(g); });
      });
      if (A.length && B.length) {
        let best = Infinity, bla = 0, blo = 0;
        for (let i = 0; i < A.length; i++) {
          for (let j = 0; j < B.length; j++) {
            const dla = A[i].lat - B[j].lat;
            const dlo = (A[i].lon - B[j].lon) * Math.cos(A[i].lat * Math.PI / 180);
            const dd = dla * dla + dlo * dlo;
            if (dd < best) { best = dd; bla = (A[i].lat + B[j].lat) / 2; blo = (A[i].lon + B[j].lon) / 2; }
          }
        }
        // Solo si de verdad se cruzan/tocan (≤120 m entre geometrías).
        if (Math.sqrt(best) * 111320 <= 120) { fijar(bla, blo); return true; }
      }
    } catch (e) {}

    setStatusBar('No encontré la esquina de "' + escapeHtml(p.a) + '" y "' + escapeHtml(p.b) + '"');
    return false;
  }

  // opts.soloFijar: solo fija la ubicación (geocodifica) sin lanzar el render/búsqueda
  // — lo usa el botón único "Buscar" para geocodificar y luego buscar en un solo paso.
  // Devuelve true si encontró la dirección.
  async function buscarPorDireccion(addr, opts) {
    const soloFijar = !!(opts && opts.soloFijar);
    // ¿Es una entrecalle ("X y Y, Comuna")? Intenta hallar la esquina exacta.
    const inter = _parseEntrecalles(addr);
    if (inter) {
      const ok = await buscarPorEntrecalles(inter);
      if (ok) return true;
      // Si no se halló la esquina, sigue como dirección normal (fallback).
    }
    setStatusBar('Geocodificando dirección...');
    try {
      const resp = await Api.externo(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr+', Chile')}&limit=1`,
        { timeout: 8000 }
      );
      const data = await resp.json();
      if(data.length) {
        state.lat=parseFloat(data[0].lat); state.lng=parseFloat(data[0].lon);
        state.gpsActive=true; actualizarMarcadorUsuario();
        setStatusBar('📍 '+escapeHtml(data[0].display_name));
        if(!soloFijar) {
          if(state.mode && state.mode !== 'combustible') {
            cargarComerciosCercanos();
          } else {
            vistaGeneral();
          }
        }
        return true;
      } else { setStatusBar('Dirección no encontrada'); return false; }
    } catch(e) { setStatusBar('Error al geocodificar'); return false; }
  }

  // Botón único "Buscar": si hay dirección escrita, la geocodifica y muestra la zona;
  // si además hay criterio (tipo de combustible o producto), refina la búsqueda.
  async function _buscarConDireccion(inputEl) {
    const addr = ((inputEl && inputEl.value) || '').trim();
    if (!addr) { buscar(); return; }
    // ¿Hay algo que buscar tras fijar la ubicación? (evita cortar en "elige combustible")
    const hayCriterio = state.mode === 'combustible'
      ? !!state.fuelType
      : !!(((dom.productoInput && dom.productoInput.value) || '').trim() || state.categoriaProducto);
    // Con criterio → geocodifica sin render (soloFijar) y luego busca; sin criterio →
    // geocodifica y muestra la zona (así ver la dirección funciona aunque falte el combustible).
    const ok = await buscarPorDireccion(addr, { soloFijar: hayCriterio });
    if (!ok) return;
    if (hayCriterio) buscar();
  }
  window._buscarConDireccion = _buscarConDireccion;

  // ════════ AUTOCOMPLETAR DE UBICACIÓN (comuna local + dirección) ════════════
  // Escribir en el campo de dirección sugiere COMUNAS de nuestros datos (siempre
  // funciona, ordenadas por cercanía) y DIRECCIONES vía Nominatim (best-effort).
  // Al elegir: fija la ubicación y, si es comuna, aplica el filtro (validado).
  const _normLoc = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  function _indiceComunas() {
    const m = {};
    (state.allStations || []).forEach(s => {
      const c = (s.comuna || '').trim(); if (!c) return;
      if (!m[c]) m[c] = { comuna: c, region: s.region || '', sumLat: 0, sumLng: 0, n: 0 };
      if (s.lat && s.lng) { m[c].sumLat += s.lat; m[c].sumLng += s.lng; m[c].n++; }
    });
    return Object.values(m).map(o => ({ comuna: o.comuna, region: o.region, lat: o.n ? o.sumLat / o.n : null, lng: o.n ? o.sumLng / o.n : null }));
  }

  function _sugerirComunas(texto, max) {
    const q = _normLoc(texto); if (q.length < 2) return [];
    const ref = state.gpsActive ? { lat: state.lat, lng: state.lng } : null;
    const cand = _indiceComunas().filter(o => _normLoc(o.comuna).includes(q));
    cand.sort((a, b) => {
      const sa = _normLoc(a.comuna).startsWith(q) ? 0 : 1, sb = _normLoc(b.comuna).startsWith(q) ? 0 : 1;
      if (sa !== sb) return sa - sb;                                   // los que empiezan igual, primero
      if (ref && a.lat && b.lat) return calcularDistancia(ref.lat, ref.lng, a.lat, a.lng) - calcularDistancia(ref.lat, ref.lng, b.lat, b.lng); // más cercanos
      return a.comuna.localeCompare(b.comuna);
    });
    return cand.slice(0, max || 6);
  }
  window._sugerirComunas = _sugerirComunas; // expuesto para pruebas de lógica

  function _comunaDeNominatim(d) {
    const a = d.address || {};
    return a.city || a.town || a.village || a.municipality || a.county || a.suburb || '';
  }

  // Aplica el filtro de comuna (y región) en los selectores si la opción existe.
  function _aplicarComunaFiltro(region, comuna) {
    if (region && dom.regionSelect) {
      const ro = Array.from(dom.regionSelect.options).find(o => _normLoc(o.value) === _normLoc(region));
      if (ro) { dom.regionSelect.value = ro.value; try { sincronizarComunas(); } catch (_) {} }
    }
    if (comuna && dom.comunaSelect) {
      const co = Array.from(dom.comunaSelect.options).find(o => _normLoc(o.value) === _normLoc(comuna));
      if (co) { dom.comunaSelect.value = co.value; return true; }
    }
    return false;
  }

  function _refrescarTrasUbicacion() {
    if (state.mode === 'combustible') { if (state.fuelType) buscar(); else vistaGeneral(); }
    else { cargarComerciosCercanos(); }
  }

  // Chip de confirmación: "¿Filtrar solo en {comuna}?" (sugerir + confirmar).
  function _confirmarComuna(comuna) {
    if (!comuna) return;
    document.getElementById('mdComunaConfirm')?.remove();
    const chip = document.createElement('div');
    chip.id = 'mdComunaConfirm';
    chip.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:9300;background:var(--card,#171B27);border:1px solid var(--accent,#f0b429);border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:inherit;max-width:92vw';
    const esc = window.escapeHtml || (s => String(s || ''));
    chip.innerHTML = `<span style="font-size:12.5px;color:var(--text,#e2e8f0)">¿Filtrar solo en <b>${esc(comuna)}</b>?</span>
      <button id="mdCcSi" style="border:none;background:var(--accent,#f0b429);color:#0B0D13;font-weight:700;font-size:12px;border-radius:8px;padding:6px 12px;cursor:pointer">Sí</button>
      <button id="mdCcNo" style="border:1px solid var(--border2,#2a3450);background:transparent;color:var(--muted,#8B91A7);font-size:12px;border-radius:8px;padding:6px 10px;cursor:pointer">No</button>`;
    document.body.appendChild(chip);
    const cerrar = () => chip.remove();
    chip.querySelector('#mdCcSi').onclick = () => { _aplicarComunaFiltro('', comuna); cerrar(); if (state.mode === 'combustible' ? state.fuelType : true) buscar(); };
    chip.querySelector('#mdCcNo').onclick = cerrar;
    setTimeout(cerrar, 8000);
  }

  // Inyecta el CSS del desplegable una sola vez.
  (function _cssAutocomplete() {
    if (document.getElementById('mdacCss')) return;
    const st = document.createElement('style'); st.id = 'mdacCss';
    st.textContent = `
      .mdac-wrap{position:relative}
      .mdac-dd{position:absolute;left:0;right:0;top:100%;z-index:9200;background:var(--card,#171B27);border:1px solid var(--border2,#2a3450);border-radius:10px;margin-top:4px;max-height:240px;overflow:auto;box-shadow:0 12px 32px rgba(0,0,0,.55);display:none}
      .mdac-dd.open{display:block}
      .mdac-item{padding:9px 12px;cursor:pointer;font-size:13px;color:var(--text,#e2e8f0);display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,.05)}
      .mdac-item:last-child{border-bottom:none}
      .mdac-item:hover,.mdac-item.sel{background:rgba(110,86,248,.16)}
      .mdac-ico{font-size:14px;opacity:.85;flex-shrink:0}
      .mdac-sub{color:var(--muted,#8B91A7);font-size:11px;margin-left:auto;flex-shrink:0}`;
    document.head.appendChild(st);
  })();

  function _attachAutocomplete(inputEl) {
    if (!inputEl || inputEl._mdacOn) return;
    inputEl._mdacOn = true;
    const wrap = inputEl.closest('.address-group') || inputEl.parentElement;
    if (wrap) wrap.classList.add('mdac-wrap');
    const dd = document.createElement('div'); dd.className = 'mdac-dd';
    (wrap || inputEl.parentElement).appendChild(dd);
    const esc = window.escapeHtml || (s => String(s || ''));
    const hide = () => dd.classList.remove('open');
    let _deb = null, _seq = 0;

    function render(items) {
      if (!items.length) { hide(); return; }
      dd.innerHTML = items.map((it, i) =>
        `<div class="mdac-item" data-i="${i}"><span class="mdac-ico">${it.tipo === 'comuna' ? '🏘️' : '📍'}</span><span>${esc(it.label)}</span><span class="mdac-sub">${esc(it.sub)}</span></div>`
      ).join('');
      Array.from(dd.querySelectorAll('.mdac-item')).forEach(el => {
        el.onclick = () => pick(items[parseInt(el.dataset.i)]);
      });
      dd.classList.add('open');
    }

    function pick(item) {
      if (!item) return;
      hide();
      inputEl.value = item.label;
      if (item.lat && item.lng) { state.lat = item.lat; state.lng = item.lng; state.gpsActive = true; try { actualizarMarcadorUsuario(); actualizarCirculoRadio(); } catch (_) {} }
      if (item.tipo === 'comuna') {
        _aplicarComunaFiltro(item.region, item.comuna);
        _refrescarTrasUbicacion();
      } else {
        _refrescarTrasUbicacion();
        _confirmarComuna(item.comuna);   // sugerir + confirmar la comuna deducida
      }
    }

    async function construir(q) {
      const seq = ++_seq;
      const items = _sugerirComunas(q, 6).map(c => ({ tipo: 'comuna', label: c.comuna, sub: c.region || 'Comuna', lat: c.lat, lng: c.lng, comuna: c.comuna, region: c.region }));
      render(items);                     // comunas locales: instantáneo
      if (q.length >= 4) {               // direcciones: best-effort, no bloquea
        try {
          let url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=cl&limit=4&q=${encodeURIComponent(q)}`;
          if (state.gpsActive) { const d = 0.4; url += `&viewbox=${state.lng - d},${state.lat - d},${state.lng + d},${state.lat + d}`; }
          const r = await Api.externo(url, { timeout: 6000 });
          if (seq !== _seq) return;      // llegó una consulta más nueva
          const data = await r.json();
          data.forEach(d => items.push({ tipo: 'dir', label: (d.display_name || '').split(',').slice(0, 2).join(', '), sub: _comunaDeNominatim(d) || 'Dirección', lat: parseFloat(d.lat), lng: parseFloat(d.lon), comuna: _comunaDeNominatim(d) }));
          render(items);
        } catch (_) { /* sin internet/servicio: quedan solo las comunas locales */ }
      }
    }

    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      clearTimeout(_deb);
      if (q.length < 2) { hide(); return; }
      _deb = setTimeout(() => construir(q), 280);
    });
    inputEl.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    inputEl.addEventListener('blur', () => setTimeout(hide, 180)); // permite el click en un ítem
  }
  window._initAutocompletarUbicacion = function () {
    _attachAutocomplete(dom.addressInput);
    _attachAutocomplete(dom.commerceAddressInput);
  };

  async function buscar() {
    // Falta lo mínimo para buscar → avisar CLARO (toast + status) y no seguir en silencio.
    if(!state.mode) {
      vistaGeneral();
      if (window.mostrarToast) mostrarToast('Elige primero una categoría arriba (⛽ Combustibles, etc.)', 3200, 'warn');
      setStatusBar('⚠️ Elige una categoría para buscar');
      return;
    }
    if(state.mode === 'combustible' && !state.fuelType) {
      vistaGeneral();
      if (window.mostrarToast) mostrarToast('Elige el tipo de combustible: 93, 95, 97, Diésel o Parafina', 3500, 'warn');
      setStatusBar('⚠️ Selecciona un tipo de combustible para ver precios');
      return;
    }

    // Búsqueda válida en curso → cerrar los paneles de filtros para dar más
    // espacio a las tarjetas de resultados.
    if (dom.advancedPanel) dom.advancedPanel.classList.remove('open');
    if (dom.commerceAdvPanel) dom.commerceAdvPanel.classList.remove('open');

    setStatusBar('<span class="spinner"></span> Buscando...');
    const marca  = dom.marcaSelect.value;
    const comuna = dom.comunaSelect.value;
    const region = dom.regionSelect.value;

    const hayFiltroZona = !!(region || comuna || marca);

    try {
      let resultados = [];
      if(state.mode === 'combustible') {
        if(localData.length) {
          let base = filtrarYMapear(localData, state.fuelType);
          if(state.gpsActive && !hayFiltroZona) base = base.filter(s=>s.distanciaM<=currentRadius);
          if(marca)  base = base.filter(s=>s.nombre===marca);
          if(comuna) base = base.filter(s=>s.comuna===comuna);
          if(region) base = base.filter(s=>s.region===region);
          resultados = base;
        } else if(state.gpsActive) {
          resultados = await overpassFuel(state.lat, state.lng, hayFiltroZona ? 50000 : currentRadius);
          if(marca)  resultados = resultados.filter(s=>s.nombre===marca);
          if(comuna) resultados = resultados.filter(s=>s.comuna===comuna);
          if(region) resultados = resultados.filter(s=>s.region===region);
        } else {
          setStatusBar('⚠️ Activa el GPS o ingresa una dirección');
          return;
        }
      } else {
        const texto = (dom.productoInput.value || '').trim();
        // Aún sin texto/categoría, si hay filtro de zona (comuna/región/marca)
        // o GPS activo, ejecutamos la búsqueda para que el mapa refleje la zona elegida.
        if (!texto && !state.categoriaProducto && !hayFiltroZona && !state.gpsActive) {
          await cargarComerciosCercanos();
          return;
        }
        resultados = await buscarEnComercios(texto, state.categoriaProducto, { comuna, region, marca });
        if(!resultados.length && state.gpsActive && (texto || state.categoriaProducto)) {
          resultados = await overpassCategoria(state.mode, state.lat, state.lng, currentRadius);
          // Aplicar filtros de zona también a resultados Overpass
          if (comuna) resultados = resultados.filter(r => (r.comuna || '').toLowerCase() === comuna.toLowerCase());
          if (region) resultados = resultados.filter(r => (r.region || '').toLowerCase() === region.toLowerCase());
        }
      }

      if(resultados.length) {
        // El sello "Mejor precio" lo pone MercaDate: no se otorga a un precio que varios
        // usuarios reportaron como distinto y el comercio todavía no confirmó.
        const enDisputa = r => r.precio_estado === 'en_disputa' || r.precio_estado === 'vencido';
        const precios = resultados.filter(r=>!enDisputa(r)).map(r=>r.precio).filter(p=>p!=null&&p>0);
        if(precios.length) {
          const min = Math.min(...precios);
          resultados = resultados.map(r=>({...r, mejor: !enDisputa(r) && r.precio!=null && r.precio===min}));
        }
      }
      state.results = resultados;
      // ▶ Sincronizar el mapa con los resultados filtrados
      if (state.mode === 'combustible') {
        state.resultadosIds = new Set(resultados.map(c => String(c.id || c.comercioId || c.codigo || c.nombre)));
        renderResults();
      } else {
        // Comercios: extraer comercios únicos de los resultados (un comercio puede tener varios productos en la lista)
        const comerciosUnicos = {};
        resultados.forEach(r => {
          const cid = String(r.local_id || r.id || r.comercioId);
          if (!comerciosUnicos[cid] && r.lat && r.lng) {
            comerciosUnicos[cid] = {
              id: r.local_id || r.id || cid,
              nombre: r.nombre,
              lat: r.lat, lng: r.lng,
              direccion: r.direccion,
              comuna: r.comuna,
              region: r.region,
              productos: r.productos || [],
              tipo_negocio: r.tipo_negocio || state.mode,
            };
          }
        });
        state.comercios = Object.values(comerciosUnicos);
        state.resultadosIds = new Set(state.comercios.map(c => String(c.id)));
        renderResults();
        renderComerciosMapa();
      }
      actualizarConteo(resultados.length, true);
      const zonaLabel = region ? `Región ${region}` : comuna ? `${comuna}` : marca ? `${marca}` : `radio ${(currentRadius/1000).toFixed(1)} km`;
      setStatusBar(`✅ ${resultados.length.toLocaleString()} resultado${resultados.length!==1?'s':''} — ${zonaLabel}`);
      registrarBusqueda({
        tipo:state.mode, combustible:state.mode==='combustible'?state.fuelType:null,
        lat:state.lat, lng:state.lng, radius:currentRadius, resultados:state.results.length,
        filtros:{ marca:dom.marcaSelect?.value||'', region:dom.regionSelect?.value||'', comuna:dom.comunaSelect?.value||'' }
      });
    } catch(e) { setStatusBar('❌ Error: '+e.message); console.error(e); }
  }

  const MODO_ICON = {
    almacen:'🛒', supermercado:'🏪', farmacia:'💊',
    restaurante:'🍽️', mascota:'🐾'
  };

  const CATS_PRODUCTO = {
    almacen: [
      {label:'🥫 Alimentos',    val:'alimentos'},
      {label:'🥤 Bebidas',      val:'bebidas'},
      {label:'🧹 Limpieza',     val:'limpieza'},
      {label:'🧼 Higiene',      val:'higiene'},
      {label:'💄 Belleza',      val:'belleza'},
      {label:'💡 Electrónica',  val:'electronica'},
      {label:'👕 Ropa',         val:'ropa'},
      {label:'🏠 Hogar',        val:'hogar'},
      {label:'🐾 Mascotas',     val:'mascotas'},
      {label:'📦 Otros',        val:'otros'},
    ],
    supermercado: [
      {label:'🥫 Alimentos',         val:'alimentos'},
      {label:'🥤 Bebidas',           val:'bebidas'},
      {label:'🧹 Limpieza',          val:'limpieza'},
      {label:'🥛 Lácteos',           val:'lacteos'},
      {label:'🥩 Carnes',            val:'carnes'},
      {label:'🍎 Frutas y Verduras', val:'frutas'},
      {label:'❄️ Congelados',        val:'congelados'},
      {label:'🍞 Panadería',         val:'panaderia'},
      {label:'📦 Otros',             val:'otros'},
    ],
    farmacia: [
      {label:'💊 Medicamentos',    val:'medicamentos'},
      {label:'💪 Vitaminas',       val:'vitaminas'},
      {label:'🧼 Higiene',         val:'higiene'},
      {label:'💄 Belleza',         val:'belleza'},
      {label:'👶 Bebé',            val:'bebe'},
      {label:'🩹 Primeros Auxilios', val:'primeros auxilios'},
      {label:'📦 Otros',           val:'otros'},
    ],
    restaurante: [
      {label:'🍽️ Almuerzo',    val:'almuerzo'},
      {label:'🌙 Cena',        val:'cena'},
      {label:'☀️ Desayuno',    val:'desayuno'},
      {label:'🥤 Bebidas',     val:'bebidas'},
      {label:'🍮 Postres',     val:'postres'},
      {label:'🥗 Vegetariano', val:'vegetariano'},
      {label:'📦 Otros',       val:'otros'},
    ],
    mascota: [
      {label:'🐕 Paseadores',          val:'paseadores',    especial:'paseadores'},
      {label:'👤 Cuidadores',           val:'cuidador',      especial:'cuidador'},
      {label:'🏥 Veterinaria',          val:'veterinaria'},
      {label:'🛁 Baño y Grooming',      val:'bano'},
      {label:'🏨 Hotel Mascota',        val:'hotel'},
      {label:'🎓 Adiestramiento',       val:'adiestramiento'},
      {label:'🍖 Alimentos',            val:'alimentos'},
      {label:'🛒 Accesorios',           val:'accesorios'},
      {label:'💊 Salud y Medicamentos', val:'salud'},
      {label:'📦 Otros',               val:'otros'},
    ],
  };

  const CATEGORIAS_MODO = {
    almacen:      ['almacen','almacén','minimercado','bazar','verdulería','carnicería','lácteos','panadería','abarrotes','alimentos','bebidas','limpieza','higiene'],
    supermercado: ['supermercado','mercado','hipermercado'],
    farmacia:     ['farmacia','pharmacy','droguería','óptica','salud'],
    restaurante:  ['restaurante','café','fast food','bar','cocina','comida'],
    mascota:      ['mascota','pet','veterinaria','animales','zoo','grooming','baño','adiestramiento','hotel','cuidador','paseador'],
  };

  function normalize(str) {
    return (str || '').toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  // FUNCIÓN CORREGIDA PARA CARGAR COMERCIOS (usa /api/locales y logs)
  async function cargarComerciosCercanos() {
    const modoAlPedir = state.mode; // snapshot: descarta el render si el usuario cambia de categoría durante la carga
    setStatusBar('<span class="spinner"></span> Cargando comercios cercanos...');
    limpiarMarcadores();

    try {
      let locales;
      try {
        const res = await fetch('/api/locales');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        locales = await res.json();
        console.log('📦 /api/locales devolvió', locales.length, 'registros');
      } catch (e) {
        console.warn('⚠️ Fallo /api/locales, intentando /api/db', e);
        const res2 = await fetch('/api/db');
        const db = await res2.json();
        locales = db.locales || db.comercios || [];
        console.log('📦 /api/db devolvió', locales.length, 'registros');
      }

      const cats = CATEGORIAS_MODO[state.mode] || [];
      console.log('🏷️ Modo:', state.mode, 'Categorías permitidas:', cats);

      let comercios = (Array.isArray(locales) ? locales : [])
        .filter(local => local.aprobado === true)
        .filter(local => {
          const catLocalNorm = normalize(local.categoria || '');
          const match = !cats.length || cats.some(c => catLocalNorm.includes(normalize(c))) || state.mode === 'almacen';
          if (!match) console.warn('❌ Filtrado por categoría:', local.nombre, 'categoría:', local.categoria);
          return match;
        })
        .map(local => {
          const lat = parseFloat(local.lat), lng = parseFloat(local.lng);
          const distanciaM = (lat && lng && state.gpsActive) ? calcularDistancia(state.lat, state.lng, lat, lng) : 0;
          return { ...local, lat, lng, distanciaM, productos: local.productos || [] };
        })
        .filter(local => {
          if(state.gpsActive && local.lat && local.distanciaM > currentRadius) return false;
          if(state.categoriaProducto) {
            const cat = normalize(state.categoriaProducto);
            const tieneCategoria = (local.productos || []).some(p =>
              normalize(p.categoria || '').includes(cat) ||
              normalize(p.nombre || '').includes(cat)
            );
            return tieneCategoria;
          }
          return true;
        })
        .sort((a,b) => (a.distanciaM||Infinity) - (b.distanciaM||Infinity));

      console.log('✅ Comercios después de filtros:', comercios.length);
      state.comercios = comercios;

      if(!comercios.length && state.gpsActive) {
        console.log('🌍 Fallback a Overpass API');
        const ov = await overpassCategoria(state.mode, state.lat, state.lng, currentRadius);
        state.comercios = ov.map(c => ({ ...c, productos:[], lat:c.lat, lng:c.lng }));
      }

      if (state.mode !== modoAlPedir) return; // el usuario cambió de categoría mientras cargaba
      renderComerciosMapa();
      mostrarInstruccionesUso(state.comercios.length);
      actualizarConteo(state.comercios.length, true);
      dom.resultadoTitle.innerText = `${MODO_ICON[state.mode]||''} Comercios en el área`.trim();
      setStatusBar(`✅ ${state.comercios.length} comercio${state.comercios.length!==1?'s':''} — radio ${(currentRadius/1000).toFixed(1)} km`);

    } catch(e) {
      console.error('❌ Error cargando comercios:', e);
      if(state.gpsActive) {
        try {
          const ov = await overpassCategoria(state.mode, state.lat, state.lng, currentRadius);
          state.comercios = ov.map(c => ({ ...c, productos:[] }));
          if (state.mode !== modoAlPedir) return;
          renderComerciosMapa();
          mostrarInstruccionesUso(state.comercios.length);
          actualizarConteo(state.comercios.length, true);
          setStatusBar(`✅ ${state.comercios.length} comercios (OpenStreetMap) — activa el servidor para ver inventario`);
        } catch(e2) { setStatusBar('❌ No se pudieron cargar comercios'); }

        // Cargar potenciales SIEMPRE, independientemente de Overpass
        cargarPotencialesCercanos();
      } else {
        dom.resultsList.innerHTML = `<div class="empty-state">
          <div class="es-title"><span class="es-icon">📍</span> Activa el GPS</div>
          <div class="es-steps"><div class="es-step"><div class="es-num">1</div><span>Presiona el botón <strong style="color:var(--calipso)">GPS</strong> en la esquina superior derecha</span></div>
          <div class="es-step"><div class="es-num">2</div><span>O ingresa una dirección en el campo de abajo</span></div></div>
          <div class="es-note">📏 Radio actual: <strong style="color:var(--calipso)">${(currentRadius/1000).toFixed(1)} km</strong></div>
        </div>`;
        setStatusBar('📍 Activa el GPS o ingresa una dirección');
      }
    }
  }

  // Cargar comercios potenciales (Google Maps) cercanos - FILTRA por categoría seleccionada
  async function cargarPotencialesCercanos() {
    if (!state.gpsActive || isNaN(state.lat) || isNaN(state.lng)) return;
    // Combustibles usa datos del CNE (localData), no comercios_potenciales: nunca mostrar acá.
    if (state.mode === 'combustible') {
      state.comerciosPotenciales = [];
      return;
    }

    const modoAlPedir = state.mode; // snapshot para detectar cambio de categoría durante el fetch
    try {
      const res = await fetch(`/api/usuario/comercios/potenciales/nearby?lat=${state.lat}&lng=${state.lng}&radio=${currentRadius}`);
      // El usuario cambió de categoría (o volvió a combustible) mientras cargaba → descartar
      if (state.mode !== modoAlPedir) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let potenciales = await res.json() || [];

      // Filtrar por categoría seleccionada (evita "ruido" visual)
      if (state.mode) {
        potenciales = potenciales.filter(p => {
          const catPotencial = (p.categoria || '').toLowerCase();
          const modoBuscado = (state.mode || '').toLowerCase();
          // Coincidencia flexible de categoría
          return catPotencial.includes(modoBuscado) || modoBuscado.includes(catPotencial);
        });
      }

      state.comerciosPotenciales = potenciales;
      console.log('🌐 Potenciales cargados (filtrados):', potenciales.length);
      renderPotencialesMapa();
    } catch (e) {
      console.warn('⚠️ Error cargando potenciales:', e.message);
    }
  }
  window._cargarPotencialesCercanos = cargarPotencialesCercanos;
  window._renderPotencialesMapa = () => renderPotencialesMapa();
  // Debug solo en local: no exponer el estado interno completo en producción.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.port === '3000') {
    window._debugState = () => state;
  }

  // Cargar comercios activos al iniciar la app (OPTIMIZADO por comunas)
  let _cargandoInicio = false; // evita que dos disparadores (GPS + carga de CSV) corran esto a la vez
  async function cargarComerciosAlInicio() {
    if (!state.gpsActive || isNaN(state.lat) || isNaN(state.lng)) return;
    // Solo aplica a la vista SIN categoría — evita pisar el render de otra categoría
    // si el usuario cambia de tab mientras esta carga (async) sigue en curso.
    if (state.mode) return;
    if (_cargandoInicio) return; // ya hay una carga idéntica en curso
    _cargandoInicio = true;

    try {
      // Los dos endpoints son independientes (solo dependen de lat/lng) → en paralelo.
      const [resComunas, resPot] = await Promise.all([
        fetch(`/api/usuario/comercios/por-comunas?lat=${state.lat}&lng=${state.lng}`),
        fetch(`/api/usuario/comercios/potenciales/nearby?lat=${state.lat}&lng=${state.lng}&radio=50000`)
      ]);
      if (state.mode) return; // el usuario eligió categoría mientras cargaba → abortar
      if (!resComunas.ok) throw new Error(`HTTP ${resComunas.status}`);
      const datoComunas = await resComunas.json() || {};
      const comercios = datoComunas.comercios || [];

      console.log(`📍 Comunas cargadas: ${(datoComunas.comunas || []).join(', ')}`);

      const potenciales = resPot.ok ? (await resPot.json() || []) : [];
      state.comerciosPotenciales = potenciales;

      // Muestra de inicio: SIEMPRE limpiar ambos grupos, aunque no haya comercios,
      // para que la muestra quede fresca (sin marcadores de una vista previa).
      limpiarMarcadores();

      // Renderizar comercios activos con sus categorías específicas - SOLO ICONOS, SIN NOMBRES.
      // Van a sampleGroup (sin clustering) → íconos individuales por categoría.
      if (comercios.length > 0) {
        comercios.forEach(comercio => {
          if (!comercio.lat || !comercio.lng) return;

          const nombre = comercio.nombre || 'Comercio';
          // Usar el emoji de la categoría específica
          const emoji = getCategoryEmoji(comercio.tipo_negocio || comercio.categoria || 'comercio');

          // Determinar si está abierto: revisar estado_operativo y horarios
          let estaAbierto = true;
          if (comercio.estado_operativo === 'cerrado') {
            estaAbierto = false;
          } else if (comercio.horario_apertura && comercio.horario_cierre) {
            const ahora = new Date();
            const horaActual = ahora.getHours() * 100 + ahora.getMinutes();
            const apertura = parseInt(comercio.horario_apertura.replace(':', '')) || 0;
            const cierre = parseInt(comercio.horario_cierre.replace(':', '')) || 2400;
            estaAbierto = horaActual >= apertura && horaActual < cierre;
          }

          const colorPin = estaAbierto ? '#18C7CE' : '#6b7280'; // Cyan si abierto, gris si cerrado
          const opacidad = estaAbierto ? '1' : '0.5'; // Más transparente si cerrado

          const icono = L.divIcon({
            className: 'comercio-icon-init',
            html: `<div style="position:relative;width:48px;height:48px;opacity:${opacidad};filter:${!estaAbierto ? 'grayscale(0.5)' : 'none'}">
              <div style="position:absolute;top:0;left:50%;transform:translateX(-50%);font-size:28px">${emoji}</div>
              <div style="position:absolute;bottom:0;left:50%;transform:translateX(-50%) translateY(50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:12px solid ${colorPin}"></div>
            </div>`,
            iconSize: [48, 56],
            iconAnchor: [24, 56]
          });

          // Popup con info (cuando hace click) — escapeHtml() obligatorio: nombre/dirección vienen de datos de comercio
          const esc = window.escapeHtml || (s => String(s||''));
          const popupHTML = `
            <div style="min-width:200px;font-family:'DM Sans',sans-serif">
              <div style="font-family:'Syne',sans-serif;font-weight:800;color:#00C4CC;font-size:14px;margin-bottom:4px">${esc(nombre)}</div>
              ${comercio.direccion ? `<div style="color:#94a3b8;font-size:11px;margin-bottom:4px">📍 ${esc(comercio.direccion)}</div>` : ''}
              ${comercio.comuna ? `<div style="color:#64748b;font-size:11px;margin-bottom:6px">${esc(comercio.comuna)}</div>` : ''}
              <div style="font-size:11px;color:${estaAbierto ? '#22c55e' : '#ef4444'};margin-bottom:8px;font-weight:700">
                ${estaAbierto ? '🟢 Abierto' : '🔴 Cerrado'}
              </div>
              <button onclick="window._verComercio(${comercio.id})" style="width:100%;padding:8px;background:#18C7CE;border:none;border-radius:6px;color:#0B0D13;font-weight:700;font-size:12px;cursor:pointer">
                Ver comercio →
              </button>
            </div>`;

          L.marker([comercio.lat, comercio.lng], { icon: icono })
            .bindPopup(popupHTML, { maxWidth: 280 })
            .addTo(_grupoMuestra(emoji)); // agrupa por categoría con contador
        });
      }

      // Renderizar potenciales en gris — agrupados por categoría en la muestra de inicio
      if (potenciales.length > 0) {
        renderPotencialesMapa(sampleGroup);
      }
      _encuadrarRadio(); // el mapa siempre muestra el círculo del radio completo

      console.log(`🌍 Inicio: ${comercios.length} comercios activos + ${potenciales.length} potenciales`);

      // Mostrar instrucciones
      const totalComerciosMapa = comercios.length + potenciales.length;
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">🗺️</span> ${totalComerciosMapa} comercios en el mapa</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Mira el <strong style="color:var(--calipso)">mapa</strong>: cada icono muestra un comercio o negocio</span></div>
          <div class="es-step"><div class="es-num">2</div><span>Presiona cualquier comercio en el mapa para <strong style="color:var(--accent)">ver sus detalles</strong></span></div>
          <div class="es-step"><div class="es-num">3</div><span>Usa las categorías de arriba (⛽ Combustibles, 🛒 Almacenes, etc) para filtrar por tipo</span></div>
          <div class="es-step"><div class="es-num">4</div><span>Usa el control deslizante para ajustar el <strong style="color:var(--accent)">radio de búsqueda</strong></span></div>
        </div>
        <div class="es-note">📏 Radio actual: <strong style="color:var(--calipso)">${(currentRadius/1000).toFixed(1)} km</strong> · 📍 GPS activo</div>
      </div>`;
    } catch (e) {
      console.warn('⚠️ Error cargando comercios al inicio:', e.message);
    } finally {
      _cargandoInicio = false;
    }
  }
  window._cargarComerciosAlInicio = cargarComerciosAlInicio;

  // Reclamar un comercio potencial (dueño lo agrega como suyo)
  // NOTA: aún no existe endpoint de backend para esto (ver DELIVERY_ESTRUCTURA.md) —
  // por eso no se promete un registro que no ocurre. prompt()/alert() están bloqueados
  // en el WebView de la APK (mismo bug ya corregido en "Reportar precio").
  window._reclamarComercio = function(potencialId) {
    const potencial = state.comerciosPotenciales.find(p => p.id === potencialId);
    if (!potencial) return;
    if (window.mostrarToast) {
      window.mostrarToast('🚧 Reclamar comercios estará disponible pronto. Escríbenos desde Mi Cuenta → Ayuda para registrar tu negocio.', 5000, 'info');
    }
  };

  function renderComerciosMapa() {
    limpiarMarcadores();
    window._verComercio = (id) => mostrarComercio(String(id));

    const hayBusqueda = state.resultadosIds.size > 0;
    state.comercios.forEach(local => {
      if(!local.lat || !local.lng) return;
      const nombre = (local.nombre || 'Comercio');
      const nProd = (local.productos || []).length;
      const localId = String(local.id || local.comercioId || nombre);
      const tieneProd = nProd > 0;
      const enResultados = state.resultadosIds.has(localId);

      // Si hay búsqueda activa y este comercio NO matchea → no se muestra en el mapa
      if (hayBusqueda && !enResultados) return;

      // Con burbuja (gota) si está en resultados, sino solo el icono flotante
      const icon = enResultados ? crearPinComercio(local, tieneProd) : crearIconoSimple(local, tieneProd);

      const popupHTML = `
        <div style="min-width:180px;font-family:'DM Sans',sans-serif">
          <div style="font-family:'Syne',sans-serif;font-weight:800;color:#00C4CC;font-size:14px;margin-bottom:4px">${nombre}</div>
          ${local.direccion ? `<div style="color:#94a3b8;font-size:11px;margin-bottom:4px">${local.direccion}</div>` : ''}
          ${local.comuna ? `<div style="color:#64748b;font-size:11px;margin-bottom:6px">📍 ${local.comuna}</div>` : ''}
          ${tieneProd
            ? `<div style="color:#22c55e;font-size:11px;margin-bottom:8px;font-weight:700">📦 ${nProd} producto${nProd!==1?'s':''} disponible${nProd!==1?'s':''}</div>`
            : `<div style="color:#64748b;font-size:11px;margin-bottom:8px;font-style:italic">Sin inventario cargado aún</div>`
          }
          <div style="display:flex;gap:6px;margin-top:2px">
            <button onclick="window._verComercio('${localId}')"
              style="flex:1;background:linear-gradient(135deg,#f0b429,#c89c25);color:#fff;border:none;
                     padding:8px 10px;border-radius:8px;cursor:pointer;font-weight:800;font-size:11px;
                     font-family:'DM Sans',sans-serif;box-shadow:0 2px 6px rgba(240,180,41,0.35);">
              ${tieneProd ? '🛒 Ver precios' : 'ℹ️ Info'}
            </button>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${local.lat},${local.lng}" target="_blank" rel="noopener"
              style="display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#18C7CE,#0fa3a8);color:#fff;border:none;
                     padding:8px 10px;border-radius:8px;font-weight:800;font-size:11px;text-decoration:none;white-space:nowrap">
              🗺️ Ir a
            </a>
          </div>
        </div>`;

      const marker = L.marker([local.lat, local.lng], { icon })
        .bindPopup(popupHTML, { maxWidth: 260 })
        .addTo(markersGroup);

      // ▶ Click directo en el marcador abre el panel de detalle.
      marker.on('click', () => mostrarComercio(localId));
    });

    if(state.gpsActive && state.comercios.length) {
      try {
        const validos = state.comercios.filter(c => {
          if (!c.lat || !c.lng) return false;
          // Si hay búsqueda activa, solo considerar los que matchean
          if (hayBusqueda) {
            const cid = String(c.id || c.comercioId || c.nombre);
            return state.resultadosIds.has(cid);
          }
          return true;
        });
        if(validos.length) {
          const bounds = L.latLngBounds(validos.map(c => [c.lat, c.lng]));
          bounds.extend([state.lat, state.lng]);
          encuadrarMapa(bounds);
        }
      } catch(e) {}
    }

    // Redibujr potenciales DESPUÉS de comercios normales
    renderPotencialesMapa();
  }

  // Renderizar comercios potenciales en gris (Google Maps) - SOLO EMOJI, sin pin.
  // targetGroup === sampleGroup → muestra de inicio: cada potencial va a su cluster por
  // categoría (contador por tipo). Si no, van directo al grupo de la vista de categoría.
  function renderPotencialesMapa(targetGroup) {
    const grupo = targetGroup || markersGroup;
    const esMuestra = (grupo === sampleGroup);
    if (!state.comerciosPotenciales || state.comerciosPotenciales.length === 0) return;

    state.comerciosPotenciales.forEach(potencial => {
      if (!potencial.lat || !potencial.lon) return;

      const nombre = potencial.nombre || 'Comercio';
      // Solo emoji, sin pin - comercios no reclamados
      const emoji = getCategoryEmoji(potencial.categoria || 'comercio');
      const icono = L.divIcon({
        className: 'potencial-emoji-only',
        html: `<div style="font-size:32px;filter:grayscale(0.5);opacity:0.7">${emoji}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });

      const esc = window.escapeHtml || (s => String(s||''));
      const popupHTML = `
        <div style="min-width:200px;font-family:'DM Sans',sans-serif;background:#f3f4f6;border-radius:8px;padding:12px">
          <div style="font-family:'Syne',sans-serif;font-weight:800;color:#374151;font-size:14px;margin-bottom:6px">${esc(nombre)}</div>
          ${potencial.direccion ? `<div style="color:#6b7280;font-size:11px;margin-bottom:4px">📍 ${esc(potencial.direccion)}</div>` : ''}
          <div style="background:#fff;padding:8px;border-radius:6px;margin:8px 0;text-align:center;border:2px dashed #d1d5db">
            <div style="color:#6b7280;font-size:10px">Comercio potencial sin verificar</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button onclick="window._reclamarComercio(${potencial.id})"
              style="flex:1;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;padding:8px;border-radius:6px;cursor:pointer;font-weight:700;font-size:11px;font-family:'DM Sans',sans-serif">
              ✅ ¿Eres dueño?
            </button>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${potencial.lat},${potencial.lon}" target="_blank" rel="noopener"
              style="display:flex;align-items:center;justify-content:center;background:#e5e7eb;color:#374151;border:none;padding:8px;border-radius:6px;font-weight:700;font-size:11px;text-decoration:none;white-space:nowrap">
              🗺️
            </a>
          </div>
        </div>`;

      // En la muestra de inicio, agrupar por categoría (contador por tipo);
      // en vistas de categoría, ir directo al grupo (una sola categoría presente).
      const destino = esMuestra ? _grupoMuestra(emoji) : grupo;
      L.marker([potencial.lat, potencial.lon], { icon: icono })
        .bindPopup(popupHTML, { maxWidth: 280 })
        .addTo(destino);
    });
  }

  // ▶ Mantiene las INSTRUCCIONES DE USO en el panel izquierdo cuando hay una pestaña activa.
  //   Los comercios se muestran solamente como marcadores en el mapa.
  function mostrarInstruccionesUso(cantidadComercios) {
    const modo = state.mode;
    const icon = MODO_ICON[modo] || '🛒';
    const labelModo = ({
      almacen: 'almacenes',
      supermercado: 'supermercados',
      farmacia: 'farmacias',
      restaurante: 'restaurantes',
      mascota: 'servicios para mascotas'
    })[modo] || 'comercios';

    // Caso 1: hay comercios cargados en el mapa
    if(cantidadComercios > 0) {
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">${icon}</span> ${cantidadComercios} ${labelModo} en tu radio</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Mira el <strong style="color:var(--calipso)">mapa</strong>: cada etiqueta muestra el nombre del comercio</span></div>
          <div class="es-step"><div class="es-num">2</div><span>Presiona cualquier comercio en el mapa para <strong style="color:var(--accent)">ver sus productos y precios</strong></span></div>
          <div class="es-step"><div class="es-num">3</div><span>Dentro del comercio puedes <strong style="color:var(--text)">filtrar por subcategoría o buscar productos</strong></span></div>
          <div class="es-step"><div class="es-num">4</div><span>Usa el control deslizante para ajustar el <strong style="color:var(--accent)">radio de búsqueda</strong></span></div>
        </div>
        <div class="es-note">📏 Radio actual: <strong style="color:var(--calipso)">${(currentRadius/1000).toFixed(1)} km</strong> · 📍 ${state.gpsActive?'GPS activo':'Sin GPS'}</div>
      </div>`;
      return;
    }

    // Caso 2: sin GPS activo
    if(!state.gpsActive) {
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">📍</span> Activa el GPS para ver ${labelModo} cercanos</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Presiona el botón <strong style="color:var(--calipso)">GPS</strong> en la esquina superior derecha</span></div>
          <div class="es-step"><div class="es-num">2</div><span>O ingresa una <strong style="color:var(--text)">dirección manual</strong> en el campo de abajo</span></div>
          <div class="es-step"><div class="es-num">3</div><span>Los ${labelModo} aparecerán automáticamente en el mapa</span></div>
          <div class="es-step"><div class="es-num">4</div><span>Presiona cualquier comercio en el mapa para ver sus productos</span></div>
        </div>
        <div class="es-note">📏 Radio actual: <strong style="color:var(--calipso)">${(currentRadius/1000).toFixed(1)} km</strong></div>
      </div>`;
      return;
    }

    // Caso 3: GPS activo pero sin comercios en el radio
    dom.resultsList.innerHTML = `<div class="empty-state">
      <div class="es-title"><span class="es-icon">🔍</span> No hay ${labelModo} en tu radio</div>
      <div class="es-steps">
        <div class="es-step"><div class="es-num">1</div><span>Amplía el <strong style="color:var(--accent)">radio de búsqueda</strong> con el control deslizante</span></div>
        <div class="es-step"><div class="es-num">2</div><span>Prueba con otra <strong style="color:var(--text)">dirección manual</strong></span></div>
        <div class="es-step"><div class="es-num">3</div><span>Cambia de pestaña para ver otras categorías de comercios</span></div>
      </div>
      <div class="es-note">📏 Radio actual: <strong style="color:var(--calipso)">${(currentRadius/1000).toFixed(1)} km</strong></div>
    </div>`;
  }

  function renderComerciosList(filtroTexto) {
    const q = (filtroTexto || '').toLowerCase().trim();
    const lista = q
      ? state.comercios.filter(c =>
          (c.nombre||'').toLowerCase().includes(q) ||
          (c.direccion||'').toLowerCase().includes(q) ||
          (c.comuna||'').toLowerCase().includes(q) ||
          (c.productos||[]).some(p =>
            (p.nombre||'').toLowerCase().includes(q) ||
            (p.marca||'').toLowerCase().includes(q)
          )
        )
      : state.comercios;

    // Marcar como "en resultados" solo si hay un filtro activo (cuando no, todos quedan sin burbuja)
    state.resultadosIds = new Set(q ? lista.map(c => String(c.id || c.comercioId || c.nombre)) : []);
    // Refrescar mapa para aplicar el nuevo modo de iconos
    if (markersGroup) renderComerciosMapa();

    if(!lista.length) {
      dom.resultsList.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">🔍</span> Sin resultados</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Prueba ampliar el radio de búsqueda</span></div>
          <div class="es-step"><div class="es-num">2</div><span>Intenta sin texto de búsqueda para ver todos</span></div>
        </div>
      </div>`;
      return;
    }

    dom.resultsList.innerHTML = '';
    lista.forEach((c, idx) => {
      const dist = (c.distanciaM && c.distanciaM < Infinity && c.distanciaM > 0)
        ? (c.distanciaM < 1000 ? Math.round(c.distanciaM)+'m' : (c.distanciaM/1000).toFixed(1)+'km')
        : '---';
      const nProd = (c.productos||[]).length;
      const localId = String(c.id || c.comercioId || c.nombre);

      const card = document.createElement('div');
      card.className = 'commerce-card';
      card.style.animationDelay = Math.min(idx*20,200)+'ms';
      card.innerHTML = `
        <div class="cc-icon">${MODO_ICON[state.mode]||'📍'}</div>
        <div class="cc-body">
          <div class="cc-name">${c.nombre||'Comercio'}</div>
          <div class="cc-sub">${c.direccion||c.comuna||'Sin dirección registrada'}</div>
        </div>
        <div class="cc-right">
          <div class="cc-dist">📏 ${dist}</div>
          <div class="cc-count">${nProd>0 ? nProd+' productos' : 'Ver info'}</div>
        </div>`;
      card.onclick = () => mostrarComercio(localId);
      dom.resultsList.appendChild(card);
    });
  }

  function mostrarComercio(id) {
    const comercio = state.comercios.find(c =>
      String(c.id) === id || String(c.comercioId) === id ||
      ('local_'+c.id) === id || c.nombre === id
    );
    if(!comercio) return;

    state.comercioActivo = comercio;

    if(comercio.lat && comercio.lng) {
      map.flyTo([comercio.lat, comercio.lng], 17, { duration: 0.4 });
    }

    document.querySelectorAll('.commerce-card').forEach(el => el.classList.remove('selected'));

    const dist = (comercio.distanciaM && comercio.distanciaM > 0 && comercio.distanciaM < Infinity)
      ? (comercio.distanciaM<1000 ? Math.round(comercio.distanciaM)+'m' : (comercio.distanciaM/1000).toFixed(1)+'km')
      : null;

    document.getElementById('cdpTitle').textContent = comercio.nombre || 'Comercio';
    const subParts = [comercio.direccion, comercio.comuna].filter(Boolean);
    if(dist) subParts.push('📏 '+dist);
    document.getElementById('cdpSub').textContent = subParts.join(' · ');

    // WhatsApp en esquina superior derecha del header — solo nivel 2+
    const _uComercio = (window.auth && auth.getUser) ? auth.getUser() : null;
    const _nivelU = (_uComercio?.nivel) || 1;
    const _libreComercio = _esPeriodoLibre(_uComercio);
    const waBtn = document.getElementById('cdpWaBtn');    if (waBtn) {
      if (comercio.whatsapp_publico && (_nivelU >= 2 || _libreComercio)) {
        const wa = comercio.whatsapp_publico.replace(/\D/g,'');
        waBtn.href = `https://wa.me/${wa}`;
        waBtn.style.display = 'flex';
        waBtn.onclick = () => { if (_nivelU >= 2) window._marcarHabilidadUsada && window._marcarHabilidadUsada(2); };
      } else if (comercio.whatsapp_publico && _nivelU < 2) {
        waBtn.removeAttribute('href');
        waBtn.style.display = 'flex';
        waBtn.title = '🔒 Nivel 2 para contactar por WhatsApp';
        waBtn.onclick = (e) => { e.preventDefault(); mostrarToast('🔒 Necesitas Nivel 2 (Rastreador Experto) para contactar por WhatsApp'); };
      } else {
        waBtn.style.display = 'none';
      }
    }

    // Instagram junto al de WhatsApp — solo nivel 2+
    const igBtn = document.getElementById('cdpIgBtn');    if (igBtn) {
      if (comercio.instagram && (_nivelU >= 2 || _libreComercio)) {
        // Acepta @usuario, usuario, o URL completa → normaliza a URL de perfil
        let ig = String(comercio.instagram).trim();
        let handle = ig.replace(/^https?:\/\//i, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '').split(/[/?#]/)[0];
        if (handle) {
          igBtn.href = `https://instagram.com/${handle}`;
          igBtn.style.display = 'flex';
        } else {
          igBtn.style.display = 'none';
        }
      } else if (comercio.instagram && _nivelU < 2) {
        igBtn.removeAttribute('href');
        igBtn.style.display = 'flex';
        igBtn.title = '🔒 Nivel 2 para ver Instagram';
        igBtn.onclick = (e) => { e.preventDefault(); mostrarToast('🔒 Necesitas Nivel 2 (Rastreador Experto) para ver Instagram'); };
      } else {
        igBtn.style.display = 'none';
      }
    }

    // Info strip: SOLO horario (teléfono y mapa eliminados)
    const strip = document.getElementById('cdpInfoStrip');
    if (strip) {
      if (comercio.horario) {
        strip.innerHTML = `<span class="cdp-info-item">🕐 ${comercio.horario}</span>`;
        strip.style.display = 'flex';
      } else {
        strip.style.display = 'none';
      }
    }

    const nProd = (comercio.productos||[]).length;
    document.getElementById('cdpBadge').textContent = nProd > 0 ? nProd+' productos' : 'Sin inventario registrado';

    document.getElementById('cdpSearch').value = '';
    state.subcatActiva = null;
    renderSubcategoriasComercio();
    renderProductosComercio('');

    document.getElementById('commerceDetailPanel').classList.add('open');
    const bd2 = document.getElementById('cdpBackdrop');
    if (bd2) bd2.classList.add('open');
    if (window.actualizarBtnFavorito) window.actualizarBtnFavorito(comercio.id);
  }

  // ▶ Genera los chips de subcategorías a partir de los productos del comercio activo.
  function renderSubcategoriasComercio() {
    const cont = document.getElementById('cdpSubcats');
    if(!cont) return;
    const comercio = state.comercioActivo;
    if(!comercio) { cont.innerHTML = ''; return; }

    const productos = comercio.productos || [];
    // Extraer subcategorías únicas (case-insensitive, ignorando vacíos/genéricos).
    const seen = new Map();
    productos.forEach(p => {
      const cat = (p.categoria || '').trim();
      if(!cat) return;
      const key = cat.toLowerCase();
      if(!seen.has(key)) seen.set(key, cat);
    });

    if(seen.size < 2) { cont.innerHTML = ''; return; } // No mostrar chips si hay 0 o 1 subcategoría.

    let html = `<div class="cdp-subcat-chip ${!state.subcatActiva?'active':''}" data-cat="">Todas (${productos.length})</div>`;
    seen.forEach((label) => {
      const count = productos.filter(p => (p.categoria||'').trim().toLowerCase() === label.toLowerCase()).length;
      const isActive = state.subcatActiva && state.subcatActiva.toLowerCase() === label.toLowerCase();
      html += `<div class="cdp-subcat-chip ${isActive?'active':''}" data-cat="${label}">${label} (${count})</div>`;
    });
    cont.innerHTML = html;

    // Event handler de los chips.
    cont.querySelectorAll('.cdp-subcat-chip').forEach(chip => {
      chip.onclick = () => {
        const cat = chip.dataset.cat || null;
        state.subcatActiva = cat;
        cont.querySelectorAll('.cdp-subcat-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderProductosComercio(document.getElementById('cdpSearch').value.trim());
      };
    });
  }

  function renderProductosComercio(query) {
    const comercio = state.comercioActivo;
    if(!comercio) return;

    const subcat = state.subcatActiva;
    const subcatLow = subcat ? subcat.toLowerCase() : null;

    const prods = (comercio.productos || []).filter(p => {
      // Filtro por subcategoría (chip activo).
      if(subcatLow) {
        const catP = (p.categoria||'').trim().toLowerCase();
        if(catP !== subcatLow) return false;
      }
      // Filtro por texto del buscador.
      if(!query) return true;
      const q = query.toLowerCase();
      return (p.nombre||'').toLowerCase().includes(q) ||
             (p.marca||'').toLowerCase().includes(q) ||
             (p.categoria||'').toLowerCase().includes(q) ||
             (p.descripcion||'').toLowerCase().includes(q);
    });

    const container = document.getElementById('cdpProducts');
    if(!prods.length) {
      const motivo = query
        ? 'Sin coincidencias para "'+query+'"'
        : subcat
          ? 'Sin productos en la subcategoría "'+subcat+'"'
          : 'Sin inventario cargado';
      container.innerHTML = `<div class="empty-state" style="margin:8px 0;">
        <div class="es-title">
          <span class="es-icon">${(query||subcat) ? '🔍' : '📦'}</span>
          ${motivo}
        </div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div>
          <span>${(query||subcat)
            ? 'Prueba otra palabra clave o quita el filtro de subcategoría'
            : 'Este comercio aún no ha cargado su inventario en MercaDate. Puede hacerlo desde el portal de comercios.'
          }</span></div>
        </div>
      </div>`;
      return;
    }

    container.innerHTML = '';
    const esc = window.escapeHtml || (s => String(s||''));
    prods.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'product-card';
      card.style.animationDelay = Math.min(idx*12,150)+'ms';
      const precio = (p.precio && Number(p.precio) > 0) ? Number(p.precio) : 0;
      const precioHTML = precio
        ? `<div class="pc-price">$${precio.toLocaleString('es-CL')}</div>`
        : `<div class="pc-noprice">Sin precio</div>`;
      const _uProd = (window.auth && auth.getUser) ? auth.getUser() : null;
      const _nivUsr = _uProd?.nivel || 1;
      const _libreProd = _esPeriodoLibre(_uProd);
      const btnCarrito = p.id ? (_nivUsr >= 2 || _libreProd
        ? `<button class="pc-add-cart" onclick="Carrito.agregar(${p.id}, 1, '', this);window._marcarHabilidadUsada&&window._marcarHabilidadUsada(2)" title="Agregar al carrito"><span>🛒</span> Agregar</button>`
        : `<button class="pc-add-cart pc-locked" onclick="window.mostrarToast('🔒 Necesitas Nivel 2 para usar el carrito')" title="🔒 Nivel 2"><span>🛒</span></button>`) : '';

      // Foto del producto (si el comercio la cargó), sino icono genérico
      const fotoUrl = p.imagen || p.foto || p.imagen_url || (p.imagenes && p.imagenes[0]) || '';
      const thumbHTML = fotoUrl
        ? `<div class="pc-thumb"><img src="${esc(fotoUrl)}" alt="${esc(p.nombre)}" onerror="this.parentElement.innerHTML='<span class=\\'pc-thumb-icon\\'>📦</span>'"/></div>`
        : `<div class="pc-thumb"><span class="pc-thumb-icon">📦</span></div>`;

      card.innerHTML = `
        ${thumbHTML}
        <div class="pc-info">
          <div class="pc-name">${esc(p.nombre)}</div>
          <div class="pc-meta">
            ${p.marca ? `<span class="pc-marca">${esc(p.marca)}</span>` : ''}
            ${p.peso ? `<span class="pc-peso">${esc(p.peso)}</span>` : ''}
          </div>
          <div class="pc-hist" id="hist-${comercio.id}-${idx}"></div>
        </div>
        <div class="pc-right">
          ${precioHTML}
          <div class="pc-right-actions">
            ${precio ? (_nivUsr >= 3 || _libreProd
              ? `<button class="pc-alerta-btn" onclick="toggleAlertaPrecio(${comercio.id},${JSON.stringify(p.nombre)},${precio},this);window._marcarHabilidadUsada&&window._marcarHabilidadUsada(3)" title="Alerta de precio">🔔</button>`
              : `<button class="pc-alerta-btn pc-locked" onclick="window.mostrarToast('🔒 Necesitas Nivel 3 (Cazador de Precios) para alertas de precio')" title="🔒 Nivel 3">🔔</button>`) : ''}
            ${btnCarrito}
          </div>
        </div>`;
      container.appendChild(card);
      // Cargar historial en background
      if (precio && p.nombre) cargarHistorialMini(comercio.id, p.nombre, `hist-${comercio.id}-${idx}`);
    });
  }

  async function cargarHistorialMini(local_id, nombre_producto, elId) {
    try {
      const r = await fetch(`/api/historial-precios?local_id=${local_id}&producto=${encodeURIComponent(nombre_producto)}`).then(r=>r.json());
      const el = document.getElementById(elId);
      if (!el || !r.historial?.length) return;
      const ult = r.historial[0];
      const diff = ult.precio_nuevo - ult.precio_anterior;
      const arrow = diff < 0 ? '↓' : '↑';
      const color = diff < 0 ? '#10b981' : '#ef4444';
      const hace = _tiempoRelativo(ult.fecha);
      el.innerHTML = `<span style="font-size:11px;color:${color}">${arrow} $${Math.abs(diff).toLocaleString('es-CL')} <span style="color:var(--muted)">${hace}</span></span>`;
    } catch (_) {}
  }

  function _tiempoRelativo(fechaStr) {
    const diff = Date.now() - new Date(fechaStr).getTime();
    const mins = Math.floor(diff/60000);
    if (mins < 60) return `hace ${mins}m`;
    const hrs = Math.floor(mins/60);
    if (hrs < 24) return `hace ${hrs}h`;
    return `hace ${Math.floor(hrs/24)}d`;
  }

  async function toggleAlertaPrecio(local_id, nombre_producto, precio_actual, btn) {
    const u = auth.getUser();
    if (!u) return mostrarToast('Inicia sesión para activar alertas');
    if ((u.nivel || 1) < 3 && !_esPeriodoLibre(u)) return mostrarToast('🔒 Necesitas Nivel 3 (Cazador de Precios) para alertas de precio');

    // Preguntar precio objetivo con un prompt simple
    const input = prompt(`🔔 Alerta de precio para "${nombre_producto}"\n\nPrecio actual: $${precio_actual.toLocaleString('es-CL')}\n¿Avisarme cuando el precio sea igual o menor a:`, precio_actual);
    if (!input) return;
    const objetivo = parseInt(input.replace(/\D/g,''));
    if (!objetivo || objetivo <= 0) return mostrarToast('Precio inválido');

    const r = await fetch('/api/usuario/alertas-precio', {
      method:'POST', headers:{'Content-Type':'application/json'}, credentials: 'same-origin',
      body: JSON.stringify({ user_id: u.id, local_id, nombre_producto, precio_objetivo: objetivo })
    }).then(r=>r.json()).catch(()=>null);

    if (r?.success) {
      btn.textContent = '🔔';
      btn.style.filter = 'drop-shadow(0 0 4px #eab308)';
      mostrarToast(`🔔 Te avisaremos cuando "${nombre_producto}" baje de $${objetivo.toLocaleString('es-CL')}`);
    } else {
      mostrarToast('❌ ' + (r?.message || 'Error'));
    }
  }
  window.toggleAlertaPrecio = toggleAlertaPrecio;

  async function buscarEnComercios(texto, categoriaFiltro, zona) {
    try {
      const res = await fetch('/api/locales');
      if (!res.ok) throw new Error('sin datos');
      const locales = await res.json();

      const cats = CATEGORIAS_MODO[state.mode] || [];
      const textoLower = (texto || '').toLowerCase().trim();
      const catFiltroNorm = normalize(categoriaFiltro || '');
      const hayFiltroProducto = !!(textoLower || catFiltroNorm);

      // Filtros de zona (todos opcionales)
      const fComuna = (zona?.comuna || '').toLowerCase().trim();
      const fRegion = (zona?.region || '').toLowerCase().trim();
      const fMarca  = (zona?.marca  || '').toLowerCase().trim();

      let resultados = [];
      (Array.isArray(locales) ? locales : []).forEach(local => {
        if (local.aprobado !== true) return;

        const catLocalNorm = normalize(local.categoria || '');
        const matchCat = !cats.length || cats.some(c => catLocalNorm.includes(normalize(c))) || state.mode === 'almacen';
        if (!matchCat) return;

        // ▶ Filtros de zona aplicados a TODO comercio (independiente del producto)
        if (fComuna && (local.comuna || '').toLowerCase() !== fComuna) return;
        if (fRegion && (local.region || '').toLowerCase() !== fRegion) return;
        if (fMarca && !(local.nombre || '').toLowerCase().includes(fMarca)) return;

        const productos = local.productos || [];

        // Caso 1: SIN filtro de producto → mostrar el comercio (un entry por local)
        if (!hayFiltroProducto) {
          const distanciaM = (local.lat && local.lng && state.gpsActive)
            ? calcularDistancia(state.lat, state.lng, parseFloat(local.lat), parseFloat(local.lng))
            : 0;
          if (state.gpsActive && local.lat && local.lng && distanciaM > currentRadius && !(fComuna || fRegion)) return;
          resultados.push({
            id:          local.id,
            nombre:      local.nombre,
            precio:      null,
            producto:    null,
            local_id:    local.id,
            direccion:   local.direccion || local.comuna || '',
            lat:         parseFloat(local.lat) || null,
            lng:         parseFloat(local.lng) || null,
            distanciaM,
            region:      local.region || '',
            comuna:      local.comuna || '',
            comercioId:  'local_' + local.id,
            productos,
          });
          return;
        }

        // Caso 2: CON filtro de producto → un entry por producto que matchea
        const prods = productos.filter(p => {
          const nombreP = (p.nombre || '').toLowerCase();
          const marcaP  = (p.marca || '').toLowerCase();
          const catP    = normalize(p.categoria || '');
          const descP   = (p.descripcion || '').toLowerCase();

          const matchText = !textoLower ||
            nombreP.includes(textoLower) ||
            marcaP.includes(textoLower) ||
            catP.includes(textoLower) ||
            descP.includes(textoLower);

          const matchCatProd = !catFiltroNorm || catP.includes(catFiltroNorm) || nombreP.includes(catFiltroNorm);
          return matchText && matchCatProd;
        });

        if (!prods.length) return;

        const distanciaM = (local.lat && local.lng && state.gpsActive)
          ? calcularDistancia(state.lat, state.lng, parseFloat(local.lat), parseFloat(local.lng))
          : 0;
        // Si hay filtro de zona explícito, el radio del GPS no aplica (el usuario quiere esa zona)
        if (state.gpsActive && local.lat && local.lng && distanciaM > currentRadius && !(fComuna || fRegion)) return;

        prods.forEach(p => {
          resultados.push({
            nombre:      local.nombre,
            precio:      p.precio || null,
            producto:    p.nombre,
            producto_id: p.id,
            local_id:    local.id,
            marca:       p.marca || '',
            peso:        p.peso || '',
            categoria:   p.categoria || '',
            direccion:   local.direccion || local.comuna || '',
            lat:         parseFloat(local.lat) || null,
            lng:         parseFloat(local.lng) || null,
            distanciaM,
            region:      local.region || '',
            comuna:      local.comuna || '',
            comercioId:  'local_' + local.id,
            precio_estado:    p.precio_estado || null,
            precio_reportes:  p.precio_reportes || 0,
            precio_reportado: p.precio_reportado ?? null,
          });
        });
      });
      return resultados;
    } catch(e) {
      console.warn('API comercios no disponible.', e);
      return [];
    }
  }

  const CONFIG_SERVICIO = {
    paseadores: { titulo: '🐕 Paseadores de Mascotas', tipo: 'paseador',  endpoint: 'paseadores' },
    cuidador:   { titulo: '👤 Cuidadores de Mascotas', tipo: 'cuidador',  endpoint: 'cuidadores' },
  };

  function abrirPanelEspecial(tipo) {
    const cfg = CONFIG_SERVICIO[tipo] || CONFIG_SERVICIO.paseadores;
    state.servicioEspecial = tipo;
    document.getElementById('pspTitle').textContent = cfg.titulo;
    document.getElementById('commerceDetailPanel').classList.remove('open');
    document.getElementById('paseadoresPanel').classList.add('open');
    cargarPaseadores(null, cfg.endpoint);
  }

  function abrirPanelPaseadores() { abrirPanelEspecial('paseadores'); }

  async function cargarPaseadores(query, endpoint) {
    endpoint = endpoint || (state.servicioEspecial === 'cuidador' ? 'cuidadores' : 'paseadores');
    const list = document.getElementById('pspList');
    list.innerHTML = `<div class="empty-state"><div class="es-title"><span class="spinner"></span> Cargando paseadores...</div></div>`;
    try {
      const params = new URLSearchParams();
      if(state.gpsActive) { params.append('lat', state.lat); params.append('lng', state.lng); params.append('radio', currentRadius); }
      const res = await fetch(`/api/${endpoint}?` + params.toString());
      if(!res.ok) throw new Error('sin datos');
      let paseadores = await res.json();
      if(Array.isArray(paseadores)) {
        paseadores = paseadores.filter(p => p.estado === 'aprobado');
      } else paseadores = [];

      if(query) {
        const q = query.toLowerCase();
        paseadores = paseadores.filter(p =>
          (p.nombre||'').toLowerCase().includes(q) ||
          (p.comuna||'').toLowerCase().includes(q) ||
          (p.barrio||'').toLowerCase().includes(q)
        );
      }

      renderPaseadores(paseadores);
      renderPaseadoresMapa(paseadores);
    } catch(e) {
      renderPaseadores([]);
      list.innerHTML += `<div style="padding:12px 0;text-align:center;font-size:12px;color:var(--muted);">
        El servidor de paseadores estará disponible próximamente.<br>
        <button onclick="document.getElementById('registroModal').classList.add('open')"
          style="margin-top:10px;background:var(--calipso-dim);border:1px solid rgba(0,196,204,0.3);color:var(--calipso);
                 padding:6px 16px;border-radius:20px;cursor:pointer;font-weight:700;font-size:12px;font-family:'DM Sans',sans-serif;">
          + Sé el primero en inscribirte
        </button>
      </div>`;
    }
  }

  function renderPaseadores(lista) {
    const list = document.getElementById('pspList');
    if(!lista.length) {
      list.innerHTML = `<div class="empty-state">
        <div class="es-title"><span class="es-icon">🐕</span> Sin paseadores en el área</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Amplía el radio de búsqueda o prueba otra comuna</span></div>
          <div class="es-step"><div class="es-num">2</div><span>¿Eres paseador? Inscríbete y sé parte del directorio</span></div>
        </div>
        <div style="margin-top:12px;text-align:center;">
          <button onclick="document.getElementById('registroModal').classList.add('open')"
            style="background:linear-gradient(135deg,var(--calipso),#008e96);color:#000;border:none;
                   padding:9px 20px;border-radius:20px;cursor:pointer;font-weight:800;font-size:13px;
                   font-family:'DM Sans',sans-serif;box-shadow:0 3px 10px rgba(0,196,204,0.35);">
            + Inscribirse como Paseador
          </button>
        </div>
      </div>`;
      return;
    }
    list.innerHTML = '';
    lista.forEach((p, idx) => {
      const card = document.createElement('div');
      card.className = 'paseador-card';
      card.style.animationDelay = Math.min(idx*25,250)+'ms';

      const avatarHtml = p.foto_url
        ? `<img src="${p.foto_url}" alt="${p.nombre}" onerror="this.parentElement.textContent='🐕'">`
        : '🐕';

      const tarifa30 = p.tarifa_30min ? `$${Number(p.tarifa_30min).toLocaleString('es-CL')}/30min` : null;
      const tarifa60 = p.tarifa_60min ? `$${Number(p.tarifa_60min).toLocaleString('es-CL')}/60min` : null;

      card.innerHTML = `
        <div class="pc-row1">
          <div class="pc-avatar">${avatarHtml}</div>
          <div class="pc-info-main">
            <div class="pc-name">
              ${p.nombre}
              ${p.verificado ? '<span class="pc-verified">✓ Verificado</span>' : ''}
            </div>
            <div class="pc-loc">📍 ${[p.barrio, p.comuna].filter(Boolean).join(', ') || 'Sin ubicación'}</div>
            ${p.disponibilidad ? `<div class="pc-loc" style="margin-top:2px;">🕐 ${p.disponibilidad}</div>` : ''}
          </div>
        </div>
        ${p.descripcion ? `<div class="pc-desc">${p.descripcion.substring(0,140)}${p.descripcion.length>140?'…':''}</div>` : ''}
        <div class="pc-row2">
          ${tarifa30 ? `<div class="pc-tarifa">${tarifa30}</div>` : ''}
          ${tarifa60 ? `<div class="pc-tarifa" style="background:linear-gradient(135deg,#1a8a8a,#0d6b6b)">${tarifa60}</div>` : ''}
          ${p.razas ? `<span class="pc-tag">🐕 ${p.razas.substring(0,28)}</span>` : ''}
          <button class="pc-contact-btn" onclick="window._contactarPaseador('${p.telefono||''}','${p.email||''}','${p.nombre||''}')">
            Contactar
          </button>
        </div>`;
      list.appendChild(card);
    });
    setStatusBar(`✅ ${lista.length} paseador${lista.length!==1?'es':''} disponible${lista.length!==1?'s':''}`);
  }

  window._contactarPaseador = (tel, email, nombre) => {
    const msg = `Hola ${nombre}, te encontré en MercaDate y me gustaría contratar tus servicios de paseo.`;
    if(tel) {
      const cleanTel = tel.replace(/\s/g,'').replace('+56','56');
      window.open(`https://wa.me/${cleanTel}?text=${encodeURIComponent(msg)}`, '_blank');
    } else if(email) {
      window.location.href = `mailto:${email}?subject=Consulta desde MercaDate&body=${encodeURIComponent(msg)}`;
    } else {
      mostrarToast('Sin datos de contacto disponibles');
    }
  };

  function renderPaseadoresMapa(lista) {
    limpiarMarcadores();
    lista.forEach(p => {
      if(!p.lat || !p.lng) return;
      const icon = L.divIcon({
        className:'',
        html:`<div class="marker-comercio-name" style="border-color:rgba(0,196,204,0.6);color:var(--calipso)">🐕 ${(p.nombre||'').split(' ')[0]}</div>`,
        iconSize:[100,26], iconAnchor:[50,13]
      });
      L.marker([parseFloat(p.lat), parseFloat(p.lng)], {icon})
        .bindPopup(`<b style="color:#00C4CC">${p.nombre}</b><br>
          <span style="color:#94a3b8;font-size:11px">${p.comuna||''}</span><br>
          ${p.tarifa_30min?`<b style="color:#f0b429">$${Number(p.tarifa_30min).toLocaleString('es-CL')}/30min</b>`:''}`)
        .addTo(markersGroup);
    });
  }

  function setupRegistroModal() {
    const hoy = new Date();
    hoy.setFullYear(hoy.getFullYear() - 18);
    document.getElementById('rFechaNac').max = hoy.toISOString().split('T')[0];

    document.getElementById('btnCerrarModal').onclick = cerrarModal;
    document.getElementById('registroModal').onclick = e => {
      if(e.target === document.getElementById('registroModal')) cerrarModal();
    };
    document.getElementById('btnRegistrarPaseador').onclick = () => {
      const cfg = CONFIG_SERVICIO[state.servicioEspecial] || CONFIG_SERVICIO.paseadores;
      document.getElementById('rTipoServicio').value = cfg.tipo;
      document.getElementById('modalTitulo').textContent =
        cfg.tipo === 'cuidador' ? '👤 Inscripción como Cuidador' : '🐕 Inscripción como Paseador';
      document.getElementById('registroModal').classList.add('open');
    };

    const fileCert = document.getElementById('fileCert');
    fileCert.onchange = () => {
      const f = fileCert.files[0];
      if(!f) return;
      if(f.size > 5*1024*1024) { mostrarToast('⚠️ El certificado supera 5 MB'); fileCert.value=''; return; }
      document.getElementById('certFileName').textContent = `✅ ${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`;
      document.getElementById('uploadCert').classList.add('has-file');
    };
    const certArea = document.getElementById('uploadCert');
    certArea.addEventListener('dragover', e => { e.preventDefault(); certArea.classList.add('drag-over'); });
    certArea.addEventListener('dragleave', () => certArea.classList.remove('drag-over'));
    certArea.addEventListener('drop', e => {
      e.preventDefault(); certArea.classList.remove('drag-over');
      if(e.dataTransfer.files[0]) { const dt=new DataTransfer(); dt.items.add(e.dataTransfer.files[0]); fileCert.files=dt.files; fileCert.dispatchEvent(new Event('change')); }
    });

    const fileSelfie = document.getElementById('fileSelfie');
    fileSelfie.onchange = () => {
      const f = fileSelfie.files[0];
      if(!f) return;
      if(f.size > 3*1024*1024) { mostrarToast('⚠️ La foto supera 3 MB'); fileSelfie.value=''; return; }
      document.getElementById('selfieFileName').textContent = `✅ ${f.name}`;
      document.getElementById('uploadSelfie').classList.add('has-file');
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('selfieImg').src = ev.target.result;
        document.getElementById('selfiePreview').style.display = 'block';
      };
      reader.readAsDataURL(f);
    };
    const selfieArea = document.getElementById('uploadSelfie');
    selfieArea.addEventListener('dragover', e => { e.preventDefault(); selfieArea.classList.add('drag-over'); });
    selfieArea.addEventListener('dragleave', () => selfieArea.classList.remove('drag-over'));
    selfieArea.addEventListener('drop', e => {
      e.preventDefault(); selfieArea.classList.remove('drag-over');
      if(e.dataTransfer.files[0]) { const dt=new DataTransfer(); dt.items.add(e.dataTransfer.files[0]); fileSelfie.files=dt.files; fileSelfie.dispatchEvent(new Event('change')); }
    });

    document.getElementById('btnEnviarRegistro').onclick = async () => {
      const campos = {
        nombre:      document.getElementById('rNombre').value.trim(),
        rut:         document.getElementById('rRut').value.trim(),
        fecha_nac:   document.getElementById('rFechaNac').value,
        telefono:    document.getElementById('rTelefono').value.trim(),
        email:       document.getElementById('rEmail').value.trim(),
        direccion:   document.getElementById('rDireccion').value.trim(),
        comuna:      document.getElementById('rComuna').value.trim(),
        region:      document.getElementById('rRegion').value,
        tipo_servicio: document.getElementById('rTipoServicio').value,
      };
      const faltan = ['nombre','rut','fecha_nac','telefono','email','direccion','comuna','region']
        .filter(k => !campos[k]);
      if(faltan.length) { mostrarToast('⚠️ Completa todos los campos obligatorios'); return; }
      if(!fileCert.files[0]) { mostrarToast('⚠️ Adjunta el certificado de antecedentes'); return; }
      if(!fileSelfie.files[0]) { mostrarToast('⚠️ Adjunta tu foto en primera persona'); return; }

      const btn = document.getElementById('btnEnviarRegistro');
      btn.disabled = true; btn.textContent = 'Enviando...';
      try {
        const fd = new FormData();
        Object.entries(campos).forEach(([k,v]) => fd.append(k, v));
        fd.append('certificado', fileCert.files[0]);
        fd.append('selfie', fileSelfie.files[0]);

        const endpoint = campos.tipo_servicio === 'cuidador' ? 'cuidadores' : 'paseadores';
        const res = await fetch(`/api/${endpoint}/registro`, { method:'POST', body:fd });
        const data = await res.json();

        if(res.ok && data.success) {
          cerrarModal();
          mostrarToast(`✅ ¡Inscripción enviada! Revisaremos tu documentación en 24–48 horas.`);
        } else {
          mostrarToast('❌ ' + (data.mensaje || 'Error al enviar. Intenta nuevamente.'));
        }
      } catch(e) {
        mostrarToast('❌ Error de conexión con el servidor');
      } finally {
        btn.disabled = false; btn.textContent = 'Enviar inscripción →';
      }
    };
  }

  function cerrarModal() {
    document.getElementById('registroModal').classList.remove('open');
    ['rNombre','rRut','rFechaNac','rTelefono','rEmail','rDireccion','rComuna'].forEach(id => {
      const el = document.getElementById(id); if(el) el.value = '';
    });
    document.getElementById('rRegion').value = '';
    document.getElementById('fileCert').value = '';
    document.getElementById('fileSelfie').value = '';
    document.getElementById('uploadCert').classList.remove('has-file');
    document.getElementById('uploadSelfie').classList.remove('has-file');
    document.getElementById('certFileName').textContent = 'Sin archivo seleccionado';
    document.getElementById('selfieFileName').textContent = 'Sin archivo seleccionado';
    document.getElementById('selfiePreview').style.display = 'none';
  }

  function setupPaseadoresEvents() {
    document.getElementById('pspBack').onclick = () => {
      document.getElementById('paseadoresPanel').classList.remove('open');
      state.categoriaProducto = null;
      state.servicioEspecial = null;
      const cse = document.getElementById('prodCatSelect'); if(cse) cse.value = '';
      cargarComerciosCercanos();
    };
    document.getElementById('pspSearch').oninput = e => {
      cargarPaseadores(e.target.value.trim());
    };
  }

  function mostrarToast(msg, ms=3500) {
    const t = document.getElementById('toastMsg');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), ms);
  }

  async function overpassQuery(query) {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:'data='+encodeURIComponent(query) });
    if(!r.ok) throw new Error('Overpass no disponible ('+r.status+')');
    return (await r.json()).elements.filter(n=>n.lat&&n.lon);
  }

  async function overpassFuel(lat, lng, radiusM) {
    const nodes = await overpassQuery(`[out:json][timeout:25];node["amenity"="fuel"](around:${radiusM},${lat},${lng});out body;`);
    return nodes.map(n => {
      const t=n.tags||{};
      const nombre=t.brand||t.name||t.operator||'Estación';
      const seed=nombre.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
      const bases={'93':1080,'95':1130,'97':1185,'DI':950,'KE':820};
      const precio=(bases[state.fuelType]||1080)+(seed%13)*4-26;
      return { nombre, precio, direccion:[t['addr:street'],t['addr:housenumber']].filter(Boolean).join(' '),
        lat:n.lat, lng:n.lon, distanciaM:calcularDistancia(lat,lng,n.lat,n.lon),
        combustible:FUEL_LABEL[state.fuelType]||state.fuelType, region:'', comuna:t['addr:city']||t['addr:suburb']||'',
        comercioId:'ov_'+n.id };
    });
  }

  async function overpassCategoria(modo, lat, lng, radiusM) {
    const filtros = {
      almacen:`(node["shop"="convenience"]; node["shop"="general"]; node["shop"="grocery"];)`,
      supermercado:`node["shop"="supermarket"]`,
      farmacia:`(node["amenity"="pharmacy"]; node["shop"="pharmacy"];)`,
      restaurante:`(node["amenity"="restaurant"]; node["amenity"="fast_food"]; node["amenity"="cafe"];)`
    };
    const nodes = await overpassQuery(`[out:json][timeout:25];${filtros[modo]||`node["shop"]`}(around:${radiusM},${lat},${lng});out body;`);
    return nodes.filter(n=>n.tags?.name).map(n => {
      const t=n.tags||{};
      return { nombre:t.name, precio:0, direccion:[t['addr:street'],t['addr:housenumber']].filter(Boolean).join(' '),
        lat:n.lat, lng:n.lon, distanciaM:calcularDistancia(lat,lng,n.lat,n.lon),
        producto:modo, region:'', comuna:t['addr:city']||'', comercioId:'ov_'+n.id };
    });
  }

  function mensajeVacio() {
    if(!state.mode) {
      return `<div class="empty-state">
        <div class="es-title"><span class="es-icon">⛽</span> ¿Qué deseas buscar?</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Selecciona una categoría en la barra superior (Combustibles, Farmacias, etc.)</span></div>
          <div class="es-step"><div class="es-num">2</div><span>Elige el tipo de combustible o producto que necesitas</span></div>
          <div class="es-step"><div class="es-num">3</div><span>Ajusta el radio de búsqueda según la distancia que estés dispuesto a recorrer</span></div>
          <div class="es-step"><div class="es-num">4</div><span>Presiona <strong style="color:var(--accent)">Buscar</strong> para ver precios actualizados</span></div>
        </div>
        <div class="es-note">📍 Activa el GPS o ingresa una dirección para obtener resultados ordenados por cercanía</div>
      </div>`;
    }

    if(state.mode === 'combustible' && !state.fuelType) {
      return `<div class="empty-state">
        <div class="es-title"><span class="es-icon">⛽</span> Selecciona el combustible</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>Elige el tipo de combustible: <strong style="color:var(--text)">93, 95, 97, Diésel o Parafina</strong></span></div>
          <div class="es-step"><div class="es-num">2</div><span>Ajusta el radio de búsqueda con el control deslizante — por defecto son <strong style="color:var(--text)">10 cuadras (1 km)</strong></span></div>
          <div class="es-step"><div class="es-num">3</div><span>Presiona <strong style="color:var(--accent)">Buscar</strong> para ver precios y estaciones cercanas</span></div>
        </div>
        <div class="es-note">💡 También puedes filtrar por región, comuna o marca usando el botón <strong>⚙️ Filtros</strong></div>
      </div>`;
    }

    if(state.mode === 'combustible' && state.fuelType) {
      const gpsHint = state.gpsActive
        ? `Intenta ampliar el radio de búsqueda moviendo el control deslizante`
        : `Activa el GPS o ingresa una dirección para buscar en tu zona`;
      return `<div class="empty-state">
        <div class="es-title"><span class="es-icon">🔍</span> Sin resultados en esta área</div>
        <div class="es-steps">
          <div class="es-step"><div class="es-num">1</div><span>${gpsHint}</span></div>
        </div>
        <div class="es-note">📏 Radio actual: <strong style="color:var(--accent)">${(currentRadius/1000).toFixed(1)} km</strong></div>
      </div>`;
    }

    return `<div class="empty-state">
      <div class="es-title"><span class="es-icon">🔍</span> Sin resultados cercanos</div>
      <div class="es-steps">
        <div class="es-step"><div class="es-num">1</div><span>Asegúrate de que el GPS esté activo o ingresa una dirección</span></div>
        <div class="es-step"><div class="es-num">2</div><span>Amplía el radio de búsqueda con el control deslizante</span></div>
        <div class="es-step"><div class="es-num">3</div><span>Presiona <strong style="color:var(--accent)">Buscar</strong> nuevamente</span></div>
      </div>
      <div class="es-note">📏 Radio actual: <strong style="color:var(--accent)">${(currentRadius/1000).toFixed(1)} km</strong></div>
    </div>`;
  }

  // Variante VIOLETA del marcador para "📍 Más cerca" (orden por distancia).
  // Se inyecta una sola vez; el verde de "Mejor precio" ya vive en styles.css.
  function inyectarEstiloMasCerca() {
    if (document.getElementById('mp-nearest-style')) return;
    const st = document.createElement('style');
    st.id = 'mp-nearest-style';
    st.textContent =
      '.marker-best-flag.nearest{background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);box-shadow:0 2px 8px rgba(139,92,246,.50),0 0 0 2px rgba(255,255,255,.20) inset;}' +
      '.marker-best-flag.nearest::after{background:#7c3aed;}' +
      '.marker-precio.best-price.nearest{background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%)!important;box-shadow:0 0 0 3px rgba(139,92,246,.30),0 6px 20px rgba(139,92,246,.45),0 2px 6px rgba(0,0,0,.30)!important;}' +
      '.marker-comercio.best-price.nearest{background:linear-gradient(135deg,#8b5cf6,#7c3aed)!important;box-shadow:0 0 0 3px rgba(139,92,246,.30),0 6px 20px rgba(139,92,246,.45)!important;}' +
      // Badge "📍 Más cerca" violeta en la tarjeta (espejo del verde .title-best-badge)
      '.title-near-badge{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:800;color:#fff;background:linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%);padding:3px 9px;border-radius:100px;white-space:nowrap;letter-spacing:.02em;box-shadow:0 2px 6px rgba(139,92,246,.4);margin-left:6px;}' +
      // Realce violeta de la tarjeta más cercana (espejo del verde .card-item.cheapest)
      '.card-item.nearest{position:relative!important;border:2px solid #8b5cf6!important;background:linear-gradient(135deg,#211a33,#241f3a)!important;box-shadow:0 4px 16px rgba(139,92,246,.30),0 0 0 4px rgba(139,92,246,.10)!important;}' +
      '.card-item.nearest::before{content:none!important;}';
    document.head.appendChild(st);
  }

  function renderResults() {
    inyectarEstiloMasCerca();
    const orden = document.getElementById('sortBy').value;
    // El orden usa SIEMPRE el precio publicado por el comercio: es el único dato que el
    // comercio aceptó, y ordenar por reportes sin verificar permitiría hundir a un
    // competidor. Contra el precio carnada no se reordena: el producto cuyo precio quedó
    // vencido directamente no llega hasta acá — el servidor lo saca de la búsqueda hasta
    // que el comercio lo actualice (ver /api/locales). MercaDate no asume un precio que no
    // puede respaldar; simplemente deja de publicar el que sabe incorrecto.
    const sorted = [...state.results].sort((a,b) =>
      orden==='precio'
        ? ((a.precio??Infinity)-(b.precio??Infinity))
        : (a.distanciaM||999999)-(b.distanciaM||999999)
    );
    limpiarMarcadores();

    if(!sorted.length) {
      dom.resultsList.innerHTML = mensajeVacio();
      return;
    }

    dom.resultsList.innerHTML = '';
    const mostrarPrecio = sorted.some(s => s.precio !== null && s.precio > 0);

    // Identificar la opción MÁS BARATA por PRECIO (no por ID, más robusto)
    let minPrecio = null;
    // El sello "🏆 Mejor precio" lo pone MercaDate: no se otorga a un precio que varios
    // usuarios reportaron como distinto y el comercio todavía no confirmó.
    const precioSinConfirmar = s => s.precio_estado === 'en_disputa' || s.precio_estado === 'vencido';
    if (mostrarPrecio) {
      const precios = sorted.filter(s => s.precio != null && s.precio > 0 && !precioSinConfirmar(s)).map(s => s.precio);
      if (precios.length) minPrecio = Math.min(...precios);
    }
    let cheapestMarcado = false; // solo marca el primero si hay empate
    const ordenarPorPrecio = orden === 'precio';

    sorted.forEach((item, idx) => {
      const card = document.createElement('div');
      const tienePrecio = item.precio != null && item.precio > 0;
      const esCheapest = !cheapestMarcado && tienePrecio && !precioSinConfirmar(item) && minPrecio !== null && item.precio === minPrecio;
      if (esCheapest) cheapestMarcado = true;

      // Realce y badges (pueden coexistir):
      //  · MÁS BARATO  → SIEMPRE verde  · "🏆 Mejor precio"  (en cualquier orden)
      //  · MÁS CERCANO → violeta        · "📍 Más cerca"     (solo al ordenar por cercanía)
      //    La lista ya viene ordenada, así que idx===0 es el más cercano.
      const esMejorPrecio = (item.mejor || esCheapest) && !precioSinConfirmar(item);
      const esMasCerca    = !ordenarPorPrecio && idx === 0;

      // El verde del mejor precio manda; el violeta solo si NO es además el más barato.
      let realce = '';
      if (esMejorPrecio)   realce = ' active cheapest';
      else if (esMasCerca) realce = ' active nearest';
      card.className = 'card-item' + realce;
      card.style.animationDelay = Math.min(idx * 30, 300) + 'ms';

      // El badge verde se mantiene siempre; el violeta "Más cerca" se suma encima.
      const mejorBadgeTitulo =
        (esMejorPrecio ? `<span class="title-best-badge">🏆 Mejor precio</span>` : '') +
        (esMasCerca    ? `<span class="title-near-badge">📍 Más cerca</span>` : '');

      const dist = item.distanciaM && item.distanciaM < Infinity
        ? (item.distanciaM<1000 ? Math.round(item.distanciaM)+'m' : (item.distanciaM/1000).toFixed(1)+'km') : '---';

      const tieneAditivo = item.precioAditivo != null && item.precioAditivo > 0
        && item.precioAditivo !== item.precio;
      const aditivoTag = tieneAditivo
        ? `<span class="tag tag-aditivo">⚗️ Con aditivo $${item.precioAditivo.toLocaleString('es-CL')}</span>`
        : '';

      // Tipo de combustible: ahora va arriba, pegado al precio (no en L2)
      const fuelBadge = (item.combustible && tienePrecio)
        ? `<span class="cv2-fuel" style="background:rgba(240,180,41,.15);color:#f0b429;border:1px solid rgba(240,180,41,.4);border-radius:7px;padding:3px 8px;font-size:13px;font-weight:800;white-space:nowrap;align-self:center">${item.combustible}</span>`
        : '';
      // Fuente oficial CNE (solo en modo combustible)
      const cneFuente = state.mode === 'combustible'
        ? `<div class="cv2-cne" style="font-size:10.5px;color:var(--muted);margin-top:7px;display:flex;align-items:center;gap:4px;opacity:.85">🏛️ Fuente oficial · Comisión Nacional de Energía</div>`
        : '';

      // Producto SIN la categoría (eliminada por pedido del usuario)
      const productoTag = item.producto && state.mode !== 'combustible'
        ? `<span class="tag" style="background:rgba(0,196,204,0.08);border-color:rgba(0,196,204,0.3);color:var(--calipso);">📦 ${item.producto}${item.marca?' · '+item.marca:''}${item.peso?' · '+item.peso:''}</span>`
        : '';

      // Botón Agregar al carro (solo comercios con producto_id)
      const agregarBtn = (item.producto_id && state.mode !== 'combustible')
        ? `<button class="card-add-cart" data-pid="${item.producto_id}" data-lid="${item.local_id||''}">🛒 Agregar</button>`
        : '';

      const precioBloque = tienePrecio
        ? `<div class="card-right">
             <div class="card-price-main">$${item.precio.toLocaleString('es-CL')}</div>
             <div class="card-price-label">${state.mode==='combustible'?'por litro':'precio'}</div>
             ${agregarBtn}
           </div>`
        : (agregarBtn ? `<div class="card-right">${agregarBtn}</div>` : '');

      // Unidad de medida
      const unidad = state.mode === 'combustible' ? 'POR LITRO'
        : item.peso ? 'POR ' + item.peso.toUpperCase()
        : 'C/U';

      // Precio reportado por varios usuarios (consenso, Paso 0). Se le da al comprador el
      // dato que le sirve —cuánto dicen que cuesta— atribuido a los usuarios, no a MercaDate.
      // Nunca se reemplaza el precio publicado ni se señala al comercio: el precio es suyo.
      const disputaAviso = (item.precio_estado === 'en_disputa' || item.precio_estado === 'vencido')
        ? `<div class="cv2-disputa ${item.precio_estado === 'vencido' ? 'cv2-disputa-vencida' : ''}">
             <span class="cv2-disputa-txt">💬 ${item.precio_reportes || 'Varios'} usuarios reportan que hoy está a</span>
             <strong class="cv2-disputa-precio">${item.precio_reportado != null ? '$' + Number(item.precio_reportado).toLocaleString('es-CL') : 'otro precio'}</strong>
             ${item.precio_estado === 'vencido' ? '<span class="cv2-disputa-txt">· el comercio aún no lo confirma</span>' : ''}
           </div>`
        : '';

      // L1: nombre + badge | precio + unidad
      // L2: dist + dirección + tipo | Reportar (esquina inferior derecha)
      card.innerHTML = `
        <div class="cv2-body">
          <div class="cv2-l1">
            <div class="cv2-left">
              <span class="cv2-nombre">${item.nombre}</span>
              ${mejorBadgeTitulo}
            </div>
            ${tienePrecio ? `
            <div class="cv2-precio-bloque" style="display:flex;align-items:center;gap:8px">
              ${fuelBadge}
              <div style="display:flex;flex-direction:column;align-items:flex-end;line-height:1.05">
                <span class="cv2-precio">$${item.precio.toLocaleString('es-CL')}</span>
                <span class="cv2-unidad">${unidad}</span>
              </div>
            </div>` : ''}
          </div>
          <div class="cv2-l2">
            <div class="cv2-l2-info">
              <span class="cv2-dist">📏 ${dist}</span>
              <span class="cv2-dir">${item.direccion||item.comuna||''}</span>
              ${productoTag}
              ${aditivoTag}
            </div>
            <div class="cv2-l2-right">
              ${agregarBtn}
              ${(state.mode === 'combustible' && item.lat && item.lng) ? `<button class="cv2-ir" data-lat="${item.lat}" data-lng="${item.lng}">🗺️ Ir</button>` : ''}
              ${tienePrecio ? `<button class="cv2-reportar" data-p="${item.precio}">🔁 Reportar</button>` : ''}
            </div>
          </div>
          ${disputaAviso}
          ${cneFuente}
        </div>`;

      card.onclick = e => {
        if(e.target.tagName!=='BUTTON' && item.lat && item.lng) {
          map.flyTo([item.lat, item.lng], 16, { duration:0.4 });
          markersGroup.eachLayer(layer => {
            if(layer.getLatLng().lat===item.lat && layer.getLatLng().lng===item.lng) layer.openPopup();
          });
        }
      };

      const irBtn = card.querySelector('button.cv2-ir');
      if (irBtn) irBtn.onclick = e => {
        e.stopPropagation();
        _abrirNavegacion(parseFloat(irBtn.dataset.lat), parseFloat(irBtn.dataset.lng));
      };

      const btn = card.querySelector('button.cv2-reportar');
      if(btn) btn.onclick = e => {
        e.stopPropagation();
        const _uRep = (window.auth && auth.getUser) ? auth.getUser() : null;
        if (!_uRep) return mostrarToast('🔒 Inicia sesión para reportar precios');
        if ((_uRep.nivel || 1) < 2 && !_esPeriodoLibre(_uRep)) return mostrarToast('🔒 Necesitas Nivel 2 (Rastreador Experto) para reportar precios');
        const precioMostrado = parseInt(btn.dataset.p);
        // Modal in-app (prompt() está bloqueado en el WebView de la APK)
        _modalReportarPrecio(precioMostrado, function(nuevoPrecio) {
          if (nuevoPrecio === precioMostrado) { mostrarToast('El precio ingresado es igual al mostrado.', 3000, 'warn'); return; }
          // Api.post inyecta el Bearer en la APK (las cookies no persisten ahí)
          Api.post('/usuario/reportes', {
            comercioId:item.comercioId, combustible:item.combustible, precioReportado:nuevoPrecio,
            comercio:(item.nombre||item.marca||null), comuna:(item.comuna||null)
          }).then(res => {
            if (res.ok && res.data && res.data.success) { sumarPuntos(5); mostrarToast('✅ ¡Gracias! +5 puntos por tu reporte.', 3500); }
            else mostrarToast('❌ No se pudo enviar el reporte.', 3500, 'err');
          }).catch(() => mostrarToast('❌ Error de conexión.', 3500, 'err'));
        });
      };

      // Botón Agregar al carro
      const addBtn = card.querySelector('button.card-add-cart');
      if (addBtn) addBtn.onclick = e => {
        e.stopPropagation();
        const pid = parseInt(addBtn.dataset.pid);
        if (!pid) { window.mostrarToast && window.mostrarToast('Producto sin ID', 3000, 'err'); return; }
        if (window.Carrito && typeof window.Carrito.agregar === 'function') {
          window.Carrito.agregar(pid, 1, '', addBtn);
        }
      };

      dom.resultsList.appendChild(card);

      if(item.lat && item.lng) {
        const tienePrecioMark = item.precio != null && item.precio > 0;
        const esCombustible = state.mode === 'combustible';
        const fuelLabel = esCombustible && state.fuelType ? state.fuelType : '';
        // Pin coherente con la tarjeta:
        //  · MÁS BARATO  → VERDE   · "🏆 MEJOR PRECIO"  (siempre, manda sobre el violeta)
        //  · MÁS CERCANO → VIOLETA · "📍 MÁS CERCA"     (solo al ordenar por cercanía)
        const destacadoMark = esMejorPrecio || esMasCerca;
        const nearClass = (esMasCerca && !esMejorPrecio) ? ' nearest' : '';
        const cheapestClass = destacadoMark ? ' best-price' + nearClass : '';
        const flagTxt = esMejorPrecio ? '🏆 MEJOR PRECIO' : '📍 MÁS CERCA';
        const flagColor = esMejorPrecio ? '#10b981' : '#8b5cf6';
        const bestFlag = destacadoMark ? `<div class="marker-best-flag${nearClass}">${flagTxt}</div>` : '';

        const markerIcon = L.divIcon({
          className:'',
          html: tienePrecioMark
            ? `<div class="marker-wrap${cheapestClass}">${bestFlag}<div class="marker-precio${cheapestClass}">${fuelLabel?`<span class="mp-fuel">${fuelLabel}</span>`:''}<span>$${item.precio.toLocaleString('es-CL')}</span></div></div>`
            : `<div class="marker-wrap${cheapestClass}">${bestFlag}<div class="marker-comercio${cheapestClass}">${item.nombre.substring(0,14)}</div></div>`,
          iconSize: tienePrecioMark ? [120, destacadoMark ? 56 : 30] : [88, destacadoMark ? 50 : 22],
          iconAnchor: tienePrecioMark ? [60, destacadoMark ? 56 : 30] : [44, destacadoMark ? 50 : 22]
        });
        const popupExtra = tienePrecioMark
          ? `<br><b style="color:#f0b429">$${item.precio.toLocaleString('es-CL')}</b>${item.precioAditivo&&item.precioAditivo!==item.precio?` <span style="color:#00BFFF;font-size:11px">/ con aditivo $${item.precioAditivo.toLocaleString('es-CL')}</span>`:''}${destacadoMark?`<br><span style="color:${flagColor};font-weight:800;font-size:11px">${flagTxt}</span>`:''}`
          : '';
        const marker = L.marker([item.lat, item.lng], {
          icon: markerIcon,
          zIndexOffset: destacadoMark ? 2000 : 0  // Destacado siempre arriba
        });
        const irABtn = (item.lat && item.lng) ? `<br><a href="https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}" target="_blank" rel="noopener" style="display:inline-block;margin-top:7px;background:linear-gradient(135deg,#18C7CE,#0fa3a8);color:#fff;border:none;padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none">🗺️ Ir a</a>` : '';
        marker.bindPopup(`<b>${item.nombre}</b>${item.direccion?'<br><span style="color:#94a3b8;font-size:11px">'+item.direccion+'</span>':''}${popupExtra}${irABtn}`).addTo(markersGroup);
      }
    });

    if(sorted.length && state.gpsActive) {
      try {
        const validos = sorted.filter(i=>i.lat&&i.lng);
        if(validos.length) {
          const bounds = L.latLngBounds(validos.map(i=>[i.lat,i.lng]));
          bounds.extend([state.lat,state.lng]);
          encuadrarMapa(bounds);
        }
      } catch(e){}
    }
  }

  function setStatusBar(msg) {
    // Función deshabilitada: el statusBar está oculto del UI.
    // La info útil (conteo + radio) está ahora en el título y badge del panel.
    // (Logging opcional a console para debug)
    // console.log('[statusBar]', msg);
  }
  // ═══ GAMIFICACIÓN — conectada al backend (Fase 1) ═══
  const NIVELES_INFO = [
    { nivel:1, nombre:'Explorador Novato',  emoji:'🟢', color:'#22c55e', habilidades:['🔍 Búsqueda de productos y comercios','📍 GPS y mapa en tiempo real','📷 Registrar visita con QR','🔔 Avisos y notificaciones','🎙️ Lila: saludo e información','⚙️ Calibrar Lila'] },
    { nivel:2, nombre:'Rastreador Experto', emoji:'🟡', color:'#eab308', habilidades:['📱 WhatsApp e Instagram del comercio','📝 Reportar precios','🛒 Carrito de compras','❤️ Favoritos (hasta 3)','🧾 Mis compras (últimas 3)','🎙️ Lila: búsqueda por voz','🐾 Registrar paseador/cuidador'] },
    { nivel:3, nombre:'Cazador de Precios', emoji:'🟠', color:'#f97316', habilidades:['❤️ Favoritos ilimitados','🧾 Todas mis compras','📊 Historial de precios','🔔 Alertas de precio','⭐ Reseñas de comercios','🎙️ Lila al 100% con búsqueda progresiva'] },
  ];
  let gamifEstado = null;

  async function cargarGamificacion() {
    const uid = window.usuarioActivo;
    if (!uid) return;
    try {
      const r = await fetch('/api/gamificacion/' + uid, { credentials: 'same-origin' });
      const data = await r.json();
      if (data && data.success) {
        gamifEstado = data;
        window.gamifEstado = data;
        state.puntos = data.puntos;
        localStorage.setItem('mercadate_pts', data.puntos);
        document.getElementById('puntosCount').innerText = data.puntos;
        // Color del dot según nivel
        const dot = document.getElementById('pbNivelDot');
        if (dot) dot.style.background = data.nivel_color || '#22c55e';
        try { window._refreshDesafios && window._refreshDesafios(); } catch (_) {}
      }
    } catch(e) { /* offline: mantener localStorage */ }
  }

  function abrirNivelPopup() {
    const popup = document.getElementById('nivelPopup');
    if (!popup) { alert('No se encontró el panel de nivel'); return; }
    // Mostrar PRIMERO — así abre aunque el relleno falle
    popup.style.display = 'block';
    try {
      const est = gamifEstado || { puntos: state.puntos || 0, nivel: 1, nivel_nombre:'Explorador Novato',
        nivel_color:'#22c55e', progreso_pct: 0, siguiente_nivel:'Rastreador Experto',
        puntos_para_siguiente: 101 - (state.puntos||0), puntos_hoy: 0, limite_diario: 50 };

      const info = NIVELES_INFO[(est.nivel || 1) - 1] || NIVELES_INFO[0];
      const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
      const badge = document.getElementById('npNivelBadge');
      if (badge) { badge.textContent = info.emoji; badge.style.background = info.color + '22'; }
      const nom = document.getElementById('npNivelNombre');
      if (nom) { nom.textContent = est.nivel_nombre || info.nombre; nom.style.color = info.color; }
      set('npPuntos', (est.puntos||0).toLocaleString('es-CL') + ' puntos');

      const fill = document.getElementById('npProgressFill');
      if (fill) { fill.style.width = (est.progreso_pct || 0) + '%'; fill.style.background = info.color; }
      set('npProgressText', est.siguiente_nivel
        ? `${est.puntos_para_siguiente} pts para ${est.siguiente_nivel}`
        : '¡Nivel máximo alcanzado! 🎉');

      const daily = document.getElementById('npDaily');
      if (daily) daily.innerHTML = `<span>Hoy: <strong>${est.puntos_hoy||0}</strong> / ${est.limite_diario||50} pts</span>`;

      const ab = document.getElementById('npAbilities');
      if (ab) ab.innerHTML = `<div class="np-ab-title">Habilidades de ${info.nombre}</div>` +
        (info.habilidades||[]).map(h => `<div class="np-ab-item">${h}</div>`).join('');
    } catch (e) { /* el popup ya está visible; ignorar errores de relleno */ }
  }
  window.abrirNivelPopup = abrirNivelPopup;

  function cerrarNivelPopup() {
    const popup = document.getElementById('nivelPopup');
    if (popup) popup.style.display = 'none';
  }
  window.cerrarNivelPopup = cerrarNivelPopup;
  window.actualizarPersonajeUsuario = function() {
    if (!userMarker || !map) return;
    userMarker.setIcon(crearIconoUsuario());
    const pj = getPersonajeUsuario();
    const _fotoU = (window.auth && auth.getUser && auth.getUser()?.avatar_url || '');
    const _updAvatar = (_fotoU.startsWith('data:image') || _fotoU.startsWith('http'))
      ? `<img src="${_fotoU}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:3px solid ${pj.color};margin-bottom:4px" referrerpolicy="no-referrer">`
      : `<div style="font-size:36px;line-height:1;margin-bottom:4px">${pj.emoji}</div>`;
    userMarker.setPopupContent(`<div style="text-align:center;font-family:'DM Sans',sans-serif">${_updAvatar}<b style="color:${pj.color}">${pj.nombre}</b><br><span style="font-size:11px;color:#94a3b8">Nivel ${pj.nivel} · Tú estás aquí</span></div>`);
  };

  function sumarPuntos(n) {
    // Actualización optimista local + refresco real del backend
    state.puntos += n;
    localStorage.setItem('mercadate_pts', state.puntos);
    document.getElementById('puntosCount').innerText = state.puntos;
    // Refrescar estado real desde el servidor (incluye nivel y límite diario)
    cargarGamificacion();
  }

  // ═══════════════════════════════════════════════════════════════════
  // CALIFICACIÓN DE APP — popup por nivel + tiempo
  // ═══════════════════════════════════════════════════════════════════
  let _ratingNivelActual = null;
  let _ratingEstrellas = 0;

  function _verificarRatingPopup() {
    const u = (window.auth && auth.getUser) ? auth.getUser() : null;
    if (!u || !_lilaHabilitada()) return;
    const nivel = u.nivel || 1;
    const msPasados = u.fecha_registro ? Date.now() - new Date(u.fecha_registro).getTime() : 0;
    const diasPasados = msPasados / (1000 * 60 * 60 * 24);

    // Verificar si fue pospuesto recientemente (3 días de gracia)
    const pospuesto = parseInt(localStorage.getItem('md_rating_posponer') || '0');
    if (pospuesto && Date.now() < pospuesto) return;

    // Disparador 1: nivel 1 + 7 días de uso
    if (nivel === 1 && diasPasados >= 7 && !localStorage.getItem('md_rating_n1_done')) {
      setTimeout(() => _mostrarRatingPopup(1, '¿Cómo va tu primera semana?', 'Llevas 7 días usando MercaDate'), 3000);
      return;
    }
    // Disparador 2: nivel 2 + usó alguna habilidad del nivel
    if (nivel >= 2 && localStorage.getItem('md_hab_n2') && !localStorage.getItem('md_rating_n2_done')) {
      setTimeout(() => _mostrarRatingPopup(2, '¡Subiste de nivel!', 'Ya estás usando las funciones de Rastreador Experto'), 3000);
      return;
    }
    // Disparador 3: nivel 3 + usó alguna habilidad del nivel
    if (nivel >= 3 && localStorage.getItem('md_hab_n3') && !localStorage.getItem('md_rating_n3_done')) {
      setTimeout(() => _mostrarRatingPopup(3, '¡Cazador de Precios!', 'Ya tenés acceso a todas las funciones'), 3000);
    }
  }

  function _mostrarRatingPopup(nivel, titulo, subtitulo) {
    const popup = document.getElementById('ratingPopup');
    if (!popup) return;
    _ratingNivelActual = nivel;
    _ratingEstrellas = 0;
    const t = document.getElementById('ratingPopupTitulo');
    const s = document.getElementById('ratingPopupSub');
    const c = document.getElementById('ratingComentario');
    if (t) t.textContent = titulo;
    if (s) s.textContent = subtitulo;
    if (c) c.value = '';
    // Reset estrellas
    document.querySelectorAll('.rating-star').forEach(st => st.style.opacity = '0.4');
    popup.style.display = 'flex';
    if (window._voiceAssistant && window._voiceAssistant.hablar) {
      setTimeout(() => window._voiceAssistant.hablar('Hola! ¿Podés calificar tu experiencia con MercaDate? Solo tarda un momento.'), 500);
    }
  }

  window._cerrarRating = function(posponer) {
    const popup = document.getElementById('ratingPopup');
    if (popup) popup.style.display = 'none';
    if (posponer) localStorage.setItem('md_rating_posponer', String(Date.now() + 3 * 24 * 60 * 60 * 1000));
  };

  window._enviarRating = async function() {
    if (!_ratingEstrellas) return mostrarToast('Seleccioná al menos una estrella', 2500, 'err');
    const comentario = (document.getElementById('ratingComentario')?.value || '').trim();
    if (comentario.length < 3) return mostrarToast('Agregá un comentario breve', 2500, 'err');
    const u = (window.auth && auth.getUser) ? auth.getUser() : null;
    if (!u) return;
    const contexto = ['App - Nivel 1 (7 días)', 'App - Nivel 2 (Rastreador)', 'App - Nivel 3 (Cazador)'][(_ratingNivelActual || 1) - 1];
    try {
      await fetch('/api/reviews', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: u.id, user_nombre: u.nombre || u.username, rating: _ratingEstrellas, titulo: contexto, comentario })
      });
      localStorage.setItem('md_rating_n' + _ratingNivelActual + '_done', '1');
      window._cerrarRating(false);
      mostrarToast('🙌 ¡Gracias por tu calificación!', 3000, 'ok');
    } catch (_) { mostrarToast('Error al enviar. Reintenta.', 2500, 'err'); }
  };

  // Marcar que el usuario usó una habilidad de su nivel
  // DEV: resetear usuario a estado nuevo (solo localhost)
  window._devResetUsuario = async function() {
    if (!location.hostname.includes('localhost') && !location.hostname.includes('127.0.0.1')) return;
    if (!confirm('¿Resetear usuario a estado nuevo? (puntos, favoritos, alertas)')) return;
    const r = await fetch('/api/dev/reset-usuario', { method:'POST', credentials:'same-origin' }).then(r=>r.json());
    if (r.success) {
      // Limpiar localStorage de rating/periodo
      ['md_rating_n1_done','md_rating_n2_done','md_rating_n3_done','md_hab_n2','md_hab_n3',
       'md_rating_posponer','mercadate_periodo_libre_anunciado','mercadate_periodo_exp_visto'].forEach(k => localStorage.removeItem(k));
      mostrarToast('✅ Usuario reseteado. Recargando…', 2000, 'ok');
      setTimeout(() => location.reload(), 2000);
    }
  };

  window._marcarHabilidadUsada = function(nivel) {
    localStorage.setItem('md_hab_n' + nivel, '1');
    // Verificar si corresponde mostrar el popup ahora
    setTimeout(_verificarRatingPopup, 500);
  };

  // Estrellas interactivas
  document.addEventListener('click', e => {
    if (!e.target.classList.contains('rating-star')) return;
    _ratingEstrellas = parseInt(e.target.dataset.v || '0');
    document.querySelectorAll('.rating-star').forEach(st => {
      st.style.opacity = parseInt(st.dataset.v) <= _ratingEstrellas ? '1' : '0.3';
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // FASE 3 — Escáner QR + validación geográfica (≤150m)
  // ═══════════════════════════════════════════════════════════════════
  const DISTANCIA_MAX_VISITA = 150; // metros (rango 100-150 del reporte)
  let _qrScanner = null;
  let _visitaLocal = null;

  function abrirEscanerQR() {
    if (!window.usuarioActivo) {
      window.mostrarToast ? window.mostrarToast('Inicia sesión para registrar visitas', 3000, 'err') : alert('Inicia sesión primero');
      return;
    }
    const overlay = document.getElementById('qrScanOverlay');
    overlay.style.display = 'block';
    // Reset pasos
    document.getElementById('qrStep1').style.display = 'block';
    document.getElementById('qrStep2').style.display = 'none';
    document.getElementById('qrStep3').style.display = 'none';
    document.getElementById('qrScanHint').textContent = 'Esperando permiso de cámara…';

    if (typeof Html5Qrcode === 'undefined') {
      document.getElementById('qrScanHint').textContent = '⚠️ La librería de escaneo no cargó. Recarga la página.';
      return;
    }

    _qrScanner = new Html5Qrcode('qrReader');
    _qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      onQrDetectado,
      () => {} // ignorar errores de frame
    ).then(() => {
      document.getElementById('qrScanHint').textContent = 'Apunta al código QR del local';
    }).catch(err => {
      document.getElementById('qrScanHint').textContent = '⚠️ No se pudo acceder a la cámara. Revisa los permisos.';
    });
  }
  window.abrirEscanerQR = abrirEscanerQR;

  function cerrarEscanerQR() {
    const overlay = document.getElementById('qrScanOverlay');
    if (_qrScanner) {
      _qrScanner.stop().then(() => { _qrScanner.clear(); _qrScanner = null; }).catch(() => { _qrScanner = null; });
    }
    // Detener también la cámara de la boleta si quedó abierta
    if (typeof cerrarCamaraBoleta === 'function') {
      try { cerrarCamaraBoleta(); } catch(e) {}
    }
    overlay.style.display = 'none';
  }
  window.cerrarEscanerQR = cerrarEscanerQR;

  async function onQrDetectado(texto) {
    // Detener cámara apenas se detecta
    if (_qrScanner) {
      try { await _qrScanner.stop(); _qrScanner.clear(); } catch(e) {}
      _qrScanner = null;
    }
    // Parsear: geo-precio://registrar?local=123
    const m = String(texto).match(/local=(\d+)/);
    if (!m) {
      mostrarResultadoQR(false, '❌', 'Código no válido', 'Este QR no corresponde a un local de MercaDate.');
      return;
    }
    const localId = parseInt(m[1]);
    // Paso 2: validando
    document.getElementById('qrStep1').style.display = 'none';
    document.getElementById('qrStep2').style.display = 'block';

    try {
      // Cargar datos del local
      const r = await fetch('/api/local/' + localId);
      const data = await r.json();
      if (!data.success || !data.local) {
        mostrarResultadoQR(false, '❌', 'Local no encontrado', 'No pudimos cargar los datos de este local.');
        return;
      }
      _visitaLocal = data.local;

      if (!_visitaLocal.lat || !_visitaLocal.lng) {
        mostrarResultadoQR(false, '⚠️', 'Local sin ubicación', 'Este local aún no tiene coordenadas GPS registradas.');
        return;
      }

      // Capturar GPS del usuario
      document.getElementById('qrValidSub').textContent = 'Obteniendo tu ubicación…';
      navigator.geolocation.getCurrentPosition(
        pos => {
          const ulat = pos.coords.latitude, ulng = pos.coords.longitude;
          const dist = Math.round(calcularDistancia(ulat, ulng, parseFloat(_visitaLocal.lat), parseFloat(_visitaLocal.lng)));
          _visitaLocal._userLat = ulat;
          _visitaLocal._userLng = ulng;
          _visitaLocal._distancia = dist;

          if (dist <= DISTANCIA_MAX_VISITA) {
            mostrarResultadoQR(true, '✅', '¡Estás en el local!',
              `Validado a ${dist}m de distancia. Ya puedes registrar tu compra.`);
          } else {
            mostrarResultadoQR(false, '📍', 'Estás muy lejos',
              `Debes estar presente en el local para registrar la visita. Estás a ${dist >= 1000 ? (dist/1000).toFixed(1)+'km' : dist+'m'} (máximo ${DISTANCIA_MAX_VISITA}m).`);
          }
        },
        () => {
          mostrarResultadoQR(false, '📡', 'GPS no disponible',
            'Necesitamos tu ubicación para validar que estás en el local. Activa el GPS e intenta de nuevo.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } catch (e) {
      mostrarResultadoQR(false, '❌', 'Error de conexión', 'No pudimos validar la visita. Intenta nuevamente.');
    }
  }

  function mostrarResultadoQR(exito, icono, titulo, subtitulo) {
    document.getElementById('qrStep1').style.display = 'none';
    document.getElementById('qrStep2').style.display = 'none';
    document.getElementById('qrStep3').style.display = 'block';
    document.getElementById('qrResultIcon').textContent = icono;
    document.getElementById('qrResultIcon').className = 'qr-result-icon ' + (exito ? 'ok' : 'err');
    document.getElementById('qrResultTitle').textContent = titulo;
    document.getElementById('qrResultSub').textContent = subtitulo;

    const infoEl = document.getElementById('qrLocalInfo');
    if (_visitaLocal && (exito || _visitaLocal._distancia != null)) {
      infoEl.innerHTML = `
        <div class="qr-li-nombre">${_visitaLocal.comercio_nombre || _visitaLocal.nombre || ''}</div>
        <div class="qr-li-dir">${_visitaLocal.direccion || _visitaLocal.comuna || ''}</div>`;
      infoEl.style.display = 'block';
    } else {
      infoEl.style.display = 'none';
    }

    const actions = document.getElementById('qrResultActions');
    if (exito) {
      // Paso siguiente: escanear la boleta (Fase 4)
      actions.innerHTML = `
        <button class="qr-btn-primary" onclick="irACapturaBoleta()">🧾 Escanear boleta</button>
        <button class="qr-btn-ghost" onclick="cerrarEscanerQR()">Cancelar</button>`;
    } else {
      actions.innerHTML = `
        <button class="qr-btn-primary" onclick="abrirEscanerQR()">🔄 Reintentar</button>
        <button class="qr-btn-ghost" onclick="cerrarEscanerQR()">Cerrar</button>`;
    }
  }

  function _mostrarPaso(n) {
    [1,2,3,4,5].forEach(i => {
      const el = document.getElementById('qrStep' + i);
      if (el) el.style.display = (i === n) ? 'block' : 'none';
    });
  }

  function irACapturaBoleta() {
    _mostrarPaso(4);
    document.getElementById('ocrProgress').style.display = 'none';
  }
  window.irACapturaBoleta = irACapturaBoleta;

  // ── Captura de boleta: cámara en vivo o archivo ──────────────────
  let _boletaStream = null;

  async function abrirCamaraBoleta() {
    const metodos = document.getElementById('boletaMetodos');
    const camView = document.getElementById('boletaCamView');
    const video = document.getElementById('boletaVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.mostrarToast && window.mostrarToast('Tu navegador no permite cámara. Usa "Buscar archivo".', 3500, 'err');
      return;
    }
    metodos.style.display = 'none';
    camView.style.display = 'block';
    try {
      _boletaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false
      });
      video.srcObject = _boletaStream;
      await video.play();
    } catch (e) {
      cerrarCamaraBoleta();
      window.mostrarToast && window.mostrarToast('No se pudo abrir la cámara. Usa "Buscar archivo" o ingresa manual.', 4000, 'err');
    }
  }
  window.abrirCamaraBoleta = abrirCamaraBoleta;

  function cerrarCamaraBoleta() {
    if (_boletaStream) { _boletaStream.getTracks().forEach(t => t.stop()); _boletaStream = null; }
    const video = document.getElementById('boletaVideo');
    if (video) video.srcObject = null;
    const camView = document.getElementById('boletaCamView');
    const metodos = document.getElementById('boletaMetodos');
    if (camView) camView.style.display = 'none';
    if (metodos) metodos.style.display = 'flex';
  }
  window.cerrarCamaraBoleta = cerrarCamaraBoleta;

  function capturarFotoBoleta() {
    const video = document.getElementById('boletaVideo');
    const canvas = document.getElementById('boletaCanvas');
    if (!video || !video.videoWidth) {
      window.mostrarToast && window.mostrarToast('La cámara aún no está lista', 2500, 'err');
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    cerrarCamaraBoleta(); // detiene el stream
    canvas.toBlob(blob => {
      if (blob) _ejecutarOCR(blob);
    }, 'image/jpeg', 0.92);
  }
  window.capturarFotoBoleta = capturarFotoBoleta;

  // Desde input de archivo
  function procesarBoleta(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    _ejecutarOCR(file);
  }
  window.procesarBoleta = procesarBoleta;

  // OCR compartido (recibe File o Blob). La imagen NO se sube ni guarda.
  async function _ejecutarOCR(imageSource) {
    const metodos = document.getElementById('boletaMetodos');
    if (metodos) metodos.style.display = 'none';

    if (typeof Tesseract === 'undefined') {
      window.mostrarToast && window.mostrarToast('OCR no disponible, ingresa manual', 3000, 'err');
      mostrarFormularioBoleta(null);
      return;
    }

    document.getElementById('ocrProgress').style.display = 'block';
    document.getElementById('ocrProgressText').textContent = 'Leyendo boleta… 0%';

    try {
      const { data } = await Tesseract.recognize(imageSource, 'spa', {
        logger: m => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            document.getElementById('ocrProgressText').textContent = `Leyendo boleta… ${pct}%`;
          }
        }
      });
      const extraido = parsearTextoBoleta(data.text || '');
      mostrarFormularioBoleta(extraido);
    } catch (e) {
      window.mostrarToast && window.mostrarToast('No se pudo leer la boleta, ingresa manual', 3000, 'err');
      mostrarFormularioBoleta(null);
    }
  }

  // Parser por regex de los campos típicos de una boleta chilena
  function parsearTextoBoleta(texto) {
    const t = texto.replace(/\n+/g, '\n');
    const out = { rut: '', boleta: '', monto: '', fecha: '' };

    // RUT: 12.345.678-9 (con o sin puntos)
    const rutMatch = t.match(/(\d{1,2}\.?\d{3}\.?\d{3}\s*-\s*[\dkK])/);
    if (rutMatch) out.rut = rutMatch[1].replace(/\s/g, '');

    // N° boleta: "BOLETA N° 123", "BOLETA 123", "N° 123", "FOLIO 123"
    const boletaMatch = t.match(/(?:boleta|folio|n[°ºo]\.?)\s*[:#]?\s*(\d{2,12})/i);
    if (boletaMatch) out.boleta = boletaMatch[1];

    // Monto TOTAL: busca "TOTAL" seguido de número, o el mayor monto con $
    let monto = null;
    const totalMatch = t.match(/total\s*[:$]?\s*\$?\s*([\d.\s]{3,12})/i);
    if (totalMatch) {
      monto = parseInt(totalMatch[1].replace(/[.\s]/g, ''));
    }
    if (!monto || isNaN(monto)) {
      // Fallback: el mayor número con formato de precio en el texto
      const montos = (t.match(/\$\s*([\d.]{3,12})/g) || [])
        .map(s => parseInt(s.replace(/[^\d]/g, '')))
        .filter(n => !isNaN(n) && n > 0);
      if (montos.length) monto = Math.max(...montos);
    }
    if (monto && !isNaN(monto)) out.monto = monto;

    // Fecha: dd/mm/yyyy o dd-mm-yyyy
    const fechaMatch = t.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (fechaMatch) {
      let [, d, mo, y] = fechaMatch;
      if (y.length === 2) y = '20' + y;
      out.fecha = `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    return out;
  }

  function mostrarFormularioBoleta(extraido) {
    _mostrarPaso(5);
    const aviso = document.getElementById('ocrAviso');
    if (extraido) {
      const leidos = Object.values(extraido).filter(Boolean).length;
      aviso.textContent = leidos
        ? `Leímos ${leidos} dato${leidos!==1?'s':''}. Revisa y corrige si algo quedó mal.`
        : 'No pudimos leer la boleta automáticamente. Ingresa los datos a mano.';
    } else {
      aviso.textContent = 'Ingresa los datos de tu boleta.';
    }
    // Prellenar
    document.getElementById('bf_rut').value    = extraido?.rut || '';
    document.getElementById('bf_boleta').value = extraido?.boleta || '';
    document.getElementById('bf_monto').value  = extraido?.monto || '';
    document.getElementById('bf_fecha').value  = extraido?.fecha || new Date().toISOString().slice(0,10);
    document.getElementById('bf_validacion').style.display = 'none';
  }
  window.mostrarFormularioBoleta = mostrarFormularioBoleta;

  // Validar contra el local + registrar transacción
  async function enviarBoleta() {
    if (!_visitaLocal) return;
    const rut    = document.getElementById('bf_rut').value.trim();
    const boleta = document.getElementById('bf_boleta').value.trim();
    const monto  = parseInt(document.getElementById('bf_monto').value) || null;
    const fecha  = document.getElementById('bf_fecha').value;

    if (!boleta) { mostrarValidacionBoleta('Ingresa el número de boleta', false); return; }

    // Validar coincidencia RUT vs local (si el local tiene RUT registrado)
    let validRut = 0, validDir = 0;
    if (rut && _visitaLocal.rut) {
      try {
        const rv = await fetch('/api/transacciones/validar', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ local_id:_visitaLocal.id, rut, direccion:'', nombre:'' })
        });
        const vd = await rv.json();
        validRut = vd.validacion_rut || 0;
        validDir = vd.validacion_direccion || 0;
        if (!vd.valido) {
          mostrarValidacionBoleta('⚠️ ' + (vd.motivo || 'El RUT no coincide con el local') + '. Verifica los datos.', false);
          return;
        }
      } catch(e) { /* si falla la validación, continuar — el admin revisará */ }
    }

    // Registrar transacción
    try {
      const r = await fetch('/api/transacciones', {
        method:'POST', headers:{'Content-Type':'application/json'}, credentials: 'same-origin',
        body: JSON.stringify({
          user_id: window.usuarioActivo,
          local_id: _visitaLocal.id,
          ubicacion_usuario_lat: _visitaLocal._userLat,
          ubicacion_usuario_lng: _visitaLocal._userLng,
          distancia_verificada: _visitaLocal._distancia,
          numero_boleta: boleta,
          fecha_hora_compra: fecha ? fecha + 'T12:00:00' : new Date().toISOString(),
          monto_total: monto,
          validacion_rut: validRut,
          validacion_direccion: validDir
        })
      });
      const data = await r.json();
      if (data.success) {
        const pts = data.puntos && data.puntos.otorgados ? data.puntos.otorgados : 0;
        mostrarResultadoQR(true, '🎉', '¡Compra registrada!',
          pts ? `Ganaste +${pts} puntos.` : 'Tu compra quedó registrada.');
        document.getElementById('qrResultActions').innerHTML =
          `<button class="qr-btn-primary" onclick="cerrarEscanerQR()">Listo</button>`;
        sumarPuntos(0); // refrescar badge real
        if (data.puntos && data.puntos.subioNivel) {
          // Actualizar usuario local con el nuevo nivel
          const u = auth.getUser();
          if (u && data.puntos.nivel) {
            u.nivel = data.puntos.nivel.nivel;
            auth.saveUser ? auth.saveUser(u) : localStorage.setItem('mercadate_user', JSON.stringify(u));
          }
          if (window.actualizarPersonajeUsuario) window.actualizarPersonajeUsuario();
          setTimeout(() => alert('🆙 ¡Subiste a nivel ' + data.puntos.nivel.nombre + '! Tu personaje en el mapa evolucionó.'), 600);
        }
      } else if (data.duplicado) {
        mostrarValidacionBoleta('🔁 Esta boleta ya fue registrada antes.', false);
      } else {
        mostrarValidacionBoleta('❌ ' + (data.message || 'No se pudo registrar'), false);
      }
    } catch (e) {
      mostrarValidacionBoleta('❌ Error de conexión', false);
    }
  }
  window.enviarBoleta = enviarBoleta;

  function mostrarValidacionBoleta(msg, ok) {
    const el = document.getElementById('bf_validacion');
    el.textContent = msg;
    el.className = 'qr-valid-msg ' + (ok ? 'ok' : 'err');
    el.style.display = 'block';
  }

  // ── HISTORIAL DE BÚSQUEDA ────────────────────────────────────────────────
  const HIST_KEY = 'mercadate_search_hist';
  const HIST_MAX = 8;

  function historialGuardar(texto) {
    if (!texto || texto.length < 2) return;
    let hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    hist = [texto, ...hist.filter(h => h !== texto)].slice(0, HIST_MAX);
    localStorage.setItem(HIST_KEY, JSON.stringify(hist));
  }

  function historialMostrar() {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    if (!hist.length) return;
    let dd = document.getElementById('searchHistDd');
    if (!dd) {
      dd = document.createElement('div');
      dd.id = 'searchHistDd';
      dd.className = 'search-history-dropdown';
      dom.productoInput.parentNode.style.position = 'relative';
      dom.productoInput.parentNode.appendChild(dd);
    }
    dd.innerHTML = hist.map(h => `<div class="sh-item" onclick="document.getElementById('productoInput').value=${JSON.stringify(h)};document.getElementById('searchHistDd').classList.remove('open');buscarDesdeHistorial()"><span class="sh-item-icon">🕐</span>${h}</div>`).join('')
      + `<div class="sh-clear" onclick="localStorage.removeItem('${HIST_KEY}');document.getElementById('searchHistDd').classList.remove('open')">✕ Limpiar historial</div>`;
    dd.classList.add('open');
  }

  function historialOcultar() {
    const dd = document.getElementById('searchHistDd');
    if (dd) setTimeout(() => dd.classList.remove('open'), 150);
  }

  window.buscarDesdeHistorial = function() {
    if (window._buscarVoz) return window._buscarVoz();
    buscar();
  };

  // ═══ ASISTENTE DE VOZ CONVERSACIONAL ════════════════════════════════════
  window._voiceAssistant = (function() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const SYNTH = window.speechSynthesis;
    // Sin SpeechRecognition: creamos un objeto mínimo que puede saludar por TTS
    // pero no escuchar. El botón de voz se mostrará con aviso al tocarlo.
    if (!SpeechRec) {
      return {
        iniciarConSaludo() {
          const hora = new Date().getHours();
          const saludo = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
          let nombre = '';
          try { const u = window.usuarioActual; const n = u && (u.nombre || u.username); if (n) nombre = ', ' + String(n).trim().split(/\s+/)[0]; } catch (_) {}
          if (window.VozMercaDate && window.VozMercaDate.hablar) window.VozMercaDate.hablar(saludo + nombre + '. Soy Lila. El reconocimiento de voz no está disponible, pero puedes buscar escribiendo.');
        },
        desactivarSiempre() {},
        activarUnaVez() { if (window.mostrarToast) window.mostrarToast('El reconocimiento de voz no está disponible en este navegador o conexión.', 4000, 'warn'); },
        iniciarSiempre() {},
        pausar() {},
        reanudar() {},
        procesarComando() {},
      };
    }

    const WAKE_WORDS = ['lila','oye lila','hola lila','hey lila','mercadate','merca date','oye merca','hola merca'];
    let _rec = null, _siempreActivo = false, _estado = 'IDLE';
    let _resultadoIndex = 0, _timeoutCmd = null;
    let _hablando = false;   // mic en pausa mientras el asistente habla (evita auto-escucha)
    let _hablandoDesde = 0;  // timestamp en que empezó a hablar (para el heartbeat de rescate)
    let _pausadoExterno = false; // pausado por calibración ("modo entrenamiento")
    let _reanudarT = null;   // timer para reanudar el mic tras hablar
    let _sinConexion = false; // true si el reconocimiento falla por red/servicio (reintento lento)

    // ── CSS para el indicador flotante ──
    const _cssStyle = document.createElement('style');
    _cssStyle.textContent = `
      @keyframes vring{0%{width:28px;height:28px;opacity:.18}70%{width:54px;height:54px;opacity:0}100%{width:54px;height:54px;opacity:0}}
      #voiceIndicator{position:fixed;right:76px;bottom:100px;z-index:9100;display:none;flex-direction:column;align-items:center;gap:6px;
        background:var(--surface,rgba(11,17,32,.95));border:1px solid rgba(242,185,69,.45);border-radius:18px;
        padding:22px 16px 14px;box-shadow:0 8px 36px rgba(0,0,0,.55);backdrop-filter:blur(10px);min-width:175px}
      #voiceIndicator.active{border-color:rgba(34,197,94,.6)}
      .vring-el{position:absolute;border-radius:50%;background:#F2B945;animation:vring 1.6s ease infinite}
      .vring-el:nth-child(2){animation-delay:.55s;opacity:.1}
      #voiceIndicator.active .vring-el{background:#22c55e;animation-duration:.85s}
      #voiceIndicator.idle .vring-el{background:#64748b;animation-duration:2.5s}
    `;
    document.head.appendChild(_cssStyle);

    function _crearIndicador() {
      if (document.getElementById('voiceIndicator')) return;
      const el = document.createElement('div');
      el.id = 'voiceIndicator';
      el.innerHTML = `
        <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center">
          <div class="vring-el" style="width:28px;height:28px"></div>
          <div class="vring-el" style="width:28px;height:28px"></div>
          <div id="voiceOrb" style="width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:15px;position:relative;z-index:1">🎙️</div>
        </div>
        <div id="voiceStatus" style="font-size:12px;font-weight:600;color:#e2e8f0;text-align:center">Escuchando…</div>
        <div id="voiceTranscript" style="font-size:11px;color:#a855f7;text-align:center;min-height:15px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>
        <button id="btnVozPrueba" onclick="window._lilaProbarVoz()" style="background:none;border:1px solid rgba(168,85,247,.5);color:#c4b5fd;border-radius:8px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:inherit;margin-top:2px">🎤 Probá tu voz</button>`;
      document.body.appendChild(el);
      // Ocultar "Probá tu voz" si ya fue usado (solo aparece en Configuración)
      if (localStorage.getItem('md_voz_probada') === '1') {
        const bp = el.querySelector('#btnVozPrueba');
        if (bp) bp.style.display = 'none';
      }
    }

    function _mostrarIndicador(estado, texto, transcript) {
      _crearIndicador();
      const el = document.getElementById('voiceIndicator');
      if (!el) return;
      el.className = estado;
      // Respetar ocultamiento manual: si el usuario escondió la burbuja (FAB / toggle),
      // Lila sigue activa y actualiza contenido, pero NO la vuelve a mostrar sola.
      if (!window._lilaManualHidden) el.style.display = 'flex';
      const orb = document.getElementById('voiceOrb');
      if (orb) orb.style.background = estado === 'active' ? 'linear-gradient(135deg,#22c55e,#16a34a)' : estado === 'idle' ? 'linear-gradient(135deg,#475569,#334155)' : 'linear-gradient(135deg,#a855f7,#7c3aed)';
      const st = document.getElementById('voiceStatus');
      const tr = document.getElementById('voiceTranscript');
      if (st) st.textContent = texto || 'Escuchando…';
      if (tr) tr.textContent = transcript || '';
    }

    function _ocultarIndicador() {
      const el = document.getElementById('voiceIndicator');
      if (el) el.style.display = 'none';
    }

    function _chime(freq1, freq2) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq1 || 660, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq2 || 900, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
      } catch(_) {}
    }

    function _hablar(texto, onEnd) {
      // Apagar el micrófono ANTES de hablar para no escucharse a sí mismo.
      _hablando = true;
      _hablandoDesde = Date.now();
      clearTimeout(_reanudarT);
      _stopRec();

      // Al terminar de hablar: reanudar la escucha (con un respiro para evitar
      // el eco de la cola del audio) y recién después ejecutar el callback.
      let _finHecho = false;
      // Watchdog LOCAL por llamada (antes era compartido y una llamada nueva
      // pisaba el de la anterior → el mic podía quedar pegado para siempre).
      let _wd = null;
      const fin = () => {
        if (_finHecho) return;           // una sola vez (onend + onerror + watchdog)
        _finHecho = true;
        clearTimeout(_wd);
        _hablando = false;
        if (onEnd) onEnd();              // fija el estado (p.ej. _esperarComando → ACTIVE)
        if (_siempreActivo && _estado !== 'IDLE') {
          clearTimeout(_reanudarT);
          // Respiro generoso para no captar la cola/eco del audio al reabrir el mic.
          _reanudarT = setTimeout(() => { if (_siempreActivo && !_hablando && !_pausadoExterno) _arrancarRec(); }, 450);
        }
      };

      // WATCHDOG = BACKSTOP LARGO (45s). La voz neuronal tarda en GENERARSE
      // antes de sonar; un watchdog corto reencendía el mic mientras todavía
      // hablaba → se escuchaba a sí mismo y entraba en bucle. La finalización
      // normal la dan audio.onended (neuronal) o el watchdog interno de la voz
      // del sistema. Esto es solo por si NADA avisa el fin.
      _wd = setTimeout(fin, 45000);

      // Voz propia de MercaDate (motor neuronal embebido). Cae sola a la del
      // sistema si el modelo aún no cargó o el equipo no lo soporta.
      if (window.VozMercaDate && window.VozMercaDate.hablar) {
        window.VozMercaDate.hablar(texto, fin);
        return;
      }
      if (!SYNTH) { fin(); return; }
      SYNTH.cancel();
      const utt = new SpeechSynthesisUtterance(texto);
      utt.lang = 'es-MX'; utt.rate = 1.25; utt.pitch = 1;
      const voces = SYNTH.getVoices();
      const voz = voces.find(v => v.lang.startsWith('es') && v.localService) || voces.find(v => v.lang.startsWith('es'));
      if (voz) utt.voice = voz;
      utt.onend = fin;
      utt.onerror = fin;
      SYNTH.speak(utt);
    }

    function _esperarComando(ms) {
      clearTimeout(_timeoutCmd);
      _estado = 'ACTIVE';
      _mostrarIndicador('active', 'Te escucho…', '');
      _timeoutCmd = setTimeout(() => {
        if (_estado === 'ACTIVE') { _estado = 'WAKE'; _mostrarIndicador('idle', 'Esperando "Mercadate"…', ''); }
      }, ms || 12000);
    }

    // Frases base del asistente (registro adulto). El admin puede sobrescribir
    // cada una desde Configuración → Asistente de voz (clave → texto). Las {x},
    // {n}, {km}, {res}, {hora} son partes dinámicas que se rellenan al hablar.
    const FRASES_BASE = {
      saludo:         '{hora}{nombre}. Soy Lila, tu asistente de MercaDate. ¿Qué andái buscando?',
      que_buscas:     '¿Qué andái buscando?',
      buscando:       'Ya, buscando {x}',
      encontrados:    'Encontre {n} {res}. Di abrir el primero para ver el mejor resultado.',
      sin_resultados: 'No encontre {x} cerca. Prueba decir amplia la busqueda.',
      resultado_n:    'Resultado {n}',
      abriendo:       'Altiro, te muestro {x}',
      no_pille:       'No pillé ese resultado.',
      cerrar:         'Listo po.',
      orden_precio:   'Listo, de menor a mayor precio.',
      orden_dist:     'Listo, de lo mas cercano primero.',
      compartir:      'Ya, compartiendo.',
      favorito_ok:    'Listo, lo guardé en favoritos.',
      mapa:           'Ya, te abro el mapa.',
      radio_exacto:   'Listo, busco en {km} kilómetros a la redonda.',
      radio_max:      'Ya, lo abro al máximo, {km} kilómetros a la redonda.',
      radio_ampliar:  'Listo, amplío a {km} kilómetros.',
      radio_reducir:  'Ya, lo achico a {km} kilómetros.',
      carrito:        'Ya, te abro el carro.',
      favoritos:      'Acá tenís tus favoritos.',
      compras:        'Ya, te muestro tus compras.',
      cuenta:         'Listo, te abro tu cuenta.',
      escaner:        'Ya, te abro el escáner.',
      nivel:          'Mira, este es tu nivel.',
      gps:            'Listo, te cambié el GPS.',
      inicio:         'Ya, volvamos al inicio.',
      limpiar:        'Ya po, partamos de nuevo. ¿Qué andái buscando?',
      bencina:        'Listo, modo bencina. ¿Qué tipo querís?',
      no_entendi:     'No te caché bien. Probá decir: buscar leche, amplía la búsqueda, más barato, abrir el primero, o abrir el carro.',
      despedida:      'Ya, ¡nos vemos!',
    };
    // Devuelve el texto de una frase: override del admin si existe, si no la base.
    function FRASE(clave, params) {
      const ov = (window.VozMercaDate && window.VozMercaDate.fraseOverride) ? window.VozMercaDate.fraseOverride(clave) : null;
      let t = (ov != null && ov !== '') ? ov : (FRASES_BASE[clave] || '');
      if (params) for (const k in params) t = t.split('{' + k + '}').join(params[k]);
      return t;
    }
    window._FRASES_BASE = FRASES_BASE; // referencia para el admin (lista de claves)

    // Vocabulario para corregir términos de voz: nombres de comercios y productos
    // de lo que está cargado en pantalla (lo que el usuario puede encontrar).
    let _vocabCache = null, _vocabCacheLen = -1;
    function _vocabBusqueda() {
      const coms = state.comercios || [];
      if (_vocabCache && _vocabCacheLen === coms.length) return _vocabCache;
      const set = new Set();
      coms.forEach(co => {
        String(co.nombre || '').toLowerCase().split(/\s+/).forEach(w => { if (w.length >= 3) set.add(w); });
        (co.productos || []).forEach(p => {
          String(p.nombre || '').toLowerCase().split(/\s+/).forEach(w => { if (w.length >= 3) set.add(w); });
        });
      });
      _vocabCache = Array.from(set).slice(0, 4000);
      _vocabCacheLen = coms.length;
      return _vocabCache;
    }

    // ── Helpers de búsqueda por voz ──────────────────────────────────────────
    function _normVoz(s) { return (s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/^(la|el|los|las)\s+/,"").trim(); }
    function _aplicarComunaVoz(nombre) {
      if (!nombre || !dom.comunaSelect) return false;
      const n = _normVoz(nombre);
      const opt = Array.from(dom.comunaSelect.options).find(o => {
        const v = _normVoz(o.value || o.text);
        return v === n || v.startsWith(n) || n.startsWith(v);
      });
      if (opt && opt.value) { dom.comunaSelect.value = opt.value; return true; }
      return false;
    }
    const _CATS_VOZ = [
      { cat: 'restaurante', re: /restaurante?|gastronom|comida|comer|almuerzo|cena|desayuno|picada|fuente de soda|delivery|menú/, nombre: 'gastronomía' },
      { cat: 'farmacia',    re: /farmacia|medicament|remedios?|botica|droguería|pastillas?|analg/,                                  nombre: 'farmacia'    },
      { cat: 'mascota',     re: /mascota|veterinari|paseador|cuidador.{0,10}perro|grooming|peluquería.{0,10}can/,                   nombre: 'mascotas'    },
      { cat: 'servicio',    re: /\bservicio|\bgasfíter|\bgasfiter|\bplomero|\belectricista|\btécnico|\bcerrajero|\bpintor\b/,        nombre: 'servicios'   },
      { cat: 'almacen',     re: /almacén|almacen|\btienda|\bsupermercado|ferretería|minimarket|abarrotes|bazar/,                    nombre: 'productos'   },
    ];

    function _procesarComando(cmd) {
      _estado = 'PROCESSING';
      clearTimeout(_timeoutCmd);
      const c = cmd.toLowerCase().trim();
      // Extraer "en <comuna>" del final del comando
      const _rCom = c.match(/\s+en\s+(?:(?:la|el|los|las)\s+)?(?:comuna\s+(?:de\s+)?)?([a-záéíóúüñ][a-záéíóúüñ\s]{1,25})$/i);
      const _comunaVoz = _rCom ? _rCom[1].trim() : null;
      const _cBase = _comunaVoz ? c.slice(0, c.length - _rCom[0].length).trim() : c;
      try { if (window._ulEvento) window._ulEvento('lila_comando', { c: c.slice(0, 40) }); } catch (_) {}
      _mostrarIndicador('active', 'Procesando…', '"' + cmd.slice(0, 38) + (cmd.length > 38 ? '…' : '') + '"');

      // cancelar
      if (/^(cancela|cancelar|para|stop|no|salir|adiós|adios|chao|bye)/.test(c)) {
        _hablar(FRASE('despedida'), () => { _estado = 'WAKE'; _mostrarIndicador('idle', 'Esperando "Mercadate"…', ''); });
        return;
      }
      // siguiente
      if (/^(siguiente|el siguiente|próximo|proxim|la siguiente)/.test(c)) {
        const items = document.querySelectorAll('.commerce-card, .card-item');
        _resultadoIndex = Math.min(_resultadoIndex + 1, items.length - 1);
        if (items[_resultadoIndex]) items[_resultadoIndex].scrollIntoView({ behavior:'smooth', block:'center' });
        _hablar(FRASE('resultado_n', { n: _resultadoIndex + 1 }), () => _esperarComando());
        return;
      }
      // anterior
      if (/^(anterior|volver|el anterior|atrás|atras)/.test(c)) {
        const items = document.querySelectorAll('.commerce-card, .card-item');
        _resultadoIndex = Math.max(_resultadoIndex - 1, 0);
        if (items[_resultadoIndex]) items[_resultadoIndex].scrollIntoView({ behavior:'smooth', block:'center' });
        _hablar(FRASE('resultado_n', { n: _resultadoIndex + 1 }), () => _esperarComando());
        return;
      }
      // abrir N
      const abrM = c.match(/(?:abr[ie]|abrir|ver|muestra)[\s\w]*?(?:el\s+)?(primer|primero|uno|(\d+))/i);
      if (abrM || /^(primer|primero|número uno|el uno)$/.test(c)) {
        const idx = parseInt(abrM && abrM[2]) - 1 || 0;
        const cards = document.querySelectorAll('.commerce-card, .card-item');
        if (cards[idx]) {
          cards[idx].click();
          const nom = cards[idx].querySelector('[class*="nombre"],[class*="nombre-estacion"],strong')?.textContent?.trim() || 'el resultado';
          _hablar(FRASE('abriendo', { x: nom }), () => _esperarComando());
        } else { _hablar(FRASE('no_pille'), () => _esperarComando()); }
        return;
      }
      // cerrar
      if (/^(cerrar|cierra|vuelve|volver|atrás|atras|regresa)/.test(c)) {
        const btn = document.getElementById('cdpBack');
        if (btn) btn.click();
        _hablar(FRASE('cerrar'), () => _esperarComando());
        return;
      }
      // más barato
      if (/más barat|precio.*bajo|barat|econom|menor precio/.test(c)) {
        if (window._sortResultsByPrice) window._sortResultsByPrice();
        _hablar(FRASE('orden_precio'), () => _esperarComando());
        return;
      }
      // más cerca
      if (/más cerca|cercano|cerquita|distancia/.test(c)) {
        if (window._sortResultsByDistance) window._sortResultsByDistance();
        _hablar(FRASE('orden_dist'), () => _esperarComando());
        return;
      }
      // compartir
      if (/compartir|comparte|mandar|enviar/.test(c)) {
        if (window.compartirComercio) window.compartirComercio();
        _hablar(FRASE('compartir'), () => _esperarComando());
        return;
      }
      // favorito
      if (/favorit|guardar|me gusta/.test(c)) {
        if (window.toggleFavorito) window.toggleFavorito();
        _hablar(FRASE('favorito_ok'), () => _esperarComando());
        return;
      }
      // IR / NAVEGAR al comercio o estación elegido (abre ruta Google Maps/Waze).
      // Variantes: "llévame", "vamos", "cómo llego", "ir a la estación/comercio", "navegar"…
      if (/ll[eé]va(me|nos)|vamos( para| pa)?|c[oó]mo (llego|llegar|voy)|ir a (la |el )?(estaci[oó]n|comercio|tienda|surtidor|local)|ir (para |pa )?all[aá]|navegar|ru?ta( hacia)?|ind[ií]came el camino|quiero ir|ir al comercio|ir a la bomba|ll[eé]vame a/.test(c)) {
        const ok = window._accionApp && window._accionApp('ir');
        _hablar(ok ? 'Ya, te llevo. Abriendo la ruta.' : 'Primero elige un comercio o una estación.', () => _esperarComando());
        return;
      }
      // ACTIVAR / MOSTRAR el mapa (cierra paneles y enfoca el mapa).
      if (/activ.{0,6}(el )?mapa|(mostr|mu[eé]str).{0,10}mapa|ver (el )?mapa|abr[ií].{0,4}(el )?mapa|ir al mapa|volver al mapa|ubicaci[oó]n en el mapa|d[oó]nde queda/.test(c)) {
        const ok = window._accionApp && window._accionApp('mapa');
        _hablar(ok ? 'Ya, te muestro el mapa.' : FRASE('mapa'), () => _esperarComando());
        return;
      }

      // ── RADIO DE BÚSQUEDA ──
      // Radio específico: "busca en 5 kilómetros", "radio de 3 km"
      const mKm = c.match(/(\d+(?:[.,]\d+)?)\s*(kil[oó]met|km)/);
      if (mKm && window._aplicarRadio) {
        const km = window._aplicarRadio({ metros: parseFloat(mKm[1].replace(',', '.')) * 1000 });
        _hablar(FRASE('radio_exacto', { km: km.toFixed(1).replace('.0', '') }), () => _esperarComando());
        return;
      }
      // Máximo / toda la ciudad
      if (/toda la (ciudad|zona|región|region)|al máximo|al maximo|lo más amplio|lo mas amplio|máxima distancia|maxima distancia/.test(c) && window._aplicarRadio) {
        const km = window._aplicarRadio({ metros: 999999 });
        _hablar(FRASE('radio_max', { km: km.toFixed(0) }), () => _esperarComando());
        return;
      }
      // Ampliar / alejar el rango
      if (/ampl[ií]|agrand|aument|extiend|más lejos|mas lejos|más rango|mas rango|más amplio|mas amplio|abr[ií] el rango|aleja/.test(c) && window._aplicarRadio) {
        const km = window._aplicarRadio({ delta: 2000 });
        _hablar(FRASE('radio_ampliar', { km: km.toFixed(1).replace('.0', '') }), () => _esperarComando());
        return;
      }
      // Reducir el rango
      if (/reduc|achic|disminu|acort|menos rango|menos radio|más chico|mas chico|cerr[áa] el rango/.test(c) && window._aplicarRadio) {
        const km = window._aplicarRadio({ delta: -2000 });
        _hablar(FRASE('radio_reducir', { km: km.toFixed(1).replace('.0', '') }), () => _esperarComando());
        return;
      }

      // ── CONTROL GENERAL DE LA APP (tabla: Lila conoce TODO el index usuario) ──
      // Cada entrada: patrón de voz → acción de _accionApp → frase de confirmación.
      // El orden importa: lo más específico primero (p.ej. "alertas de precio"
      // antes que "avisos"). Ver _accionApp para el destino de cada acción.
      const _NAV_VOZ = [
        { re: /\b(mi )?carrito\b|mi carro|el carro|la canasta|el carrito/,                              a: 'carrito',       f: 'Ya, te abro el carro.' },
        { re: /(quiero |ir a )?comprar|pagar|finalizar compra|ir al pago/,                              a: 'comprar',       f: 'Ya, vamos a comprar.' },
        { re: /(mis |ver |mostrar )?favoritos|lista de favoritos|mis guardados/,                        a: 'favoritos',     f: 'Acá tenís tus favoritos.' },
        { re: /mis compras|mi historial|mis boletas|historial de compras|mis pedidos/,                  a: 'compras',       f: 'Ya, te muestro tus compras.' },
        { re: /cambiar.{0,6}(contrase(ñ|n)a|clave|usuario)|seguridad de (mi )?cuenta|\bseguridad\b/,     a: 'seguridad',     f: 'Ya, seguridad de tu cuenta.' },
        { re: /(mis |ver |leer |escribir )?rese(ñ|n)as|mis opiniones|mis comentarios|calificar/,        a: 'resenas',       f: 'Acá están tus reseñas.' },
        { re: /alertas( de precio)?|avisos de precio|avísame cuando baje|avisame cuando baje/,          a: 'alertas',       f: 'Ya, tus alertas de precio.' },
        { re: /(mis )?avisos|notificaci(ó|o)n|la campanita|mensajes de la app/,                          a: 'avisos',        f: 'Acá tenís tus avisos.' },
        { re: /mi perfil|abr[ií] el perfil|editar (mi )?perfil|mis datos/,                              a: 'perfil',        f: 'Listo, te abro tu perfil.' },
        { re: /ayuda|soporte|contactar|reportar (un )?problema|escribir a soporte|necesito ayuda/,      a: 'ayuda',         f: 'Ya, te abro ayuda.' },
        { re: /acerca de|sobre mercadate|qu[eé] es mercadate|informaci[oó]n de la app|qui[eé]nes son/,  a: 'acerca',        f: 'Ya, acerca de MercaDate.' },
        { re: /configuraci[oó]n|ajustes|opciones|preferencias|configurar/,                              a: 'config',        f: 'Listo, te abro la configuración.' },
        { re: /manual|instrucciones|c[oó]mo (se )?usa|tutorial|gu[ií]a de uso|c[oó]mo funciona/,        a: 'manual',        f: 'Ya, te abro el manual de usuario.' },
        { re: /t[eé]rminos( y condiciones)?|condiciones de uso/,                                        a: 'terminos',      f: 'Ya, los términos y condiciones.' },
        { re: /privacidad|pol[ií]tica de privacidad|c[oó]mo usan mis datos|datos personales/,           a: 'privacidad',    f: 'Ya, la política de privacidad.' },
        { re: /present[ae]ci[oó]n|demostraci[oó]n|\bdemo\b|qu[eé] sab[eé]s hacer|qu[eé] puedes hacer/,   a: 'presentacion',  f: 'Dale, te muestro qué puedo hacer.' },
        { re: /escane|esc[aá]ner|registrar visita|c[oó]digo qr|\bqr\b|escanear el local/,               a: 'escanear',      f: 'Ya, te abro el escáner.' },
        { re: /mi nivel|qu[eé] nivel|mis puntos|mis habilidades|mi progreso|mis logros/,                a: 'nivel',         f: 'Mira, este es tu nivel.' },
        { re: /(activ|prend|enciend|apag|desactiv).{0,12}gps|\bgps\b|mi ubicaci[oó]n/,                   a: 'gps',           f: 'Listo, te cambié el GPS.' },
        { re: /filtros?|filtrar|opciones de b[uú]squeda|filtros avanzados/,                             a: 'filtros',       f: 'Ya, te abro los filtros.' },
        { re: /desaf[ií]os|misiones|\bretos\b/,                                                          a: 'desafios',      f: 'Ya, tus desafíos.' },
        { re: /reportar (un )?precio|corregir (el )?precio|el precio est[aá] mal|precio equivocado/,     a: 'reportar',      f: 'Ya, reportemos el precio.' },
        { re: /m[aá]s barat|precio.*(bajo|menor)|ordenar por precio|el m[aá]s econ[oó]mico/,             a: 'ordenar-barato',f: 'Listo, de menor a mayor precio.' },
        { re: /m[aá]s cerca|cercan|cerquita|ordenar por (cercan|distancia)|el m[aá]s cerca/,             a: 'ordenar-cerca', f: 'Listo, de lo más cercano primero.' },
        { re: /(tema|modo) (de )?d[ií]a|modo claro|ponlo claro|pantalla clara/,                          a: 'tema-dia',      f: 'Listo, modo día.' },
        { re: /(tema|modo) (de )?noche|modo oscuro|ponlo oscuro|pantalla oscura/,                        a: 'tema-noche',    f: 'Listo, modo noche.' },
        { re: /(tema|modo) autom[aá]tico|seg[uú]n (el )?horario|tema por horario/,                       a: 'tema-auto',     f: 'Listo, tema automático por horario.' },
        { re: /cerrar sesi[oó]n|salir de mi cuenta|desconect|cerrar mi cuenta/,                          a: 'cerrar-sesion', f: 'Ya, cerrando tu sesión.' },
        { re: /mi cuenta|abr[ií] mi cuenta|abr[ií] la cuenta/,                                          a: 'cuenta',        f: 'Listo, te abro tu cuenta.' },
        { re: /volver al inicio|pantalla principal|men[uú] principal|al inicio|p[aá]gina principal/,     a: 'inicio',        f: 'Ya, volvamos al inicio.' },
        { re: /nueva b[uú]squeda|limpi[aá]|borr[aá] todo|empez[aá]r de nuevo|de cero/,                   a: 'limpiar',       f: 'Ya, partamos de nuevo. ¿Qué estás buscando?' },
      ];
      const _nav = _NAV_VOZ.find(x => x.re.test(c));
      if (_nav && window._accionApp) {
        const ok = window._accionApp(_nav.a);
        _hablar(ok ? _nav.f : 'Eso no lo pude abrir ahora.', () => _esperarComando());
        return;
      }
      // ── COMBUSTIBLES por voz: detecta el tipo y busca estaciones ──
      const esCombustible = /combustible|bencina|nafta|gasolina|petr[oó]leo|estaci[oó]n de servicio|surtidor|di[eé]sel|gas[oó]il|parafina|keros[eé]n|querosen/.test(_cBase)
        || /\b(9\s*3|9\s*5|9\s*7)\b|noventa y (tres|cinco|siete)/.test(_cBase);
      if (esCombustible && window._activarCombustibleVoz) {
        let ft = null;
        if (/\b9\s*7\b|noventa y siete/.test(_cBase)) ft = '97';
        else if (/\b9\s*5\b|noventa y cinco/.test(_cBase)) ft = '95';
        else if (/\b9\s*3\b|noventa y tres/.test(_cBase)) ft = '93';
        else if (/di[eé]sel|gas[oó]il/.test(_cBase)) ft = 'DI';
        else if (/parafina|keros[eé]n|querosen/.test(_cBase)) ft = 'KE';
        const FT_NOMBRE = { '93': '93', '95': '95', '97': '97', 'DI': 'diésel', 'KE': 'parafina' };
        if (_comunaVoz) _aplicarComunaVoz(_comunaVoz);
        if (ft) {
          _hablar('Ya, busco ' + FT_NOMBRE[ft] + (_comunaVoz ? ' en ' + _comunaVoz : ' cerca tuyo') + '.', () => {
            Promise.resolve(window._activarCombustibleVoz(ft)).then((n) => {
              _resultadoIndex = 0;
              const msg = n ? FRASE('encontrados', { n: n, res: 'estación' + (n > 1 ? 'es' : '') })
                            : 'No pillé estaciones cerca. Probá decir "amplía la búsqueda".';
              _hablar(msg, () => _esperarComando());
            });
          });
        } else {
          window._activarCombustibleVoz(null);
          _hablar('Listo, modo combustibles' + (_comunaVoz ? ' en ' + _comunaVoz : '') + '. ¿Qué tipo querís? Decime 93, 95, 97, diésel o parafina.', () => _esperarComando());
        }
        return;
      }

      // ── CATEGORÍAS por voz: "buscar [gastronomía/servicios/...] [en <comuna>]" ──
      const _catMatch = _CATS_VOZ.find(x => x.re.test(_cBase));
      if (_catMatch && window._activarCategoria) {
        if (_comunaVoz) _aplicarComunaVoz(_comunaVoz);
        const _tabOk = window._activarCategoria(_catMatch.cat);
        const _textoProducto = _cBase
          .replace(_catMatch.re, '')
          .replace(/^(buscar?|busco|busc[aá]me?|búscame|encuentra|encontrar|quiero|necesito|mu[eé]strame|hay|tienen|ver|muestra|d[oó]nde)\s*/i, '')
          .trim();
        if (_tabOk && _textoProducto.length >= 2) {
          _hablar(FRASE('buscando', { x: _textoProducto }), () => {
            setTimeout(() => {
              if (dom.productoInput) dom.productoInput.value = _textoProducto;
              Promise.resolve(typeof buscar === 'function' ? buscar() : null).then(() => {
                const cnt = document.querySelectorAll('.commerce-card').length;
                _resultadoIndex = 0;
                _hablar(cnt ? FRASE('encontrados', { n: cnt, res: 'resultado' + (cnt > 1 ? 's' : '') })
                            : FRASE('sin_resultados', { x: _textoProducto }), () => _esperarComando());
              });
            }, 350);
          });
        } else if (_tabOk) {
          _hablar('Listo, busco en ' + _catMatch.nombre + (_comunaVoz ? ' en ' + _comunaVoz : '') + '. ¿Qué estás buscando?', () => _esperarComando());
        } else {
          _hablar(FRASE('no_entendi'), () => _esperarComando());
        }
        return;
      }

      // Gate nivel 2 para comandos de búsqueda y control de app
      const _uLila = (window.auth && auth.getUser) ? auth.getUser() : null;
      const _nivelLila = _uLila?.nivel || 1;
      if (_nivelLila < 2 && !_esPeriodoLibre(_uLila)) {
        _hablar('Para usar la búsqueda por voz necesitas ser Rastreador Experto. ¡Sigue acumulando puntos!', () => _esperarComando());
        return;
      }

      // BUSCAR algo — usar _cBase (ya sin "en <comuna>")
      if (_comunaVoz) _aplicarComunaVoz(_comunaVoz);
      let textoBuscar = _cBase
        .replace(/^(mercadate|merca)\s+/,'')
        .replace(/^(buscar?|busco|busc[aá]me?|búscame|encuentra|encontrar|quiero|necesito|mu[eé]strame|mostrame|ver|muestra|hay|tienen|d[oó]nde hay|d[oó]nde|donde)\s+/,'')
        .replace(/\s+(por (acá|aca|aquí|aqui|la zona)|cerca( m[ií]o)?|cercano)$/,'')
        .trim();
      // Capa A: corregir el término contra el vocabulario del inventario
      // (ej. "leshe" → "leche" si existe en los comercios cargados).
      if (window.VozCorr && textoBuscar.length >= 2) {
        textoBuscar = window.VozCorr.corregirTermino(textoBuscar, _vocabBusqueda());
      }
      if (textoBuscar.length >= 2) {
        _hablar(FRASE('buscando', { x: textoBuscar }), () => {
          // _buscarVoz usa el MISMO camino que la búsqueda manual (renderComerciosList)
          // → tarjetas + mapa. Devuelve el conteo de tarjetas filtradas.
          window._origenBusqueda = 'voz';  // esta búsqueda vino del asistente
          if (_nivelLila >= 2) window._marcarHabilidadUsada && window._marcarHabilidadUsada(2);
          Promise.resolve(window._buscarVoz && window._buscarVoz(textoBuscar)).then((cnt) => {
            cnt = cnt || 0;
            _resultadoIndex = 0;
            const msg = cnt
              ? FRASE('encontrados', { n: cnt, res: 'resultado' + (cnt > 1 ? 's' : '') })
              : FRASE('sin_resultados', { x: textoBuscar });
            _hablar(msg, () => _esperarComando());
          });
        });
        return;
      }
      _hablar(FRASE('no_entendi'), () => _esperarComando());
    }

    // Cierre limpio del reconocedor: anula sus handlers ANTES de abortar para
    // que su onend/onerror no dispare un reinicio fantasma (evita duplicados).
    function _stopRec() {
      if (!_rec) return;
      const r = _rec; _rec = null;
      r.onresult = r.onend = r.onerror = null;
      try { r.abort(); } catch(_) {}
    }

    function _arrancarRec() {
      if (_hablando || _pausadoExterno) return; // no escuchar al hablar ni en entrenamiento
      _stopRec();
      const rec = new SpeechRec();
      _rec = rec;
      rec.lang = 'es-CL'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 3;

      // Solo cuando el reconocimiento CONECTA de verdad mostramos el mensaje de
      // escucha. Así, si estaba "Esperando conexión…", vuelve a "Esperando Mercadate".
      rec.onstart = () => {
        if (rec !== _rec) return;
        _sinConexion = false; // conectó → vuelve al ritmo normal de reintento
        if (_estado === 'WAKE' || _estado === 'IDLE') _mostrarIndicador('idle', 'Esperando "Mercadate"…', '');
      };

      rec.onresult = e => {
        if (rec !== _rec) return;                       // instancia vieja, ignorar
        if (_hablando || _estado === 'PROCESSING') return; // no procesar mientras habla/procesa

        const ress = Array.from(e.results);
        const interim = ress.filter(r => !r.isFinal).map(r => r[0].transcript).join(' ');
        const fin = ress.filter(r => r.isFinal).map(r => r[0].transcript).join(' ');
        const todo = (fin + ' ' + interim).toLowerCase();
        const tr = document.getElementById('voiceTranscript');
        if (tr) tr.textContent = (interim || fin || '').slice(-42);

        if (_estado === 'WAKE' || _estado === 'IDLE') {
          const ww = WAKE_WORDS.find(w => todo.includes(w));
          if (ww) {
            const trasPalabra = todo.slice(todo.lastIndexOf(ww) + ww.length).trim();
            _estado = 'PROCESSING';        // cierra la ventana de re-disparo del wake
            _chime(660, 900);
            if (trasPalabra.length >= 3) {
              _procesarComando(trasPalabra);
            } else {
              _hablar(FRASE('que_buscas'), () => _esperarComando());
            }
          }
        } else if (_estado === 'ACTIVE') {
          // Procesar SOLO cuando hay un resultado final (una vez).
          const lastFin = ress.filter(r => r.isFinal).pop();
          if (lastFin) {
            // Capa A: aplica las correcciones aprendidas del usuario al texto.
            const txt = window.VozCorr ? window.VozCorr.aplicar(lastFin[0].transcript) : lastFin[0].transcript;
            _procesarComando(txt);
          }
        }
      };
      rec.onend = () => {
        if (rec !== _rec) return;                       // ya fue reemplazado
        // Reiniciar siempre que esté activo — incluso en IDLE (wake-word mode)
        if (_siempreActivo && !_hablando && !_pausadoExterno) {
          clearTimeout(_reanudarT);
          // Sin conexión: reintentar más lento (2,5s) para no drenar red/batería.
          _reanudarT = setTimeout(() => { if (_siempreActivo && !_hablando && !_pausadoExterno) _arrancarRec(); }, _sinConexion ? 2500 : 400);
        }
      };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'audio-capture') {
          console.warn('[Voice] Micrófono no disponible:', e.error);
          _mostrarIndicador('error', 'Sin acceso al micrófono', '');
          _siempreActivo = false; return;
        }
        if (e.error === 'network' || e.error === 'service-not-allowed') {
          // Sin internet o el servicio de voz de Google no está disponible/autorizado
          // (típico en http sin conexión segura). Sigue reintentando (onend reinicia);
          // avisamos honestamente en vez de fingir que está escuchando.
          console.warn('[Voice] Reconocimiento sin conexión:', e.error);
          _sinConexion = true; // el onend reintentará más lento (no martillar la red)
          if (_estado === 'WAKE' || _estado === 'IDLE') {
            _mostrarIndicador('idle', 'Esperando conexión…', 'La voz necesita internet');
          }
          return;
        }
        // no-speech / aborted: onend reinicia automáticamente, no hacer nada aquí.
      };
      try {
        rec.start();
      } catch(_) {
        // Chrome aún no liberó el micrófono: reintentar con más margen.
        setTimeout(() => {
          if (rec === _rec && _siempreActivo && !_hablando) { try { rec.start(); } catch(__) {} }
        }, 500);
      }
    }

    // ── HEARTBEAT de rescate ─────────────────────────────────────────────────
    // Garantiza el invariante: "si el asistente está activo y no está hablando,
    // el micrófono está escuchando". Rescata dos fallas que dejaban a Lila muda:
    //   1) _hablando quedó pegado en true (el TTS no avisó su fin) → lo libera.
    //   2) activo, sin hablar y sin reconocedor vivo → reenciende el mic.
    setInterval(() => {
      if (!_siempreActivo || _pausadoExterno) return;
      if (_hablando) {
        // Ninguna frase real dura tanto: si sigue "hablando" >12s, el fin se perdió.
        if (Date.now() - _hablandoDesde > 12000) {
          _hablando = false;
          if (_estado === 'PROCESSING') _estado = 'WAKE';
          _arrancarRec();
        }
        return;
      }
      if (_estado !== 'IDLE' && !_rec) _arrancarRec();  // backstop: reencender si murió
    }, 3000);

    function iniciarSiempre() {
      _siempreActivo = true; _estado = 'WAKE';
      _crearIndicador();
      _mostrarIndicador('idle', 'Esperando "Mercadate"…', '');
      const btn = document.getElementById('btnVoice');
      if (btn) { btn.classList.add('recording'); btn.title = 'Asistente activo — decí "Mercadate buscar leche"'; }
      _arrancarRec();
    }

    // Arranca el asistente, saluda por voz y queda esperando la instrucción.
    // No se arranca el mic acá: _hablar lo reenciende solo al terminar el saludo
    // (así no se escucha a sí mismo mientras saluda).
    async function iniciarConSaludo() {
      if (_siempreActivo) return;
      _siempreActivo = true; _estado = 'ACTIVE';
      _crearIndicador();
      const btn = document.getElementById('btnVoice');
      if (btn) { btn.classList.add('recording'); btn.title = 'Asistente activo — decí "Mercadate buscar leche"'; }

      // La voz primaria (Catalina) es remota: el propio _hablar la pide a /api/tts.
      // No hace falta esperar a Piper (que ahora es solo respaldo offline).
      _mostrarIndicador('active', 'Te escucho…', '');
      const hora = new Date().getHours();
      const saludo = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
      // Saludar por el nombre del usuario logueado (no hace falta biometría: ya
      // sabemos quién es por su sesión).
      let nombre = '';
      try {
        const u = window.usuarioActual;
        const n = u && (u.nombre || u.username);
        if (n) nombre = ', ' + String(n).trim().split(/\s+/)[0];
      } catch (_) {}
      _chime(660, 900);
      _hablar(FRASE('saludo', { hora: saludo, nombre: nombre }), () => _esperarComando(15000));
    }

    function desactivarSiempre() {
      _siempreActivo = false; _estado = 'IDLE'; _hablando = false;
      clearTimeout(_timeoutCmd);
      clearTimeout(_reanudarT);
      _stopRec();
      if (SYNTH) { try { SYNTH.cancel(); } catch(_) {} }
      if (window.VozMercaDate && window.VozMercaDate.detener) window.VozMercaDate.detener();
      _ocultarIndicador();
      const btn = document.getElementById('btnVoice');
      if (btn) { btn.classList.remove('recording'); btn.title = 'Voz · Mantén para modo siempre activo'; }
    }

    function activarUnaVez() {
      if (_siempreActivo) { desactivarSiempre(); return; }
      const r = new SpeechRec();
      r.lang = 'es-CL'; r.interimResults = false;
      const btn = document.getElementById('btnVoice');
      if (btn) btn.classList.add('recording');
      r.onresult = e => {
        const txt = e.results[0][0].transcript;
        const inp = document.getElementById('productoInput');
        if (inp) inp.value = txt;
        if (btn) btn.classList.remove('recording');
        window._origenBusqueda = 'voz';  // dictado por voz
        window.buscarDesdeHistorial && window.buscarDesdeHistorial();
      };
      r.onerror = r.onend = () => { if (btn) btn.classList.remove('recording'); };
      try { r.start(); } catch(_) {}
    }

    // Pausa "entrenamiento": el asistente deja de escuchar y de hablar mientras
    // se calibra la voz, para no procesar las frases de prueba como comandos.
    function pausar() {
      _pausadoExterno = true;
      clearTimeout(_timeoutCmd); clearTimeout(_reanudarT);
      _hablando = false;
      _stopRec();
      if (SYNTH) { try { SYNTH.cancel(); } catch (_) {} }
      if (window.VozMercaDate && window.VozMercaDate.detener) window.VozMercaDate.detener();
      if (_siempreActivo) _mostrarIndicador('idle', 'Modo entrenamiento…', '');
    }
    function reanudar() {
      if (!_pausadoExterno) return;
      _pausadoExterno = false;
      if (_siempreActivo) {
        _estado = 'WAKE';
        _mostrarIndicador('idle', 'Esperando "Mercadate"…', '');
        _arrancarRec();
      }
    }

    return { iniciarSiempre, iniciarConSaludo, desactivarSiempre, activarUnaVez, pausar, reanudar, procesarComando: _procesarComando, get activo() { return _siempreActivo; } };
  })();

  // ── Funciones globales de control de Lila ────────────────────────────────
  // (La ✕ interna de la burbuja se eliminó: el FAB es el interruptor maestro
  //  — cerrar la burbuja = apagar Lila. No hay botón de desactivar por separado.)
  window._lilaProbarVoz = function() {
    if (window.VozCorr && window.VozCorr.calibrar) window.VozCorr.calibrar();
    localStorage.setItem('md_voz_probada', '1');
    // Ocultar el botón de la burbuja — tras la primera calibración solo estará en Configuración
    const btn = document.getElementById('btnVozPrueba');
    if (btn) { btn.style.display = 'none'; }
  };

  // El antiguo botón 🎙️ en la fila de filtros (#btnVoice) se eliminó: el FAB naranja
  // es la única entrada a Lila. Conservamos solo la precarga de la voz neuronal si
  // ya está cacheada (no depende de ningún botón), para que Lila responda sin espera.
  (function() {
    if (window.VozMercaDate && window.VozMercaDate.precargarSiCacheado) {
      window.VozMercaDate.precargarSiCacheado();
    }
  })();

  // ── FAB Lila (botón flotante abajo-derecha): INTERRUPTOR MAESTRO ─────────────
  //    Burbuja abierta ⟺ Lila activa. 1 toque enciende (activa + abre burbuja),
  //    otro toque apaga (desactiva + cierra burbuja). No hace falta la ✕ interna.
  // DOMContentLoaded: el FAB está después del script en el HTML, no existe al parsear app.js
  document.addEventListener('DOMContentLoaded', function() {
    const fab = document.getElementById('lilaFab');
    if (!fab) return;
    fab.removeAttribute('onclick');
    fab.addEventListener('click', function() {
      const va = window._voiceAssistant;
      if (!va) return;
      if (va.activo) {
        // Lila activa → apagar (desactivarSiempre ya cierra la burbuja).
        va.desactivarSiempre();
        localStorage.setItem('mercadate_lila_activa', '0');
      } else {
        // Apagada → encender y abrir la burbuja para recibir el texto.
        window._lilaManualHidden = false;
        window._lilaAutoHidden = false;
        va.iniciarSiempre();
        localStorage.setItem('mercadate_lila_activa', '1');
      }
    });
  });

  // ── Solicitud única de Lila al inicio (solo primera sesión) ───────────────
  (function() {
    if (localStorage.getItem('md_lila_preguntado') === '1') return;
    document.addEventListener('sesion-lista', function() {
      localStorage.setItem('md_lila_preguntado', '1');
      setTimeout(function() {
        const ov = document.createElement('div');
        ov.id = 'lilaInitModal';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99997;background:rgba(11,13,19,.85);display:flex;align-items:flex-end;justify-content:center;padding-bottom:90px;font-family:inherit';
        ov.innerHTML = '<div style="background:#161B27;border:1px solid #313850;border-radius:20px;padding:22px 22px 18px;max-width:340px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.6)">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          '<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🎙️</div>' +
          '<div><div style="font-weight:800;font-size:15px;color:#ECEEF5">¡Hola! Soy Lila</div>' +
          '<div style="font-size:12px;color:#8B91A7;margin-top:2px">Tu asistente de voz</div></div></div>' +
          '<p style="font-size:13px;color:#C7CCDA;line-height:1.5;margin:0 0 16px">Puedo ayudarte a buscar precios y comercios usando tu voz. ¿Quieres activarme?</p>' +
          '<div style="display:flex;gap:8px">' +
          '<button onclick="window._lilaInitAceptar()" style="flex:1;padding:11px;border-radius:10px;border:none;background:#6E56F8;color:#fff;font-weight:700;font-size:13px;cursor:pointer">🎙️ Sí, activar Lila</button>' +
          '<button onclick="window._lilaInitRechazar()" style="flex:1;padding:11px;border-radius:10px;border:1px solid #313850;background:transparent;color:#8B91A7;font-size:13px;cursor:pointer">Ahora no</button>' +
          '</div></div>';
        document.body.appendChild(ov);
      }, 1800);
    }, { once: true });
  })();
  window._lilaInitAceptar = function() {
    const ov = document.getElementById('lilaInitModal');
    if (ov) ov.remove();
    localStorage.setItem('mercadate_lila_activa', '1');
    if (window._voiceAssistant) window._voiceAssistant.iniciarSiempre();
  };
  window._lilaInitRechazar = function() {
    const ov = document.getElementById('lilaInitModal');
    if (ov) ov.remove();
    localStorage.setItem('mercadate_lila_activa', '0');
  };

  // ── Desafíos: badge + bounce en el botón del rail ────────────────────────
  // No auto-abre; en cambio muestra cuántos retos están pendientes en el badge
  // del botón 🚀 y lo anima para llamar la atención.
  (function() {
    const st = document.createElement('style');
    st.textContent = '@keyframes mdcBounce{0%,100%{transform:scale(1) translateY(0)}30%{transform:scale(1.25) translateY(-5px)}60%{transform:scale(.95) translateY(2px)}}' +
      '.md-mother[data-group="desafios"].mdc-pulse{animation:mdcBounce .7s ease 3}' +
      '.mdc-rail-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;' +
      'border-radius:99px;background:#f0b429;color:#0B0D13;font-size:10px;font-weight:800;' +
      'line-height:18px;text-align:center;border:2px solid #0B0D13;box-shadow:0 2px 6px rgba(0,0,0,.4)}';
    document.head.appendChild(st);

    window._actualizarBadgeDesafios = function() {
      const btn = document.querySelector('#mdRailMothers .md-mother[data-group="desafios"]');
      if (!btn) return;
      // Contar retos pendientes si el módulo está cargado
      let pendientes = 0;
      try {
        if (window._desafiosPrincipiantes && window._desafiosPrincipiantes.estado) {
          const retos = window._desafiosPrincipiantes.estado();
          pendientes = retos.filter(r => r.cur < r.goal).length;
        }
      } catch(_) {}
      let badge = btn.querySelector('.mdc-rail-badge');
      if (pendientes > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'mdc-rail-badge'; btn.appendChild(badge); }
        badge.textContent = pendientes;
        badge.style.display = '';
      } else {
        if (badge) badge.style.display = 'none';
      }
    };

    // Bounce + badge al cargar sesión
    document.addEventListener('sesion-lista', function() {
      setTimeout(function() {
        window._actualizarBadgeDesafios();
        const btn = document.querySelector('#mdRailMothers .md-mother[data-group="desafios"]');
        if (btn) {
          btn.classList.add('mdc-pulse');
          setTimeout(() => btn.classList.remove('mdc-pulse'), 2200);
        }
      }, 1500);
    }, { once: true });
  })();

  // ── Menú lateral flotante (Lila · sumar comercio · redes · accesos) ──────────
  // Rail a la derecha. Se abre/cierra con el botón ✦ y RECUERDA su estado
  // (localStorage md_rail). "Sumar comercio" ancla la ubicación del mapa.
  (function _menuLateralFlotante() {
    if (document.getElementById('mdRail')) return;
    // ⚠️ Reemplazar por los handles reales de MercaDate cuando estén:
    const REDES = {
      instagram: 'https://instagram.com/mercadate',
      facebook : 'https://facebook.com/mercadate',
      tiktok   : 'https://www.tiktok.com/@mercadate',
      whatsapp : 'https://wa.me/56900000000'
    };
    const st = document.createElement('style');
    st.textContent = [
      '#mdRail{position:fixed;right:10px;top:50%;transform:translateY(-50%);z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;font-family:inherit}',
      '#mdRailMothers{display:flex;flex-direction:column;align-items:center;gap:6px;transition:opacity .2s ease,transform .2s ease;transform-origin:bottom right;background:var(--bg,rgba(8,12,24,0.96));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1.5px solid rgba(255,255,255,.14);border-radius:20px;padding:10px 6px;box-shadow:0 8px 32px rgba(0,0,0,.7)}',
      '#mdRail.closed #mdRailMothers{opacity:0;pointer-events:none;transform:scale(.5) translateX(24px)}',
      '#mdRailMothers .md-mother{transition:opacity .22s ease,transform .22s ease}',
      '#mdRailMothers.has-active .md-mother:not(.active){opacity:0;pointer-events:none;transform:scale(.4)}',
      '#mdRailToggle{width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(135deg,var(--accent2,#f5c64d),var(--accent,#f0b429));color:#0B0D13;font-size:22px;box-shadow:0 6px 18px rgba(242,185,69,.5);display:flex;align-items:center;justify-content:center;transition:transform .25s,box-shadow .25s;margin-top:8px}',
      '#mdRailToggle.lila-activa{background:linear-gradient(135deg,#6E56F8,#a855f7);box-shadow:0 6px 18px rgba(110,86,248,.6);color:#fff}',
      '#mdRail.closed #mdRailMothers{opacity:0;pointer-events:none;transform:scale(.5) translateX(24px)}',
      '.md-rail-btn{position:relative;width:52px;min-height:52px;border-radius:14px;border:1px solid rgba(255,255,255,.08);cursor:pointer;background:rgba(255,255,255,.06);color:var(--text,#fff);font-size:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:transform .15s,border-color .15s,background .15s;padding:6px 4px}',
      '.md-rail-btn .md-rail-ico{font-size:20px;line-height:1}',
      '.md-rail-btn .md-rail-lbl{font-size:9px;color:rgba(255,255,255,.45);line-height:1;white-space:nowrap;font-family:inherit}',
      '.md-rail-btn:hover{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.1);transform:translateY(-1px)}',
      '.md-mother.active{border-color:var(--accent,#F2B945)!important;background:rgba(242,185,69,.15)!important}',
      '.md-mother.active .md-rail-lbl{color:var(--accent,#F2B945)}',
      '.md-rail-btn:active{transform:scale(.92)}',
      '.md-mother.md-act-active{border-color:var(--accent,#F2B945);background:rgba(242,185,69,.15)}',
      '.md-children{position:absolute;top:50%;left:50%;width:0;height:0}',
      '.md-child{position:absolute;top:-20px;left:-20px;width:40px;height:40px;font-size:17px;opacity:0;transform:scale(.2);pointer-events:none;transition:transform .24s cubic-bezier(.34,1.56,.64,1),opacity .18s ease}',
      '.md-mother.active .md-child{pointer-events:auto}',
      '.md-rail-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;line-height:18px;text-align:center;border:2px solid var(--bg,#0B0D13);box-shadow:0 2px 6px rgba(0,0,0,.4)}'
    ].join('');
    document.head.appendChild(st);

    const rail = document.createElement('div');
    rail.id = 'mdRail';
    if (localStorage.getItem('md_rail') === 'closed') rail.classList.add('closed');

    // ── Grupos (burbujas madre) y sus hijas ──────────────────────────────────
    const GROUPS = [
      { id:'config', icon:'⚙️', label:'Config', title:'Configuración', act:'config' },
      { id:'comprar', icon:'🛒', label:'Comprar', title:'Comprar', act:'comprar' },
      { id:'desafios', icon:'🚀', label:'Desafíos', title:'Desafíos', act:'desafios' }
      // Lila removido — FAB naranja es la única entrada a Lila
    ];

    const mothers = document.createElement('div');
    mothers.id = 'mdRailMothers';

    function _makeChild(c) {
      var el;
      if (c.href) { el = document.createElement('a'); el.href = c.href; el.target = '_blank'; el.rel = 'noopener'; }
      else { el = document.createElement('button'); el.setAttribute('data-act', c.act); }
      el.className = 'md-rail-btn md-child';
      el.title = c.title;
      el.textContent = c.icon;
      return el;
    }

    GROUPS.forEach(function (g) {
      var m = document.createElement('div');
      m.className = 'md-rail-btn md-mother';
      m.setAttribute('role', 'button');
      m.setAttribute('tabindex', '0');
      m.title = g.title;
      m.setAttribute('data-group', g.id);
      if (g.act) m.setAttribute('data-act', g.act);
      var ico = document.createElement('span'); ico.className = 'md-rail-ico'; ico.textContent = g.icon;
      var lbl = document.createElement('span'); lbl.className = 'md-rail-lbl'; lbl.textContent = g.label || g.title.split(' ')[0];
      m.appendChild(ico); m.appendChild(lbl);
      if (g._esLila) {
        m.style.cssText += ';background:linear-gradient(135deg,#f5c64d,#f0b429);border-color:#f0b429;color:#0B0D13;box-shadow:0 4px 16px rgba(242,185,69,.5);border-radius:50%;width:52px;height:52px;padding:0';
        lbl.style.color = '#0B0D13';
        lbl.textContent = 'Lila';
      }
      if (g.children) {
        var box = document.createElement('div');
        box.className = 'md-children';
        g.children.forEach(function (c) { box.appendChild(_makeChild(c)); });
        m.appendChild(box);
        var kids = box.querySelectorAll('.md-child');
        var n = kids.length;
        var R = 86, span = Math.min(48 + (n - 1) * 22, 150);
        var startA = 180 - span / 2, step = n > 1 ? span / (n - 1) : 0;
        kids.forEach(function (k, i) {
          var ang = (startA + i * step) * Math.PI / 180;
          k.setAttribute('data-tx', (Math.cos(ang) * R).toFixed(1));
          k.setAttribute('data-ty', (Math.sin(ang) * R).toFixed(1));
        });
      }
      mothers.appendChild(m);
    });

    rail.appendChild(mothers);
    var toggle = document.createElement('button');
    toggle.id = 'mdRailToggle';
    toggle.title = 'Menú MercaDate';
    toggle.textContent = '✦';
    rail.appendChild(toggle);
    document.body.appendChild(rail);

    function _applyKids(m, open) {
      m.querySelectorAll('.md-child').forEach(function (k) {
        k.style.transform = open
          ? 'translate(' + k.getAttribute('data-tx') + 'px,' + k.getAttribute('data-ty') + 'px) scale(1)'
          : 'scale(.2)';
        k.style.opacity = open ? '1' : '';
      });
    }
    window._lilaAutoOcultar = function() {
      var ind = document.getElementById('voiceIndicator');
      if (ind && ind.style.display === 'flex') { ind.style.display = 'none'; window._lilaAutoHidden = true; }
    };
    window._lilaAutoRestaurar = function() {
      if (!window._lilaAutoHidden) return;
      window._lilaAutoHidden = false;
      if (window._lilaManualHidden) return;
      var ind = document.getElementById('voiceIndicator');
      if (ind) ind.style.display = 'flex';
    };
    var _lilaAutoOcultar = window._lilaAutoOcultar;
    var _lilaAutoRestaurar = window._lilaAutoRestaurar;
    function _closeGroup() {
      var a = mothers.querySelector('.md-mother.active');
      if (a) { a.classList.remove('active'); _applyKids(a, false); }
      mothers.classList.remove('has-active');
      _lilaAutoRestaurar();
    }
    function _openGroup(m) {
      _lilaAutoOcultar();
      _closeGroup();
      m.classList.add('active');
      mothers.classList.add('has-active');
      _applyKids(m, true);
    }

    function _toggleLilaDesdeToggle() {
      const va = window._voiceAssistant;
      const ind = document.getElementById('voiceIndicator');
      if (!va) { mostrarToast('🎙️ Lila no disponible'); return; }
      if (!va.activo) {
        va.iniciarSiempre();
        localStorage.setItem('mercadate_lila_activa', '1');
        window._lilaManualHidden = false;
        window._lilaAutoHidden = false;
        toggle.classList.add('lila-activa');
      } else {
        if (!ind || ind.style.display === 'none' || ind.style.display === '') {
          if (ind) { ind.style.display = 'flex'; window._lilaManualHidden = false; window._lilaAutoHidden = false; }
          toggle.classList.add('lila-activa');
        } else {
          ind.style.display = 'none';
          window._lilaManualHidden = true;
          window._lilaAutoHidden = false;
          toggle.classList.remove('lila-activa');
        }
      }
    }
    toggle.addEventListener('click', function () {
      rail.classList.toggle('closed');
      localStorage.setItem('md_rail', rail.classList.contains('closed') ? 'closed' : 'open');
    });

    function _doAct(a) {
      // Ítems que reusan el botón original del header (oculto por CSS):
      var proxy = { cuenta:'btnMiCuenta', carrito:'btnCarrito', avisos:'notifBell', visita:'btnRegistrarVisita', puntos:'puntosBadge' };
      if (proxy[a]) { var el = document.getElementById(proxy[a]); if (el) el.click(); return; }
      switch (a) {
        case 'lila': {
          const va = window._voiceAssistant;
          const ind = document.getElementById('voiceIndicator');
          if (!va) { mostrarToast('🎙️ Lila no disponible'); break; }
          if (!va.activo) {
            va.iniciarSiempre();
            localStorage.setItem('mercadate_lila_activa', '1');
            window._lilaManualHidden = false;
            window._lilaAutoHidden = false;
          } else {
            if (!ind || ind.style.display === 'none' || ind.style.display === '') {
              if (ind) { ind.style.display = 'flex'; window._lilaManualHidden = false; window._lilaAutoHidden = false; }
            } else {
              ind.style.display = 'none';
              window._lilaManualHidden = true;
              window._lilaAutoHidden = false;
            }
          }
          break;
        }
        case 'comercio': {
          _lilaAutoOcultar();
          var cardId = 'mdComercioCard';
          if (!document.getElementById(cardId)) {
            var cc = document.createElement('div');
            cc.id = cardId;
            cc.style.cssText = 'position:fixed;right:76px;bottom:80px;z-index:9200;width:280px;max-width:calc(100vw - 90px);background:var(--card,#171B27);border:1px solid rgba(24,199,206,.35);border-radius:18px;padding:20px 18px 16px;box-shadow:0 12px 40px rgba(0,0,0,.6);backdrop-filter:blur(12px);display:none';
            cc.innerHTML = '<button onclick="document.getElementById(\'mdComercioCard\').style.display=\'none\';window._lilaAutoRestaurar&&window._lilaAutoRestaurar();" style="position:absolute;top:10px;right:12px;background:none;border:none;color:var(--text2,#8899b4);font-size:16px;cursor:pointer;line-height:1;padding:2px 4px">✕</button>' +
              '<div style="font-size:22px;margin-bottom:6px">🏪</div>' +
              '<div style="font-family:Inter,sans-serif;font-weight:800;font-size:16px;color:#18C7CE;margin-bottom:4px">Suma tu comercio</div>' +
              '<div style="font-size:13px;color:var(--text2,#8899b4);line-height:1.5;margin-bottom:12px">Aparece en el mapa de MercaDate y llega a clientes de tu barrio que buscan lo que vendes.</div>' +
              '<ul style="margin:0 0 14px 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px">' +
                '<li style="font-size:12px;color:var(--text,#e2e8f0);display:flex;align-items:center;gap:7px"><span style="color:#F2B945;font-size:14px">✓</span> Perfil con horario, fotos y precios</li>' +
                '<li style="font-size:12px;color:var(--text,#e2e8f0);display:flex;align-items:center;gap:7px"><span style="color:#F2B945;font-size:14px">✓</span> Clientes te encuentran en el mapa</li>' +
                '<li style="font-size:12px;color:var(--text,#e2e8f0);display:flex;align-items:center;gap:7px"><span style="color:#F2B945;font-size:14px">✓</span> Estadísticas de visitas y búsquedas</li>' +
                '<li style="font-size:12px;color:var(--text,#e2e8f0);display:flex;align-items:center;gap:7px"><span style="color:#F2B945;font-size:14px">✓</span> Gratis durante el período fundador</li>' +
              '</ul>' +
              '<button id="mdComercioCardBtn" style="width:100%;padding:11px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(135deg,#18C7CE,#0fa3a8);color:#fff;font-weight:700;font-size:14px;font-family:inherit">Agregar mi comercio →</button>';
            document.body.appendChild(cc);
            document.getElementById('mdComercioCardBtn').addEventListener('click', function() {
              var lat2 = state.userLat || state.lat, lng2 = state.userLng || state.lng;
              try { if (map && map.getCenter) { var c2 = map.getCenter(); lat2 = c2.lat; lng2 = c2.lng; } } catch (_) {}
              window.open('/comercio/?nuevo=1&lat=' + encodeURIComponent(lat2) + '&lng=' + encodeURIComponent(lng2), '_blank', 'noopener');
              cc.style.display = 'none';
              window._lilaAutoRestaurar && window._lilaAutoRestaurar();
            });
          }
          var el2 = document.getElementById(cardId);
          el2.style.display = el2.style.display === 'block' ? 'none' : 'block';
          if (el2.style.display === 'none') window._lilaAutoRestaurar && window._lilaAutoRestaurar();
          break;
        }
        case 'compartir':
          if (navigator.share) {
            navigator.share({ title:'MercaDate', text:'El precio más barato, a la vuelta de la esquina.', url: location.origin }).catch(function(){});
          } else {
            try { navigator.clipboard.writeText(location.origin); mostrarToast('🔗 Enlace copiado'); } catch (_) {}
          }
          break;
        case 'comprar': {
          _lilaAutoOcultar();
          var cmpId = 'mdComprarCard';
          if (!document.getElementById(cmpId)) {
            var cmpCard = document.createElement('div');
            cmpCard.id = cmpId;
            cmpCard.style.cssText = 'position:fixed;right:76px;top:50%;transform:translateY(-50%);z-index:9200;width:260px;max-width:calc(100vw - 90px);background:var(--card,#171B27);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:20px 18px 16px;box-shadow:0 12px 40px rgba(0,0,0,.7);backdrop-filter:blur(12px);display:none';
            cmpCard.innerHTML = '<button onclick="document.getElementById(\'mdComprarCard\').style.display=\'none\';window._lilaAutoRestaurar&&window._lilaAutoRestaurar();" style="position:absolute;top:10px;right:12px;background:none;border:none;color:var(--text2,#8899b4);font-size:16px;cursor:pointer;line-height:1;padding:2px 4px">✕</button>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text2,#8899b4);letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px">Comprar</div>' +
              '<div style="display:flex;flex-direction:column;gap:8px">' +
                '<button data-cmp-act="carrito" style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:14px;cursor:pointer;font-family:inherit;width:100%"><span style="font-size:22px">🛒</span> Mi carrito</button>' +
                '<button data-cmp-act="visita" style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:14px;cursor:pointer;font-family:inherit;width:100%"><span style="font-size:22px">📷</span> Registrar visita</button>' +
              '</div>';
            document.body.appendChild(cmpCard);
            cmpCard.querySelectorAll('[data-cmp-act]').forEach(function(btn) {
              btn.addEventListener('click', function() {
                _doAct(this.getAttribute('data-cmp-act'));
                cmpCard.style.display = 'none';
                window._lilaAutoRestaurar && window._lilaAutoRestaurar();
              });
            });
          }
          var cmpEl = document.getElementById(cmpId);
          cmpEl.style.display = cmpEl.style.display === 'block' ? 'none' : 'block';
          if (cmpEl.style.display === 'none') window._lilaAutoRestaurar && window._lilaAutoRestaurar();
          break;
        }
        case 'config': {
          _lilaAutoOcultar();
          var cfgId = 'mdConfigCard';
          if (!document.getElementById(cfgId)) {
            var cfgCard = document.createElement('div');
            cfgCard.id = cfgId;
            cfgCard.style.cssText = 'position:fixed;right:76px;top:50%;transform:translateY(-50%);z-index:9200;width:300px;max-width:calc(100vw - 90px);background:var(--card,#171B27);border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:20px 18px 16px;box-shadow:0 12px 40px rgba(0,0,0,.7);backdrop-filter:blur(12px);display:none';
            cfgCard.innerHTML = '<button onclick="document.getElementById(\'mdConfigCard\').style.display=\'none\';window._lilaAutoRestaurar&&window._lilaAutoRestaurar();" style="position:absolute;top:10px;right:12px;background:none;border:none;color:var(--text2,#8899b4);font-size:16px;cursor:pointer;line-height:1;padding:2px 4px">✕</button>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text2,#8899b4);letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px">Mi cuenta</div>' +
              '<div id="mdCfgBtns" style="display:flex;flex-direction:column;gap:8px">' +
                '<button data-cfg-act="cuenta"  style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:14px;cursor:pointer;font-family:inherit;width:100%"><span style="font-size:20px">👤</span> Mi perfil</button>' +
                '<button data-cfg-act="puntos"  style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:14px;cursor:pointer;font-family:inherit;width:100%"><span style="font-size:20px">🏆</span> Mi nivel y puntos</button>' +
                '<button data-cfg-act="avisos"  style="display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:14px;cursor:pointer;font-family:inherit;width:100%"><span style="font-size:20px">🔔</span> Avisos</button>' +
              '</div>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text2,#8899b4);letter-spacing:.08em;text-transform:uppercase;margin:16px 0 10px">Comunidad</div>' +
              '<div style="display:flex;gap:8px;margin-bottom:14px">' +
                '<a href="' + REDES.instagram + '" target="_blank" rel="noopener" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:12px;text-decoration:none"><span style="font-size:22px">📸</span>Instagram</a>' +
                '<a href="' + REDES.facebook  + '" target="_blank" rel="noopener" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:12px;text-decoration:none"><span style="font-size:22px">👍</span>Facebook</a>' +
                '<a href="' + REDES.tiktok    + '" target="_blank" rel="noopener" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:var(--text,#e2e8f0);font-size:12px;text-decoration:none"><span style="font-size:22px">🎵</span>TikTok</a>' +
              '</div>' +
              '<button id="mdCfgComercioBtn" style="width:100%;padding:11px;border-radius:10px;border:none;cursor:pointer;background:linear-gradient(135deg,#18C7CE,#0fa3a8);color:#fff;font-weight:700;font-size:14px;font-family:inherit">🏪 Sumar mi comercio →</button>';
            document.body.appendChild(cfgCard);
            cfgCard.querySelectorAll('[data-cfg-act]').forEach(function(btn) {
              btn.addEventListener('click', function() {
                _doAct(this.getAttribute('data-cfg-act'));
                cfgCard.style.display = 'none';
                window._lilaAutoRestaurar && window._lilaAutoRestaurar();
              });
            });
            document.getElementById('mdCfgComercioBtn').addEventListener('click', function() {
              var lat2 = state.userLat || state.lat, lng2 = state.userLng || state.lng;
              try { if (map && map.getCenter) { var c2 = map.getCenter(); lat2 = c2.lat; lng2 = c2.lng; } } catch (_) {}
              window.open('/comercio/?nuevo=1&lat=' + encodeURIComponent(lat2) + '&lng=' + encodeURIComponent(lng2), '_blank', 'noopener');
              cfgCard.style.display = 'none';
              window._lilaAutoRestaurar && window._lilaAutoRestaurar();
            });
          }
          var cfgEl = document.getElementById(cfgId);
          cfgEl.style.display = cfgEl.style.display === 'block' ? 'none' : 'block';
          if (cfgEl.style.display === 'none') window._lilaAutoRestaurar && window._lilaAutoRestaurar();
          break;
        }
        case 'desafios': {
          _lilaAutoOcultar();
          const dp = document.getElementById('mdChallenges');
          if (!dp) { mostrarToast('🚀 Cargando desafíos…'); break; }
          localStorage.removeItem('md_desafios_cerrado');
          if (dp.classList.contains('hidden')) {
            window._refreshDesafios && window._refreshDesafios();
            dp.classList.remove('hidden');
          } else {
            dp.classList.add('hidden');
            window._lilaAutoRestaurar && window._lilaAutoRestaurar();
          }
          break;
        }
      }
    }

    mothers.addEventListener('click', function (e) {
      var child = e.target.closest('.md-child');
      if (child) {
        if (child.getAttribute('data-act')) _doAct(child.getAttribute('data-act'));
        _closeGroup();
        return;
      }
      var m = e.target.closest('.md-mother');
      if (!m) return;
      if (m.getAttribute('data-act') && !m.querySelector('.md-children')) {
        _doAct(m.getAttribute('data-act'));
        m.classList.add('md-act-active');
        setTimeout(function() { m.classList.remove('md-act-active'); }, 600);
        return;
      }
      if (m.classList.contains('active')) _closeGroup(); else _openGroup(m);
    });
    // Cerrar el grupo abierto al tocar fuera del rail
    document.addEventListener('click', function (e) {
      if (!rail.contains(e.target)) _closeGroup();
    });

    // ── Réplica de contadores: badge en la madre y en la hija correspondiente ──
    var _badgeDefs = [
      { src:'cartBadge',  group:'comprar', act:'carrito' },
      { src:'notifBadge', group:'config',  act:'avisos'  }
    ];
    _badgeDefs.forEach(function (d) {
      [ mothers.querySelector('.md-mother[data-group="' + d.group + '"]'),
        mothers.querySelector('.md-child[data-act="' + d.act + '"]') ].forEach(function (host) {
        if (!host) return;
        var b = document.createElement('span');
        b.className = 'md-rail-badge';
        b.style.display = 'none';
        host.appendChild(b);
      });
    });
    function _syncRailBadges() {
      _badgeDefs.forEach(function (d) {
        var src = document.getElementById(d.src);
        var n = src ? (src.textContent || '').trim() : '';
        var oculto = src ? getComputedStyle(src).display === 'none' : true;
        var show = !(oculto || n === '' || n === '0');
        [ mothers.querySelector('.md-mother[data-group="' + d.group + '"] > .md-rail-badge'),
          mothers.querySelector('.md-child[data-act="' + d.act + '"] > .md-rail-badge') ].forEach(function (dst) {
          if (!dst) return;
          if (show) { dst.textContent = n; dst.style.display = ''; }
          else { dst.style.display = 'none'; }
        });
      });
    }
    _badgeDefs.forEach(function (d) {
      var src = document.getElementById(d.src);
      if (!src) return;
      try {
        new MutationObserver(_syncRailBadges)
          .observe(src, { attributes: true, attributeFilter: ['style'], childList: true, characterData: true, subtree: true });
      } catch (_) {}
    });
    _syncRailBadges();
    document.addEventListener('sesion-lista', function () { setTimeout(_syncRailBadges, 400); });
  })();

  // ── Desafíos para principiantes (onboarding gamificado, estilo vidu) ──────
  // Panel motivacional al tope de la columna de tarjetas. Lee progreso real de
  // gamifEstado + localStorage. Se oculta solo al completarse o si el usuario
  // lo descarta. Pensado para enganchar al usuario nuevo (período libre / nivel 1).
  (function _desafiosPrincipiantes() {
    if (document.getElementById('mdChallengesStyle')) return;
    const st = document.createElement('style');
    st.id = 'mdChallengesStyle';
    st.textContent = [
      '#mdChallenges{background:var(--surface,#161b27);border:1px solid rgba(242,185,69,0.2);border-radius:16px;padding:14px 14px 10px;font-family:inherit;box-shadow:0 12px 40px rgba(0,0,0,.6);backdrop-filter:blur(10px);width:260px;max-width:calc(100vw - 90px)}',
      '#mdChallenges.hidden{display:none}',
      '.mdc-head{display:flex;align-items:center;gap:6px;margin-bottom:2px}',
      '.mdc-head .mdc-ico{font-size:16px;flex:none}',
      '.mdc-title{font-size:13px;font-weight:700;color:var(--text,#f3f4f6);flex:1}',
      '.mdc-sub{font-size:10px;color:var(--muted,#64748b);margin-bottom:10px;padding-left:22px}',
      '.mdc-close{background:none;border:none;color:var(--muted,#64748b);cursor:pointer;font-size:15px;padding:0 0 0 6px;line-height:1;flex:none}',
      '.mdc-grid{display:flex;flex-direction:column;gap:7px}',
      '.mdc-card{background:var(--card,#1c2233);border:1px solid var(--border,#2a3150);border-radius:10px;padding:9px 10px;display:flex;align-items:center;gap:10px}',
      '.mdc-card.done{border-color:rgba(34,192,138,0.35);background:rgba(34,192,138,0.05)}',
      '.mdc-card-left{flex:none;font-size:20px;line-height:1}',
      '.mdc-card-right{flex:1;min-width:0}',
      '.mdc-name{font-size:12px;font-weight:600;color:var(--text,#f3f4f6);margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.mdc-bar{height:4px;background:rgba(255,255,255,0.08);border-radius:100px;overflow:hidden;margin-bottom:4px}',
      '.mdc-fill{height:100%;border-radius:100px;background:linear-gradient(90deg,#f0b429,#f5c64d);transition:width .5s ease}',
      '.mdc-fill.full{background:linear-gradient(90deg,#22c08a,#34d399)}',
      '.mdc-foot{display:flex;justify-content:space-between;font-size:10px;color:var(--muted,#94a3b8)}',
      '.mdc-rew{color:#f5c64d;font-weight:700}',
      '.mdc-rew.got{color:#22c08a}'
    ].join('');
    document.head.appendChild(st);

    function _num(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

    function _estado() {
      const g = window.gamifEstado || {};
      const busquedas = _num(localStorage.getItem('md_busq_count'));
      // visitas / invitados: tomar del estado de gamificación si vienen, si no 0
      const visitas   = _num(g.visitas != null ? g.visitas : g.total_visitas);
      const invitados = _num(g.invitados != null ? g.invitados : g.referidos);
      return [
        { id: 'busq',  ico: 'ti-search',     name: 'Tu 1ª búsqueda', cur: Math.min(busquedas, 1),  goal: 1, rew: 20 },
        { id: 'visita',ico: 'ti-camera',     name: 'Registra 1 visita', cur: Math.min(visitas, 1),  goal: 1, rew: 30 },
        { id: 'invita',ico: 'ti-user-plus',  name: 'Invita 1 amigo', cur: Math.min(invitados, 1),    goal: 1, rew: 40 }
      ];
    }

    function _emoji(ico) {
      return ({ 'ti-search':'🔍', 'ti-camera':'📷', 'ti-user-plus':'👋' })[ico] || '⭐';
    }

    window._refreshDesafios = function() {
      const panel = document.getElementById('mdChallenges');
      if (!panel) return;
      // Si el usuario lo cerró, no reaparecer
      if (localStorage.getItem('md_desafios_cerrado') === '1') { panel.classList.add('hidden'); return; }
      const retos = _estado();
      const todos = retos.every(r => r.cur >= r.goal);
      if (todos) { panel.classList.add('hidden'); return; }
      const totalPts = retos.reduce((s, r) => s + r.rew, 0);
      panel.querySelector('.mdc-sub').textContent = '3 retos · gana hasta ' + totalPts + ' pts';
      panel.querySelector('.mdc-grid').innerHTML = retos.map(r => {
        const pct = Math.round((r.cur / r.goal) * 100);
        const ok = r.cur >= r.goal;
        return '<div class="mdc-card' + (ok ? ' done' : '') + '">' +
          '<div class="mdc-card-left">' + _emoji(r.ico) + '</div>' +
          '<div class="mdc-card-right">' +
            '<div class="mdc-name">' + r.name + '</div>' +
            '<div class="mdc-bar"><div class="mdc-fill' + (ok ? ' full' : '') + '" style="width:' + pct + '%"></div></div>' +
            '<div class="mdc-foot"><span>' + r.cur + '/' + r.goal + '</span>' +
            '<span class="mdc-rew' + (ok ? ' got' : '') + '">' + (ok ? '✓ ' : '+') + r.rew + ' pts</span></div>' +
          '</div>' +
        '</div>';
      }).join('');
      if (panel.classList.contains('hidden')) return;
      panel.classList.remove('hidden');
    };

    function _montar() {
      if (document.getElementById('mdChallenges')) { window._refreshDesafios(); return; }
      // Panel flotante (se abre desde el rail, no sobre las tarjetas)
      const panel = document.createElement('div');
      panel.id = 'mdChallenges';
      panel.className = 'hidden';
      panel.style.cssText = 'position:fixed;right:76px;bottom:18%;z-index:9100;width:260px;max-width:calc(100vw - 90px)';
      panel.innerHTML =
        '<div class="mdc-head">' +
          '<span class="mdc-ico">🚀</span>' +
          '<span class="mdc-title">Desafíos</span>' +
          '<button class="mdc-close" title="Cerrar">✕</button>' +
        '</div>' +
        '<div class="mdc-sub"></div>' +
        '<div class="mdc-grid"></div>';
      document.body.appendChild(panel);
      panel.querySelector('.mdc-close').addEventListener('click', () => {
        panel.classList.add('hidden');
        localStorage.setItem('md_desafios_cerrado', '1');
        if (typeof _lilaAutoRestaurar === 'function') _lilaAutoRestaurar();
      });
      // Siempre muestra (desde rail o auto-apertura diaria)
      window._mostrarDesafios = function() {
        var p = document.getElementById('mdChallenges');
        if (!p) return;
        localStorage.removeItem('md_desafios_cerrado');
        if (window._refreshDesafios) window._refreshDesafios();
        p.classList.remove('hidden');
      };
      // Toggle: solo para uso interno (auto-apertura del día ya lo llama)
      window._toggleDesafiosPanel = function() {
        if (panel.classList.contains('hidden')) {
          window._mostrarDesafios();
        } else {
          panel.classList.add('hidden');
        }
      };
      window._refreshDesafios();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _montar);
    } else { _montar(); }
    document.addEventListener('sesion-lista', () => setTimeout(window._refreshDesafios, 400));
  })();

  // ── Ordenar resultados (para comandos de voz) ─────────────────────────────
  // Orden por precio/cercanía: reutiliza el selector + render nativo (renderResults
  // lee #sortBy). Antes hacía un truco de CSS 'order' que no siempre se reflejaba.
  window._sortResultsByPrice = function() {
    const sel = document.getElementById('sortBy'); if (sel) sel.value = 'precio';
    if (typeof renderResults === 'function') renderResults();
  };
  window._sortResultsByDistance = function() {
    const sel = document.getElementById('sortBy'); if (sel) sel.value = 'distancia';
    if (typeof renderResults === 'function') renderResults();
  };

  // ── Búsqueda por voz / historial (asegura un modo de comercios) ───────────
  // buscar() se sale si no hay state.mode. Para la voz y el historial fijamos
  // un modo de comercios: 'almacen' actúa como "todos los comercios" (su bypass
  // de matchCat acepta cualquier categoría), así la búsqueda de texto recorre
  // todo el inventario y renderiza tarjetas + mapa.
  window._buscarVoz = async function(texto, _optsInternos) {
    // Mismo modo que el manual: 'almacen' carga TODOS los comercios.
    if (!state.mode || state.mode === 'combustible') state.mode = 'almacen';
    state.categoriaProducto = null;
    const q = (texto != null ? texto : (dom.productoInput ? dom.productoInput.value : '')) || '';
    if (dom.productoInput) dom.productoInput.value = q;

    // Asegurar que los comercios estén cargados (igual que cuando elegís un modo).
    if (!state.comercios || !state.comercios.length) {
      try { await cargarComerciosCercanos(); } catch(_) {}
    }

    if (state.comercios && state.comercios.length) {
      renderComerciosList(q.trim());
    }
    let cnt = document.querySelectorAll('.commerce-card').length;

    // ── Búsqueda progresiva (Lila al 100%, nivel 3) ──────────────────────────
    // Si no hay resultados, amplía radio al máximo; si sigue sin resultados,
    // busca en toda la comuna. Solo en modo de comercios, no en combustibles.
    const _nivelProg = (window.auth && auth.getUser) ? (auth.getUser()?.nivel || 1) : 1;
    const _progresivo = _optsInternos && _optsInternos.progresivo;
    if (cnt === 0 && !_progresivo && _nivelProg >= 3 && state.mode !== 'combustible') {
      // Paso 2: radio máximo
      const radioOriginal = currentRadius;
      if (window._aplicarRadio) window._aplicarRadio({ metros: 10000 });
      try { await cargarComerciosCercanos(); } catch(_) {}
      if (state.comercios && state.comercios.length) renderComerciosList(q.trim());
      cnt = document.querySelectorAll('.commerce-card').length;

      if (cnt === 0) {
        // Paso 3: toda la comuna — elimina filtro de radio y busca por texto
        try {
          const uid = window.usuarioActivo;
          const pos = state.userLat && state.userLng ? `&lat=${state.userLat}&lng=${state.userLng}&radio=50000` : '';
          const res = await fetch(`/api/usuario/comercios/nearby?q=${encodeURIComponent(q)}${pos}`, { credentials:'same-origin' }).then(r=>r.json());
          if (Array.isArray(res) && res.length) {
            state.comercios = res;
            renderComerciosList(q.trim());
            cnt = document.querySelectorAll('.commerce-card').length;
          }
        } catch(_) {}
      }
      // Restaurar radio original si no encontró nada
      if (cnt === 0 && window._aplicarRadio) window._aplicarRadio({ metros: radioOriginal });
    }

    if (q.trim().length >= 2) registrarBusqueda({ tipo: state.mode, termino: q.trim(), resultados: cnt });
    return cnt;
  };

  // ── Radio de búsqueda por voz ─────────────────────────────────────────────
  const RADIO_MIN = 500, RADIO_MAX = 10000, RADIO_PASO = 500;
  // metros = valor absoluto; delta = sumar/restar al actual. Devuelve km aplicados.
  window._aplicarRadio = function(opts) {
    opts = opts || {};
    let metros = currentRadius;
    if (typeof opts.metros === 'number') metros = opts.metros;
    if (typeof opts.delta === 'number') metros = currentRadius + opts.delta;
    metros = Math.max(RADIO_MIN, Math.min(RADIO_MAX, Math.round(metros / RADIO_PASO) * RADIO_PASO));
    currentRadius = metros;
    const txt = (currentRadius / 1000).toFixed(1) + ' km';
    ['radiusVal','radiusVal1','radiusValMap'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = txt; });
    ['radiusSlider','radiusSlider1','radiusSliderMap'].forEach(id => { const e = document.getElementById(id); if (e) e.value = currentRadius; });
    const badge = document.getElementById('appliedRadiusBadge');
    if (badge) badge.textContent = '📏 ' + txt;
    try { actualizarCirculoRadio(); ajustarZoomPorRadio(); } catch(_) {}
    if (state.mode === 'combustible' && state.fuelType) {
      buscar();
    } else if (state.mode && state.mode !== 'combustible') {
      // Recargar comercios en el nuevo radio y RE-APLICAR el filtro de texto
      // actual (si no, ampliar el rango perdía lo que estabas buscando).
      const q = (dom.productoInput ? dom.productoInput.value : '').trim();
      Promise.resolve(cargarComerciosCercanos()).then(() => {
        if (q && state.comercios && state.comercios.length) renderComerciosList(q);
      });
    } else {
      vistaGeneral();
    }
    return currentRadius / 1000;
  };
  window._radioActualKm = function() { return currentRadius / 1000; };

  // ── Control general de la app por voz ─────────────────────────────────────
  // Ejecuta una acción de la interfaz. Devuelve true si la reconoció.
  window._accionApp = function(accion) {
    // Abre Mi Cuenta y salta a una pestaña (perfil/compras/seguridad/reseñas/
    // favoritos/alertas/notificaciones/ayuda/acerca/config).
    const cuentaTab = (t) => {
      if (!(window.MiCuenta && MiCuenta.abrir)) return false;
      MiCuenta.abrir();
      if (t) setTimeout(() => MiCuenta.tab && MiCuenta.tab(t), 250);
      return true;
    };
    const legal = (url, titulo) => { if (window.abrirPopupLegal) { abrirPopupLegal(url, titulo); return true; } return false; };
    switch (accion) {
      // Carrito / comprar
      case 'carrito':
      case 'comprar':   if (window.Carrito && Carrito.abrir) { Carrito.abrir(); return true; } break;
      // Mi Cuenta y sus pestañas
      case 'cuenta':    return cuentaTab(null);
      case 'perfil':    return cuentaTab('perfil');
      case 'favoritos': return cuentaTab('favoritos');
      case 'compras':   return cuentaTab('compras');
      case 'seguridad': return cuentaTab('seguridad');
      case 'resenas':   return cuentaTab('reseñas');
      case 'alertas':   return cuentaTab('alertas');
      case 'avisos':    return cuentaTab('notificaciones');
      case 'ayuda':     return cuentaTab('ayuda');
      case 'acerca':    return cuentaTab('acerca');
      case 'config':    return cuentaTab('config');
      // Acciones directas
      case 'escanear':  if (window.abrirEscanerQR) { abrirEscanerQR(); return true; } break;
      case 'nivel':     if (window.abrirNivelPopup) { abrirNivelPopup(); return true; } break;
      case 'gps':       if (window.toggleGPS) { toggleGPS(); return true; } break;
      // IR: navegar (ruta Google Maps/Waze) al comercio/estación elegido.
      case 'ir': {
        const cdp = document.getElementById('cdpMapsBtn');        // detalle de comercio abierto
        if (cdp && getComputedStyle(cdp).display !== 'none') { cdp.click(); return true; }
        const irCard = document.querySelector('#resultsList button.cv2-ir'); // 1er resultado
        if (irCard) { irCard.click(); return true; }
        if (window.mostrarToast) mostrarToast('Primero elige un comercio o estación', 3000);
        break;
      }
      // MAPA: cerrar paneles/modales para dejar el mapa a la vista.
      case 'mapa':
        document.querySelectorAll('.modal,.mc-panel,.cart-panel,#commerceDetailPanel').forEach(p => p.classList && p.classList.remove('open'));
        { const bd = document.getElementById('cdpBackdrop'); if (bd) bd.classList.remove('open'); }
        return true;
      case 'filtros':   { const b = document.getElementById('btnToggleAdvanced') || document.getElementById('btnToggleCommerceAdvanced'); if (b) { b.click(); return true; } break; }
      case 'ordenar-barato': if (window._sortResultsByPrice)    { window._sortResultsByPrice();    return true; } break;
      case 'ordenar-cerca':  if (window._sortResultsByDistance) { window._sortResultsByDistance(); return true; } break;
      case 'reportar': { const b = document.querySelector('button.cv2-reportar'); if (b) { b.click(); return true; } if (window.mostrarToast) mostrarToast('Abre un comercio con precio para reportar', 3000); break; }
      // Tema
      case 'tema-dia':   if (window.MiCuenta && MiCuenta.aplicarTema) { MiCuenta.aplicarTema('light'); return true; } break;
      case 'tema-noche': if (window.MiCuenta && MiCuenta.aplicarTema) { MiCuenta.aplicarTema('dark');  return true; } break;
      case 'tema-auto':  if (window.MiCuenta && MiCuenta.aplicarTema) { MiCuenta.aplicarTema('auto');  return true; } break;
      // Contenido / legal / demo
      case 'manual':       return legal('usuario/manual-usuario.html', 'Manual de usuario');
      case 'terminos':     return legal('legal/terminos.html', 'Términos y Condiciones');
      case 'privacidad':   return legal('legal/privacidad.html', 'Política de Privacidad');
      case 'presentacion': if (window.LilaDemo && LilaDemo.iniciar) { LilaDemo.iniciar({ conLogin: true }); return true; } break;
      case 'cerrar-sesion':if (window.MiCuenta && MiCuenta.cerrarSesion) { MiCuenta.cerrarSesion(); return true; } break;
      case 'desafios':     if (window._toggleDesafiosPanel) { window._toggleDesafiosPanel(); return true; } break;
      case 'inicio':
        document.querySelectorAll('.modal,.mc-panel,.cart-panel').forEach(p => p.classList && p.classList.remove('open'));
        if (window.MiCuenta && MiCuenta.cerrar) try { MiCuenta.cerrar(); } catch(_) {}
        vistaGeneral();
        return true;
      case 'limpiar':
        dom.productoInput.value = '';
        vistaGeneral();
        return true;
    }
    return false;
  };
  // Activa un modo/categoría por su data-cat (si el botón está habilitado).
  window._activarCategoria = function(cat) {
    const btn = document.querySelector('.cat-tab[data-cat="' + cat + '"]');
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  };

  // Búsqueda de COMBUSTIBLES por voz: activa el modo, elige el tipo (93/95/97/DI/KE)
  // y ejecuta la búsqueda de estaciones (buscar()). Devuelve la cantidad encontrada.
  window._activarCombustibleVoz = async function(ft) {
    // Activar modo combustible (como tocar la pestaña).
    if (state.mode !== 'combustible') {
      const btn = document.querySelector('.cat-tab[data-cat="combustible"]');
      if (btn) btn.click(); else { state.mode = 'combustible'; try { actualizarUIporModo(); } catch(_){} }
    }
    if (ft) {
      state.fuelType = ft;
      document.querySelectorAll('.fuel-chip').forEach(c => c.classList.toggle('active', c.dataset.val === ft));
      window._origenBusqueda = 'voz';
      await Promise.resolve(buscar());
    }
    return (state.results && state.results.length) || 0;
  };

  // ── COMPARTIR COMERCIO ───────────────────────────────────────────────────
  window.compartirComercio = async function() {
    const c = state.comercioActivo;
    if (!c) return;
    const titulo = c.nombre || 'Comercio';
    const texto = `${titulo}${c.direccion ? ' — ' + c.direccion : ''}${c.comuna ? ', ' + c.comuna : ''}`;
    const url = window.location.origin + 'usuario/index.html';
    if (navigator.share) {
      try { await navigator.share({ title: titulo, text: texto, url }); } catch (_) {}
    } else {
      try { await navigator.clipboard.writeText(`${texto}\n${url}`); window.mostrarToast('📋 Copiado al portapapeles'); } catch (_) { window.mostrarToast('No se pudo compartir'); }
    }
  };

  // ── SKELETON LOADERS ─────────────────────────────────────────────────────
  function mostrarSkeletons(n) {
    const el = document.getElementById('resultsList');
    if (!el) return;
    el.innerHTML = Array(n || 4).fill(`<div class="skeleton skeleton-card" style="margin-bottom:10px;border-radius:14px"></div>`).join('');
  }

  // Parchar buscar() para guardar historial Y mostrar skeletons
  const _buscarOrigConSkel = buscar;
  buscar = async function() {
    const texto = (dom.productoInput.value || '').trim();
    if (texto) historialGuardar(texto);
    mostrarSkeletons(4);
    return _buscarOrigConSkel.apply(this, arguments);
  };

  // ── VISTO RECIENTEMENTE ──────────────────────────────────────────────────
  const RECENT_KEY = 'mercadate_recientes';
  const RECENT_MAX = 6;

  function recentesGuardar(comercio) {
    if (!comercio || !comercio.id) return;
    let lista = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    lista = [{ id: comercio.id, nombre: comercio.nombre, comuna: comercio.comuna }, ...lista.filter(c => c.id !== comercio.id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(lista));
  }

  function recentesMostrar() {
    const lista = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const el = document.getElementById('resultsList');
    if (!lista.length || !el) return;
    const html = `<div style="padding:10px 4px 6px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">🕐 Vistos recientemente</div>
      ${lista.map(c => `<div class="sh-item" style="padding:9px 12px;cursor:pointer;border-radius:10px;margin-bottom:4px;background:var(--card2,#1a2233)"
          onclick="window._abrirReciente(${c.id})">
        <span style="font-size:14px">🏪</span>
        <div style="flex:1"><div style="font-weight:600;font-size:13px">${c.nombre||''}</div><div style="font-size:11px;color:var(--muted)">${c.comuna||''}</div></div>
      </div>`).join('')}
    </div>`;
    el.innerHTML = html;
  }

  window._abrirReciente = function(id) {
    const c = state.comercios.find(x => x.id === id);
    if (c && window._abrirDetallePorComercio) window._abrirDetallePorComercio(c);
  };

  // ── GOOGLE MAPS BUTTON en panel de detalle ────────────────────────────────
  (function() {
    const panel = document.getElementById('commerceDetailPanel');
    if (!panel) return;
    new MutationObserver(() => {
      if (!panel.classList.contains('open')) return;
      const c = state.comercioActivo;
      if (!c) return;
      // Share btn
      const shareBtn = document.getElementById('cdpShareBtn');
      if (shareBtn) shareBtn.style.display = 'flex';
      // Botón "Cómo llegar" usando preferencia de mapa del usuario
      const _mapaUrl = (lat, lng) => {
        const pref = (window.SafeStorage ? window.SafeStorage.get('mercadate_mapa_pref') : localStorage.getItem('mercadate_mapa_pref')) || 'google';
        return pref === 'waze'
          ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
          : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      };
      if (!document.getElementById('cdpMapsBtn') && c.lat && c.lng) {
        const strip = document.getElementById('cdpInfoStrip');
        if (strip) {
          const mapsLink = document.createElement('a');
          mapsLink.id = 'cdpMapsBtn';
          mapsLink.href = _mapaUrl(c.lat, c.lng);
          mapsLink.target = '_blank'; mapsLink.rel = 'noopener';
          mapsLink.className = 'cdp-wa-btn';
          mapsLink.style.cssText = 'display:flex;text-decoration:none';
          mapsLink.textContent = '📍 Cómo llegar';
          strip.appendChild(mapsLink);
          if (strip.style.display === 'none') strip.style.display = 'flex';
        }
      } else if (document.getElementById('cdpMapsBtn') && c.lat && c.lng) {
        const btn = document.getElementById('cdpMapsBtn');
        btn.href = _mapaUrl(c.lat, c.lng);
        btn.style.display = 'flex';
      } else if (document.getElementById('cdpMapsBtn')) {
        document.getElementById('cdpMapsBtn').style.display = 'none';
      }
      // Guardar en recientes
      recentesGuardar(c);
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  })();

  // ── AUTOCOMPLETADO DE PRODUCTOS ──────────────────────────────────────────
  (function() {
    let _debTimer = null;
    let _acDd = null;
    if (!dom.productoInput) return;

    dom.productoInput.addEventListener('input', () => {
      clearTimeout(_debTimer);
      const q = dom.productoInput.value.trim();
      if (q.length < 2) { _cerrarAC(); return; }
      _debTimer = setTimeout(async () => {
        try {
          const r = await fetch('/api/productos/sugerencias?q=' + encodeURIComponent(q));
          const data = await r.json();
          _mostrarAC(data.sugerencias || []);
        } catch(_) {}
      }, 280);
    });

    function _mostrarAC(items) {
      if (!items.length) { _cerrarAC(); return; }
      if (!_acDd) {
        _acDd = document.createElement('div');
        _acDd.id = 'acDropdown';
        _acDd.className = 'search-history-dropdown';
        dom.productoInput.parentNode.style.position = 'relative';
        dom.productoInput.parentNode.appendChild(_acDd);
      }
      _acDd.innerHTML = items.map(s =>
        `<div class="sh-item" onclick="document.getElementById('productoInput').value=${JSON.stringify(s)};window._cerrarACGlobal();window.buscarDesdeHistorial()"><span class="sh-item-icon">🔎</span>${s}</div>`
      ).join('');
      _acDd.classList.add('open');
    }

    function _cerrarAC() {
      if (_acDd) _acDd.classList.remove('open');
    }

    window._cerrarACGlobal = _cerrarAC;
    dom.productoInput.addEventListener('blur', () => setTimeout(_cerrarAC, 150));
  })();

  // ── PLACEHOLDER DINÁMICO ─────────────────────────────────────────────────
  const PLACEHOLDERS = {
    productos: '🔍 ¿Qué producto buscas?',
    servicios: '🔍 ¿Qué servicio necesitas?',
    gastronomia: '🔍 ¿Qué quieres comer?',
    consumo: '🔍 ¿Qué buscas?',
    default: '🔍 Buscar producto…'
  };
  const _placeholderOrig = dom.productoInput ? dom.productoInput.placeholder : '';

  function actualizarPlaceholder() {
    if (!dom.productoInput) return;
    const cat = state.mode || 'default';
    dom.productoInput.placeholder = PLACEHOLDERS[cat] || PLACEHOLDERS.default;
  }

  // ── PRE-FILL INVITANTE DESDE URL ─────────────────────────────────────────
  (function() {
    const params = new URLSearchParams(window.location.search);
    const inv = params.get('invitante');
    if (!inv) return;
    // Esperar a que el overlay esté en DOM
    const tryFill = () => {
      const el = document.getElementById('ul_reg_invitante');
      if (el) { el.value = inv; return; }
      setTimeout(tryFill, 500);
    };
    setTimeout(tryFill, 800);
  })();

  // ── HOOK: history dropdown on focus ──────────────────────────────────────
  if (dom.productoInput) {
    dom.productoInput.addEventListener('focus', () => {
      if (!dom.productoInput.value) { historialMostrar(); recentesMostrar(); }
    });
    dom.productoInput.addEventListener('blur', historialOcultar);
    dom.productoInput.addEventListener('input', () => {
      const dd = document.getElementById('searchHistDd');
      if (dd && dom.productoInput.value) dd.classList.remove('open');
    });
  }


  // Exponer para uso desde voz/historial
  window._abrirDetallePorComercio = function(c) {
    if (typeof abrirDetalle === 'function') abrirDetalle(c);
  };

  init();
})();
