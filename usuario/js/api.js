// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente
// ARCHIVO    : api.js
// ═══════════════════════════════════════════════════
// api.js — Wrapper seguro para llamadas al backend
// Centraliza: timeouts, manejo de errores, cancelación, headers
//
// SEGURIDAD:
//   - AbortController previene leaks de memoria por requests colgadas
//   - cache: 'no-store' evita responses obsoletas tras logout
//   - credentials: 'same-origin' no envía cookies a 3os
//   - Accept: 'application/json' enforce response type
//   - Timeouts por defecto para evitar slow-loris/UI bloqueado

window.Api = (function () {
  'use strict';

  const DEFAULT_TIMEOUT = 15000; // 15s
  const UPLOAD_TIMEOUT  = 60000; // 60s para subidas

  // ── Núcleo de llamada con AbortController ─────────────────────────────────
  async function call(method, path, body, opts = {}) {
    const timeout = opts.timeout || DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const config = {
      method,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Accept': 'application/json', ...(opts.headers || {}) }
    };

    // Respaldo para APK/WebView que no persiste cookies: SOLO ahí se envía el
    // token como Bearer. En el navegador se usa la cookie httpOnly y, si quedó
    // un token viejo guardado, se elimina (un Bearer rancio tiene prioridad
    // sobre la cookie en el server y provocaría 401 → rebote al login).
    try {
      const esApp = /MercaDateApp/i.test(navigator.userAgent) || window.MERCADATE_APP === true;
      const tk = window.localStorage && localStorage.getItem('md_user_token');
      if (esApp) {
        if (tk && !config.headers['Authorization']) config.headers['Authorization'] = 'Bearer ' + tk;
      } else if (tk) {
        localStorage.removeItem('md_user_token');
      }
    } catch (_) {}

    if (body !== undefined && body !== null) {
      if (body instanceof FormData) {
        // FormData: no setear Content-Type (lo pone el navegador con boundary)
        config.body = body;
      } else {
        config.headers['Content-Type'] = 'application/json';
        config.body = JSON.stringify(body);
      }
    }

    try {
      const r = await fetch('/api' + path, config);
      clearTimeout(timer);

      // Intentar parsear JSON; si falla, devolver vacío sin lanzar
      let data = {};
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await r.json().catch(() => ({}));
      } else if (r.ok) {
        // Endpoint que devuelve no-JSON (ej. CSV, blob) — no procesamos aquí
        data = { _raw: true };
      }

      // Sesión expirada o inválida durante el uso → auto-logout limpio
      // (solo rutas de usuario autenticadas; evita doble redirección)
      if (r.status === 401 && path.startsWith('/usuario/') && !window.__mdKick) {
        window.__mdKick = true;
        try {
          localStorage.removeItem('mercadate_user');
          localStorage.removeItem('md_user_token');
        } catch (_) {}
        if (window._ulMostrar) window._ulMostrar();
        else { var ov=document.getElementById('usuarioLoginOverlay'); if(ov) ov.style.display='flex'; }
      }

      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        return { ok: false, status: 0, error: 'timeout', data: {} };
      }
      return { ok: false, status: 0, error: e.message || 'network_error', data: {} };
    }
  }

  // ── Atajos por método ────────────────────────────────────────────────────
  const get   = (path, opts) => call('GET', path, null, opts);
  const post  = (path, body, opts) => call('POST', path, body, opts);
  const patch = (path, body, opts) => call('PATCH', path, body, opts);
  const del   = (path, opts) => call('DELETE', path, null, opts);

  // ── Descarga de archivo binario (Excel, CSV, etc.) ───────────────────────
  // Triggerea descarga del navegador sin exponer URL sensible en window.location
  function descargar(path, filename) {
    const a = document.createElement('a');
    a.href = '/api' + path;
    a.download = filename || '';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ── Fetch externo (NO al API local) — para CSV CNE, OpenStreetMap, etc.
  //    Aplica las mismas medidas de seguridad: timeout, no-store, sin credenciales
  async function externo(url, opts = {}) {
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error('URL inválida');
    }
    const timeout = opts.timeout || DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const r = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',      // NUNCA enviar credenciales a 3os
        referrerPolicy: 'no-referrer',
        cache: 'default',
        ...opts
      });
      clearTimeout(timer);
      return r;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  }

  return { call, get, post, patch, delete: del, descargar, externo, UPLOAD_TIMEOUT };
})();

// Mantener compatibilidad con código viejo que usa window.apiCall
window.apiCall = window.Api.call;
