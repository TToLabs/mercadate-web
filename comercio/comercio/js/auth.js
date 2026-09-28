// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comerciante
// ARCHIVO    : auth.js
// ═══════════════════════════════════════════════════
// auth.js — Login, registro, selección de local, logout
window.auth = (function () {
  const { STATE, $, toast } = app;

  async function login(cerrarSid) {
    const user = $('loginUser').value.trim();
    const pass = $('loginPass').value.trim();
    if (!user || !pass) return toast('Ingresa tus credenciales', 'err');

    // Limpiar cualquier aviso previo
    const errBox = $('loginErr');
    if (errBox) { errBox.innerHTML = ''; errBox.style.display = 'none'; }

    const r = await api.post('/owner-login', {
      owner_username: user, owner_password: pass, cerrar_sid: cerrarSid || undefined
    });

    if (!r || !r.ok || !r.data || !r.data.success) {
      if (r && r.data && r.data.codigo === 'limite_dispositivos') {
        return mostrarLimiteDispositivos(r.data.sesiones || []);
      }
      if (errBox) {
        errBox.textContent = (r && r.data && r.data.message) || 'No se pudo conectar. Reintenta.';
        errBox.style.display = 'block';
      }
      return;
    }

    STATE.owner = {
      username: user,
      whatsapp_admin: r.data.owner?.whatsapp_admin || null,
      tyc_version: r.data.owner?.tyc_version || null,
      token: r.data.token || null  // respaldo Bearer para APK/WebView que no persiste cookies
    };
    STATE.allLocales = r.data.locales || [];

    if (STATE.allLocales.length === 0) {
      toast('No tienes locales registrados.', 'err');
      return;
    }
    if (STATE.allLocales.length === 1) {
      seleccionarLocal(0);
    } else {
      renderSelectorLocales();
    }
  }

  // Aviso de tope de dispositivos: lista las sesiones activas y deja cerrar una para entrar
  function mostrarLimiteDispositivos(sesiones) {
    const err = $('loginErr');
    const fmt = (ms) => { try { return new Date(ms).toLocaleString('es-CL'); } catch { return ''; } };
    err.style.display = 'block';
    err.innerHTML = `
      <div style="text-align:left;font-weight:700;margin-bottom:6px">🔒 Máximo de dispositivos alcanzado</div>
      <div style="text-align:left;font-size:13px;margin-bottom:10px">Esta cuenta puede tener 2 sesiones activas. Cierra una para iniciar en este dispositivo:</div>
      ${sesiones.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px;border:1px solid var(--border,#334155);border-radius:8px;margin-bottom:6px">
          <div style="text-align:left">
            <div style="font-weight:600">${app.escapeHtml(s.dispositivo)}</div>
            <div style="font-size:12px;opacity:.7">Último acceso: ${fmt(s.ultimo_acceso || s.creada)}</div>
          </div>
          <button class="btn" onclick="auth.login('${s.sid}')" style="white-space:nowrap">Cerrar y entrar</button>
        </div>`).join('')}`;
  }

  function renderSelectorLocales() {
    $('loginScreen').style.display = 'none';
    $('selectLocalScreen').style.display = 'flex';
    $('selectTitle').textContent = `Tienes ${STATE.allLocales.length} locales`;
    $('localList').innerHTML = STATE.allLocales.map((l, idx) => {
      const plan = app.getPlan(l.plan || 0);
      const cupo = app.cupoEfectivo(l);
      const habs = (l.productos || []).filter(p => p.estado === 'habilitado').length;
      return `
        <div class="local-item" onclick="auth.seleccionarLocal(${idx})">
          <div class="local-info">
            <h4>${app.escapeHtml(l.nombre)}</h4>
            <p>📍 ${app.escapeHtml(l.direccion ? l.direccion + ', ' : '')}${app.escapeHtml(l.comuna || '—')}</p>
            <p style="margin-top:3px">📦 ${habs}/${cupo === Infinity ? '∞' : cupo} activos · ${plan.icon} ${plan.nombre}</p>
          </div>
          <span style="color:var(--accent);font-size:20px;font-weight:bold">›</span>
        </div>`;
    }).join('');
  }

  function seleccionarLocal(idx) {
    STATE.activeLocal = STATE.allLocales[idx];
    $('selectLocalScreen').style.display = 'none';
    $('loginScreen').style.display = 'none';
    $('appScreen').style.display = 'block';
    app.actualizarUI();
    toast(`Local activo: ${STATE.activeLocal.nombre}`, 'ok');
    if (window.MDOnboarding) window.MDOnboarding.mostrarUnaVez('comercio', _checkTyC); else _checkTyC();
  }

  // ─── Términos y Condiciones (comercio) ────────────────────────────────────
  // TYC_VERSION centralizada en server.js — se lee al arrancar
  let TYC_VERSION = '2.1'; // fallback si la API no responde
  (async () => { try { const r = await fetch('/api/tyc-version'); const d = await r.json(); if (d && d.version) TYC_VERSION = d.version; } catch (_) {} })();

  function _checkTyC() {
    const ow = STATE.owner || {};
    if (ow.tyc_version === TYC_VERSION) return;
    if (localStorage.getItem('md_owner_tyc_v') === TYC_VERSION) return;
    _mostrarModalTyC();
  }

  function _mostrarModalTyC() {
    if (document.getElementById('tycModalComercio')) return;
    const ov = document.createElement('div');
    ov.id = 'tycModalComercio';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(10,14,24,.94);display:flex;align-items:center;justify-content:center';
    ov.innerHTML = `
      <div style="background:var(--surface,#1a2233);border:1px solid var(--border,#2a3342);border-radius:18px;padding:26px 22px;width:340px;max-width:92%;text-align:center">
        <div style="font-size:32px;margin-bottom:8px">📄</div>
        <h3 style="color:var(--text,#e2e8f0);font-size:16px;margin:0 0 10px">Términos y Condiciones</h3>
        <p style="color:var(--muted,#94a3b8);font-size:12.5px;line-height:1.55;margin:0 0 12px;text-align:left">
          Para operar tu comercio en MercaDate necesitas aceptar los Términos y Condiciones de Uso
          (versión ${TYC_VERSION}). Incluyen: el plan gratuito permanente y las membresías pagadas con
          <strong style="color:var(--text,#e2e8f0)">garantía de precio</strong> (tu valor mensual se respeta
          mientras mantengas tu plan), tu responsabilidad sobre el contenido que publicas, y las
          condiciones generales de la plataforma.
        </p>
        <a href="legal/terminos.html" target="_blank" rel="noopener"
           style="display:block;color:#f0b429;font-size:13px;font-weight:700;margin-bottom:14px;text-decoration:underline">
          Leer los términos completos
        </a>
        <label style="display:flex;align-items:flex-start;gap:9px;text-align:left;margin-bottom:16px;cursor:pointer">
          <input type="checkbox" id="tycCheckCom" style="width:18px;height:18px;margin-top:1px;flex-shrink:0;cursor:pointer"
                 onchange="document.getElementById('tycBtnCom').disabled=!this.checked;
                           document.getElementById('tycBtnCom').style.opacity=this.checked?'1':'.45'">
          <span style="font-size:12.5px;color:#cbd5e1;line-height:1.5">
            He leído y acepto los Términos y Condiciones de Uso de MercaDate (versión ${TYC_VERSION}).
          </span>
        </label>
        <button id="tycBtnCom" onclick="auth._aceptarTyC()" disabled
          style="width:100%;padding:13px;border-radius:10px;border:none;opacity:.45;background:#f0b429;color:#1a1a1a;font-weight:800;font-size:14px;cursor:pointer">
          Continuar
        </button>
        <p style="color:#64748b;font-size:11px;margin:10px 0 0">Si no estás de acuerdo, puedes cerrar sesión.</p>
      </div>`;
    document.body.appendChild(ov);
  }

  async function _aceptarTyC() {
    const chk = document.getElementById('tycCheckCom');
    if (!chk || !chk.checked) return; // requiere marcar la casilla
    localStorage.setItem('md_owner_tyc_v', TYC_VERSION);
    document.getElementById('tycModalComercio')?.remove();
    try {
      await api.post('/comercio/aceptar-tyc', {});
      if (STATE.owner) STATE.owner.tyc_version = TYC_VERSION;
    } catch (e) { localStorage.removeItem('md_owner_tyc_v'); }
  }

  async function logout() {
    try { await api.post('/owner-logout'); } catch (e) { /* ignorar */ }
    location.reload();
  }

  function mostrarRegistro() { $('loginScreen').style.display = 'none'; $('registerScreen').style.display = 'flex'; }
  function mostrarLogin()    { $('registerScreen').style.display = 'none'; $('loginScreen').style.display = 'flex'; }

  function mostrarRecuperar() { app.abrirModal('recuperarModal'); }

  // ── Reset de contraseña desde enlace de correo (pantalla integrada) ──
  let _resetToken = null;
  async function iniciarReset(token) {
    _resetToken = token;
    ['loginScreen','registerScreen','selectLocalScreen','appScreen'].forEach(id => { const e = $(id); if (e) e.style.display = 'none'; });
    $('resetScreen').style.display = 'flex';
    // Validar el token; si no sirve, ocultar el formulario
    try {
      const r = await api.get('/reset-password/validar?token=' + encodeURIComponent(token));
      if (!r.ok || !r.data || !r.data.valido) {
        $('resetForm').style.display = 'none';
        _resetMsg('Este enlace expiró o ya fue usado. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".', false);
      }
    } catch (_) {}
  }
  function _resetMsg(t, ok) {
    const m = $('resetMsg'); if (!m) return;
    m.style.display = 'block'; m.style.color = ok ? '#10b981' : '#ef4444'; m.textContent = t;
  }
  async function resetear() {
    const p1 = $('resetP1').value, p2 = $('resetP2').value;
    if (p1.length < 6) return _resetMsg('La contraseña debe tener al menos 6 caracteres.', false);
    if (p1 !== p2)     return _resetMsg('Las contraseñas no coinciden.', false);
    const r = await api.post('/reset-password', { token: _resetToken, password: p1 });
    if (r.ok && r.data && r.data.success) {
      $('resetForm').style.display = 'none';
      _resetMsg('✅ ' + r.data.message + ' Redirigiendo…', true);
      setTimeout(() => location.href = 'index.html', 2000);
    } else {
      _resetMsg((r.data && r.data.message) || 'No se pudo actualizar.', false);
    }
  }
  async function enviarRecuperacion() {
    const email = ($('recEmail').value || '').trim();
    const msg = $('recMsg');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.style.display = 'block'; msg.style.color = '#ef4444';
      msg.textContent = 'Ingresa un correo válido.'; return;
    }
    const r = await api.post('/comercio/recuperar-password', { email });
    msg.style.display = 'block'; msg.style.color = 'var(--accent,#f0b429)';
    msg.textContent = (r && r.data && r.data.message) || 'Si el correo está registrado, recibirás un enlace.';
    $('recEmail').value = '';
  }

  async function registrar() {
    const nombre   = $('regLocalNombre').value.trim();
    const cat      = $('regLocalCategoria').value;
    const dir      = $('regLocalDir').value.trim();
    const comuna   = $('regLocalComuna').value.trim();
    const user     = $('regUser').value.trim();
    const pass     = $('regPass').value.trim();
    const wspAdmin = $('regWspAdmin').value.trim();

    if (!nombre || !comuna || !user || pass.length < 6 || !wspAdmin) {
      $('regErr').textContent = 'Completa todos los campos (contraseña mínimo 6 caracteres).';
      $('regErr').style.display = 'block';
      return;
    }

    // Rubro principal + estado híbrido
    const catOpt        = $('regLocalCategoria').options[$('regLocalCategoria').selectedIndex];
    const tipoNegocio   = catOpt?.dataset?.tipo || '';
    const esHibrido     = !!($('reg_hibrido')?.value);
    const rubroSecundario = esHibrido ? ($('reg_rubroSecundario')?.value || null) : null;

    const payload = {
      owner: { username: user, password: pass, whatsapp_admin: wspAdmin },
      local: {
        id: Date.now(),
        nombre, comuna, direccion: dir, categoria: cat,
        tipo_negocio: tipoNegocio,
        rubro_secundario: rubroSecundario,
        es_hibrido: esHibrido,
        plan: 0, aprobado: true, productos: [],
        estado_suscripcion: 'activa'
      }
    };
    const r = await api.post('/locales', payload);

    if (r.status === 409 && r.data?.conflicto === 'nombre_duplicado') {
      // Manejar conflicto: ofrecer iniciar sesión o crear igual
      $('regErr').style.display = 'none';
      STATE.conflictoPayload = payload;
      const otros = r.data.otros_dueños || [];
      $('conflictoTxt').innerHTML = `Ya existe un comercio llamado <strong>"${app.escapeHtml(nombre)}"</strong> registrado por: <em>${otros.map(app.escapeHtml).join(', ')}</em>.`;
      app.abrirModal('conflictoModal');
      return;
    }

    if (r.ok && r.data?.success) {
      toast('Cuenta creada. Ahora inicia sesión.', 'ok');
      ['regLocalNombre','regLocalDir','regLocalComuna','regUser','regPass','regWspAdmin'].forEach(id => $(id).value = '');
      mostrarLogin();
    } else {
      $('regErr').textContent = r.data?.message || 'Error al crear cuenta';
      $('regErr').style.display = 'block';
    }
  }

  return {
    login, registrar, logout,
    mostrarRegistro, mostrarLogin,
    renderSelectorLocales, seleccionarLocal, _aceptarTyC,
    mostrarRecuperar, enviarRecuperacion, iniciarReset, resetear
  };
})();
