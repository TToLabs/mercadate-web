// productos.js — Inventario completo del local: CRUD, estados, fotos, WhatsApp
window.productos = (function () {
  const { STATE, $, toast } = app;

  // Marca en la lista de productos los que tienen reportes de precio, con cuántos
  // compradores distintos coincidieron y a qué precio. Sin esto el comercio vería
  // "habilitado" un producto que ya está pausado en las búsquedas.
  function marcaReporte(p) {
    if (!p.precio_estado) return '';
    const n = p.precio_reportes || 0;
    const precio = p.precio_reportado != null ? app.clp(p.precio_reportado) : 'otro precio';
    if (p.precio_estado === 'vencido') {
      return `<div style="font-size:11px;color:#e05252;margin-top:3px;font-weight:700">
                ⏸ Pausado · ${n} compradores reportan ${precio}
              </div>
              <div style="font-size:11px;color:var(--muted)">Actualiza el precio y vuelve a aparecer</div>`;
    }
    return `<div style="font-size:11px;color:#F2B945;margin-top:3px;font-weight:700">
              ⚠️ ${n} compradores reportan ${precio}
            </div>`;
  }

  // ────────────────────────────────────────────────────────────────────────
  // RENDER TABLA DE PRODUCTOS
  // ────────────────────────────────────────────────────────────────────────
  function renderTabla() {
    const local = STATE.activeLocal;
    if (!local) return;
    const query = ($('busqueda')?.value || '').toLowerCase();
    const filtrados = (local.productos || []).filter(p =>
      (p.nombre || '').toLowerCase().includes(query) ||
      (p.marca  || '').toLowerCase().includes(query)
    );

    const tbody = $('tablaProductos');
    if (!filtrados.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--muted)">
        ${query ? 'Sin resultados para "' + app.escapeHtml(query) + '"' : 'Aún no tienes productos. ¡Agrega el primero!'}
      </td></tr>`;
      return;
    }

    const wspPublico = local.whatsapp_publico;
    const tienePlanPagado = (local.plan || 0) > 0;

    tbody.innerHTML = filtrados.map(p => {
      const idx = local.productos.indexOf(p);
      const fotosCount = (p.imagenes || []).length;
      return `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            ${fotosCount ? `<img src="${app.escapeHtml(p.imagenes[0].ruta)}" style="width:38px;height:38px;border-radius:6px;object-fit:cover;flex-shrink:0"/>` : ''}
            <div>
              <strong>${app.escapeHtml(p.nombre)}</strong>
              ${p.marca ? `<div style="font-size:12px;color:var(--muted)">${app.escapeHtml(p.marca)}${p.peso ? ' · ' + app.escapeHtml(p.peso) : ''}</div>` : ''}
              ${fotosCount > 0 ? `<div style="font-size:11px;color:var(--accent);margin-top:2px">📷 ${fotosCount} foto${fotosCount > 1 ? 's' : ''}</div>` : ''}
              ${marcaReporte(p)}
            </div>
          </div>
        </td>
        <td><span class="badge">${app.escapeHtml(p.categoria || 'General')}</span></td>
        <td class="price-tag">${app.clp(p.precio)}</td>
        <td>${renderEstadoChip(p, idx)}</td>
        <td style="font-size:12px;color:var(--muted)">${p.ultima_actualizacion ? new Date(p.ultima_actualizacion).toLocaleDateString('es-CL') : '—'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${tienePlanPagado && wspPublico ? `<button class="btn btn-wsp btn-sm" onclick="productos.clickWhatsapp(${p.id}, '${app.escapeHtml(wspPublico)}', '${app.escapeHtml(p.nombre)}')" title="Consultar por WhatsApp">📱</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="productos.duplicar(${p.id})" title="Duplicar producto">📋</button>
          <button class="btn btn-ghost btn-sm" onclick="productos.abrirEditar(${idx})" title="Editar">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="productos.eliminar(${idx})" title="Eliminar">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }

  // Registra el click en el backend ANTES de abrir WhatsApp
  function clickWhatsapp(productoId, numero, nombreProducto) {
    const local = STATE.activeLocal;
    api.post('/clicks/whatsapp', { local_id: local.id, producto_id: productoId }).catch(()=>{});
    const num = String(numero).replace(/[^0-9]/g, '');
    const msg = encodeURIComponent(`Hola, vengo de MercaDate, quiero consultar por: ${nombreProducto}`);
    window.open(`https://wa.me/${num}?text=${msg}`, '_blank');
  }

  async function duplicar(productoId) {
    if (!confirm('¿Duplicar este producto? Se creará una copia pausada que podrás editar.')) return;
    const r = await api.post(`/productos/${productoId}/duplicar`);
    if (r.ok && r.data?.success) {
      app.toast('✅ Producto duplicado (pausado)', 'ok');
      await app.recargarLocales();
    } else app.toast('❌ Error al duplicar', 'err');
  }

  function urlWhatsapp(numero, nombreProducto) {
    const num = numero.replace(/[^0-9]/g, '');
    const msg = encodeURIComponent(`Hola, vengo de MercaDate, quiero consultar por: ${nombreProducto}`);
    return `https://wa.me/${num}?text=${msg}`;
  }

  function renderEstadoChip(p, idx) {
    const estado = p.estado || 'habilitado';
    const clases = {
      habilitado:   'estado-habilitado',
      pausado:      'estado-pausado',
      restringido:  'estado-restringido'
    };
    const labels = {
      habilitado:   '🟢 Activo',
      pausado:      '🟡 Pausado',
      restringido:  '🔴 Restringido'
    };
    const onclick = estado === 'restringido' ? '' : `onclick="productos.toggleEstado(${idx})"`;
    const title = estado === 'restringido'
      ? 'Este producto excede el cupo del plan. Sube de plan o pausa otros para activarlo.'
      : estado === 'habilitado' ? 'Click para pausar' : 'Click para activar';
    return `<span class="estado-chip ${clases[estado]}" ${onclick} title="${title}">${labels[estado]}</span>`;
  }

  // ────────────────────────────────────────────────────────────────────────
  // TOGGLE ESTADO
  // ────────────────────────────────────────────────────────────────────────
  async function toggleEstado(idx) {
    const local = STATE.activeLocal;
    const p = local.productos[idx];
    if (!p || p.estado === 'restringido') return;
    const nuevoEstado = p.estado === 'habilitado' ? 'pausado' : 'habilitado';
    const r = await api.patch(`/productos/${p.id}/estado`, { estado: nuevoEstado });
    if (r.ok && r.data?.success) {
      p.estado = nuevoEstado;
      app.actualizarUI();
      toast(`Producto ${nuevoEstado}`, 'ok');
    } else {
      toast(r.data?.message || 'Error al cambiar estado', 'err');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // ABRIR MODAL NUEVO / EDITAR
  // ────────────────────────────────────────────────────────────────────────
  function abrirNuevo() {
    const local = STATE.activeLocal;
    const cupoMax = app.cupoEfectivo(local);
    const activos = (local.productos || []).filter(p => p.estado === 'habilitado').length;
    if (activos >= cupoMax && (local.plan || 0) === 0) {
      toast(`Límite del plan alcanzado (${activos}/${cupoMax}). Sube tu plan o pausa otros productos.`, 'err');
      app.mostrar('membresia');
      return;
    }
    $('modalTitle').textContent = 'Nuevo Producto';
    $('modalSub').textContent = `${activos}/${cupoMax === Infinity ? '∞' : cupoMax} productos activos`;
    $('edit_idx').value = '-1';
    $('edit_producto_id').value = '';
    ['edit_nombre','edit_marca','edit_peso','edit_desc'].forEach(id => $(id).value = '');
    $('edit_precio').value = '';
    poblarCategorias();
    $('fotosSection').style.display = 'none';
    app.abrirModal('editModal');
  }

  function abrirEditar(idx) {
    const local = STATE.activeLocal;
    const p = local.productos[idx];
    if (!p) return;
    $('modalTitle').textContent = 'Editar Producto';
    $('modalSub').textContent = app.escapeHtml(p.nombre);
    $('edit_idx').value = idx;
    $('edit_producto_id').value = p.id || '';
    $('edit_nombre').value = p.nombre;
    $('edit_precio').value = p.precio;
    $('edit_marca').value = p.marca || '';
    $('edit_peso').value = p.peso || '';
    $('edit_desc').value = p.descripcion || '';
    poblarCategorias(p.categoria);

    // Lógica de fotos:
    //  · Plan pagado + producto creado en backend → mostrar galería
    //  · Plan pagado + producto nuevo (sin id) → ocultar (primero hay que guardar)
    //  · Plan gratuito → mostrar aviso de upgrade
    const planPagado = (local.plan || 0) > 0;
    if (planPagado && p.id) {
      $('fotosSection').style.display = 'block';
      $('fotosUpgradeAviso').style.display = 'none';
      renderFotos(p);
    } else if (planPagado && !p.id) {
      $('fotosSection').style.display = 'none';
      $('fotosUpgradeAviso').style.display = 'none';
    } else {
      // Plan gratuito → mostrar aviso para invitar a actualizar
      $('fotosSection').style.display = 'none';
      $('fotosUpgradeAviso').style.display = 'block';
    }
    app.abrirModal('editModal');
  }

  function poblarCategorias(selected) {
    const tipo = STATE.activeLocal?.tipo_negocio || 'productos';
    const sec  = STATE.activeLocal?.rubro_secundario || null;
    const opciones = {
      productos:   ["Abarrotes","Bebidas","Lácteos","Panadería","Carnes","Frutas","Verduras","Limpieza","Higiene","Congelados","Bazar","Ferretería","Otros"],
      servicios:   ["Corte","Color","Barba","Peinado","Manicure","Pedicure","Tratamiento","Baño","Vacuna","Consulta","Reparación","Otros"],
      gastronomia: ["Entrada","Plato principal","Postre","Bebida","Coctel","Café","Combo","Promoción","Otros"]
    };
    let cats = (opciones[tipo] || opciones.productos).slice();
    // Si el local es híbrido, sumar las categorías del rubro secundario
    if (sec && opciones[sec]) {
      opciones[sec].forEach(c => { if (!cats.includes(c)) cats.push(c); });
    }
    const html = cats.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
    const editSel = $('edit_cat');     if (editSel) editSel.innerHTML = html;
    const nuevoSel = $('n_categoria'); if (nuevoSel) nuevoSel.innerHTML = html;
  }

  // ── Modal Agregar Nuevo: abre con tabs (uno a uno + carga masiva) ─────────
  function abrirAgregarNuevo() {
    const local = STATE.activeLocal;
    if (!local) { app.toast('Selecciona un local primero', 'err'); return; }
    // Reset campos
    ['n_nombre','n_precio','n_marca','n_peso','n_desc'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    poblarCategorias();
    // Reset carga masiva
    if ($('csvStatus')) $('csvStatus').textContent = '';
    if ($('csvPreviewCard')) $('csvPreviewCard').style.display = 'none';
    if ($('fileCSV')) $('fileCSV').value = '';
    STATE.importBuffer = [];
    // Tab default
    cambiarTabAgregar('uno');
    app.abrirModal('agregarNuevoModal');
  }

  function cambiarTabAgregar(tab) {
    document.querySelectorAll('.agregar-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.agregar-panel').forEach(p => p.style.display = p.dataset.panel === tab ? 'block' : 'none');
  }

  // Guardar producto nuevo (desde modal con prefijo n_)
  async function guardarNuevo() {
    const local = STATE.activeLocal;
    if (!local) return;
    const nombre = $('n_nombre').value.trim();
    const precio = parseFloat($('n_precio').value) || 0;
    if (!nombre) { app.toast('El nombre es requerido', 'err'); return; }
    if (precio < 0) { app.toast('Precio inválido', 'err'); return; }

    const nuevo = {
      nombre, precio,
      categoria:    $('n_categoria').value || '',
      marca:        $('n_marca').value.trim(),
      peso:         $('n_peso').value.trim(),
      descripcion:  $('n_desc').value.trim(),
      estado: 'habilitado',
      ultima_actualizacion: new Date().toISOString()
    };
    const productos = [...(local.productos || []), nuevo];

    const r = await api.post('/locales', {
      owner: {
        username: STATE.owner.username,
        whatsapp_admin: STATE.owner.whatsapp_admin
      },
      local: {
        id: local.id, nombre: local.nombre, comuna: local.comuna,
        direccion: local.direccion || '', categoria: local.categoria || '',
        horario: local.horario || '', plan: local.plan,
        whatsapp_publico: local.whatsapp_publico || null,
        aprobado: local.aprobado !== undefined ? local.aprobado : true,
        estado_suscripcion: local.estado_suscripcion || 'activa',
        fecha_vencimiento: local.fecha_vencimiento || null,
        productos
      }
    });
    if (r.ok && r.data?.success) {
      app.toast('✅ Producto agregado', 'ok');
      app.cerrarModal('agregarNuevoModal');
      await app.recargarLocales();
    } else {
      app.toast(r.data?.message || 'Error al guardar', 'err');
    }
  }

  // Descarga la plantilla Excel oficial según el rubro del local
  function descargarTemplate() {
    const local = STATE.activeLocal;
    if (!local) { app.toast('Selecciona un local', 'err'); return; }
    const tipo = local.tipo_negocio || 'productos';
    const a = document.createElement('a');
    a.href = `/api/template-inventario/${tipo}`;
    a.download = `plantilla_${tipo}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    app.toast('⬇️ Descargando plantilla…', 'info');
  }

  // ────────────────────────────────────────────────────────────────────────
  // GUARDAR PRODUCTO
  // ────────────────────────────────────────────────────────────────────────
  async function guardar() {
    const local = STATE.activeLocal;
    const idx = parseInt($('edit_idx').value);
    const p = {
      nombre: $('edit_nombre').value.trim(),
      precio: parseFloat($('edit_precio').value),
      categoria: $('edit_cat').value,
      marca: $('edit_marca').value.trim(),
      peso: $('edit_peso').value.trim(),
      descripcion: $('edit_desc').value.trim(),
      estado: 'habilitado',
      ultima_actualizacion: new Date().toISOString()
    };
    if (!p.nombre || isNaN(p.precio)) return toast('Nombre y precio son obligatorios', 'err');

    if (idx === -1) {
      local.productos = local.productos || [];
      local.productos.push(p);
    } else {
      // Mantener todo lo del producto que el formulario no edita (id, imágenes,
      // código de barras, stock, destacado, agotado…): antes se perdían al guardar.
      local.productos[idx] = Object.assign({}, local.productos[idx], p);
    }
    if (await sincronizar()) {
      app.cerrarModal('editModal');
      await app.recargarLocales();
      toast(idx === -1 ? 'Producto agregado' : 'Producto actualizado', 'ok');
    }
  }

  async function eliminar(idx) {
    const local = STATE.activeLocal;
    if (!confirm(`¿Eliminar "${local.productos[idx]?.nombre}"?`)) return;
    local.productos.splice(idx, 1);
    if (await sincronizar()) {
      app.actualizarUI();
      toast('Producto eliminado');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // SINCRONIZACIÓN CON BACKEND
  // ────────────────────────────────────────────────────────────────────────
  async function sincronizar() {
    const local = STATE.activeLocal;
    if (!local) return false;
    const r = await api.post('/locales', {
      owner: {
        username: STATE.owner.username,
        whatsapp_admin: STATE.owner.whatsapp_admin
      },
      local: {
        id: local.id, nombre: local.nombre, comuna: local.comuna,
        direccion: local.direccion || '', categoria: local.categoria || '',
        horario: local.horario || '', plan: local.plan,
        whatsapp_publico: local.whatsapp_publico || null,
        aprobado: local.aprobado !== undefined ? local.aprobado : true,
        estado_suscripcion: local.estado_suscripcion || 'activa',
        fecha_vencimiento: local.fecha_vencimiento || null,
        productos: local.productos || []
      }
    });
    if (!r.ok || !r.data?.success) {
      toast('Error al guardar: ' + (r.data?.message || ''), 'err');
      return false;
    }
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // GALERÍA DE FOTOS
  // ────────────────────────────────────────────────────────────────────────
  function renderFotos(producto) {
    const gal = $('fotosGaleria');
    const fotos = producto.imagenes || [];
    const max = 3;
    const items = fotos.map(f => `
      <div class="foto-item">
        <img src="${app.escapeHtml(f.ruta)}" alt="foto"/>
        <button class="foto-del" onclick="productos.eliminarFoto(${producto.id}, ${f.id})" title="Eliminar">✕</button>
      </div>`).join('');
    const canAdd = fotos.length < max;
    const adder = canAdd
      ? `<label class="foto-add">
           <span style="font-size:24px">+</span>
           <span>Subir foto</span>
           <span style="font-size:10px">JPG/PNG · 4MB máx</span>
           <input type="file" accept=".jpg,.jpeg,.png,.webp" onchange="productos.subirFoto(${producto.id}, event)"/>
         </label>`
      : `<div class="foto-add foto-add-disabled">
           <span>Límite</span>
           <span style="font-size:10px">${max}/${max} fotos</span>
         </div>`;
    gal.innerHTML = items + adder;
  }

  async function subirFoto(productoId, evt) {
    const file = evt.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('imagen', file);
    const r = await api.upload(`/productos/${productoId}/foto`, fd);
    if (r.ok && r.data?.success) {
      toast('Foto subida', 'ok');
      await app.recargarLocales();
      // Re-render galería del producto activo
      const p = STATE.activeLocal.productos.find(x => x.id === productoId);
      if (p) renderFotos(p);
    } else {
      toast(r.data?.message || 'Error al subir foto', 'err');
    }
  }

  async function eliminarFoto(productoId, fotoId) {
    if (!confirm('¿Eliminar esta foto?')) return;
    const r = await api.delete(`/productos/${productoId}/foto/${fotoId}`);
    if (r.ok && r.data?.success) {
      toast('Foto eliminada');
      await app.recargarLocales();
      const p = STATE.activeLocal.productos.find(x => x.id === productoId);
      if (p) renderFotos(p);
    } else {
      toast('Error al eliminar', 'err');
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // CARGA MASIVA CSV/EXCEL
  // ────────────────────────────────────────────────────────────────────────
  // Parser CSV nativo (sin dependencias): para archivos .csv evita SheetJS por completo.
  function _parseCSVNativo(texto) {
    const t = String(texto || '').replace(/^\uFEFF/, '');
    const lineas = t.split(/\r?\n/).filter(l => l.length > 0);
    if (lineas.length < 2) return [];
    const sep = (lineas[0].split(';').length > lineas[0].split(',').length) ? ';' : ',';
    const partir = (linea) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (c === '"') { if (q && linea[i+1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === sep && !q) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    const headers = partir(lineas[0]);
    return lineas.slice(1).map(l => {
      const cols = partir(l);
      const o = Object.create(null);
      headers.forEach((h, i) => { o[h] = cols[i] != null ? cols[i] : ''; });
      return o;
    });
  }

  // Bloquea claves peligrosas de prototype pollution en filas parseadas por SheetJS
  function _sanitizarFila(r) {
    const limpio = {};
    for (const k in r) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      limpio[k] = r[k];
    }
    return limpio;
  }

  function _mapearFilas(rows) {
    return rows.map(_sanitizarFila).map(r => ({
      nombre: r.nombre || r.Nombre || '',
      precio: parseFloat(r.precio || r.Precio || 0),
      categoria: r.categoria || r.Categoria || 'General',
      marca: r.marca || r.Marca || '',
      peso: r.peso || r.Peso || '',
      descripcion: r.descripcion || r.Descripcion || '',
      estado: 'habilitado',
      ultima_actualizacion: new Date().toISOString()
    })).filter(r => r.nombre && r.precio > 0);
  }

  function _previewImport() {
    const cupoMax = app.cupoEfectivo(STATE.activeLocal);
    const activos = (STATE.activeLocal.productos || []).filter(p => p.estado === 'habilitado').length;
    const disponibles = cupoMax - activos;
    $('csvPreviewCard').style.display = 'block';
    $('csvPreviewTitle').textContent = `Vista Previa — ${STATE.importBuffer.length} productos (puedes importar ${Math.max(0, disponibles)})`;
    $('csvPreviewList').innerHTML = STATE.importBuffer.slice(0, 5).map(p =>
      `<div style="padding:8px;border-bottom:1px solid var(--border)">${app.escapeHtml(p.nombre)} — ${app.clp(p.precio)}</div>`
    ).join('') + (STATE.importBuffer.length > 5 ? `<div style="padding:8px;color:var(--muted)">…y ${STATE.importBuffer.length - 5} más</div>` : '');
  }

  function onFileCSV(e) {
    const file = e.target.files[0];
    if (!file) return;
    const esCSV = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        let rows;
        if (esCSV) {
          // Ruta segura: parser nativo, no toca SheetJS
          rows = _parseCSVNativo(evt.target.result);
        } else {
          // XLSX: SheetJS en cliente; se sanitiza la salida contra prototype pollution
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        }
        STATE.importBuffer = _mapearFilas(rows);
        _previewImport();
      } catch (err) {
        toast('No se pudo leer el archivo. Verifica el formato.', 'err');
      }
    };
    if (esCSV) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  }

  async function importarMasivo() {
    const local = STATE.activeLocal;
    const cupoMax = app.cupoEfectivo(local);
    const activos = (local.productos || []).filter(p => p.estado === 'habilitado').length;
    const disponibles = cupoMax - activos;
    if (disponibles <= 0) return toast('Límite del plan alcanzado. Sube tu plan primero.', 'err');
    const aImportar = STATE.importBuffer.slice(0, disponibles);
    local.productos.push(...aImportar);
    if (await sincronizar()) {
      await app.recargarLocales();
      app.mostrar('productos'); limpiarCarga();
      toast(`${aImportar.length} productos importados`, 'ok');
    }
  }

  function limpiarCarga() {
    $('csvPreviewCard').style.display = 'none';
    $('fileCSV').value = '';
    STATE.importBuffer = [];
  }

  // ────────────────────────────────────────────────────────────────────────
  // EXPORTAR EXCEL
  // ────────────────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────────
  // DESCARGAR INVENTARIO EN EXCEL
  // ────────────────────────────────────────────────────────────────────────
  function descargarInventario() {
    const local = STATE.activeLocal;
    if (!local) return;
    if (!(local.productos || []).length) {
      toast('No hay productos para exportar', 'err');
      return;
    }
    const a = document.createElement('a');
    a.href = `/api/comercio/exportar-inventario/${local.id}`;
    a.download = `inventario_${local.nombre}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    toast('📥 Descargando inventario…', 'info');
  }

  // ────────────────────────────────────────────────────────────────────────
  // ALERTAS DEL COMERCIO
  // ────────────────────────────────────────────────────────────────────────
  // Estado del reporte según el consenso de usuarios (Paso 0). Mercadate no cambia el
  // precio: avisa cuántos usuarios distintos lo reportaron y cuánto queda para actualizarlo.
  function estadoAlerta(rep) {
    const n = rep.insistencias || 1, tope = rep.consenso_n || 3;
    if (rep.estado === 'vencido') {
      return `<span style="color:#e05252;font-weight:700;font-size:12px">⏸ Pausado en las búsquedas</span>
              <div style="font-size:11px;color:var(--muted)">Actualiza el precio y vuelve a aparecer de inmediato</div>`;
    }
    if (rep.estado === 'en_disputa') {
      let restante = '';
      if (rep.fecha_disputa) {
        const h = Math.max(0, Math.ceil((new Date(rep.fecha_disputa).getTime() + 72 * 3600000 - Date.now()) / 3600000));
        restante = `<div style="font-size:11px;color:var(--muted)">~${h}h para actualizarlo</div>`;
      }
      return `<span style="color:#F2B945;font-weight:700;font-size:12px">${n} usuarios coinciden</span>${restante}`;
    }
    return `<span style="font-size:12px;color:var(--muted)">${n} de ${tope} reportes</span>`;
  }

  async function cargarAlertas() {
    const local = STATE.activeLocal;
    if (!local) return;
    const r = await api.get(`/comercio/reportes/${local.id}`);
    if (!r.ok) return;
    const reportes = r.data || [];
    const badge = $('alertasBadge');
    if (reportes.length > 0) {
      badge.textContent = reportes.length; badge.style.display = 'inline';
      $('alertasTable').innerHTML = reportes.map(rep => `
        <tr>
          <td>${app.escapeHtml(rep.combustible || rep.producto || '—')}</td>
          <td>${app.clp(rep.precioReportado)}</td>
          <td>${estadoAlerta(rep)}</td>
          <td style="font-size:12px;color:var(--muted)">${rep.fecha ? new Date(rep.fecha).toLocaleString('es-CL') : '—'}</td>
        </tr>`).join('');
    } else {
      badge.style.display = 'none';
      $('alertasTable').innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px">Sin alertas por ahora.</td></tr>';
    }
  }

  return {
    renderTabla, toggleEstado, abrirNuevo, abrirAgregarNuevo, abrirEditar,
    guardar, guardarNuevo, eliminar,
    subirFoto, eliminarFoto, clickWhatsapp, duplicar,
    cambiarTabAgregar, descargarTemplate, descargarInventario,
    onFileCSV, importarMasivo, limpiarCarga,
    cargarAlertas, poblarCategorias
  };
})();
