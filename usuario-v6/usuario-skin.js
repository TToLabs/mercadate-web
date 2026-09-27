// PLATAFORMA : APK Usuario — skin móvil (inyectado por el WebView, NO modifica la web)
// Reordena la UI de www.mercadate.cl/usuario para móvil: riel vertical de acciones,
// Desafíos colapsado al iniciar. Reutiliza los botones reales del web (proxies/madres).
(function () {
  if (window.__mdApkSkin) return;
  window.__mdApkSkin = true;

  function $(s) { return document.querySelector(s); }

  // 1) Desafíos colapsado al iniciar (igual que "Sumar mi comercio"): no auto-abre.
  try { localStorage.setItem('md_desafios_cerrado', '1'); } catch (e) {}

  function build() {
    if (document.getElementById('apkRail')) return;
    if (!document.body) return;
    // Solo en la página de la app (no en splash u otras): requiere la barra de categorías
    if (!document.querySelector('.category-nav')) return;

    // Inyectar estilos del menú (tarjeta con fondo)
    if (!document.getElementById('apkRailStyles')) {
      var style = document.createElement('style');
      style.id = 'apkRailStyles';
      style.textContent = `
        #mdRail{display:none!important}
        #apkRail{position:fixed;right:10px;top:50%;transform:translateY(-50%);z-index:9010;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}
        #apkRail .apk-rb-group{display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--bg,rgba(8,12,24,0.96));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1.5px solid rgba(255,255,255,.14);border-radius:20px;padding:10px 6px;box-shadow:0 8px 32px rgba(0,0,0,.7);transition:opacity .2s ease,transform .2s ease;transform-origin:top right}
        #apkRail .apk-rb{position:relative;width:52px;min-height:52px;border-radius:14px;border:1px solid rgba(255,255,255,.08);cursor:pointer;background:rgba(255,255,255,.06);color:var(--text,#fff);font-size:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:transform .15s,border-color .15s,background .15s;padding:6px 4px}
        #apkRail .apk-rb:hover{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.1);transform:translateY(-1px)}
        #apkRail .apk-chev{background:linear-gradient(135deg,var(--accent2,#f5c64d),var(--accent,#f0b429));color:#0B0D13;font-size:22px;box-shadow:0 6px 18px rgba(242,185,69,.5);margin-bottom:8px}
        #apkRail.apk-collapsed .apk-rb-group{opacity:0;pointer-events:none;transform:scale(.5) translateX(24px)}
        .apk-badge{position:absolute;top:4px;right:4px;min-width:16px;height:16px;background:#ef4444;color:#fff;border-radius:100px;font-size:10px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 3px}
      `;
      document.head.appendChild(style);
    }

    var rail = document.createElement('div');
    rail.id = 'apkRail';
    rail.innerHTML =
      '<button class="apk-rb apk-chev" data-act="toggle" aria-label="Esconder u abrir menú"><span>✦</span></button>' +
      '<div class="apk-rb-group">' +
        '<button class="apk-rb" data-group="config" aria-label="Configuración">⚙️</button>' +
        '<button class="apk-rb" data-group="comprar" aria-label="Comprar">🛒<span class="apk-badge" id="apkCart"></span></button>' +
        '<button class="apk-rb" data-group="desafios" aria-label="Desafíos">🚀</button>' +
      '</div>';
    document.body.appendChild(rail);

    rail.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act],[data-group]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      var group = b.getAttribute('data-group');

      // Toggle: esconder/abrir menú
      if (act === 'toggle') { rail.classList.toggle('apk-collapsed'); return; }

      // Botones del menú: hacen click en los grupos del rail web
      if (group) {
        var mo = document.querySelector('.md-mother[data-group="' + group + '"]');
        if (mo) mo.click();
      }
    });

    mirrorBadges();
    try {
      var obs = new MutationObserver(mirrorBadges);
      ['#cartBadge'].forEach(function (s) {
        var el = $(s);
        if (el) obs.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
      });
    } catch (e) {}
  }

  function mirrorBadges() {
    [['#cartBadge', '#apkCart']].forEach(function (p) {
      var a = $(p[0]), b = $(p[1]);
      if (!a || !b) return;
      var v = (a.textContent || '').trim();
      var show = getComputedStyle(a).display !== 'none' && v && v !== '0';
      b.textContent = v;
      b.style.display = show ? 'flex' : 'none';
    });
  }

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
  // reintento por si el riel del web se monta tarde
  setTimeout(build, 1200);
  setTimeout(build, 3000);
})();
