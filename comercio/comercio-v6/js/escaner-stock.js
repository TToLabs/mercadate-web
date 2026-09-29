// PLATAFORMA : Comercio V6 — escáner de código de barras para cargar stock
// Cámara del teléfono (html5-qrcode autohospedado en /vendor) → busca el código
// en el inventario del local activo:
//   · existe  → sumar al stock (entrada de mercadería) o fijar el conteo
//   · no existe → alta rápida con el código ya cargado
// Stock por PATCH /api/productos/:id/stock (no reescribe el local completo).
// La cámara solo funciona en contexto seguro (https o localhost).
window.escanerStock = (function () {
  var lector = null, leyendo = false, actual = null, codigoLeido = '', ficha = null, fotoNueva = '';
  function $(id) { return document.getElementById(id); }
  function toast(m, t) { try { app.toast(m, t); } catch (e) {} }
  function normalizar(v) { var s = String(v || '').replace(/\D/g, ''); return s.length >= 6 && s.length <= 18 ? s : ''; }

  function paso(nombre) {
    ['cv6ScanPasoLeer', 'cv6ScanPasoExiste', 'cv6ScanPasoNuevo'].forEach(function (id) {
      $(id).hidden = id !== 'cv6ScanPaso' + nombre;
    });
  }

  function abrir() {
    if (!app.STATE || !app.STATE.activeLocal) return toast('Elegí un local primero', 'err');
    app.abrirModal('cv6ScanModal');
    $('cv6ScanManual').value = '';
    paso('Leer');
    iniciarCamara();
  }

  function cerrar() { detenerCamara(); app.cerrarModal('cv6ScanModal'); }

  function iniciarCamara() {
    var aviso = $('cv6ScanAviso');
    aviso.textContent = '';
    if (!window.isSecureContext) {
      aviso.textContent = 'La cámara necesita una conexión segura (https). Escribe el código a mano.';
      return;
    }
    if (typeof Html5Qrcode === 'undefined') {
      aviso.textContent = 'No se pudo cargar el lector. Escribe el código a mano.';
      return;
    }
    var F = window.Html5QrcodeSupportedFormats || {};
    var formatos = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.ITF].filter(function (x) { return x !== undefined; });
    try {
      lector = new Html5Qrcode('cv6ScanLector', formatos.length ? { formatsToSupport: formatos, verbose: false } : undefined);
    } catch (e) { aviso.textContent = 'No se pudo iniciar el lector.'; return; }
    leyendo = true;
    lector.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: function (w, h) { var a = Math.min(w * 0.85, 320); return { width: a, height: Math.round(a * 0.5) }; } },
      function (texto) { if (leyendo) { leyendo = false; alLeer(texto); } },
      function () { /* sin código en este cuadro: normal */ }
    ).catch(function (err) {
      leyendo = false;
      var m = String(err || '');
      aviso.textContent = /Permission|NotAllowed/i.test(m)
        ? 'Sin permiso de cámara. Actívalo en el navegador o escribe el código a mano.'
        : 'No se encontró una cámara disponible. Escribe el código a mano.';
    });
  }

  function detenerCamara() {
    leyendo = false;
    if (!lector) return;
    var l = lector; lector = null;
    try { l.stop().then(function () { try { l.clear(); } catch (e) {} }).catch(function () {}); } catch (e) {}
  }

  function usarManual() {
    var c = normalizar($('cv6ScanManual').value);
    if (!c) return toast('Código inválido: solo números, 6 a 18 dígitos', 'err');
    detenerCamara();
    alLeer(c);
  }

  function alLeer(texto) {
    var codigo = normalizar(texto);
    if (!codigo) { toast('No es un código de barras de producto', 'err'); leyendo = true; return; }
    try { navigator.vibrate && navigator.vibrate(60); } catch (e) {}
    detenerCamara();
    codigoLeido = codigo;
    var prods = (app.STATE.activeLocal.productos || []);
    actual = prods.find(function (p) { return p.codigo_barras === codigo; }) || null;
    if (actual) mostrarExistente(); else mostrarNuevo();
  }

  function mostrarExistente() {
    $('cv6ScanNombre').textContent = actual.nombre || '—';
    $('cv6ScanCodigo').textContent = codigoLeido;
    var sinControl = actual.stock == null;
    $('cv6ScanStock').textContent = sinControl ? 'Sin registrar' : String(actual.stock);
    $('cv6ScanStock').classList.toggle('cv6-sin', sinControl);
    $('cv6ScanCant').value = 1;
    paso('Existe');
    setTimeout(function () { $('cv6ScanCant').focus(); $('cv6ScanCant').select(); }, 50);
  }

  function mostrarNuevo() {
    $('cv6ScanNuevoCodigo').textContent = codigoLeido;
    $('cv6NNombre').value = ''; $('cv6NPrecio').value = ''; $('cv6NStock').value = '1';
    // Mismas categorías que el alta normal (las llena productos.js en #n_categoria)
    try { if (window.productos && productos.poblarCategorias) productos.poblarCategorias(); } catch (e) {}
    var origen = $('n_categoria'), destino = $('cv6NCategoria');
    destino.innerHTML = origen ? origen.innerHTML : '<option value="">Sin categoría</option>';
    $('cv6NMarca').value = ''; $('cv6NPesoN').value = ''; $('cv6NPesoU').value = 'ml';
    ficha = null; fotoNueva = ''; cerrarGuia();
    $('cv6ScanFicha').hidden = false; $('cv6ScanImg').hidden = true; $('cv6ScanBtnFoto').hidden = true;
    $('cv6ScanFichaTxt').textContent = 'Buscando el producto…';
    paso('Nuevo');
    setTimeout(function () { $('cv6NNombre').focus(); }, 50);
    buscarFicha(codigoLeido);
  }

  // Ficha pública del código (Open Food Facts vía backend): rellena solo campos vacíos.
  async function buscarFicha(codigo) {
    var r = await api.get('/codigo-barras/' + codigo);
    if (codigo !== codigoLeido) return; // ya se escaneó otro
    var d = r && r.data;
    if (!r.ok || !d || !d.encontrado) {
      $('cv6ScanFichaTxt').textContent = d && d.sin_conexion ? 'No se pudo consultar la ficha. Complétala a mano.' : 'Sin ficha para este código. Complétala a mano y sácale una foto.';
      $('cv6ScanBtnFoto').hidden = false;
      return;
    }
    ficha = d;
    if (!$('cv6NNombre').value) $('cv6NNombre').value = [d.nombre, d.marca && d.nombre.indexOf(d.marca) < 0 ? d.marca : '', d.contenido].filter(Boolean).join(' ');
    if (!$('cv6NMarca').value) $('cv6NMarca').value = d.marca || '';
    if (!$('cv6NPesoN').value) ponerContenido(d.contenido);
    $('cv6ScanFichaTxt').textContent = 'Ficha encontrada (' + d.origen + '). Revisa y agrega el precio.';
    if (d.imagen_url) { $('cv6ScanImg').src = d.imagen_url; $('cv6ScanImg').hidden = false; }
    else $('cv6ScanBtnFoto').hidden = false; // hay ficha pero sin foto: se pide
    $('cv6NPrecio').focus();
  }

  // ── Nombre ordenado: espacios limpios y Mayúscula Inicial (conectores en minúscula;
  //    siglas y unidades se respetan). No corrige ortografía.
  var MINUS = { de: 1, del: 1, la: 1, el: 1, los: 1, las: 1, y: 1, con: 1, sin: 1, en: 1, para: 1, a: 1 };
  var UNIDADES = { ml: 'ml', l: 'L', lt: 'L', lts: 'L', litro: 'L', litros: 'L', cc: 'ml', g: 'g', gr: 'g', grs: 'g', gramos: 'g', kg: 'kg', kilo: 'kg', kilos: 'kg' };
  function ordenarNombre(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().split(' ').map(function (w, i) {
      var b = w.toLowerCase();
      if (UNIDADES[b] && i > 0) return UNIDADES[b];
      if (i > 0 && MINUS[b]) return b;
      if (w.length > 1 && w.length <= 4 && w === w.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(w)) return w; // sigla
      return b.charAt(0).toUpperCase() + b.slice(1);
    }).join(' ');
  }
  // Contenido = número + unidad (ml, L, g, kg). Acepta "350 ml", "1,5 L", "500g", "1 kilo".
  function ponerContenido(txt) {
    var m = String(txt || '').replace(',', '.').match(/([\d.]+)\s*([a-zA-Z]+)?/);
    if (!m) return;
    $('cv6NPesoN').value = parseFloat(m[1]) || '';
    var u = UNIDADES[String(m[2] || '').toLowerCase()];
    if (u) $('cv6NPesoU').value = u;
  }
  function leerContenido() {
    var n = parseFloat(String($('cv6NPesoN').value).replace(',', '.'));
    return n > 0 ? String(n).replace('.', ',') + ' ' + $('cv6NPesoU').value : '';
  }

  // ── Foto limpia y uniforme: producto principal centrado sobre fondo blanco, 800×800 ──
  // En la APK el plugin nativo FotoLimpia (ML Kit) recorta el producto del fondo;
  // en el navegador solo se encuadra sobre blanco (sin recorte).
  var LADO = 800;
  function cargarImagen(src) {
    return new Promise(function (ok, mal) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = mal; i.src = src; });
  }
  function encuadrar(img, fondo) {
    var c = document.createElement('canvas'); c.width = c.height = LADO;
    var x = c.getContext('2d');
    x.fillStyle = fondo || '#ffffff'; x.fillRect(0, 0, LADO, LADO);
    var esc = Math.min(LADO * 0.84 / img.width, LADO * 0.84 / img.height);
    var w = img.width * esc, h = img.height * esc;
    x.drawImage(img, (LADO - w) / 2, (LADO - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.85);
  }
  // Foto de la cámara → JPEG derecho y reducido (el navegador ya aplica la rotación EXIF)
  function reducir(img, max) {
    var esc = Math.min(1, max / Math.max(img.width, img.height));
    var c = document.createElement('canvas'); c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }
  // ── Barrido: guía en video → grabar 3 s → se elige el cuadro más nítido ──
  function abrirGuia() {
    $('cv6ScanGuia').hidden = false;
    var v = $('cv6ScanGuia').querySelector('video');
    try { v.currentTime = 0; v.play(); } catch (e) {}
  }
  function cerrarGuia() {
    $('cv6ScanGuia').hidden = true;
    try { $('cv6ScanGuia').querySelector('video').pause(); } catch (e) {}
  }
  function grabar() { cerrarGuia(); $('cv6ScanVideoIn').click(); }
  function fotoSuelta() { cerrarGuia(); $('cv6ScanFotoIn').click(); }

  // Nitidez = varianza del laplaciano en una versión chica y en gris (más alta = más nítido)
  function nitidez(ctx, w, h) {
    var d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h), i, x, y;
    for (i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    var suma = 0, suma2 = 0, n = 0;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      suma += l; suma2 += l * l; n++;
    }
    var m = suma / n; return suma2 / n - m * m;
  }
  function irA(video, t) {
    return new Promise(function (ok) {
      var listo = function () { video.removeEventListener('seeked', listo); ok(); };
      video.addEventListener('seeked', listo); video.currentTime = t;
      setTimeout(listo, 1500);
    });
  }
  async function mejorCuadro(url) {
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise(function (ok, mal) { v.onloadeddata = ok; v.onerror = mal; setTimeout(ok, 5000); });
    var dur = isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
    var W = v.videoWidth, H = v.videoHeight;
    if (!W || !H) throw new Error('video sin cuadros');
    var cw = 240, ch = Math.round(240 * H / W);
    var chico = document.createElement('canvas'); chico.width = cw; chico.height = ch;
    var cx = chico.getContext('2d', { willReadFrequently: true });
    var esc = Math.min(1, 1280 / Math.max(W, H));
    var t0 = dur * 0.12, t1 = dur * 0.88;   // se evita el inicio y el final (movidos)
    var mejor = -1, guardado = null;
    function evaluar() {
      cx.drawImage(v, 0, 0, cw, ch);
      var n = nitidez(cx, cw, ch);
      if (n > mejor) {
        mejor = n;
        if (!guardado) { guardado = document.createElement('canvas'); guardado.width = Math.round(W * esc); guardado.height = Math.round(H * esc); }
        guardado.getContext('2d').drawImage(v, 0, 0, guardado.width, guardado.height);
      }
    }
    if ('requestVideoFrameCallback' in v) {
      // Rápido: se reproduce a 2× y se mide cada cuadro al pasar
      await new Promise(function (ok) {
        var hecho = false;
        function fin() { if (hecho) return; hecho = true; try { v.pause(); } catch (e) {} ok(); }
        function cb(now, meta) {
          if (meta.mediaTime >= t0 && meta.mediaTime <= t1) evaluar();
          if (v.ended || meta.mediaTime >= t1) fin(); else v.requestVideoFrameCallback(cb);
        }
        v.onended = fin;
        setTimeout(fin, 9000);
        v.currentTime = t0;
        v.playbackRate = 2;
        var pr = v.play();
        if (pr && pr.then) pr.then(function () { v.requestVideoFrameCallback(cb); }).catch(fin);
        else v.requestVideoFrameCallback(cb);
      });
    }
    if (!guardado) {
      // Alternativa: saltar a 8 instantes del video
      var N = 8;
      for (var k = 0; k < N; k++) {
        await irA(v, Math.min(dur - 0.05, dur * (0.12 + 0.76 * k / (N - 1))));
        evaluar();
      }
    }
    if (!guardado) throw new Error('sin cuadros');
    return guardado.toDataURL('image/jpeg', 0.92);
  }
  async function alElegirVideo(input) {
    var f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    $('cv6ScanFichaTxt').textContent = 'Eligiendo el mejor cuadro…';
    var url = URL.createObjectURL(f);
    try {
      var base = await mejorCuadro(url);
      await procesarBase(base);
    } catch (e) {
      $('cv6ScanFichaTxt').textContent = 'No se pudo leer el video. Prueba con "Mejor una foto".';
      $('cv6ScanBtnFoto').hidden = false;
    } finally { URL.revokeObjectURL(url); }
  }

  async function alElegirFoto(input) {
    var f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    var url = URL.createObjectURL(f);
    try {
      await procesarBase(reducir(await cargarImagen(url), 1280));
    } catch (e) {
      $('cv6ScanFichaTxt').textContent = 'No se pudo procesar la foto. Intenta de nuevo.';
    } finally { URL.revokeObjectURL(url); }
  }

  async function procesarBase(base) {
    $('cv6ScanFichaTxt').textContent = 'Limpiando la foto…';
    window._fotoBase = base; // solo en memoria: permite repetir el procesado con la misma toma
    {
      var plugin = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.FotoLimpia;
      var final = '';
      if (plugin) {
        try { final = (await plugin.limpiar({ imagen: base, lado: LADO, fondo: '#FFFFFF', estilo: 'gondola' })).imagen || ''; } catch (e) { final = ''; }
      }
      if (!final) final = encuadrar(await cargarImagen(base), '#ffffff');
      fotoNueva = final;
      $('cv6ScanImg').src = final; $('cv6ScanImg').hidden = false;
      $('cv6ScanFichaTxt').textContent = plugin ? 'Foto lista.' : 'Foto lista (sin recorte de fondo en el navegador).';
      $('cv6ScanBtnFoto').textContent = '🎥 Repetir toma';
    }
  }

  async function guardarStock(modo) {
    var n = parseInt($('cv6ScanCant').value, 10);
    if (!Number.isFinite(n) || n < 0) return toast('Cantidad inválida', 'err');
    if (!actual || !actual.id) return toast('Producto sin id: recarga el inventario', 'err');
    var cuerpo = modo === 'fijar' ? { stock: n } : { delta: n };
    var r = await api.patch('/productos/' + actual.id + '/stock', cuerpo);
    if (!r.ok || !r.data || !r.data.success) return toast((r.data && r.data.message) || 'No se pudo guardar el stock', 'err');
    actual.stock = r.data.stock;
    toast(actual.nombre + ': stock ' + r.data.stock, 'ok');
    siguiente();
  }

  // Alta rápida: mismo guardado que "Agregar Nuevo" (productos.js), con código y stock.
  async function guardarNuevo() {
    var local = app.STATE.activeLocal;
    var nombre = ordenarNombre($('cv6NNombre').value);
    $('cv6NNombre').value = nombre;
    $('cv6NMarca').value = ordenarNombre($('cv6NMarca').value);
    var precio = parseFloat($('cv6NPrecio').value);
    if (!nombre || isNaN(precio)) return toast('Nombre y precio son obligatorios', 'err');
    var stock = $('cv6NStock').value === '' ? null : Math.max(0, parseInt($('cv6NStock').value, 10) || 0);
    var nuevo = {
      nombre: nombre, precio: precio, categoria: $('cv6NCategoria').value || '',
      marca: $('cv6NMarca').value.trim(), peso: leerContenido(), descripcion: '', estado: 'habilitado',
      codigo_barras: codigoLeido, stock: stock,
      ultima_actualizacion: new Date().toISOString()
    };
    var owner = app.STATE.owner || {};
    var r = await api.post('/locales', {
      owner: { username: owner.username, whatsapp_admin: owner.whatsapp_admin },
      local: {
        id: local.id, nombre: local.nombre, comuna: local.comuna,
        direccion: local.direccion || '', categoria: local.categoria || '',
        horario: local.horario || '', plan: local.plan,
        whatsapp_publico: local.whatsapp_publico || null,
        aprobado: local.aprobado !== undefined ? local.aprobado : true,
        estado_suscripcion: local.estado_suscripcion || 'activa',
        fecha_vencimiento: local.fecha_vencimiento || null,
        productos: (local.productos || []).concat([nuevo])
      }
    });
    if (!r.ok || !r.data || !r.data.success) return toast((r.data && r.data.message) || 'Error al guardar', 'err');
    toast('Producto agregado con su código', 'ok');
    await app.recargarLocales();
    // Catálogo compartido: si el código no tenía ficha o foto, este comercio la aporta
    var cod = codigoLeido, imgUrl = ficha && ficha.imagen_url;
    if (!ficha || !ficha.nombre || (!imgUrl && fotoNueva)) {
      var c = await api.post('/catalogo/' + cod, {
        nombre: nombre, marca: nuevo.marca, contenido: nuevo.peso, imagen: imgUrl ? '' : fotoNueva
      });
      if (c.ok && c.data && c.data.success) imgUrl = c.data.imagen_url || imgUrl;
    }
    // Foto del catálogo (enlace, no se copia) como foto del producto
    if (imgUrl) {
      var loc = app.STATE.activeLocal || {};
      var p = (loc.productos || []).find(function (x) { return x.codigo_barras === cod; });
      if (p && p.id) {
        var f = await api.post('/productos/' + p.id + '/foto-remota', { url: imgUrl });
        if (!f.ok || !f.data || !f.data.success) toast((f.data && f.data.message) || 'No se pudo guardar la foto', 'err');
        else await app.recargarLocales();
      }
    }
    siguiente();
  }

  function siguiente() {
    actual = null; codigoLeido = '';
    $('cv6ScanManual').value = '';
    paso('Leer');
    iniciarCamara();
  }

  return { _mejorCuadro: mejorCuadro, abrir: abrir, cerrar: cerrar, usarManual: usarManual, alElegirFoto: alElegirFoto, alElegirVideo: alElegirVideo, abrirGuia: abrirGuia, grabar: grabar, fotoSuelta: fotoSuelta, guardarStock: guardarStock, guardarNuevo: guardarNuevo, siguiente: siguiente };
})();
