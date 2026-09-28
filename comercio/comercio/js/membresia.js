// membresia.js — Gestión de membresía: planes, prorrateo, downgrade
window.membresia = (function () {
  const { STATE, $, toast } = app;

  function render() {
    const local = STATE.activeLocal;
    if (!local) return;
    const plan = app.getPlan(local.plan || 0);
    const cupoMax = app.cupoEfectivo(local);
    const activos = (local.productos || []).filter(p => p.estado === 'habilitado').length;
    const totalProds = (local.productos || []).length;

    $('mbLocalNombre').textContent = local.nombre;
    $('mbPlanNombre').textContent = plan.icon + ' ' + plan.nombre;
    $('mbPlanNombre').style.color = plan.color;
    $('mbBadge').textContent = (cupoMax === Infinity ? '∞' : cupoMax) + ' productos';
    $('mbBadge').style.background = plan.color + '20';
    $('mbBadge').style.color = plan.color;
    const perc = cupoMax === Infinity ? 100 : Math.min((activos / cupoMax) * 100, 100);
    $('mbFill').style.width = perc + '%';
    $('mbFill').style.background = plan.color;
    const promoBonus = local.promo_activa && local.promo_activa.bonus_productos_pct;
    $('mbProgTxt').innerHTML = `${activos} activos · ${totalProds} totales`
      + (promoBonus && cupoMax !== Infinity ? ` · <span style="color:#10b981;font-weight:700">🎟️ cupo aumentado +${local.promo_activa.bonus_productos_pct}%</span>` : '');

    const vence = local.fecha_vencimiento ? new Date(local.fecha_vencimiento).toLocaleDateString('es-CL') : null;
    if (plan.precio === 0 && !plan.ilimitado) {
      $('mbRenovacion').textContent = 'Plan gratuito · Sin vencimiento';
    } else {
      $('mbRenovacion').textContent = vence ? `Próxima renovación: ${vence}` : 'Renovación automática mensual';
    }

    // Aviso de downgrade pendiente
    if (local.plan_pendiente !== null && local.plan_pendiente !== undefined && local.fecha_efectiva_downgrade) {
      const planPend = app.getPlan(local.plan_pendiente);
      const fecha = new Date(local.fecha_efectiva_downgrade).toLocaleDateString('es-CL');
      $('mbDowngradeAlert').style.display = 'block';
      $('mbDowngradeTxt').innerHTML = `Bajarás a <strong>${planPend.icon} ${planPend.nombre}</strong> el ${fecha}.`;
    } else {
      $('mbDowngradeAlert').style.display = 'none';
    }

    renderPlanes();
    mostrarPromoActiva();
    $('cambioBox').style.display = 'none';
    $('cambioBox').innerHTML = '';
    STATE.planPendienteCambio = null;
  }

  function mostrarPromoActiva() {
    const local = STATE.activeLocal;
    const box = $('mbPromoActiva');
    if (!box) return;
    const promo = local && local.promo_activa;
    const hint = $('mbPromoHint');
    const canjeBox = $('mbCanjeBox');

    if (promo) {
      // Hay promo activa → no se puede canjear otra hasta que venza
      if (canjeBox) canjeBox.style.display = 'none';
      if (hint) hint.innerHTML = 'Solo puedes tener una promoción activa a la vez. Podrás usar otro código cuando termine la actual.';
    } else {
      if (canjeBox) canjeBox.style.display = 'flex';
      if (hint) {
        hint.innerHTML = local && local.es_cliente_nuevo
          ? '🆕 <strong>Eres cliente nuevo</strong> (primeras 48h): puedes usar un código de bienvenida en cualquier plan.'
          : 'Ingresa el código de cliente existente para acceder a un beneficio temporal.';
      }
    }

    if (!promo) { box.style.display = 'none'; return; }

    const vence = promo.fecha_vence ? new Date(promo.fecha_vence).toLocaleDateString('es-CL') : '';
    const lineas = [];

    if (promo.descuento_pct) {
      lineas.push(`💰 <strong>${promo.descuento_pct}% de descuento</strong> en el precio de tu plan`);
    }
    if (promo.bonus_productos_pct) {
      const plan = app.getPlan(local.plan || 0);
      const base = plan.ilimitado ? Infinity
                 : (local.plan > 0 ? plan.cupo : app.getCupoGratuito(local.tipo_negocio || 'productos'));
      if (base === Infinity) {
        lineas.push(`📦 <strong>+${promo.bonus_productos_pct}% de cupo</strong> (ya tienes cupo ilimitado)`);
      } else {
        const efectivo = Math.round(base * (1 + promo.bonus_productos_pct / 100));
        const extra = efectivo - base;
        lineas.push(`📦 <strong>+${extra} productos extra</strong> (de ${base} a <strong>${efectivo}</strong>, +${promo.bonus_productos_pct}%)`);
      }
    }

    box.style.display = 'block';
    box.innerHTML = `
      <div style="font-weight:800;margin-bottom:6px">🎟️ Código ${app.escapeHtml ? app.escapeHtml(promo.codigo) : promo.codigo} activo</div>
      <div style="display:flex;flex-direction:column;gap:3px">${lineas.map(l => `<span>${l}</span>`).join('')}</div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px dashed currentColor;opacity:.85;font-size:12px">
        ⏳ Vigente hasta el <strong>${vence}</strong>. Mantienes este descuento aunque cambies de plan durante el período. Al terminar, tu plan vuelve a la normalidad (precio y cupo estándar).
      </div>`;
  }

  async function canjearCodigo() {
    const local = STATE.activeLocal;
    if (!local) return;
    const codigo = $('mbCodigoInput').value.trim();
    if (!codigo) return app.toast ? app.toast('Escribe un código') : alert('Escribe un código');
    const r = await api.post('/comercio/aplicar-codigo', { local_id: local.id, codigo });
    if (r.ok && r.data && r.data.success) {
      const p = r.data.promo;
      const benef = [];
      if (p.descuento_pct) benef.push(`${p.descuento_pct}% descuento`);
      if (p.bonus_productos_pct) benef.push(`+${p.bonus_productos_pct}% productos`);
      (app.toast ? app.toast('🎟️ ¡Código aplicado! ' + benef.join(' y ')) : alert('Código aplicado'));
      $('mbCodigoInput').value = '';
      // Refrescar datos del local desde el servidor
      if (window.app && app.recargarLocales) await app.recargarLocales();
      render();
    } else {
      const msg = (r.data && r.data.message) || 'Código inválido';
      (app.toast ? app.toast('❌ ' + msg) : alert(msg));
    }
  }

  function renderPlanes() {
    const local = STATE.activeLocal;
    const planActual = local.plan || 0;
    const grid = $('planesGrid');

    // Descuento por código activo
    const promo = local.promo_activa;
    const descPct = (promo && promo.descuento_pct) ? promo.descuento_pct : 0;

    grid.innerHTML = app.PLANES.map(p => {
      const esActual = p.cupo === planActual;
      const esDeluxeBloqueado = p.requiereDesde !== null && planActual < p.requiereDesde;

      let onclick = '';
      let cursorStyle = '';
      if (esActual) {
        onclick = '';
      } else if (esDeluxeBloqueado) {
        onclick = `onclick="app.toast('El plan Deluxe requiere estar primero en Premium', 'err')"`;
        cursorStyle = 'opacity:.6;cursor:not-allowed';
      } else {
        onclick = `onclick="membresia.solicitar(${p.cupo})"`;
      }

      const tipo = local.tipo_negocio || 'productos';
      const cupoReal = p.cupo === 0 ? app.getCupoGratuito(tipo) : p.cupo;
      const cupoTxt = p.ilimitado ? '∞<span> ilimitado</span>' : `${cupoReal}<span> productos</span>`;

      let precioTxt;
      if (p.precio === 0) {
        precioTxt = '<div class="plan-card-precio gratis">¡Gratis!</div>';
      } else if (descPct > 0) {
        const precioDesc = Math.round(p.precio * (1 - descPct / 100));
        precioTxt = `
          <div class="plan-precio-orig">${app.clp(p.precio)}</div>
          <div class="plan-card-precio promo">${app.clp(precioDesc)}/mes</div>
          <div class="plan-card-iva">${app.clp(Math.round(precioDesc * 1.19))} c/IVA</div>
          <div class="plan-promo-badge">🎟️ −${descPct}% con ${app.escapeHtml ? app.escapeHtml(promo.codigo) : promo.codigo}</div>`;
      } else {
        precioTxt = `<div class="plan-card-precio">${app.clp(p.precio)}/mes</div>
           <div class="plan-card-iva">${app.clp(Math.round(p.precio * 1.19))} c/IVA</div>`;
      }

      const accionTxt = esActual ? '' :
        esDeluxeBloqueado ? '🔒 Bloqueado' :
        (p.ilimitado ? Infinity : p.cupo) > planActual ? '⬆ Subir' : '⬇ Bajar'; // ilimitado llega con cupo 0

      return `
        <div class="plan-card ${esActual ? 'actual' : ''} ${p.requiereDesde !== null ? 'deluxe' : ''} ${descPct > 0 && p.precio > 0 ? 'con-promo' : ''}"
             ${onclick}
             style="border-color:${esActual ? p.color : 'var(--border)'}; ${cursorStyle}">
          <div class="plan-card-nombre" style="color:${p.color}">${p.icon} ${p.nombre}</div>
          <div class="plan-card-cupo" style="color:${p.color}">${cupoTxt}</div>
          ${precioTxt}
          ${accionTxt ? `<div style="margin-top:10px;font-size:12px;color:var(--muted);font-weight:600">${accionTxt}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ──────────────────────────────────────────────────────────────────────
  // SOLICITAR CAMBIO DE PLAN
  // ──────────────────────────────────────────────────────────────────────
  async function solicitar(nuevoCupo) {
    const local = STATE.activeLocal;
    const r = await api.post(`/comercios/cambiar-plan/${local.id}`, { nuevoCupo });
    if (!r.ok || !r.data?.success) {
      return toast(r.data?.message || 'Error al cambiar plan', 'err');
    }

    // ── Caso 1: aplicado sin cobro (volver a gratuito) ──
    if (r.data.accion === 'aplicado_sin_cobro') {
      toast('Plan cambiado', 'ok');
      await app.recargarLocales();
      render();
      return;
    }

    // ── Caso 2: downgrade programado ──
    if (r.data.accion === 'downgrade_programado') {
      const box = $('cambioBox');
      const planNuevo = app.getPlan(nuevoCupo);
      const planAct = app.getPlan(local.plan || 0);
      const fecha = new Date(r.data.local.fecha_efectiva_downgrade).toLocaleDateString('es-CL');
      const activosActuales = r.data.productos_activos_actuales || 0;
      const excedente = activosActuales > nuevoCupo ? (activosActuales - nuevoCupo) : 0;

      box.innerHTML = `
        <div class="bajada-warning">
          <strong>⬇ Bajada de plan programada</strong>
          Mantienes el plan <strong>${planAct.icon} ${planAct.nombre}</strong> hasta el <strong>${fecha}</strong>.<br>
          A partir de esa fecha pasarás a <strong>${planNuevo.icon} ${planNuevo.nombre}</strong> (${nuevoCupo} productos).
          ${excedente > 0 ? `<br><br><strong>⚠️ Tienes ${activosActuales} productos activos.</strong> Al aplicar la bajada, los ${excedente} más recientes se marcarán como <span style="background:var(--red-bg);color:var(--red-tx);padding:2px 6px;border-radius:4px">🔴 Restringidos</span> automáticamente. Puedes pausar manualmente otros antes para mantener los que prefieras.` : ''}
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-ghost btn-sm" onclick="membresia.cancelarDowngrade()">Cancelar la bajada</button>
          <button class="btn btn-primary btn-sm" onclick="app.mostrar('productos')">Ir al inventario</button>
        </div>`;
      box.style.display = 'block';
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await app.recargarLocales();
      render();
      return;
    }

    // ── Caso 3: requiere pago (upgrade) ──
    if (r.data.accion === 'pago_pendiente') {
      STATE.planPendienteCambio = {
        nuevoCupo,
        prorrateo: r.data.prorrateo,
        pagoId: r.data.pago_id
      };
      abrirPagoModal(r.data.prorrateo);
      return;
    }
  }

  function abrirPagoModal(calc) {
    $('pagoTitle').textContent = `💳 Activar plan ${calc.plan_nuevo.nombre}`;
    $('pagoSub').textContent = `Pago prorrateado por los ${calc.dias_restantes} días restantes del mes`;

    const promo = calc.promocion;
    // Renovación: con promo usa el precio rebajado mientras esté vigente
    const renovTotal = promo ? calc.precio_mensual_total : Math.round(calc.plan_nuevo.precio * 1.19);
    const promoRow = promo ? `
      <div class="prorratea-row" style="color:#10b981;font-weight:700">
        <span>🎟️ ${promo.fuente === 'codigo' ? 'Código ' + (promo.codigo||'') : promo.nombre} (−${promo.descuento_pct}%)</span>
        <span>−${app.clp(promo.descuento_monto)}/mes</span>
      </div>` : '';
    const promoNota = promo && promo.fuente === 'codigo' && promo.vence
      ? `<div style="font-size:12px;color:#10b981;margin-top:6px">🎟️ Descuento vigente hasta el ${new Date(promo.vence).toLocaleDateString('es-CL')}. Luego se cobra el valor normal.</div>`
      : '';

    $('pagoResumen').innerHTML = `
      <h4>📅 Resumen del cambio</h4>
      <div class="prorratea-row"><span>Plan actual</span><span>${calc.plan_actual.nombre}</span></div>
      <div class="prorratea-row"><span>Nuevo plan</span><span>${calc.plan_nuevo.nombre} (${calc.plan_nuevo.ilimitado ? '∞' : calc.plan_nuevo.cupo} productos)</span></div>
      ${promoRow}
      <div class="prorratea-row"><span>Días restantes del mes</span><span>${calc.dias_restantes} de ${calc.dias_mes}</span></div>
      <div class="prorratea-row"><span>Cobro prorrateado neto</span><span>${app.clp(calc.monto_neto_prorrateo)}</span></div>
      <div class="prorratea-row"><span>IVA (19%)</span><span>${app.clp(calc.iva_prorrateo)}</span></div>
      <div class="prorratea-row"><span>💰 Total a pagar ahora</span><span>${app.clp(calc.monto_total_pago)}</span></div>
      <div style="font-size:12px;color:var(--muted);margin-top:14px;padding-top:10px;border-top:1px dashed var(--border)">
        ℹ️ Próximas renovaciones mensuales: <strong>${app.clp(renovTotal)}</strong> el día 1 de cada mes.
      </div>
      ${promoNota}`;

    app.abrirModal('pagoModal');
  }

  async function cancelarDowngrade() {
    const local = STATE.activeLocal;
    if (!local) return;
    if (!confirm('¿Cancelar el downgrade programado y mantener el plan actual?')) return;
    const r = await api.post(`/comercios/cancelar-downgrade/${local.id}`);
    if (r.ok && r.data?.success) {
      toast('Downgrade cancelado', 'ok');
      await app.recargarLocales();
      render();
    } else {
      toast('Error al cancelar', 'err');
    }
  }

  return { render, renderPlanes, solicitar, abrirPagoModal, cancelarDowngrade, canjearCodigo };
})();
