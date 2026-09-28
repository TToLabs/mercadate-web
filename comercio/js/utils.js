// ═══════════════════════════════════════════════════
// PLATAFORMA : Global — Utilidades compartidas (todos los paneles)
// ARCHIVO    : web/js/utils.js
// ═══════════════════════════════════════════════════
// Cargado como /js/utils.js por admin, comercio y usuario.
// Define window.escapeHtml — función global, nunca duplicar en otros archivos.

(function () {
  'use strict';

  // Sanitiza HTML: previene XSS en innerHTML.
  // Todo contenido externo (servidor, usuario, localStorage, querystring)
  // DEBE pasar por esta función antes de inyectarse vía innerHTML.
  window.escapeHtml = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  };

})();
