// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comerciante
// ARCHIVO    : locales.js
// ═══════════════════════════════════════════════════
// locales.js — Gestión de los locales del comerciante
window.locales = (function () {
  const { STATE, $, toast } = app;

  function render() {
    const grid = $('localesGrid');
    if (!STATE.allLocales.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <span class="es-icon">🏪</span>
        <div class="es-title">Aún no tienes locales</div>
        <div class="es-sub">Agrega tu primer local con el botón superior</div>
      </div>`;
      return;
    }

    grid.innerHTML = STATE.allLocales.map((l, idx) => {
      const plan = app.getPlan(l.plan || 0);
      const cupo = app.cupoEfectivo(l);
      const activos = (l.productos || []).filter(p => p.estado === 'habilitado').length;
      const esCurrent = STATE.activeLocal && l.id === STATE.activeLocal.id;
      return `
        <div class="local-card" style="${esCurrent ? 'border-color:var(--accent);background:var(--accent-light)' : ''}">
          <div class="local-card-header">
            <div>
              <div class="local-card-title">${app.escapeHtml(l.nombre)}</div>
              <div class="local-card-sub">${app.escapeHtml(l.categoria || l.tipo_negocio || 'Comercio')}</div>
            </div>
            <span style="background:${plan.color}20;color:${plan.color};font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap">
              ${plan.icon} ${plan.nombre}
            </span>
          </div>
          <div class="local-card-data">
            ${l.direccion ? `<div class="local-card-row">📍 <strong>${app.escapeHtml(l.direccion)}</strong></div>` : ''}
            <div class="local-card-row">🏙️ <strong>${app.escapeHtml(l.comuna || '—')}</strong></div>
            ${l.horario ? `<div class="local-card-row">🕐 <strong>${app.escapeHtml(l.horario)}</strong></div>` : ''}
            <div class="local-card-row">📦 <strong>${activos}/${cupo === Infinity ? '∞' : cupo}</strong> productos activos</div>
            ${l.whatsapp_publico ? `<div class="local-card-row">📱 <strong>${app.escapeHtml(l.whatsapp_publico)}</strong></div>` : ''}
            ${l.instagram ? `<div class="local-card-row">📷 <strong>${app.escapeHtml(l.instagram)}</strong></div>` : ''}
            <div class="local-card-row" style="font-size:11px;color:${l.lat && l.lng ? 'var(--ok)' : 'var(--muted)'}">
              🗺️ ${l.lat && l.lng ? `GPS: ${parseFloat(l.lat).toFixed(4)}, ${parseFloat(l.lng).toFixed(4)}` : 'Sin coordenadas GPS'}
              <button class="btn btn-ghost btn-sm" style="margin-left:8px;padding:2px 8px;font-size:10px" onclick="locales.capturarGPS(${l.id})">📍 Usar mi ubicación</button>
            </div>
          </div>
          <div class="local-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="locales.abrirEditar(${idx})" title="Editar datos del local">✏️ Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="locales.verQR(${l.id})" title="Código QR del local">🔳 Código QR</button>
            ${esCurrent
              ? `<span class="badge badge-ok" style="padding:8px 14px">✅ Local activo</span>`
              : `<button class="btn btn-primary btn-sm" onclick="locales.cambiarA(${idx})" style="flex:1;justify-content:center">Gestionar este local</button>`
            }
          </div>
        </div>`;
    }).join('');
  }

  function cambiarA(idx) {
    auth.seleccionarLocal(idx);
    app.mostrar('productos');
  }

  function abrirNuevo() {
    ['nl_nombre','nl_direccion','nl_comuna','nl_horario'].forEach(id => $(id).value = '');
    $('nl_cat').value = '';
    // Limpiar estado híbrido
    const sugg = $('nlHibridoSugg'), wrap = $('nlHibridoRubroWrap'), hid = $('nl_hibrido');
    if(sugg) sugg.style.display = 'none';
    if(wrap) wrap.style.display = 'none';
    if(hid)  hid.value = '';
    app.abrirModal('nuevoLocalModal');
  }

  async function crear() {
    const nombre  = $('nl_nombre').value.trim();
    const cat     = $('nl_cat').value;
    const dir     = $('nl_direccion').value.trim();
    const comuna  = $('nl_comuna').value.trim();
    const horario = $('nl_horario').value.trim();
    if (!nombre || !comuna) return toast('Nombre y comuna son obligatorios', 'err');

    // Rubro principal + híbrido
    const catOpt          = $('nl_cat').options[$('nl_cat').selectedIndex];
    const tipoNegocio     = catOpt?.dataset?.tipo || '';
    const esHibrido       = !!($('nl_hibrido')?.value);
    const rubroSecundario = esHibrido ? ($('nl_rubroSecundario')?.value || null) : null;

    const payload = {
      owner: {
        username: STATE.owner.username,
        whatsapp_admin: STATE.owner.whatsapp_admin
      },
      local: {
        id: Date.now(),
        nombre, comuna, direccion: dir, categoria: cat, horario,
        tipo_negocio: tipoNegocio,
        rubro_secundario: rubroSecundario,
        es_hibrido: esHibrido,
        plan: 0, aprobado: true, productos: [], estado_suscripcion: 'activa'
      }
    };
    const r = await api.post('/locales', payload);

    // ¿Conflicto de nombre?
    if (r.status === 409 && r.data?.conflicto === 'nombre_duplicado') {
      STATE.conflictoPayload = payload;
      const otros = r.data.otros_dueños || [];
      $('conflictoTxt').innerHTML = `Ya existe un comercio llamado <strong>"${app.escapeHtml(nombre)}"</strong> registrado por: <em>${otros.map(app.escapeHtml).join(', ')}</em>.`;
      app.cerrarModal('nuevoLocalModal');
      app.abrirModal('conflictoModal');
      return;
    }

    if (r.ok && r.data?.success) {
      app.cerrarModal('nuevoLocalModal');
      toast(`Local "${nombre}" creado correctamente`, 'ok');
      await app.recargarLocales();
      render();
    } else {
      toast(r.data?.message || 'Error al crear el local', 'err');
    }
  }

  // Confirmar creación cuando hay conflicto de nombre
  async function confirmarConflicto() {
    if (!STATE.conflictoPayload) return;
    const payload = { ...STATE.conflictoPayload, force_create_duplicate: true };
    const r = await api.post('/locales', payload);
    app.cerrarModal('conflictoModal');
    STATE.conflictoPayload = null;
    if (r.ok && r.data?.success) {
      toast('Local creado. El equipo de MercaDate revisará el caso.', 'ok');
      // Si estaba en registro, ir a login
      if (!STATE.owner) {
        ['regLocalNombre','regLocalDir','regLocalComuna','regUser','regPass','regWspAdmin'].forEach(id => $(id) && ($(id).value = ''));
        auth.mostrarLogin();
      } else {
        await app.recargarLocales();
        render();
      }
    } else {
      toast(r.data?.message || 'Error al crear el local', 'err');
    }
  }

  // ── Editar local: abre modal pre-llenado y guarda cambios ─────────────────
  let _editingLocalId = null;
  const DIAS_SEMANA = [
    { key: 'lun', label: 'Lunes',     short: 'Lun' },
    { key: 'mar', label: 'Martes',    short: 'Mar' },
    { key: 'mie', label: 'Miércoles', short: 'Mié' },
    { key: 'jue', label: 'Jueves',    short: 'Jue' },
    { key: 'vie', label: 'Viernes',   short: 'Vie' },
    { key: 'sab', label: 'Sábado',    short: 'Sáb' },
    { key: 'dom', label: 'Domingo',   short: 'Dom' }
  ];

  function abrirEditar(idx) {
    const l = STATE.allLocales[idx];
    if (!l) return;
    _editingLocalId = l.id;
    $('el_nombre').value    = l.nombre_sucursal || l.nombre || '';
    $('el_direccion').value = l.direccion || '';
    $('el_comuna').value    = l.comuna || '';
    $('el_region').value    = l.region || '';
    $('el_telefono').value  = l.telefono || '';
    const igEl = $('el_instagram'); if (igEl) igEl.value = l.instagram || '';

    // Poblar select de categoría desde el catálogo canónico (nl_cat tiene el nuevo)
    const sel = $('el_categoria');
    const refSel = $('nl_cat') || $('regLocalCategoria');
    if (sel && refSel) {
      sel.innerHTML = refSel.innerHTML;
      sel.value = l.categoria || '';
    }
    // El catálogo clonado ya trae 🤲 y Gastronomía — no se necesita ajuste manual


    renderDiasHorarios(l);
    app.abrirModal('editarLocalModal');
  }

  // Renderiza la grilla de 7 días con sus checkboxes y inputs de hora
  function renderDiasHorarios(local) {
    // Intentar parsear horarios_detalle (JSON), si no existe usar fallback semanal estándar
    let detalle = {};
    if (local.horarios_detalle) {
      try {
        detalle = typeof local.horarios_detalle === 'string'
          ? JSON.parse(local.horarios_detalle)
          : local.horarios_detalle;
      } catch { detalle = {}; }
    }
    // Fallback: L-V abierto 9-19h si no hay datos
    if (!Object.keys(detalle).length && !local.horarios_detalle) {
      ['lun','mar','mie','jue','vie'].forEach(d => detalle[d] = { desde: '09:00', hasta: '19:00' });
    }

    $('el_dias_grid').innerHTML = DIAS_SEMANA.map(d => {
      const abierto = !!(detalle[d.key] && detalle[d.key].desde);
      const desde = detalle[d.key]?.desde || '09:00';
      const hasta = detalle[d.key]?.hasta || '19:00';
      return `
        <div class="dia-row ${abierto ? '' : 'dia-cerrado'}">
          <label class="dia-check">
            <input type="checkbox" id="dia_${d.key}" ${abierto ? 'checked' : ''} onchange="locales.toggleDia('${d.key}')"/>
            <span class="dia-label">${d.short}</span>
          </label>
          <div class="dia-horario">
            <input type="time" id="dia_${d.key}_desde" value="${desde}" ${abierto ? '' : 'disabled'}/>
            <span style="color:var(--muted)">—</span>
            <input type="time" id="dia_${d.key}_hasta" value="${hasta}" ${abierto ? '' : 'disabled'}/>
          </div>
        </div>`;
    }).join('');
  }

  function toggleDia(key) {
    const checked = $(`dia_${key}`).checked;
    $(`dia_${key}_desde`).disabled = !checked;
    $(`dia_${key}_hasta`).disabled = !checked;
    $(`dia_${key}`).closest('.dia-row').classList.toggle('dia-cerrado', !checked);
  }

  function aplicarHorarioATodos() {
    const desde = $('el_quick_desde').value;
    const hasta = $('el_quick_hasta').value;
    if (!desde || !hasta) { toast('Define ambos horarios', 'err'); return; }
    let aplicados = 0;
    DIAS_SEMANA.forEach(d => {
      if ($(`dia_${d.key}`).checked) {
        $(`dia_${d.key}_desde`).value = desde;
        $(`dia_${d.key}_hasta`).value = hasta;
        aplicados++;
      }
    });
    toast(`✅ Horario aplicado a ${aplicados} día${aplicados !== 1 ? 's' : ''}`, 'ok');
  }

  async function guardarEdicion() {
    if (!_editingLocalId) return;
    // Construir objeto de horarios
    const horarios_detalle = {};
    DIAS_SEMANA.forEach(d => {
      if ($(`dia_${d.key}`).checked) {
        const desde = $(`dia_${d.key}_desde`).value;
        const hasta = $(`dia_${d.key}_hasta`).value;
        if (desde && hasta) horarios_detalle[d.key] = { desde, hasta };
      }
    });

    const catSel = $('el_categoria');
    const catOpt = catSel?.options[catSel?.selectedIndex];
    const datos = {
      nombre_sucursal: $('el_nombre').value.trim(),
      direccion:       $('el_direccion').value.trim(),
      comuna:          $('el_comuna').value.trim(),
      region:          $('el_region').value.trim(),
      telefono:        $('el_telefono').value.trim(),
      instagram:       ($('el_instagram')?.value || '').trim(),
      categoria:       catSel?.value || '',
      tipo_negocio:    catOpt?.dataset?.tipo || '',
      horarios_detalle
    };
    if (!datos.nombre_sucursal) { toast('El nombre es requerido', 'err'); return; }
    if (!datos.comuna)          { toast('La comuna es requerida', 'err'); return; }

    const r = await api.patch(`/locales/${_editingLocalId}`, datos);
    if (r.ok && r.data?.success) {
      toast('✅ Local actualizado', 'ok');
      app.cerrarModal('editarLocalModal');
      await app.recargarLocales();
      render();
    } else {
      toast(r.data?.message || 'Error al actualizar', 'err');
    }
  }


  function capturarGPS(localId) {
    if (!navigator.geolocation) {
      toast('Tu navegador no soporta GPS', 'err');
      return;
    }
    toast('📡 Obteniendo ubicación…', 'info');
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        const r = await api.patch(`/locales/${localId}/coordenadas`, { lat, lng });
        if (r.ok && r.data?.success) {
          toast(`✅ Ubicación guardada (${lat.toFixed(4)}, ${lng.toFixed(4)})`, 'ok');
          await app.recargarLocales();
          render();
        } else toast('Error al guardar coordenadas', 'err');
      },
      err => {
        const msgs = { 1: 'Permiso de ubicación denegado', 2: 'Ubicación no disponible', 3: 'Timeout obteniendo GPS' };
        toast(msgs[err.code] || 'Error de GPS', 'err');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // ═══ FASE 2 — Código QR por local ═══
  let _qrLocalActual = null;

  function verQR(localId) {
    const local = STATE.allLocales.find(l => l.id === localId);
    if (!local) { toast('Local no encontrado', 'err'); return; }
    _qrLocalActual = local;

    // Código legible y contenido del QR
    const codigoLegible = 'LOC-' + String(localId).padStart(6, '0');
    const contenidoQR = 'geo-precio://registrar?local=' + localId;

    // Rellenar datos de la tarjeta
    $('qrLocalNombre').textContent = local.nombre || local.nombre_sucursal || 'Mi Local';
    $('qrLocalDir').textContent = local.direccion || local.comuna || '';
    $('qrLocalRut').textContent = (STATE.owner && STATE.owner.rut) ? ('RUT ' + STATE.owner.rut) : '';
    $('qrCodigo').textContent = codigoLegible;

    // Generar el QR (limpiar anterior)
    const cont = $('qrCanvas');
    cont.innerHTML = '';
    if (typeof QRCode === 'undefined') {
      toast('Librería QR no cargó. Recarga la página.', 'err');
      return;
    }
    new QRCode(cont, {
      text: contenidoQR,
      width: 200, height: 200,
      colorDark: '#0f1218', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    // Guardar el código QR en el backend (no bloquea)
    if (window.api && typeof window.api.post === 'function') {
      window.api.post('/locales/' + localId + '/qr', { codigo_qr: contenidoQR })
        .catch(() => {});
    } else {
      fetch('/api/locales/' + localId + '/qr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_qr: contenidoQR })
      }).catch(() => {});
    }

    app.abrirModal('qrModal');
  }

  // Componer la tarjeta imprimible en un canvas (QR + datos)
  function _componerCanvas() {
    return new Promise((resolve) => {
      const qrImg = $('qrCanvas').querySelector('img') || $('qrCanvas').querySelector('canvas');
      const W = 420, H = 540;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Fondo blanco con borde naranja
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#FF8A00'; ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);

      // Textos
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f1218';
      ctx.font = '800 24px Inter, sans-serif';
      ctx.fillText(($('qrLocalNombre').textContent || '').slice(0, 28), W/2, 50);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.fillText(($('qrLocalDir').textContent || '').slice(0, 40), W/2, 76);
      const rut = $('qrLocalRut').textContent || '';
      if (rut) { ctx.fillStyle = '#94a3b8'; ctx.font = '12px Inter, sans-serif'; ctx.fillText(rut, W/2, 98); }

      const drawRest = () => {
        ctx.fillStyle = '#FF8A00';
        ctx.font = '700 16px Inter, sans-serif';
        ctx.fillText('📲 Escanea para registrar tu visita', W/2, 380);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px Inter, sans-serif';
        ctx.fillText($('qrCodigo').textContent || '', W/2, 404);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText('Ápale! · El mejor precio a la vuelta de la esquina', W/2, 510);
        resolve(canvas);
      };

      // Dibujar el QR centrado
      if (qrImg) {
        const qrSize = 240, qx = (W - qrSize)/2, qy = 120;
        if (qrImg.tagName === 'CANVAS') {
          ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
          drawRest();
        } else {
          const im = new Image();
          im.onload = () => { ctx.drawImage(im, qx, qy, qrSize, qrSize); drawRest(); };
          im.onerror = drawRest;
          im.src = qrImg.src;
        }
      } else { drawRest(); }
    });
  }

  async function descargarQrPNG() {
    if (!_qrLocalActual) return;
    const canvas = await _componerCanvas();
    const link = document.createElement('a');
    link.download = 'QR_' + (_qrLocalActual.nombre || 'local').replace(/[^\w]/g, '_') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Imagen QR descargada', 'ok');
  }

  async function descargarQrPDF() {
    if (!_qrLocalActual) return;
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('Librería PDF no cargó', 'err'); return; }
    const canvas = await _componerCanvas();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const imgW = 300, imgH = 300 * (canvas.height / canvas.width);
    const x = (pw - imgW) / 2;
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, 80, imgW, imgH);
    pdf.save('QR_' + (_qrLocalActual.nombre || 'local').replace(/[^\w]/g, '_') + '.pdf');
    toast('PDF QR descargado', 'ok');
  }

  return { render, cambiarA, abrirNuevo, crear, confirmarConflicto, capturarGPS, abrirEditar, guardarEdicion, toggleDia, aplicarHorarioATodos,
           verQR, descargarQrPNG, descargarQrPDF };
})();
