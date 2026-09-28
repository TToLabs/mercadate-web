// ═══════════════════════════════════════════════════
// PLATAFORMA : Comercio — Portal del comerciante
// ARCHIVO    : api.js
// ═══════════════════════════════════════════════════
// api.js — Wrapper de fetch para el portal comercio
// Centraliza la URL del backend y maneja errores de forma uniforme.

(function () {
  const BASE = '/api';

  async function request(method, path, body, opts = {}) {
    const url = BASE + path;
    const init = { method, headers: {}, credentials: 'include' }; // envía la cookie httpOnly de sesión
    // Token Bearer: SOLO en APK. En navegador usa cookie httpOnly; si hay token viejo, se limpia.
    const esApp = /MercaDateApp/i.test(navigator.userAgent) || window.MERCADATE_APP === true;
    const token = (window.app && window.app.STATE && window.app.STATE.owner && window.app.STATE.owner.token) || null;
    if (esApp && token) init.headers['Authorization'] = 'Bearer ' + token;
    if (body && !(body instanceof FormData)) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else if (body instanceof FormData) {
      init.body = body;
    }
    try {
      const res = await fetch(url, init);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      console.error('[API]', method, path, e);
      return { ok: false, status: 0, error: e.message };
    }
  }

  const api = {
    get:    (p)            => request('GET',    p),
    post:   (p, body)      => request('POST',   p, body),
    patch:  (p, body)      => request('PATCH',  p, body),
    delete: (p)            => request('DELETE', p),
    upload: (p, formData)  => request('POST',   p, formData),
    BASE
  };

  // Exponer como global de forma explícita (window.api Y api suelto)
  window.api = api;
})();
