// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comercio MercaDate
// ARCHIVO    : dashboard.js
// ═══════════════════════════════════════════════════
// dashboard.js — Dashboard del comerciante (su panel personal)
window.cdashboard = (function () {
  const { STATE, $, toast } = app;

  async function cargar() {
    const local = STATE.activeLocal;
    if (!local) return;
    const r = await api.get(`/comercio/dashboard/${local.id}`);
    if (!r.ok) return;
    renderKPIs(r.data);
    renderEstadoLocal(r.data.local);
    renderNotificaciones(r.data);
    renderSinFoto(r.data.sin_foto);
    renderStockBajo(r.data.stock_bajo);
    renderDesactualizados(r.data.desactualizados);
    renderTopClicks(r.data.top_clicks_productos);
  }

  function renderKPIs(d) {
    const { local, productos, clicks_wsp, dias_hasta_renovacion } = d;
    const cupo = local.cupo_max || '∞';
    const percUsado = local.cupo_max ? Math.round((productos.activos / local.cupo_max) * 100) : 0;

    $('cdKpiClicks').innerHTML = `
      <div class="cd-kpi-label">📱 Clics WhatsApp (7d)</div>
      <div class="cd-kpi-value">${clicks_wsp.ultimos_7d}</div>
      <div class="cd-kpi-sub">${clicks_wsp.ultimos_30d} en 30 días</div>
      <div style="margin-top:8px">${_sparkline(clicks_wsp.por_dia || [0, clicks_wsp.ultimos_7d], '#25d366')}</div>`;

    const cupoColor = percUsado > 85 ? '#ef4444' : percUsado > 60 ? '#f59e0b' : '#10b981';
    const cupoGrad  = percUsado > 85
      ? 'linear-gradient(90deg,#ef4444,#dc2626)'
      : percUsado > 60
        ? 'linear-gradient(90deg,#f59e0b,#d97706)'
        : 'linear-gradient(90deg,#10b981,#059669)';
    $('cdKpiCupo').innerHTML = `
      <div class="cd-kpi-label">📦 Capacidad del Plan</div>
      <div style="display:flex;align-items:baseline;gap:4px;margin:4px 0">
        <div class="cd-kpi-value" style="color:${cupoColor}">${productos.activos}</div>
        <span style="font-size:14px;color:var(--muted)">/ ${cupo === '∞' ? '∞' : cupo} prod.</span>
      </div>
      <div style="position:relative;background:rgba(255,255,255,.08);border-radius:100px;height:10px;overflow:hidden;margin:6px 0 5px">
        <div style="background:${cupoGrad};height:100%;width:${Math.min(percUsado,100)}%;border-radius:100px;transition:width .6s ease;box-shadow:0 0 6px ${cupoColor}66"></div>
      </div>
      <div class="cd-kpi-sub" style="color:${cupoColor}">${percUsado}% · ${productos.pausados} pausados</div>`;

    $('cdKpiPlan').innerHTML = `
      <div class="cd-kpi-label">💳 Plan ${local.plan_actual.nombre}</div>
      <div class="cd-kpi-value" style="color:${local.plan_actual.color||'var(--accent)'}">${local.plan_actual.icon || ''} ${local.plan_actual.nombre}</div>
      <div class="cd-kpi-sub">${dias_hasta_renovacion !== null
        ? (dias_hasta_renovacion <= 0 ? 'Vencido' : `Renueva en ${dias_hasta_renovacion} días`)
        : 'Plan gratuito'}</div>`;

    // El estado (abierto/pausado/cerrado) ya se ve siempre arriba del sidebar — repetirlo
    // acá era ruido. En su lugar: lo que de verdad hay que mirar cada día.
    const stockN = (d.stock_bajo || []).length;
    $('cdKpiEstado').innerHTML = `
      <div class="cd-kpi-label">📉 Stock bajo</div>
      <div class="cd-kpi-value" style="color:${stockN ? 'var(--warn)' : 'var(--ok)'}">${stockN}</div>
      <div class="cd-kpi-sub">${stockN ? 'productos con 5 o menos' : 'todo con stock sano'}</div>`;
  }

  function badgeEstado(estado) {
    const map = {
      abierto: '<span style="color:var(--ok)">🟢 Abierto</span>',
      pausado: '<span style="color:var(--warn)">🟡 Pausado</span>',
      cerrado: '<span style="color:var(--err)">🔴 Cerrado</span>'
    };
    return map[estado] || map.abierto;
  }

  function renderEstadoLocal(local) {
    const sel = $('cdEstadoSel');
    if (sel) sel.value = local.estado_operativo || 'abierto';
    const msg = $('cdEstadoMsg');
    if (msg) msg.value = local.estado_mensaje || '';
  }

  // ── Banner de notificaciones inteligentes ─────────────────────────────────
  function renderNotificaciones(d) {
    const cont = $('cdNotifs');
    const notifs = [];

    if (d.sin_foto.length >= 3) {
      notifs.push({
        tipo: 'foto', color: 'var(--accent)', icon: '📸',
        msg: `<strong>Tienes ${d.sin_foto.length} productos sin foto.</strong> Productos con foto reciben 3x más clics.`,
        accion: 'Ver productos sin foto', onclick: 'cdashboard.irASinFoto()'
      });
    }
    if (d.dias_hasta_renovacion !== null && d.dias_hasta_renovacion <= 7 && d.dias_hasta_renovacion > 0) {
      notifs.push({
        tipo: 'plan', color: 'var(--accent)', icon: '⏰',
        msg: `<strong>Tu plan vence en ${d.dias_hasta_renovacion} días.</strong> Renovación automática.`,
        accion: 'Ver mi plan', onclick: "app.mostrar('membresia')"
      });
    }
    if (d.dias_hasta_renovacion !== null && d.dias_hasta_renovacion <= 0) {
      notifs.push({
        tipo: 'plan_venc', color: 'var(--err)', icon: '⚠️',
        msg: `<strong>Tu plan está vencido.</strong> Renueva para seguir teniendo todos tus productos visibles.`,
        accion: 'Renovar', onclick: "app.mostrar('membresia')"
      });
    }
    if (d.desactualizados.length >= 5) {
      notifs.push({
        tipo: 'precios', color: 'var(--info)', icon: '🕒',
        msg: `<strong>${d.desactualizados.length} productos sin actualizar hace 30+ días.</strong> Mantén tus precios al día.`,
        accion: 'Revisar', onclick: 'cdashboard.irADesactualizados()'
      });
    }
    if (d.productos.activos === 0) {
      notifs.push({
        tipo: 'vacio', color: 'var(--warn)', icon: '📭',
        msg: `<strong>No tienes productos activos.</strong> Los clientes no pueden encontrarte. Agrega o reactiva productos.`,
        accion: 'Ir a inventario', onclick: "app.mostrar('productos')"
      });
    }
    if (d.local.estado_operativo === 'cerrado') {
      notifs.push({
        tipo: 'cerrado', color: 'var(--err)', icon: '🔴',
        msg: `<strong>Tu local está marcado como cerrado.</strong> Los clientes lo ven con un aviso.`,
        accion: 'Reabrir', onclick: "cdashboard.abrirEstadoModal()"
      });
    }

    if (!notifs.length) {
      cont.innerHTML = `<div class="cd-notif cd-notif-ok">
        ✅ <strong>Todo en orden.</strong> Tu local está funcionando bien.
      </div>`;
      return;
    }

    cont.innerHTML = notifs.map(n => `
      <div class="cd-notif" style="border-left-color:${n.color}">
        <span class="cd-notif-icon">${n.icon}</span>
        <div class="cd-notif-content">${n.msg}</div>
        ${n.accion ? `<button class="btn btn-sm btn-ghost" onclick="${n.onclick}">${n.accion} →</button>` : ''}
      </div>`).join('');
  }

  // ── Pestañas del panel de detalle (menos scroll: 1 tarjeta, no 3 apiladas) ──
  function tab(nombre) {
    document.querySelectorAll('.cd-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));
    document.querySelectorAll('.cd-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === nombre));
  }

  // ── Acciones de notificaciones ────────────────────────────────────────────
  function irASinFoto() {
    app.mostrar('productos');
    // Resaltar la card de "sin foto"
    setTimeout(() => $('cardSinFoto')?.scrollIntoView({ behavior: 'smooth' }), 100);
  }
  function irADesactualizados() {
    app.mostrar('productos');
    // Filtrar por "no actualizados"
    const busq = $('busqueda');
    if (busq) busq.placeholder = '🕒 Revisa los productos con fecha más antigua';
  }

  // ── Productos sin foto ────────────────────────────────────────────────────
  function renderStockBajo(stockBajo) {
    const cont = $('cdStockBajo');
    if (!cont) return;
    if (!stockBajo || !stockBajo.length) {
      cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:14px">✅ Ningún producto con stock bajo</p>';
      return;
    }
    cont.innerHTML = stockBajo.slice(0, 8).map(p =>
      `<div class="cd-list-item">
        <span>${p.stock === 0 ? '🔴' : '🟡'} ${app.escapeHtml(p.nombre)}</span>
        <span style="font-weight:700;color:${p.stock === 0 ? 'var(--err)' : 'var(--warn)'}">${p.stock}</span>
      </div>`).join('') + (stockBajo.length > 8 ? `<p style="font-size:11px;color:var(--muted);text-align:right;padding:6px">+ ${stockBajo.length - 8} más</p>` : '');
  }

  function renderSinFoto(sinFoto) {
    const cont = $('cdSinFoto');
    if (!cont) return;
    if (!sinFoto.length) {
      cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:14px">✅ Todos tus productos tienen foto</p>';
      return;
    }
    cont.innerHTML = sinFoto.slice(0, 8).map(p =>
      `<div class="cd-list-item">
        <span>📦 ${app.escapeHtml(p.nombre)}</span>
        <button class="btn btn-sm btn-primary" onclick="cdashboard.subirFotoDe(${p.id})">📸 Subir</button>
      </div>`).join('') + (sinFoto.length > 8 ? `<p style="font-size:11px;color:var(--muted);text-align:right;padding:6px">+ ${sinFoto.length - 8} más</p>` : '');
  }

  function subirFotoDe(productoId) {
    app.mostrar('productos');
    setTimeout(() => productos.abrirEditar(STATE.activeLocal.productos.findIndex(p => p.id === productoId)), 200);
  }

  function renderDesactualizados(items) {
    const cont = $('cdDesact');
    if (!cont) return;
    if (!items.length) {
      cont.innerHTML = '<p style="color:var(--muted);text-align:center;padding:14px">✅ Todos los precios al día</p>';
      return;
    }
    cont.innerHTML = items.slice(0, 8).map(p => {
      const dias = p.ultima_actualizacion
        ? Math.floor((Date.now() - new Date(p.ultima_actualizacion).getTime()) / 86400000)
        : null;
      return `<div class="cd-list-item" style="flex-wrap:wrap;gap:6px">
        <span style="flex:1;min-width:120px">📦 ${app.escapeHtml(p.nombre)}</span>
        <span style="font-size:11px;color:var(--muted)">${dias !== null ? `Hace ${dias}d` : 'Nunca'}</span>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="number" placeholder="Nuevo precio"
            id="precioInline_${p.id}"
            style="width:110px;padding:4px 8px;border-radius:7px;border:1px solid var(--border2,#2a3450);background:var(--bg2,#0f1320);color:var(--text);font-size:12px"
            min="1" step="1"/>
          <button onclick="cdashboard.guardarPrecioInline(${p.id})"
            style="padding:4px 10px;border-radius:7px;border:none;background:var(--accent,#f0b429);color:#1a1a2e;font-size:11px;font-weight:700;cursor:pointer">
            Guardar
          </button>
        </div>
      </div>`;
    }).join('');
  }

  function renderTopClicks(tops) {
    let el = document.getElementById('cdTopClicks');
    if (!el) return;
    if (!tops || !tops.length) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">Sin datos de clics aún</p>'; return; }
    const max = tops[0].clicks || 1;
    el.innerHTML = `<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">📱 Top productos por clics WhatsApp</div>`
      + tops.slice(0,5).map((p,i) => {
          const pct = Math.round(((p.clicks||0)/max)*100);
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
          return `<div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span style="color:var(--text)">${medal} ${app.escapeHtml(p.nombre||'Producto')}</span>
              <span style="color:#25d366;font-weight:700">${p.clicks||0} 📱</span>
            </div>
            <div style="background:rgba(255,255,255,.06);border-radius:100px;height:5px;overflow:hidden">
              <div style="background:linear-gradient(90deg,#25d366,#128c7e);height:100%;width:${pct}%;border-radius:100px"></div>
            </div>
          </div>`;
        }).join('');
  }

  // ── Sparkline SVG helper ──────────────────────────────────────────────────
  function _sparkline(valores, color) {
    if (!valores || !valores.length) return '';
    const w = 120, h = 36, pad = 2;
    const max = Math.max(...valores, 1);
    const pts = valores.map((v, i) => {
      const x = pad + (i / (valores.length - 1 || 1)) * (w - pad*2);
      const y = h - pad - ((v/max) * (h - pad*2));
      return `${x},${y}`;
    }).join(' ');
    const lastPt = pts.split(' ').pop();
    const [lx, ly] = lastPt.split(',');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible">
      <polyline points="${pts}" fill="none" stroke="${color||'#f0b429'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="3" fill="${color||'#f0b429'}"/>
    </svg>`;
  }

  // ── Modal de estado del local ─────────────────────────────────────────────
  function abrirEstadoModal() {
    const local = STATE.activeLocal;
    $('cdEstadoSel').value = local.estado_operativo || 'abierto';
    $('cdEstadoMsg').value = local.estado_mensaje || '';
    app.abrirModal('estadoLocalModal');
  }

  async function guardarEstado() {
    const local = STATE.activeLocal;
    const estado = $('cdEstadoSel').value;
    const mensaje = $('cdEstadoMsg').value.trim();
    const r = await api.patch(`/locales/${local.id}/estado-operativo`, { estado, mensaje });
    if (r.ok && r.data?.success) {
      local.estado_operativo = estado;
      local.estado_mensaje = mensaje;
      toast('Estado actualizado', 'ok');
      app.cerrarModal('estadoLocalModal');
      cargar();
    } else toast('Error al actualizar estado', 'err');
  }

  // ── Vista previa pública ──────────────────────────────────────────────────
  function abrirVistaPublica() {
    const local = STATE.activeLocal;
    const productos = (local.productos || []).filter(p => p.estado === 'habilitado');
    const plan = app.getPlan(local.plan || 0);
    const estado = local.estado_operativo || 'abierto';
    const estadoBadge = {
      abierto: '<span style="background:#10b981;color:#fff;padding:3px 10px;border-radius:14px;font-size:11px;font-weight:700">🟢 Abierto ahora</span>',
      pausado: '<span style="background:#f59e0b;color:#fff;padding:3px 10px;border-radius:14px;font-size:11px;font-weight:700">🟡 Pausado temporalmente</span>',
      cerrado: '<span style="background:#ef4444;color:#fff;padding:3px 10px;border-radius:14px;font-size:11px;font-weight:700">🔴 Cerrado</span>'
    }[estado];

    $('previewContent').innerHTML = `
      <div class="preview-frame">
        <div class="preview-header">
          <h2>${app.escapeHtml(local.nombre)}</h2>
          <div style="display:flex;gap:8px;align-items:center;margin:8px 0">
            ${estadoBadge}
          </div>
          <p style="color:#64748b;font-size:13px">📍 ${app.escapeHtml(local.direccion || '')} · ${app.escapeHtml(local.comuna || '—')}</p>
          ${local.estado_mensaje ? `<div style="background:#fef3c7;border:1px solid #fde68a;padding:8px 12px;border-radius:6px;font-size:12px;color:#92400e;margin-top:8px">⚠️ ${app.escapeHtml(local.estado_mensaje)}</div>` : ''}
        </div>
        <div class="preview-body">
          <h4 style="font-size:13px;color:#64748b;margin-bottom:10px;text-transform:uppercase">Catálogo (${productos.length} productos)</h4>
          ${productos.length ? `<div class="preview-grid">
            ${productos.slice(0, 12).map(p => `
              <div class="preview-product">
                ${(p.imagenes && p.imagenes.length) ? `<img src="${app.escapeHtml(p.imagenes[0].ruta)}" alt=""/>` : '<div class="preview-noimg">📦</div>'}
                <div class="preview-product-info">
                  <strong>${app.escapeHtml(p.nombre)}</strong>
                  <span class="preview-precio">${app.clp(p.precio)}</span>
                </div>
              </div>`).join('')}
          </div>${productos.length > 12 ? `<p style="text-align:center;color:#64748b;font-size:12px;margin-top:10px">+ ${productos.length - 12} más</p>` : ''}` :
          '<p style="text-align:center;color:#94a3b8;padding:30px">📭 Sin productos visibles</p>'}
        </div>
      </div>`;
    // Botón copiar link
    const linkBtn = document.getElementById('previewCopyLink');
    if (linkBtn) {
      linkBtn.onclick = () => {
        const url = window.location.origin + '/usuario/index.html';
        navigator.clipboard.writeText(url).then(() => toast('📋 Link copiado', 'ok')).catch(() => toast('No se pudo copiar', 'err'));
      };
    }
    app.abrirModal('previewModal');
  }

  async function guardarPrecioInline(productoId) {
    const input = document.getElementById('precioInline_' + productoId);
    if (!input) return;
    const precio = parseInt(input.value);
    if (!precio || precio <= 0) { toast('Ingresa un precio válido', 'err'); return; }
    const r = await api.patch('/productos/' + productoId, { precio });
    if (r.ok && r.data && r.data.success) {
      toast('✅ Precio actualizado', 'ok');
      input.value = '';
      cargar();
    } else { toast('Error al guardar', 'err'); }
  }

  return { cargar, abrirEstadoModal, guardarEstado, abrirVistaPublica, irASinFoto, irADesactualizados, subirFotoDe, guardarPrecioInline, tab };
})();
