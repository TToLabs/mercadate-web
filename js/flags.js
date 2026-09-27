// ═══════════════════════════════════════════════════
// PLATAFORMA : Compartida — Feature flags (usuario · comercio · admin)
// ARCHIVO    : flags.js
// ═══════════════════════════════════════════════════
// Lee /api/flags (público) y aplica los interruptores definidos en el panel admin.
//
// USO DECLARATIVO (no requiere tocar lógica):
//   <button data-flag="usuario_carrito">…</button>        → se OCULTA si el flag está off
//   <button data-flag-disable="busqueda_almacenes">…</button> → queda DESHABILITADO si está off
//   <span data-flag-not="busqueda_almacenes">Próximamente</span> → visible SOLO si está off
//
// USO PROGRAMÁTICO:
//   await MDFlags.listo;  if (MDFlags.on('delivery')) { … }
//
// Criterio a prueba de fallos: si la API no responde, NO se oculta nada
// (mejor mostrar de más que dejar la app vacía por un error de red).
window.MDFlags = (function () {
  'use strict';

  let _flags = null;

  function on(key)  { return !_flags || _flags[key] !== 0; }
  function off(key) { return !on(key); }

  // Ocultamos con una REGLA CSS (!important) atada a un atributo, no con estilo
  // en línea: así el ocultamiento sobrevive aunque la app haga `el.style.display=''`
  // más tarde (p. ej. al abrir el detalle de un comercio). Sin esto, una función
  // apagada volvía a aparecer al re-renderizar.
  (function _inyectarRegla() {
    const st = document.createElement('style');
    st.textContent = '[data-flag-off]{display:none !important}';
    (document.head || document.documentElement).appendChild(st);
  })();

  // Aplica los atributos data-flag sobre un subárbol (por defecto, todo el documento).
  function aplicar(raiz) {
    if (!_flags) return;
    const root = raiz || document;

    root.querySelectorAll('[data-flag]').forEach(el => {
      if (off(el.getAttribute('data-flag'))) el.setAttribute('data-flag-off', '');
      else el.removeAttribute('data-flag-off');
    });

    // Inverso: visible SOLO cuando el flag está apagado (carteles "Próximamente").
    root.querySelectorAll('[data-flag-not]').forEach(el => {
      if (on(el.getAttribute('data-flag-not'))) el.setAttribute('data-flag-off', '');
      else el.removeAttribute('data-flag-off');
    });

    root.querySelectorAll('[data-flag-disable]').forEach(el => {
      const k = el.getAttribute('data-flag-disable');
      if (off(k)) {
        el.disabled = true;
        el.classList.add('flag-off');
        el.classList.add('proximamente');   // estilo gris ya existente en el panel usuario
      } else {
        el.disabled = false;
        el.classList.remove('flag-off');
        el.classList.remove('proximamente');
      }
    });
  }

  async function cargar() {
    try {
      const r = await fetch('/api/flags', { credentials: 'same-origin', cache: 'no-store' });
      const d = await r.json();
      if (d && d.success && d.flags) _flags = d.flags;
    } catch (e) {
      // Sin conexión → se deja todo visible a propósito.
      console.warn('[flags] no se pudieron cargar; se muestra todo por defecto.');
    }
    aplicar();
    document.dispatchEvent(new CustomEvent('flags-listos', { detail: _flags }));
    return _flags;
  }

  const listo = cargar();

  // Reaplica cuando el DOM ya terminó de armarse (los paneles pintan tarde).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => aplicar());
  }

  // Los paneles crean UI después de cargar (listas, modales, el rail flotante).
  // Sin esto, un elemento con data-flag nacido más tarde ignoraría su interruptor.
  // Se agrupa con setTimeout (NO requestAnimationFrame: rAF no dispara en pestañas
  // en segundo plano y los flags quedarían sin aplicar hasta volver a la pestaña).
  (function _observar() {
    if (!window.MutationObserver) return;
    let pendiente = false;
    new MutationObserver(muts => {
      if (pendiente || !_flags) return;
      if (!muts.some(m => m.addedNodes && m.addedNodes.length)) return;
      pendiente = true;
      setTimeout(() => { pendiente = false; aplicar(); }, 0);
    }).observe(document.documentElement, { childList: true, subtree: true });
  })();

  return { on, off, aplicar, listo, todos: () => _flags, recargar: cargar };
})();
