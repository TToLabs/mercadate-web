// pagos.js — Integración con PayPal y MercadoPago
// En modo desarrollo: simula el pago confirmando directamente.
// En producción: redirige a la pasarela real (backend ya genera la URL).

window.pagos = (function () {
  const { STATE, $, toast } = app;

  async function iniciar(metodo) {
    const pendiente = STATE.planPendienteCambio;
    if (!pendiente || !pendiente.pagoId) {
      return toast('No hay pago pendiente', 'err');
    }

    // Pedir al backend que cree la orden y devuelva la URL
    const r = await api.post(`/pagos/${pendiente.pagoId}/iniciar`, { metodo });
    if (!r.ok || !r.data?.success) {
      return toast(r.data?.message || 'Error al iniciar pago', 'err');
    }

    // En desarrollo (sin credenciales reales), simulamos el flujo
    const esSimulacion = r.data.external_id && r.data.external_id.includes('SIM_');

    if (esSimulacion) {
      const ok = confirm(
        `🧪 MODO DESARROLLO — Simulación de pago\n\n` +
        `Método: ${metodo.toUpperCase()}\n` +
        `ID transacción: ${r.data.external_id}\n\n` +
        `¿Confirmar como pagado?\n` +
        `(En producción, esto redirige a ${metodo === 'paypal' ? 'PayPal' : 'Mercado Pago'} real)`
      );
      if (!ok) return;
      await confirmarSimulado(pendiente.pagoId, r.data.external_id);
      return;
    }

    // Producción: abrir la URL de pago en nueva ventana
    if (r.data.url) {
      const w = window.open(r.data.url, '_blank', 'width=600,height=700');
      toast('Completa el pago en la ventana abierta', 'ok');
      // Polling: chequear cada 3 segundos si el pago se confirmó
      const interval = setInterval(async () => {
        const check = await api.get(`/pagos/${pendiente.pagoId}/iniciar`);
        // En realidad necesitaríamos un endpoint para consultar el estado del pago
        // Aquí simplificamos: el webhook del backend actualiza el estado
        // y cuando recargamos los locales, vemos el cambio.
        await app.recargarLocales();
        if (STATE.activeLocal?.plan === pendiente.nuevoCupo) {
          clearInterval(interval);
          if (w && !w.closed) w.close();
          app.cerrarModal('pagoModal');
          toast('✅ Pago confirmado · Plan activado', 'ok');
          membresia.render();
        }
      }, 3000);
      // Tope de 10 minutos
      setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
    }
  }

  async function confirmarSimulado(pagoId, transactionId) {
    const r = await api.post(`/pagos/${pagoId}/confirmar`, { transaction_id: transactionId });
    if (r.ok && r.data?.success) {
      app.cerrarModal('pagoModal');
      toast('✅ Pago confirmado · Plan activado', 'ok');
      STATE.planPendienteCambio = null;
      await app.recargarLocales();
      membresia.render();
      // Después de cambio de plan, el cupo del local cambió → puede haber nuevos productos que se pueden habilitar
      app.actualizarUI();
    } else {
      toast('Error al confirmar pago', 'err');
    }
  }

  return { iniciar, confirmarSimulado };
})();
