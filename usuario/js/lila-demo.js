// ═══════════════════════════════════════════════════════════════════════════
// PLATAFORMA : Usuario — MercaDate
// ARCHIVO    : lila-demo.js
// Tour de presentación de Lila como asistente de voz. Popup autónomo con
// cards visuales que muestran cada comando, narrado por la voz de Lila.
// ═══════════════════════════════════════════════════════════════════════════
window.LilaDemo = (function () {
  'use strict';

  // ── Helpers visuales ─────────────────────────────────────────────────────
  // Carrusel interactivo: pantalla COMPLETA de la app + anillo pulsante en la
  // sección que narra Lila (enseña DÓNDE está) + lupa con zoom de esa zona.
  var _IMGVER = '20260622a'; // sube al recapturar imágenes (rompe caché del navegador)

  // Posición (% del ancho/alto de la pantalla completa) de cada sección.
  var _MARK = {
    catBar:     { x: 50,   y: 10.1 },
    puntos:     { x: 87.4, y: 3.2  },
    resultados: { x: 50,   y: 61   },
    mic:        { x: 80.8, y: 82.2 },
  };

  function _url(archivo) { return 'usuario/img/demo/' + archivo + '?v=' + _IMGVER; }

  // Construye el visual: teléfono completo (con anillo en la marca) + lupa de zona.
  function _visual(paso) {
    if (!paso.full) return '';
    var ring = '';
    if (paso.mark) {
      ring =
        '<span style="position:absolute;left:' + paso.mark.x + '%;top:' + paso.mark.y + '%;'
        + 'width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;'
        + 'border:2.5px solid #c084fc;background:rgba(192,132,252,.22);'
        + 'box-shadow:0 0 14px rgba(192,132,252,.9);'
        + 'animation:ldpulse 1.5s ease-out infinite;pointer-events:none;"></span>';
    }
    var phone =
      '<div style="position:relative;height:100%;flex:0 0 auto;">'
      + '<img src="' + _url(paso.full) + '" loading="eager" '
      + 'style="height:100%;width:auto;display:block;border-radius:12px;border:1px solid #24324f;">'
      + ring
      + '</div>';
    var zoom = '';
    if (paso.zoom) {
      zoom =
        '<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:7px;align-items:center;justify-content:center;">'
        + (paso.zlabel ? '<div style="font-size:11px;font-weight:700;color:#c4a5f7;text-align:center;display:flex;align-items:center;gap:4px;"><span style="font-size:13px;">&#x1F50D;</span>' + paso.zlabel + '</div>' : '')
        + '<img src="' + _url(paso.zoom) + '" loading="eager" '
        + 'style="width:100%;border-radius:10px;border:1.5px solid #a855f7;'
        + 'box-shadow:0 4px 18px rgba(168,85,247,.4);display:block;">'
        + '</div>';
    }
    return '<div style="display:flex;flex-direction:row;gap:12px;align-items:center;justify-content:center;'
      + 'height:clamp(180px,36vh,300px);height:clamp(180px,36dvh,300px);'
      + 'padding:12px 14px;background:#0b0f1e;box-sizing:border-box;">'
      + phone + zoom + '</div>';
  }

  // ── Pasos del tour ───────────────────────────────────────────────────────
  // Cada paso: { tip, texto, full, zoom?, zlabel?, mark?, comando? }
  function _construirPasos(conLogin) {
    const u = window.usuarioActual;
    const nombre = (conLogin && u && (u.nombre || u.username))
      ? String(u.nombre || u.username).trim().split(/\s+/)[0] : '';

    return [
      // 0 — Presentación (pantalla completa, sin marca)
      {
        tip: '¡Hola' + (nombre ? ', ' + nombre : '') + '! Soy Lila',
        texto: '¡Hola' + (nombre ? ', ' + nombre : '') + '! Soy Lila, tu asistente de voz de MercaDate. Te muestro cómo hablarme para encontrar precios y comercios cerca tuyo.',
        full: 'full-home.png',
      },

      // 1 — Cómo activar (marca el micrófono, abajo a la derecha)
      {
        tip: 'Cómo activarme',
        texto: 'Toca el botón del micrófono, abajo a la derecha. También puedes decir "Lila" seguido de tu comando y te respondo de inmediato.',
        full: 'full-mic.png', zoom: 'zoom-mic.png', zlabel: 'Micrófono', mark: _MARK.mic,
        comando: 'Lila, buscar bencina 93',
      },

      // 2 — Combustibles (marca la barra de resultados)
      {
        tip: 'Buscar combustibles',
        texto: 'Dime qué combustible necesitas y te muestro las estaciones más baratas y cercanas. Di bencina 93, diésel, bencina 97 o parafina.',
        full: 'full-combustibles.png', zoom: 'zoom-resultados.png', zlabel: 'Estaciones cerca tuyo', mark: _MARK.resultados,
        comando: 'buscar bencina 93',
      },

      // 3 — Categorías (marca la barra superior)
      {
        tip: 'Buscar por categoría',
        texto: 'En la barra superior elijo la categoría. Di gastronomía, farmacia, servicios, almacén o mascotas y cambio la búsqueda automáticamente.',
        full: 'full-home.png', zoom: 'zoom-catbar.png', zlabel: 'Barra de categorías', mark: _MARK.catBar,
        comando: 'buscar farmacia',
      },

      // 4 — Con comuna (marca la barra superior también)
      {
        tip: 'Buscar en una comuna',
        texto: 'Agrega "en" y el nombre de la comuna al final del comando. Por ejemplo: buscar farmacia en Providencia, o buscar combustible en Ñuñoa.',
        full: 'full-home.png', zoom: 'zoom-catbar.png', zlabel: 'Filtra por comuna', mark: _MARK.catBar,
        comando: 'buscar farmacia en Providencia',
      },

      // 5 — Navegar resultados (marca la barra de resultados)
      {
        tip: 'Navegar los resultados',
        texto: 'Cuando te muestro resultados, pídeme más. Di el siguiente, el anterior, más información, o amplía la búsqueda si no hay nada cerca.',
        full: 'full-combustibles.png', zoom: 'zoom-resultados.png', zlabel: 'Resultados y orden', mark: _MARK.resultados,
        comando: 'el siguiente · más información',
      },

      // 6 — Puntos y nivel (marca la insignia de puntos, arriba a la derecha)
      {
        tip: 'Consulta tus puntos',
        texto: 'Pregúntame por tu progreso. Di mis puntos o mi nivel y te cuento cuántos puntos tienes y qué funciones desbloqueaste.',
        full: 'full-home.png', zoom: 'zoom-puntos.png', zlabel: 'Tus puntos', mark: _MARK.puntos,
        comando: 'mis puntos · mi nivel',
      },

      // 7 — Listo (pantalla completa, sin marca)
      {
        tip: '¡Listo para usar!',
        texto: conLogin
          ? '¡Ya sabes cómo hablarme! Cuando me necesites, toca el micrófono o di Lila seguido de tu comando. ¡A ahorrar en cada compra!'
          : '¡Ya sabes cómo funciono! Crea tu cuenta gratis, activa el micrófono y empieza a ahorrar. ¡Te espero!',
        full: 'full-home.png',
      },
    ];
  }

  // ── Estado ───────────────────────────────────────────────────────────────
  let _pasos = [], _i = 0, _popup = null, _timer = null, _activo = false;

  // ── Popup ────────────────────────────────────────────────────────────────
  function _crearPopup() {
    if (_popup) return;
    const el = document.createElement('div');
    el.id = 'lilaDemoPopup';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:100001',
      'background:rgba(5,8,20,.9)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:clamp(6px,3vw,16px)', 'box-sizing:border-box',
      'font-family:system-ui,sans-serif',
      'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)'
    ].join(';');
    // Keyframes del anillo pulsante (una sola vez).
    if (!document.getElementById('ldKeyframes')) {
      var kf = document.createElement('style');
      kf.id = 'ldKeyframes';
      kf.textContent = '@keyframes ldpulse{0%{box-shadow:0 0 0 0 rgba(192,132,252,.55),0 0 14px rgba(192,132,252,.9)}'
        + '70%{box-shadow:0 0 0 16px rgba(192,132,252,0),0 0 14px rgba(192,132,252,.5)}'
        + '100%{box-shadow:0 0 0 0 rgba(192,132,252,0),0 0 14px rgba(192,132,252,.9)}}';
      document.head.appendChild(kf);
    }
    el.innerHTML = [
      '<div id="ldCard" style="',
        'background:#0f172a;',
        'border:1px solid #1e3a5f;',
        'border-radius:clamp(14px,4vw,20px);',
        'width:min(94vw,460px);',
        'overflow:hidden;',
        'box-shadow:0 32px 100px rgba(0,0,0,.8);',
      '">',
        // Zona scrollable interna; en pantallas muy bajas hace scroll como último recurso.
        // dvh maneja la barra del navegador móvil; vh queda de fallback.
        '<div id="ldScroll" style="',
          'max-height:94vh;',
          'max-height:94dvh;',
          'overflow-y:auto;-webkit-overflow-scrolling:touch;',
          'display:flex;',
          'flex-direction:column;',
        '">',
          // Imagen: primera. Puede encogerse cuando falta alto (object-fit:cover la recorta bien).
          '<div id="ldVisual" style="flex:0 1 auto;min-height:0;"></div>',
          // Header bajo la imagen
          '<div style="',
            'display:flex;align-items:center;gap:12px;',
            'padding:12px 20px 8px;',
            'border-bottom:1px solid #1a2d4a;',
          '">',
            '<div style="',
              'width:36px;height:36px;border-radius:50%;flex-shrink:0;',
              'background:linear-gradient(135deg,#a855f7,#7c3aed);',
              'display:flex;align-items:center;justify-content:center;font-size:18px;',
            '">&#x1F98A;</div>',
            '<div style="flex:1;min-width:0;">',
              '<div id="ldTip" style="font-weight:700;font-size:clamp(14px,3.8vw,16px);color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>',
              '<div style="font-size:11px;color:#4b6ea8;margin-top:1px;">Lila &middot; Asistente de voz</div>',
            '</div>',
            '<div id="ldProg" style="font-size:12px;color:#4b6ea8;flex-shrink:0;"></div>',
          '</div>',
          // Fila del comando de voz (separada, en flujo — nunca encima de la imagen)
          '<div id="ldComando" style="padding:0 20px;"></div>',
          // Texto narración
          '<div id="ldTexto" style="',
            'font-size:clamp(12.5px,3.4vw,14px);line-height:1.5;color:#94a3b8;',
            'padding:10px clamp(14px,5vw,20px) 8px;',
          '"></div>',
          // Dots
          '<div id="ldDots" style="display:flex;gap:6px;justify-content:center;padding:2px 0 12px;"></div>',
          // Botones
          '<div style="display:flex;gap:10px;padding:0 18px 16px;">',
            '<button id="ldSkip" style="',
              'background:none;border:1px solid #1e3a5f;color:#4b6ea8;',
              'border-radius:12px;padding:12px 16px;cursor:pointer;',
              'font-family:inherit;font-size:13px;font-weight:600;flex-shrink:0;',
            '">Saltar</button>',
            '<button id="ldNext" style="',
              'flex:1;background:linear-gradient(90deg,#a855f7,#7c3aed);',
              'border:none;color:#fff;border-radius:12px;padding:12px;',
              'cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;',
            '">Siguiente &#x2192;</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(el);
    _popup = el;
    el.querySelector('#ldSkip').onclick = () => terminar(false);
    el.querySelector('#ldNext').onclick = _siguiente;
  }

  function _pintarDots() {
    const dots = _popup.querySelector('#ldDots');
    dots.innerHTML = _pasos.map((_, i) =>
      `<span style="
        width:${i === _i ? 18 : 6}px;height:6px;border-radius:3px;
        background:${i === _i ? '#a855f7' : 'rgba(255,255,255,.14)'};
        transition:all .3s
      "></span>`
    ).join('');
  }

  // Píldora del comando de voz (en flujo normal, nunca encima de la imagen).
  function _comandoHTML(paso) {
    if (!paso.comando) return '';
    return '<div style="'
      + 'display:flex;align-items:center;gap:7px;justify-content:center;'
      + 'background:rgba(168,85,247,.12);border:1.5px solid #a855f7;border-radius:12px;'
      + 'padding:8px 14px;margin-top:10px;'
      + 'color:#c4a5f7;font-size:clamp(12px,3.4vw,13.5px);font-weight:700;text-align:center;'
      + '">'
      + '<span style="font-size:15px;flex-shrink:0">&#x1F399;&#xFE0F;</span>'
      + '<span>&ldquo;' + paso.comando + '&rdquo;</span>'
      + '</div>';
  }

  function _mostrarPaso() {
    if (!_popup) return;
    const paso = _pasos[_i];
    _popup.querySelector('#ldTip').textContent = paso.tip;
    _popup.querySelector('#ldTexto').textContent = paso.texto;
    _popup.querySelector('#ldProg').textContent = (_i + 1) + ' / ' + _pasos.length;
    _popup.querySelector('#ldNext').textContent = (_i === _pasos.length - 1) ? '¡Listo! ✓' : 'Siguiente →';
    _popup.querySelector('#ldVisual').innerHTML = _visual(paso);
    _popup.querySelector('#ldComando').innerHTML = _comandoHTML(paso);
    // Reinicia el scroll al tope en cada paso para que se vea desde la imagen.
    const sc = _popup.querySelector('#ldScroll'); if (sc) sc.scrollTop = 0;
    _pintarDots();

    clearTimeout(_timer);
    // Safety timer: avanza siempre aunque la voz no llame al callback. Calcula según largo del texto.
    const _durEst = Math.max(20000, 2000 + (paso.texto ? paso.texto.length * 85 : 0));
    _timer = setTimeout(_siguiente, _durEst);

    if (window.VozMercaDate && window.VozMercaDate.hablar) {
      window.VozMercaDate.hablar(paso.texto, () => {
        clearTimeout(_timer);
        _timer = setTimeout(_siguiente, 1600);
      });
    }
  }

  function _siguiente() {
    clearTimeout(_timer);
    if (window.VozMercaDate && window.VozMercaDate.detener) window.VozMercaDate.detener();
    _i++;
    if (_i >= _pasos.length) { terminar(true); return; }
    _mostrarPaso();
  }

  // ── API pública ──────────────────────────────────────────────────────────
  function iniciar(opts) {
    if (_activo) return;
    _activo = true;
    const conLogin = !!(opts && opts.conLogin);
    _pasos = _construirPasos(conLogin);
    try { if (window._ulEvento) window._ulEvento(conLogin ? 'lila_demo_login' : 'lila_demo_anon'); } catch (_) {}
    if (window._voiceAssistant && window._voiceAssistant.pausar) window._voiceAssistant.pausar();
    if (window.VozMercaDate) {
      // Resetear cooldown de Catalina para que el demo use la voz neural desde el primer slide.
      if (window.VozMercaDate.reiniciarCatalina) window.VozMercaDate.reiniciarCatalina();
      // Pre-cachear todos los audios en paralelo para que no haya espera de red entre slides.
      if (window.VozMercaDate.precargar) _pasos.forEach(p => window.VozMercaDate.precargar(p.texto));
    }
    // Pre-cargar las imágenes (full + zoom) para que aparezcan al instante, sin parpadeo.
    _pasos.forEach(p => {
      [p.full, p.zoom].forEach(f => { if (f) { const im = new Image(); im.src = _url(f); } });
    });
    _crearPopup();
    _i = 0;
    _mostrarPaso();
  }

  function terminar(completo) {
    _activo = false;
    clearTimeout(_timer);
    if (window.VozMercaDate && window.VozMercaDate.detener) window.VozMercaDate.detener();
    if (_popup) { try { _popup.remove(); } catch (_) {} _popup = null; }
    try { localStorage.setItem('mercadate_lila_demo_visto', '1'); } catch (_) {}
    if (window._voiceAssistant && window._voiceAssistant.reanudar) window._voiceAssistant.reanudar();
    if (completo) _mostrarInvitacion();
  }

  function _mostrarInvitacion() {
    const logueado = !!(window.usuarioActivo || window._sesionConfirmada);
    const el = document.createElement('div');
    el.id = 'lilaDemoInvite';
    el.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(5,8,20,.88);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px)';
    const botonesAnon = `
      <button onclick="window._ulTab&&window._ulTab('register');document.getElementById('lilaDemoInvite')?.remove();window._ulMostrar&&window._ulMostrar()"
        style="flex:1;background:linear-gradient(90deg,#a855f7,#7c3aed);border:none;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Crear cuenta</button>
      <button onclick="window._ulTab&&window._ulTab('login');document.getElementById('lilaDemoInvite')?.remove();window._ulMostrar&&window._ulMostrar()"
        style="flex:1;background:none;border:1px solid #1e2d4a;color:#94a3b8;border-radius:10px;padding:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Iniciar sesión</button>`;
    const botonesLogin = `
      <button onclick="(function(){document.getElementById('lilaDemoInvite')?.remove();window._voiceSaludoHecho=false;setTimeout(function(){if(window._voiceAssistant&&window._voiceAssistant.iniciarConSaludo)window._voiceAssistant.iniciarConSaludo();},400);})()"
        style="flex:1;background:linear-gradient(90deg,#a855f7,#7c3aed);border:none;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">¡Empezar a usar Lila!</button>`;
    el.innerHTML = `
      <div style="background:#111827;border:1px solid #1e2d4a;border-radius:20px;width:min(96vw,380px);padding:28px 22px;box-shadow:0 24px 80px rgba(0,0,0,.7);color:#e2e8f0;text-align:center">
        <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#a855f7,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px">🎙️</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:6px">${logueado ? '¡Ya conoces a Lila!' : '¿Empezamos a ahorrar?'}</div>
        <div style="font-size:13px;color:#94a3b8;margin-bottom:22px;line-height:1.55">${logueado ? 'Toca el micrófono o di "Lila" para activarme cuando me necesites.' : 'Crea tu cuenta gratis y activa la búsqueda por voz. ¡Es rápido!'}</div>
        <div style="display:flex;gap:10px">${logueado ? botonesLogin : botonesAnon}</div>
        ${logueado ? '' : '<button onclick="document.getElementById(\'lilaDemoInvite\')?.remove()" style="background:none;border:none;color:#475569;font-size:12px;cursor:pointer;margin-top:12px;font-family:inherit">Ahora no</button>'}
      </div>`;
    document.body.appendChild(el);
    setTimeout(() => {
      if (window.VozMercaDate && window.VozMercaDate.hablar) {
        window.VozMercaDate.hablar(
          logueado
            ? '¡Ya conoces todos mis comandos! Toca el micrófono cuando me necesites. ¡A ahorrar!'
            : '¡Ya sabes cómo funciono! Crea tu cuenta y empieza a ahorrar con tu voz. ¡Te espero!'
        );
      }
    }, 400);
  }

  function visto() {
    try { return localStorage.getItem('mercadate_lila_demo_visto') === '1'; } catch (_) { return false; }
  }

  return { iniciar, terminar, visto };
})();
