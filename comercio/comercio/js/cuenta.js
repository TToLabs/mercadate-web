// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comerciante
// ARCHIVO    : cuenta.js
// ═══════════════════════════════════════════════════
// cuenta.js — Mi Cuenta: WhatsApp admin/público + cambio de contraseña
window.cuenta = (function () {
  const { STATE, $, toast } = app;

  function render() {
    $('cuentaUsuario').textContent = STATE.owner?.username || '—';
    $('cuentaLocalesCount').textContent = STATE.allLocales.length;
    $('cuentaWspAdmin').value = STATE.owner?.whatsapp_admin || '';

    const local = STATE.activeLocal;
    const tienePagado = (local?.plan || 0) > 0;
    const wspInput = $('cuentaWspPublico');
    const wspBtn   = $('cuentaWspPublicoBtn');
    const wspInfo  = $('cuentaWspPublicoInfo');

    if (tienePagado) {
      wspInput.disabled = false;
      wspBtn.disabled = false;
      wspInput.value = local.whatsapp_publico || '';
      wspInfo.innerHTML = `Número visible para clientes en el local <strong>${app.escapeHtml(local.nombre)}</strong>. Aparece como botón 📱 junto a cada producto.`;
    } else {
      wspInput.disabled = true;
      wspBtn.disabled = true;
      wspInput.value = '';
      wspInput.placeholder = 'Disponible con plan pagado';
      wspInfo.innerHTML = `⚠️ Disponible al activar un plan pagado en el local <strong>${app.escapeHtml(local?.nombre || '—')}</strong>. Será el número que verán los clientes.`;
    }

    ['passActual','passNueva','passConfirm'].forEach(id => $(id).value = '');
  }

  async function guardarWspAdmin() {
    const wsp = $('cuentaWspAdmin').value.trim();
    // La cookie httpOnly md_owner autentica la sesión — no se requiere password en el body
    const r = await api.patch('/owner/whatsapp-admin', { whatsapp: wsp });
    if (r.ok && r.data?.success) {
      STATE.owner.whatsapp_admin = wsp;
      toast('WhatsApp del administrador actualizado', 'ok');
    } else {
      toast(r.data?.message || 'Error al guardar', 'err');
    }
  }

  async function guardarWspPublico() {
    const local = STATE.activeLocal;
    if (!local) return;
    if ((local.plan || 0) === 0) return toast('Necesitas un plan pagado para esto', 'err');

    const wsp = $('cuentaWspPublico').value.trim();
    const r = await api.patch(`/locales/${local.id}/whatsapp-publico`, { whatsapp: wsp });
    if (r.ok && r.data?.success) {
      local.whatsapp_publico = wsp;
      toast('WhatsApp público actualizado', 'ok');
      await app.recargarLocales();
    } else {
      toast(r.data?.message || 'Error al guardar', 'err');
    }
  }

  async function cambiarPassword() {
    const actual  = $('passActual').value;
    const nueva   = $('passNueva').value;
    const confirm = $('passConfirm').value;

    if (!actual || !nueva || !confirm) return toast('Completa todos los campos', 'err');
    if (nueva.length < 6) return toast('La nueva contraseña debe tener mínimo 6 caracteres', 'err');
    if (nueva !== confirm) return toast('Las contraseñas nuevas no coinciden', 'err');

    // La validación de la contraseña actual la hace el backend con bcrypt.
    // No se almacena ni compara el password en el cliente.
    const r = await api.patch('/owner/cambiar-password', {
      password_actual: actual,
      password_nueva:  nueva
    });

    if (r.ok && r.data?.success) {
      toast('Contraseña actualizada correctamente', 'ok');
      ['passActual','passNueva','passConfirm'].forEach(id => $(id).value = '');
    } else {
      toast(r.data?.message || 'Error al actualizar contraseña', 'err');
    }
  }

  // ── AYUDA / SOPORTE ───────────────────────────────────────────────────────
  let tipoAyudaActual = null;

  function abrirAyuda() {
    tipoAyudaActual = null;
    $('ayudaOpciones').style.display = 'block';
    $('ayudaFormulario').style.display = 'none';
    $('ayudaHistorial').style.display = 'none';
    app.abrirModal('ayudaModal');
  }

  function abrirFormularioAyuda(tipo) {
    tipoAyudaActual = tipo;
    const titulos = {
      comentario: '💬 Enviar comentarios',
      soporte_tecnico: '🛠️ Soporte Técnico'
    };
    $('ayudaTipoTitulo').textContent = titulos[tipo] || 'Mensaje';
    $('ayudaAsunto').value = '';
    $('ayudaMensaje').value = '';
    $('ayudaOpciones').style.display = 'none';
    $('ayudaFormulario').style.display = 'block';
    $('ayudaHistorial').style.display = 'none';
  }

  function volverOpcionesAyuda() {
    $('ayudaOpciones').style.display = 'block';
    $('ayudaFormulario').style.display = 'none';
    $('ayudaHistorial').style.display = 'none';
  }

  async function enviarAyuda() {
    const mensaje = $('ayudaMensaje').value.trim();
    const asunto = $('ayudaAsunto').value.trim();
    if (!mensaje) { toast('Escribe un mensaje', 'err'); return; }
    const local = STATE.activeLocal;
    const r = await api.post('/comercio/soporte', {
      local_id: local?.id || null,
      owner: STATE.owner.username,
      tipo: tipoAyudaActual,
      asunto,
      mensaje
    });
    if (r.ok && r.data?.success) {
      toast(tipoAyudaActual === 'soporte_tecnico' ? '✅ Ticket enviado. Te contactaremos pronto.' : '✅ Comentario enviado. ¡Gracias!', 'ok');
      app.cerrarModal('ayudaModal');
    } else {
      toast('Error al enviar', 'err');
    }
  }

  async function cargarHistorialSoporte() {
    $('ayudaOpciones').style.display = 'none';
    $('ayudaFormulario').style.display = 'none';
    $('ayudaHistorial').style.display = 'block';
    $('ayudaHistorialList').innerHTML = '<p style="color:var(--muted);padding:14px">Cargando…</p>';
    const r = await api.get(`/comercio/historial-soporte/${STATE.owner.username}`);
    if (!r.ok || !Array.isArray(r.data)) {
      $('ayudaHistorialList').innerHTML = '<p style="color:var(--err);padding:14px">Error al cargar</p>';
      return;
    }
    if (!r.data.length) {
      $('ayudaHistorialList').innerHTML = '<p style="color:var(--muted);padding:14px;text-align:center">No tienes mensajes anteriores</p>';
      return;
    }
    $('ayudaHistorialList').innerHTML = r.data.map(a => {
      const fecha = new Date(a.fecha).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const tipoIcon = a.tipo === 'soporte_tecnico' ? '🛠️' : '💬';
      const tipoTxt = a.tipo === 'soporte_tecnico' ? 'Soporte Técnico' : 'Comentario';
      const estado = a.resuelto
        ? '<span style="color:var(--ok);font-size:11px;font-weight:600">✅ Resuelto</span>'
        : '<span style="color:var(--accent);font-size:11px;font-weight:600">⏳ Pendiente</span>';
      return `<div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:var(--surface2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:12px">${tipoIcon} ${tipoTxt}</strong>
          ${estado}
        </div>
        ${a.datos.asunto ? `<div style="font-size:13px;margin-bottom:4px">${app.escapeHtml(a.datos.asunto)}</div>` : ''}
        <p style="font-size:12px;color:var(--muted);white-space:pre-wrap">${app.escapeHtml(a.datos.mensaje || '').slice(0, 200)}</p>
        <div style="font-size:10px;color:var(--muted);margin-top:6px">${fecha}</div>
      </div>`;
    }).join('');
  }

  return {
    render, guardarWspAdmin, guardarWspPublico, cambiarPassword,
    abrirAyuda, abrirFormularioAyuda, volverOpcionesAyuda, enviarAyuda, cargarHistorialSoporte
  };
})();
