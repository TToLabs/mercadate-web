// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente
// ARCHIVO    : auth.js
// ═══════════════════════════════════════════════════
// Mismo patrón que admin: login como overlay dentro del index.
// SIN navegación entre páginas. SIN race condition. SIN bucle posible.

(function () {
  'use strict';

  var IS_APP = /MercaDateApp/i.test(navigator.userAgent) || window.MERCADATE_APP === true;
  if (!IS_APP) { try { localStorage.removeItem('md_user_token'); } catch (_) {} }

  function mostrarLogin() {
    var ov = document.getElementById('usuarioLoginOverlay');
    if (ov) ov.style.display = 'flex';
    document.documentElement.classList.remove('sesion-ok');
  }

  function ocultarLogin() {
    var ov = document.getElementById('usuarioLoginOverlay');
    if (ov) ov.style.display = 'none';
    document.documentElement.classList.add('sesion-ok');
  }

  function esValido(u) {
    return u && typeof u.id === 'number' && u.id > 0;
  }

  function definirIdentidad(u) {
    try { Object.defineProperty(window, 'usuarioActivo', { value: u.id, writable: false, configurable: true }); } catch (_) {}
    try { Object.defineProperty(window, 'usuarioActual', { value: u, writable: false, configurable: true }); } catch (_) {}
  }

  // ── Verificar con servidor ─────────────────────────────────────────────────
  async function verificar() {
    try {
      var headers = {};
      if (IS_APP) {
        try { var tk = localStorage.getItem('md_user_token'); if (tk) headers['Authorization'] = 'Bearer ' + tk; } catch (_) {}
      }
      var r = await fetch('/api/usuario/me', { method:'GET', credentials:'same-origin', cache:'no-store', headers: headers });
      if (r.ok) { var d = await r.json(); if (d && (d.es_admin || typeof d.id === 'number')) return d; }
      return null;
    } catch (_) { return null; }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  // 1. Cargar caché local (síncrono → los módulos tienen la identidad al arrancar)
  var u = null;
  try { u = JSON.parse(localStorage.getItem('mercadate_user') || 'null'); } catch (_) {}

  // Modo demo (index.html?demo=1): la presentación de Lila se ve SIN login.
  var esDemo = false;
  try { esDemo = new URLSearchParams(location.search).get('demo') === '1'; } catch (_) {}

  // Optimista: si hay caché o es demo, mostrar la app ya (sin esperar al server).
  if (esValido(u)) { definirIdentidad(u); ocultarLogin(); }
  else if (esDemo) { ocultarLogin(); }

  // 2. Verificar SIEMPRE con el servidor (aunque NO haya caché): si la cookie de
  //    sesión es válida, el usuario sigue logueado y se reconstruye la caché.
  //    Solo se pide login cuando el SERVIDOR confirma que no hay sesión.
  verificar().then(function(serverUser) {
    if (serverUser && serverUser.es_admin) {
      // Admin navegando la vista de usuario: ocultar login sin identidad de usuario
      window._sesionConfirmada = true;
      ocultarLogin();
      setTimeout(function() {
        try { if (window.map && window.map.invalidateSize) window.map.invalidateSize(); } catch (_) {}
      }, 50);
      return;
    }
    if (serverUser) {
      try { localStorage.setItem('mercadate_user', JSON.stringify(serverUser)); } catch (_) {}
      definirIdentidad(serverUser);
      ocultarLogin();
      setTimeout(function() {
        try { if (window.map && window.map.invalidateSize) window.map.invalidateSize(); } catch (_) {}
        try { document.dispatchEvent(new Event('sesion-lista')); } catch (_) {}
      }, 50);
    } else {
      // El servidor confirma que no hay sesión.
      try { localStorage.removeItem('mercadate_user'); } catch (_) {}
      if (esDemo) return;            // en demo NO se pide login
      // ── DEV LOCAL (puerto 3000): INGRESO LIBRE — auto-login con usuario de prueba.
      //    Solo en el entorno local de upgrade; al migrar a web real (otro host/puerto)
      //    el gate no coincide y se muestra el login normal.
      if (location.port === '3000') { autoLoginDev(); }
      else { mostrarLogin(); }
    }
  });

  // ── Auto-login de desarrollo (solo local :3000) ─────────────────────────────
  async function autoLoginDev() {
    try {
      var r = await fetch('/api/usuario/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ username: 'admin@mercadate.cl', password: 'ironman33' })
      });
      var d = await r.json();
      if (d && d.success && d.usuario) {
        try { localStorage.setItem('mercadate_user', JSON.stringify(d.usuario)); } catch (_) {}
        definirIdentidad(d.usuario);
        ocultarLogin();
        setTimeout(function () {
          try { if (window.map && window.map.invalidateSize) window.map.invalidateSize(); } catch (_) {}
          try { document.dispatchEvent(new Event('sesion-lista')); } catch (_) {}
        }, 50);
      } else { mostrarLogin(); }
    } catch (_) { mostrarLogin(); }
  }

})();

// ── API para otros módulos ─────────────────────────────────────────────────
window.auth = {
  getUser: function() {
    try { var u = JSON.parse(localStorage.getItem('mercadate_user')||'null'); return (u&&u.id)?u:null; } catch(_){ return null; }
  },
  saveUser: function(u) {
    if (u&&u.id) try { localStorage.setItem('mercadate_user', JSON.stringify(u)); } catch(_){}
  }
};

// ── Logout ─────────────────────────────────────────────────────────────────
window.cerrarSesion = function() {
  if (!confirm('¿Cerrar sesión?')) return;
  try { localStorage.removeItem('md_user_token'); localStorage.removeItem('mercadate_user'); localStorage.removeItem('mercadate_pts'); } catch(_){}
  fetch('/api/usuario/logout', { method:'POST', credentials:'same-origin' }).catch(function(){});
  // Mostrar overlay de login en vez de navegar
  if (window._ulMostrar) window._ulMostrar();
  else { var ov=document.getElementById('usuarioLoginOverlay'); if(ov) ov.style.display='flex'; }
  document.documentElement.classList.remove('sesion-ok');
};
