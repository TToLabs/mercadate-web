// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente MercaDate
// ARCHIVO    : carrito.js
// ═══════════════════════════════════════════════════
// carrito.js — Carrito de compras del usuario · v2 moderno
window.Carrito = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let dataCache = null;

  function user() { return window.usuarioActual; }

  async function cargar() {
    const u = user(); if (!u) return null;
    const r = await window.Api.get('/cart/' + u.id);
    if (r.ok) dataCache = r.data;
    return dataCache;
  }

  async function actualizarBadge() {
    const u = user(); if (!u) return;
    const r = await window.Api.get('/cart/' + u.id + '/count');
    const n = r.ok ? (r.data.count || 0) : 0;
    const badge = $('cartBadge');
    if (badge) {
      badge.textContent = n;
      badge.style.display = n > 0 ? 'flex' : 'none';
      if (n > 0) {
        badge.classList.add('cart-badge-pulse');
        setTimeout(() => badge.classList.remove('cart-badge-pulse'), 600);
      }
    }
  }

  async function agregar(producto_id, cantidad = 1, notas = '', btnEl = null) {
    if (!btnEl && window.event && window.event.target) {
      btnEl = window.event.target.closest('.pc-add-cart');
    }
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.classList.add('loading');
      btnEl.dataset.originalText = btnEl.innerHTML;
      btnEl.innerHTML = '<span>⏳</span> Agregando...';
    }
    const u = user();
    if (!u || !u.id) {
      window.mostrarToast('Inicia sesión primero', 3000, 'err');
      if (btnEl) restaurarBoton(btnEl);
      return false;
    }
    if (!producto_id || isNaN(parseInt(producto_id))) {
      window.mostrarToast('Error: producto sin ID', 3000, 'err');
      if (btnEl) restaurarBoton(btnEl);
      return false;
    }
    try {
      const r = await window.Api.post('/cart', {
        user_id: u.id, producto_id: parseInt(producto_id),
        cantidad: Math.max(1, parseInt(cantidad) || 1),
        notas: notas || ''
      });
      if (r.ok && r.data && r.data.success) {
        window.mostrarToast('🛒 Agregado al carrito');
        const badge = $('cartBadge');
        if (badge && typeof r.data.count === 'number') {
          badge.textContent = r.data.count;
          badge.style.display = r.data.count > 0 ? 'flex' : 'none';
          badge.classList.add('cart-badge-pulse');
          setTimeout(() => badge.classList.remove('cart-badge-pulse'), 600);
        }
        if (btnEl) {
          btnEl.innerHTML = '<span>✓</span> Agregado';
          btnEl.classList.remove('loading');
          btnEl.classList.add('added');
          setTimeout(() => restaurarBoton(btnEl), 1100);
        }
        dataCache = null;
        return true;
      }
      window.mostrarToast((r.data && r.data.message) || 'Error al agregar', 3000, 'err');
      if (btnEl) restaurarBoton(btnEl);
      return false;
    } catch (e) {
      window.mostrarToast('Error inesperado', 3000, 'err');
      if (btnEl) restaurarBoton(btnEl);
      return false;
    }
  }

  function restaurarBoton(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('loading', 'added');
    if (btn.dataset.originalText) {
      btn.innerHTML = btn.dataset.originalText;
      delete btn.dataset.originalText;
    } else {
      btn.innerHTML = '<span>🛒</span> Agregar';
    }
  }

  async function cambiarCantidad(item_id, cantidad) {
    const u = user(); if (!u) return;
    cantidad = Math.max(1, Math.min(99, parseInt(cantidad) || 1));
    const r = await window.Api.patch('/cart/' + item_id, { user_id: u.id, cantidad });
    if (r.ok && r.data && r.data.success) {
      dataCache = null;
      await renderModal();
      actualizarBadge();
    }
  }

  async function quitar(item_id) {
    const u = user(); if (!u) return;
    const r = await window.Api.delete('/cart/' + item_id + '?user_id=' + u.id);
    if (r.ok && r.data && r.data.success) {
      window.mostrarToast('Producto quitado');
      dataCache = null;
      await renderModal();
      const badge = $('cartBadge');
      if (badge) {
        badge.textContent = r.data.count || 0;
        badge.style.display = r.data.count > 0 ? 'flex' : 'none';
      }
    }
  }

  async function vaciar() {
    if (!confirm('¿Vaciar todo el carrito?')) return;
    const u = user(); if (!u) return;
    const r = await window.Api.delete('/cart/user/' + u.id);
    if (r.ok && r.data && r.data.success) {
      dataCache = null;
      await renderModal();
      actualizarBadge();
      window.mostrarToast('Carrito vaciado');
    }
  }

  function enviarWhatsApp(local_id) {
    if (!dataCache) return;
    const grupo = dataCache.comercios.find(c => c.local_id === local_id);
    if (!grupo) return;
    if (!grupo.local_whatsapp) {
      window.mostrarToast('Este comercio no tiene WhatsApp', 3000, 'err');
      return;
    }
    const lineas = grupo.productos.map(p =>
      `• ${p.cantidad}× ${p.nombre} — ${window.formatoCLP(p.subtotal)}`
    );
    const u = user();
    const saludo = u && u.nombre ? `Hola, soy ${u.nombre}.` : 'Hola.';
    const mensaje = `${saludo} Te escribo desde MercaDate para consultar por:\n\n${lineas.join('\n')}\n\nTotal: ${window.formatoCLP(grupo.subtotal)}\n\n¿Tienen disponibilidad?`;
    const tel = String(grupo.local_whatsapp).replace(/\D/g, '');
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`, '_blank', 'noopener,noreferrer');
  }

  function abrir() {
    let modal = $('cartModal');
    if (!modal) crearModal();
    $('cartModal').classList.add('open');
    renderModal();
  }
  function cerrar() { $('cartModal')?.classList.remove('open'); }

  function crearModal() {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="cart-overlay" id="cartModal" onclick="if(event.target.id==='cartModal')Carrito.cerrar()">
        <div class="cart-modal">
          <div class="cart-header">
            <div>
              <h2>🛒 Mi Carrito</h2>
              <p class="cart-subtitle" id="cartSubtitle">Productos seleccionados</p>
            </div>
            <button class="cart-close" onclick="Carrito.cerrar()" aria-label="Cerrar">✕</button>
          </div>
          <div class="cart-body" id="cartBody"></div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
  }

  async function renderModal() {
    const body = $('cartBody');
    const subtitle = $('cartSubtitle');
    if (!body) return;
    body.innerHTML = '<div class="cart-loader"><div class="cart-spinner"></div></div>';

    const data = await cargar();

    if (!data || !data.comercios || !data.comercios.length) {
      if (subtitle) subtitle.textContent = 'Tu carrito está vacío';
      body.innerHTML = `
        <div class="cart-empty">
          <div class="cart-empty-icon">🛒</div>
          <h3>Tu carrito está vacío</h3>
          <p>Explora comercios y agrega productos<br>desde sus catálogos</p>
          <button class="cart-btn-primary" onclick="Carrito.cerrar()">Explorar comercios →</button>
        </div>`;
      return;
    }

    if (subtitle) {
      subtitle.textContent = `${data.total_items} producto${data.total_items !== 1 ? 's' : ''} en ${data.comercios.length} comercio${data.comercios.length !== 1 ? 's' : ''}`;
    }

    const esc = window.escapeHtml;
    const clp = window.formatoCLP;

    let html = '';

    data.comercios.forEach(c => {
      html += `<div class="cart-group">
        <div class="cart-group-header">
          <div class="cart-group-info">
            <div class="cart-group-name">📍 ${esc(c.local_nombre)}</div>
            <div class="cart-group-meta">${esc(c.local_comuna || '')}${c.local_direccion ? ' · ' + esc(c.local_direccion) : ''}</div>
          </div>
          <div class="cart-group-total">${clp(c.subtotal)}</div>
        </div>

        <div class="cart-products">`;

      c.productos.forEach(p => {
        const imgHtml = p.imagen
          ? `<img src="${esc(p.imagen)}" alt="" class="cart-prod-img" onerror="this.style.display='none'"/>`
          : `<div class="cart-prod-placeholder">${getCategoryEmoji(p.categoria)}</div>`;

        html += `<div class="cart-product">
          <div class="cart-prod-thumb">${imgHtml}</div>
          <div class="cart-prod-info">
            <div class="cart-prod-name">${esc(p.nombre)}</div>
            <div class="cart-prod-unit">${clp(p.precio)} c/u${p.categoria ? ' · ' + esc(p.categoria) : ''}</div>
          </div>
          <div class="cart-prod-controls">
            <div class="cart-qty">
              <button class="cart-qty-btn" onclick="Carrito.cambiarCantidad(${p.item_id},${p.cantidad-1})" ${p.cantidad <= 1 ? 'disabled' : ''}>−</button>
              <span class="cart-qty-val">${p.cantidad}</span>
              <button class="cart-qty-btn" onclick="Carrito.cambiarCantidad(${p.item_id},${p.cantidad+1})" ${p.cantidad >= 99 ? 'disabled' : ''}>+</button>
            </div>
            <div class="cart-prod-subtotal">${clp(p.subtotal)}</div>
            <button class="cart-prod-remove" onclick="Carrito.quitar(${p.item_id})" title="Quitar">🗑</button>
          </div>
        </div>`;
      });

      html += `</div>`;

      html += `<button class="cart-dlv-btn" data-flag="delivery" onclick="Delivery.abrirCheckout(${c.local_id})">
        🛍️ Hacer pedido (Delivery o Retiro)
      </button>`;

      if (c.local_whatsapp) {
        html += `<button class="cart-wa-btn" onclick="Carrito.enviarWhatsApp(${c.local_id})">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/>
          </svg>
          Pedir por WhatsApp
        </button>`;
      } else {
        html += `<div class="cart-no-wa">Este comercio aún no tiene WhatsApp configurado</div>`;
      }

      html += `</div>`;
    });

    // Resumen total
    html += `<div class="cart-summary">
      <div class="cart-summary-info">
        <div class="cart-summary-label">Total estimado</div>
        <div class="cart-summary-total">${clp(data.total_general)}</div>
        <div class="cart-summary-meta">${data.total_items} producto${data.total_items !== 1 ? 's' : ''} · ${data.comercios.length} comercio${data.comercios.length !== 1 ? 's' : ''}</div>
      </div>
      <button class="cart-clear-btn" data-flag="delivery" onclick="Delivery.misPedidos()">🛵 Mis pedidos</button>
      <button class="cart-clear-btn" onclick="Carrito.vaciar()">🗑 Vaciar</button>
    </div>`;

    body.innerHTML = html;
  }

  // Emoji según categoría
  function getCategoryEmoji(cat) {
    const c = (cat || '').toLowerCase();
    if (c.includes('abarrote') || c.includes('almacén')) return '🛒';
    if (c.includes('bebida') || c.includes('liquid')) return '🥤';
    if (c.includes('lácteo') || c.includes('lacteo')) return '🥛';
    if (c.includes('limpieza')) return '🧽';
    if (c.includes('higiene') || c.includes('aseo')) return '🧴';
    if (c.includes('panader') || c.includes('pan')) return '🍞';
    if (c.includes('carne') || c.includes('carnicer')) return '🥩';
    if (c.includes('fruta') || c.includes('verdur')) return '🥕';
    if (c.includes('comida') || c.includes('restau')) return '🍽️';
    if (c.includes('pizza')) return '🍕';
    if (c.includes('mascota') || c.includes('paseo')) return '🐕';
    if (c.includes('farma') || c.includes('medica')) return '💊';
    if (c.includes('belleza') || c.includes('barber')) return '✂️';
    return '📦';
  }

  document.addEventListener('DOMContentLoaded', () => { actualizarBadge(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrar();
  });

  return { cargar, abrir, cerrar, agregar, quitar, cambiarCantidad, vaciar, enviarWhatsApp, actualizarBadge };
})();
