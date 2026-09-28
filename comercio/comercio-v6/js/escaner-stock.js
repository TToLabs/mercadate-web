// PLATAFORMA : Comercio V6 — escáner de código de barras para cargar stock
// Cámara del teléfono (html5-qrcode autohospedado en /vendor) → busca el código
// en el inventario del local activo:
//   · existe  → sumar al stock (entrada de mercadería) o fijar el conteo
//   · no existe → alta rápida con el código ya cargado
// Stock por PATCH /api/productos/:id/stock (no reescribe el local completo).
// La cámara solo funciona en contexto seguro (https o localhost).
window.escanerStock = (function () {
  var lector = null, leyendo = false, actual = null, codigoLeido = '';
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
    paso('Nuevo');
    setTimeout(function () { $('cv6NNombre').focus(); }, 50);
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
    var nombre = $('cv6NNombre').value.trim();
    var precio = parseFloat($('cv6NPrecio').value);
    if (!nombre || isNaN(precio)) return toast('Nombre y precio son obligatorios', 'err');
    var stock = $('cv6NStock').value === '' ? null : Math.max(0, parseInt($('cv6NStock').value, 10) || 0);
    var nuevo = {
      nombre: nombre, precio: precio, categoria: $('cv6NCategoria').value || '',
      marca: '', peso: '', descripcion: '', estado: 'habilitado',
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
    siguiente();
  }

  function siguiente() {
    actual = null; codigoLeido = '';
    $('cv6ScanManual').value = '';
    paso('Leer');
    iniciarCamara();
  }

  return { abrir: abrir, cerrar: cerrar, usarManual: usarManual, guardarStock: guardarStock, guardarNuevo: guardarNuevo, siguiente: siguiente };
})();
