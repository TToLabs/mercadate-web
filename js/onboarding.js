// ════════════════════════════════════════════════════════════════════════════
// PLATAFORMA : Compartido — Onboarding MercaDate (modulo reutilizable)
// ARCHIVO    : /js/onboarding.js
// ════════════════════════════════════════════════════════════════════════════
// API:
//   MDOnboarding.abrir(rol, onDone)         -> muestra siempre
//   MDOnboarding.mostrarUnaVez(rol, onDone) -> solo la 1a vez (flag localStorage)
//   MDOnboarding.reset(rol)                 -> borra el flag
// rol = 'usuario' | 'comercio' | 'admin'
(function () {
  if (window.MDOnboarding && window.MDOnboarding.__real) return;

  var CSS = 'y el <div id="mdOnb"> a tu panel,\n          o sirve este archivo y cárgalo en un <iframe>/inyección.\n       2) En cada panel fija el rol y muéstralo SOLO la primera vez:\n             const ROL = \'usuario\'; // \'comercio\' | \'admin\'\n             if (!localStorage.getItem(\'md_onb_\'+ROL)) {\n               MDOnboarding.abrir(ROL, () => {\n                 localStorage.setItem(\'md_onb_\'+ROL, \'1\');\n                 // continuar flujo: T&C → GPS (usuario) / seleccionar local (comercio) / login (admin)\n               });\n             } else { /* continuar flujo normal */ }\n       3) El botón final (CTA) llama al callback onDone que le pases.\n       En esta vista previa el selector de rol de arriba es solo para demostración;\n       en producción se oculta (data-preview="0").\n     ╚══════════════════════════════════════════════════════════════════════════╝ -->\n<html lang="es">\n<head>\n<meta charset="UTF-8"/>\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>\n<title>MercaDate — Conoce tu plataforma</title>\n<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>\n<style id="onb-css">\n  :root{\n    --bg:#0b0f16; --bg2:#12182300; --card:#151c28; --card2:#1b2433;\n    --line:#243044; --txt:#eaf0f8; --muted:#8b95a7;\n    --accent:#f0b429; --accent2:#ff7a18;           /* usuario (default) */\n    --shadow:0 24px 60px -20px rgba(0,0,0,.7);\n  }\n  *{box-sizing:border-box;margin:0;padding:0}\n  html,body{height:100%}\n  /* body global del onboarding neutralizado: .onb define su propio fondo */\n\n  /* tema por rol */\n  .onb[data-role="comercio"]{--accent:#22c08a;--accent2:#0ea371}\n  .onb[data-role="admin"]{--accent:#8b7bff;--accent2:#6a55e6}\n\n  .onb{position:fixed;inset:0;display:flex;flex-direction:column;\n    --bg:#0b0f16;--card:#151c28;--card2:#1b2433;--line:#243044;--txt:#eaf0f8;--muted:#8b95a7;\n    --accent:#f0b429;--accent2:#ff7a18;\n    color:var(--txt);font-family:\'Inter\',system-ui,sans-serif;\n    background:radial-gradient(130% 90% at 50% -20%, color-mix(in srgb,var(--accent) 14%, transparent) 0%, transparent 55%), var(--bg);\n    overscroll-behavior:contain}\n\n  /* barra superior */\n  .onb-top{display:flex;align-items:center;justify-content:space-between;\n    padding:14px clamp(16px,5vw,28px);gap:10px;flex:none}\n  .onb-brand{display:flex;align-items:center;gap:9px;font-family:\'Plus Jakarta Sans\';font-weight:800;letter-spacing:-.01em}\n  .onb-brand b{background:linear-gradient(90deg,var(--accent2),var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent;font-size:18px}\n  .onb-logo{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;\n    background:linear-gradient(135deg,var(--accent2),var(--accent));color:#0b0f16}\n  .onb-skip{background:none;border:0;color:var(--muted);font:inherit;font-size:14px;cursor:pointer;padding:8px 10px;border-radius:10px}\n  .onb-skip:hover{color:var(--txt);background:#ffffff0d}\n\n  /* selector de rol (solo vista previa) */\n  .onb-roles{display:flex;gap:6px;background:#0e141e;border:1px solid var(--line);\n    padding:5px;border-radius:999px}\n  .onb-roles[data-preview="0"]{display:none}\n  .onb-roles button{border:0;background:none;color:var(--muted);font:inherit;font-size:13px;font-weight:600;\n    padding:7px 14px;border-radius:999px;cursor:pointer;transition:.2s}\n  .onb-roles button.on{background:linear-gradient(135deg,var(--accent2),var(--accent));color:#0b0f16}\n\n  /* viewport del deck */\n  .onb-stage{flex:1;display:flex;align-items:center;justify-content:center;\n    padding:6px clamp(12px,4vw,24px) 0;min-height:0}\n  .onb-deck{width:100%;max-width:460px;height:100%;max-height:640px;display:flex;flex-direction:column}\n\n  .onb-track-wrap{flex:1;overflow:hidden;border-radius:24px;min-height:0;\n    touch-action:pan-y}\n  .onb-track{display:flex;height:100%;transition:transform .42s cubic-bezier(.4,.0,.2,1);will-change:transform}\n  .onb[data-drag="1"] .onb-track{transition:none}\n\n  .onb-slide{flex:0 0 100%;height:100%;padding:0 4px;display:flex}\n  .onb-cardview{flex:1;display:flex;flex-direction:column;background:\n    linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);\n    border-radius:24px;overflow:hidden;box-shadow:var(--shadow)}\n\n  /* zona ilustración */\n  .onb-art{position:relative;flex:0 0 46%;min-height:0;display:grid;place-items:center;\n    background:radial-gradient(120% 120% at 50% 10%, color-mix(in srgb,var(--accent) 16%, transparent), transparent 70%);\n    border-bottom:1px solid var(--line)}\n  .onb-art svg{width:min(72%,230px);height:auto;display:block;\n    animation:rise .5s cubic-bezier(.2,.7,.2,1) both}\n  .onb-eyebrow{position:absolute;top:16px;left:18px;font-size:11px;font-weight:700;letter-spacing:.14em;\n    text-transform:uppercase;color:var(--accent);background:#0b0f1688;border:1px solid var(--line);\n    padding:5px 10px;border-radius:999px}\n\n  /* texto */\n  .onb-body{flex:1;display:flex;flex-direction:column;padding:clamp(18px,4vw,26px);gap:10px;min-height:0}\n  .onb-title{font-family:\'Plus Jakarta Sans\';font-weight:800;line-height:1.12;letter-spacing:-.02em;\n    color:var(--txt);font-size:clamp(21px,5.4vw,27px)}\n  .onb-text{color:var(--muted);font-size:15px;line-height:1.55;max-width:38ch}\n  .onb-perk{margin-top:auto;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--accent);\n    font-weight:600}\n  .onb-perk svg{width:16px;height:16px;flex:none}\n\n  /* controles */\n  .onb-ctrl{flex:none;display:flex;align-items:center;gap:14px;padding:16px 6px 8px}\n  .onb-dots{display:flex;gap:7px;flex:1;align-items:center}\n  .onb-dot{height:7px;width:7px;border-radius:999px;background:#33415a;transition:.3s;cursor:pointer}\n  .onb-dot.on{width:24px;background:linear-gradient(90deg,var(--accent2),var(--accent))}\n  .onb-nav{display:flex;gap:10px}\n  .onb-btn{border:1px solid var(--line);background:#0e141e;color:var(--txt);width:46px;height:46px;\n    border-radius:14px;display:grid;place-items:center;cursor:pointer;transition:.18s}\n  .onb-btn:hover{border-color:var(--accent)}\n  .onb-btn:disabled{opacity:.35;cursor:default;border-color:var(--line)}\n  .onb-btn svg{width:20px;height:20px}\n  .onb-cta{border:0;cursor:pointer;font:inherit;font-weight:700;color:#0b0f16;font-size:15px;\n    padding:0 22px;height:46px;border-radius:14px;display:none;align-items:center;gap:8px;\n    background:linear-gradient(135deg,var(--accent2),var(--accent));box-shadow:0 10px 24px -8px color-mix(in srgb,var(--accent) 70%, transparent)}\n  .onb-cta svg{width:18px;height:18px}\n  .onb.is-last .onb-cta{display:inline-flex}\n  .onb.is-last .onb-next{display:none}\n\n  .onb-foot{flex:none;text-align:center;color:#566174;font-size:12px;padding:6px 0 max(10px,env(safe-area-inset-bottom))}\n\n  @keyframes rise{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}\n  @media (prefers-reduced-motion:reduce){\n    .onb-track{transition:none}.onb-art svg{animation:none}\n  }';
  var HTML = '<div class="onb" id="mdOnb" data-role="usuario">\n  <div class="onb-top">\n    <div class="onb-brand"><span class="onb-logo" aria-hidden="true">\n      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-5.7-7-11a7 7 0 0 1 14 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>\n    </span><b>MercaDate</b></div>\n\n    <div class="onb-roles" id="onbRoles" data-preview="1">\n      <button data-r="usuario" class="on">Usuario</button>\n      <button data-r="comercio">Comercio</button>\n      <button data-r="admin">Admin</button>\n    </div>\n\n    <button class="onb-skip" id="onbSkip">Saltar</button>\n  </div>\n\n  <div class="onb-stage">\n    <div class="onb-deck">\n      <div class="onb-track-wrap" id="onbWrap">\n        <div class="onb-track" id="onbTrack"><!-- slides --></div>\n      </div>\n\n      <div class="onb-ctrl">\n        <div class="onb-dots" id="onbDots"></div>\n        <div class="onb-nav">\n          <button class="onb-btn onb-prev" id="onbPrev" aria-label="Anterior">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>\n          </button>\n          <button class="onb-btn onb-next" id="onbNext" aria-label="Siguiente">\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>\n          </button>\n          <button class="onb-cta" id="onbCta"><span id="onbCtaTxt">Comenzar</span>\n            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>\n          </button>\n        </div>\n      </div>\n      <div class="onb-foot" id="onbFoot">Desliza para conocer más →</div>\n    </div>\n  </div>\n</div>';

  var injected = false, started = false, engineAbrir = null;

  function inject() {
    if (injected) return; injected = true;
    if (!document.getElementById('onb-fonts')) {
      var l = document.createElement('link'); l.id = 'onb-fonts'; l.rel = 'stylesheet';
      l.href = 'vendor/fonts/fonts.css?v=20260628-vendor';
      document.head.appendChild(l);
    }
    var st = document.createElement('style'); st.id = 'onb-css'; st.textContent = CSS; document.head.appendChild(st);
    // Override para tema día (paleta slate claro usuario)
    var stDia = document.createElement('style'); stDia.id = 'onb-css-dia'; stDia.textContent =
      '[data-theme="dark"].theme-dia .onb{--bg:#46576a;--card:#3a4a5c;--card2:#3f5060;--line:rgba(255,255,255,.08);--txt:#f0f4f8;--muted:#b8c8d8;--accent:#F2B945;--accent2:#F7CE6E}' +
      '[data-theme="dark"].theme-dia .onb-logo{color:#46576a}' +
      '[data-theme="dark"].theme-dia .onb-cta{color:#46576a}' +
      '[data-theme="dark"].theme-dia .onb-roles{background:#3a4a5c}' +
      '[data-theme="dark"].theme-dia .onb-btn{background:#3f5060}' +
      '[data-theme="dark"].theme-dia .onb-eyebrow{background:#46576a88}';
    document.head.appendChild(stDia);
    var holder = document.createElement('div'); holder.innerHTML = HTML;
    var el = holder.firstElementChild; el.style.display = 'none';
    document.body.appendChild(el);
  }

  function buildEngine() {
/* ─── Ilustraciones SVG (planas, heredan var(--accent)) ─── */
const A='var(--accent)', A2='var(--accent2)', L='#2c3a52', W='#0b0f16';
const ART = {
  mapa:`<svg viewBox="0 0 220 180"><rect x="20" y="28" width="180" height="124" rx="16" fill="#0e1622" stroke="${L}"/>
    <path d="M20 70 H200 M20 110 H200 M80 28 V152 M140 28 V152" stroke="${L}" stroke-width="2"/>
    <circle cx="70" cy="60" r="9" fill="${A}"/><circle cx="150" cy="100" r="9" fill="${A}"/><circle cx="110" cy="130" r="7" fill="#3a4a66"/>
    <path d="M110 38c-16 0-29 13-29 29 0 21 29 46 29 46s29-25 29-46c0-16-13-29-29-29z" fill="${A2}"/>
    <circle cx="110" cy="66" r="11" fill="${W}"/></svg>`,
  vitrina:`<svg viewBox="0 0 220 180"><path d="M34 56l10-22h132l10 22z" fill="${A2}"/><path d="M34 56h152v18a14 14 0 0 1-28 0 14 14 0 0 1-28 0 14 14 0 0 1-28 0 14 14 0 0 1-28 0 14 14 0 0 1-28 0z" fill="${A}"/>
    <rect x="42" y="74" width="136" height="78" rx="8" fill="#0e1622" stroke="${L}"/>
    <rect x="56" y="92" width="44" height="44" rx="7" fill="#162132" stroke="${L}"/><rect x="120" y="92" width="44" height="44" rx="7" fill="#162132" stroke="${L}"/>
    <rect x="64" y="100" width="28" height="6" rx="3" fill="${A}"/><rect x="128" y="100" width="28" height="6" rx="3" fill="${A}"/></svg>`,
  combustible:`<svg viewBox="0 0 220 180"><rect x="52" y="40" width="74" height="112" rx="12" fill="#0e1622" stroke="${L}"/>
    <rect x="64" y="54" width="50" height="34" rx="6" fill="#162132" stroke="${L}"/><path d="M70 71h38" stroke="${A}" stroke-width="6" stroke-linecap="round"/>
    <rect x="66" y="104" width="46" height="10" rx="5" fill="${A2}"/><rect x="66" y="122" width="32" height="8" rx="4" fill="#3a4a66"/>
    <path d="M126 64h14a10 10 0 0 1 10 10v44a8 8 0 0 0 16 0V92" fill="none" stroke="${L}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="174" cy="78" r="9" fill="${A}"/></svg>`,
  alerta:`<svg viewBox="0 0 220 180"><path d="M110 36c-22 0-34 16-34 40 0 26-10 32-14 38h96c-4-6-14-12-14-38 0-24-12-40-34-40z" fill="#0e1622" stroke="${L}"/>
    <path d="M96 122a14 14 0 0 0 28 0" fill="none" stroke="${A}" stroke-width="6" stroke-linecap="round"/>
    <path d="M150 64c14 6 14 30 0 40" fill="none" stroke="${A2}" stroke-width="5" stroke-linecap="round"/>
    <path d="M70 64c-14 6-14 30 0 40" fill="none" stroke="${A2}" stroke-width="5" stroke-linecap="round"/>
    <path d="M101 60a9 9 0 0 1 18 0" fill="${A}"/></svg>`,
  chat:`<svg viewBox="0 0 220 180"><rect x="34" y="44" width="120" height="78" rx="16" fill="${A}"/><path d="M58 122l-4 22 26-16z" fill="${A}"/>
    <path d="M58 70h72M58 90h48" stroke="${W}" stroke-width="7" stroke-linecap="round"/>
    <rect x="104" y="86" width="82" height="56" rx="14" fill="#0e1622" stroke="${L}"/><path d="M168 142l4 18-22-12z" fill="#0e1622" stroke="${L}"/>
    <path d="M120 106h50M120 122h30" stroke="${A2}" stroke-width="6" stroke-linecap="round"/></svg>`,
  regalo:`<svg viewBox="0 0 220 180"><rect x="56" y="80" width="108" height="72" rx="10" fill="#0e1622" stroke="${L}"/>
    <rect x="48" y="62" width="124" height="24" rx="8" fill="${A2}"/><rect x="100" y="62" width="20" height="90" fill="${A}"/>
    <path d="M110 62c-18-26-44-2-0 0M110 62c18-26 44-2 0 0" fill="none" stroke="${A}" stroke-width="7"/>
    <circle cx="110" cy="120" r="3" fill="${A}"/></svg>`,
  subir:`<svg viewBox="0 0 220 180"><rect x="44" y="44" width="92" height="112" rx="12" fill="#0e1622" stroke="${L}"/>
    <path d="M60 72h60M60 90h60M60 108h40M60 126h48" stroke="${L}" stroke-width="6" stroke-linecap="round"/>
    <circle cx="156" cy="112" r="40" fill="${A2}"/><path d="M156 96v32M142 110l14-14 14 14" fill="none" stroke="${W}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  radar:`<svg viewBox="0 0 220 180"><circle cx="110" cy="96" r="62" fill="none" stroke="${L}"/><circle cx="110" cy="96" r="40" fill="none" stroke="${L}"/><circle cx="110" cy="96" r="18" fill="none" stroke="${L}"/>
    <path d="M110 96 L168 62 A62 62 0 0 0 110 34 Z" fill="${A}" opacity=".25"/><path d="M110 96 L168 62" stroke="${A}" stroke-width="3"/>
    <path d="M110 78c-10 0-18 8-18 18 0 13 18 30 18 30s18-17 18-30c0-10-8-18-18-18z" fill="${A2}"/><circle cx="110" cy="96" r="7" fill="${W}"/></svg>`,
  grafico:`<svg viewBox="0 0 220 180"><rect x="34" y="36" width="152" height="112" rx="14" fill="#0e1622" stroke="${L}"/>
    <rect x="58" y="96" width="20" height="36" rx="4" fill="#33415a"/><rect x="90" y="74" width="20" height="58" rx="4" fill="${A}"/>
    <rect x="122" y="60" width="20" height="72" rx="4" fill="${A2}"/><rect x="154" y="88" width="14" height="44" rx="4" fill="#33415a"/>
    <path d="M50 70l28 8 28-18 32-12" fill="none" stroke="${A}" stroke-width="3" opacity=".6"/></svg>`,
  locales:`<svg viewBox="0 0 220 180"><rect x="40" y="58" width="64" height="94" rx="10" fill="#0e1622" stroke="${L}"/><rect x="116" y="40" width="64" height="112" rx="10" fill="#0e1622" stroke="${L}"/>
    <rect x="54" y="74" width="36" height="8" rx="4" fill="#33415a"/><rect x="54" y="92" width="36" height="8" rx="4" fill="#33415a"/>
    <rect x="130" y="58" width="36" height="8" rx="4" fill="${A}"/><rect x="130" y="78" width="36" height="8" rx="4" fill="#33415a"/><rect x="130" y="98" width="24" height="8" rx="4" fill="#33415a"/>
    <circle cx="148" cy="128" r="10" fill="${A2}"/></svg>`,
  planes:`<svg viewBox="0 0 220 180"><rect x="40" y="120" width="40" height="32" rx="6" fill="#33415a"/><rect x="90" y="92" width="40" height="60" rx="6" fill="${A}"/><rect x="140" y="56" width="40" height="96" rx="6" fill="${A2}"/>
    <path d="M160 44l6 10h-12z" fill="${A}"/><path d="M150 38c4-6 12-6 16 0" fill="none" stroke="${A}" stroke-width="3"/></svg>`,
  dashboard:`<svg viewBox="0 0 220 180"><rect x="30" y="36" width="160" height="110" rx="14" fill="#0e1622" stroke="${L}"/>
    <rect x="44" y="50" width="60" height="40" rx="8" fill="${A}"/><rect x="114" y="50" width="62" height="18" rx="6" fill="#33415a"/><rect x="114" y="74" width="62" height="16" rx="6" fill="#33415a"/>
    <rect x="44" y="100" width="132" height="34" rx="8" fill="#162132" stroke="${L}"/><rect x="56" y="112" width="14" height="10" rx="3" fill="${A2}"/><rect x="80" y="112" width="80" height="10" rx="5" fill="#33415a"/></svg>`,
  usuarios:`<svg viewBox="0 0 220 180"><circle cx="86" cy="74" r="24" fill="${A}"/><path d="M50 138c0-22 16-34 36-34s36 12 36 34z" fill="${A}"/>
    <circle cx="146" cy="82" r="18" fill="${A2}"/><path d="M120 134c0-16 12-26 26-26s26 10 26 26z" fill="${A2}"/></svg>`,
  reloj:`<svg viewBox="0 0 220 180"><circle cx="110" cy="94" r="56" fill="#0e1622" stroke="${L}"/><circle cx="110" cy="94" r="56" fill="none" stroke="${A}" stroke-width="6" stroke-dasharray="120 300" stroke-linecap="round"/>
    <path d="M110 64v30l20 14" fill="none" stroke="${A2}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="110" cy="94" r="5" fill="${A}"/></svg>`,
  inbox:`<svg viewBox="0 0 220 180"><rect x="40" y="48" width="140" height="92" rx="14" fill="#0e1622" stroke="${L}"/>
    <path d="M40 70l70 40 70-40" fill="none" stroke="${A}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="158" cy="58" r="13" fill="${A2}"/></svg>`,
  cohete:`<svg viewBox="0 0 220 180"><path d="M110 30c26 14 38 42 34 76l-16 14h-36l-16-14c-4-34 8-62 34-76z" fill="${A}"/>
    <circle cx="110" cy="78" r="13" fill="${W}"/><path d="M94 120l-16 18 22-4M126 120l16 18-22-4" fill="${A2}"/>
    <path d="M104 134h12l-6 22z" fill="${A2}"/></svg>`,
};

/* ─── Contenido por rol (modo comercial / marketing) ─── */
const PERK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
const SLIDES = {
  usuario:[
    {e:'Bienvenido', t:'El mejor precio, a la vuelta de la esquina', x:'Descubre los comercios de tu barrio y compara precios reales antes de salir de casa.', p:'Gratis, para siempre', a:'mapa'},
    {e:'Descubrir', t:'Todo lo de tu zona, en un solo lugar', x:'Productos, servicios y gastronomía cerca de ti, con fotos y precios actualizados.', p:'Cientos de comercios locales', a:'vitrina'},
    {e:'Combustibles', t:'Carga al precio más bajo', x:'Precios de bencina al día con datos oficiales de la CNE, más reportes de la comunidad.', p:'Actualizado cada semana', a:'combustible'},
    {e:'Favoritos y alertas', t:'Te avisamos cuando baja el precio', x:'Guarda tus comercios y productos favoritos y recibe alertas apenas bajan de precio.', p:'Nunca pagues de más', a:'alerta'},
    {e:'Contacto directo', t:'A un toque del comercio', x:'Escribe por WhatsApp o visita su Instagram sin salir de la app.', p:'Sin intermediarios', a:'chat'},
    {e:'Beneficios', t:'Descuentos, cashback y premios', x:'Accede a beneficios de marcas aliadas en tu día a día.', p:'Disponible para mayores de 18', a:'regalo'},
    {e:'Listo', t:'Empieza a ahorrar en tu barrio', x:'Completa tu perfil en segundos y descubre lo que tienes cerca.', p:'', a:'cohete', cta:'Comenzar'},
  ],
  comercio:[
    {e:'Bienvenido', t:'Tu negocio, visible en tu barrio', x:'Llega a los clientes que ya están buscando lo que vendes, cerca de ti.', p:'Empieza gratis', a:'vitrina'},
    {e:'Publica', t:'Tu catálogo online en minutos', x:'Sube productos, servicios o tu carta con fotos y precios. Importa todo por CSV.', p:'Carga masiva incluida', a:'subir'},
    {e:'Visibilidad', t:'Aparece en las búsquedas de tu zona', x:'Cuando alguien cerca busca lo que ofreces, tu comercio aparece primero.', p:'Tráfico hiperlocal', a:'radar'},
    {e:'Estadísticas', t:'Conoce a tus clientes', x:'Mira qué buscan, a qué hora y cuántos te contactan por WhatsApp.', p:'Datos para vender más', a:'grafico'},
    {e:'Gestión', t:'Varios locales, sin enredos', x:'Administra sucursales, horarios y estados desde un panel simple.', p:'Todo en un lugar', a:'locales'},
    {e:'Planes', t:'Empieza gratis, crece cuando quieras', x:'Plan gratuito permanente y planes pagados con más cupo. Si pagas, mantienes tu precio.', p:'Garantía de precio', a:'planes'},
    {e:'Listo', t:'Pon tu negocio en el mapa', x:'Crea tu primer local y empieza a recibir clientes hoy.', p:'', a:'cohete', cta:'Crear mi primer local'},
  ],
  admin:[
    {e:'Panel', t:'Todo MercaDate, en un tablero', x:'Gestiona comercios, usuarios y contenido desde un solo lugar.', p:'Control total', a:'dashboard'},
    {e:'Gestión', t:'Comercios y usuarios al detalle', x:'Fichas completas, edición y soporte para cada cuenta.', p:'Acciones rápidas', a:'usuarios'},
    {e:'Inteligencia', t:'Estadísticas que importan', x:'Búsquedas, comportamiento y segmentación por edad para entender el uso.', p:'Decisiones con datos', a:'grafico'},
    {e:'Combustibles', t:'Precios CNE en piloto automático', x:'Descarga automática semanal y estadísticas de combustibles.', p:'Cero trabajo manual', a:'reloj'},
    {e:'Operación', t:'Mensajes, reseñas y reportes', x:'Responde, modera y mantén la plataforma sana.', p:'Bandeja unificada', a:'inbox'},
    {e:'Listo', t:'Entra a administrar', x:'Accede al panel y toma el control de la plataforma.', p:'', a:'cohete', cta:'Entrar al panel'},
  ],
};

/* ─── Motor del deck ─── */
const onb = document.getElementById('mdOnb');
const track = document.getElementById('onbTrack');
const dotsBox = document.getElementById('onbDots');
const wrap = document.getElementById('onbWrap');
let rol='usuario', i=0, slides=[], onDone=null;

function render(){
  slides = SLIDES[rol];
  onb.dataset.role = rol;
  track.innerHTML = slides.map(s=>`
    <div class="onb-slide"><div class="onb-cardview">
      <div class="onb-art"><span class="onb-eyebrow">${s.e}</span>${ART[s.a]||''}</div>
      <div class="onb-body">
        <h2 class="onb-title">${s.t}</h2>
        <p class="onb-text">${s.x}</p>
        ${s.p?`<div class="onb-perk">${PERK}<span>${s.p}</span></div>`:''}
      </div>
    </div></div>`).join('');
  dotsBox.innerHTML = slides.map((_,k)=>`<span class="onb-dot" data-k="${k}"></span>`).join('');
  i=0; update();
}
function update(){
  track.style.transform = `translateX(${-i*100}%)`;
  [...dotsBox.children].forEach((d,k)=>d.classList.toggle('on',k===i));
  document.getElementById('onbPrev').disabled = i===0;
  const last = i===slides.length-1;
  onb.classList.toggle('is-last', last);
  document.getElementById('onbCtaTxt').textContent = slides[i].cta || 'Comenzar';
  document.getElementById('onbFoot').style.visibility = last?'hidden':'visible';
}
function go(n){ i=Math.max(0,Math.min(slides.length-1,n)); update(); }

document.getElementById('onbNext').onclick=()=>go(i+1);
document.getElementById('onbPrev').onclick=()=>go(i-1);
dotsBox.onclick=e=>{const k=e.target.dataset.k; if(k!=null) go(+k);};
document.getElementById('onbSkip').onclick=finish;
document.getElementById('onbCta').onclick=finish;
function finish(){ onb.style.display='none'; if(typeof onDone==='function') onDone(rol); }

/* swipe / drag */
let x0=null,dx=0;
wrap.addEventListener('pointerdown',e=>{x0=e.clientX;dx=0;onb.dataset.drag='1';wrap.setPointerCapture(e.pointerId);});
wrap.addEventListener('pointermove',e=>{ if(x0==null)return; dx=e.clientX-x0;
  track.style.transform=`translateX(calc(${-i*100}% + ${dx}px))`; });
wrap.addEventListener('pointerup',()=>{ if(x0==null)return; onb.dataset.drag='0';
  if(Math.abs(dx)>60) go(i+(dx<0?1:-1)); else update(); x0=null; });
wrap.addEventListener('pointercancel',()=>{onb.dataset.drag='0';x0=null;update();});
addEventListener('keydown',e=>{ if(e.key==='ArrowRight')go(i+1); if(e.key==='ArrowLeft')go(i-1); });

/* selector de rol (vista previa) */
document.getElementById('onbRoles').addEventListener('click',e=>{
  const r=e.target.dataset.r; if(!r)return;
  [...e.currentTarget.children].forEach(b=>b.classList.toggle('on',b.dataset.r===r));
  rol=r; render();
});

  engineAbrir = function(rolPanel, cb){
    rol = rolPanel || 'usuario'; onDone = cb || null;
    var rolesEl = document.getElementById('onbRoles'); if (rolesEl) rolesEl.dataset.preview = '0';
    render(); onb.style.display = 'flex';
  };

  }

  function ensure() {
    if (started) return; started = true;
    inject();
    buildEngine();
  }

  window.MDOnboarding = {
    __real: true,
    abrir: function (rol, onDone) { ensure(); engineAbrir(rol, onDone); },
    mostrarUnaVez: function (rol, onDone) {
      var k = 'md_onb_' + rol;
      try { if (localStorage.getItem(k)) { onDone && onDone(); return; } } catch (e) {}
      ensure();
      engineAbrir(rol, function () { try { localStorage.setItem(k, '1'); } catch (e) {} onDone && onDone(); });
    },
    reset: function (rol) { try { localStorage.removeItem('md_onb_' + rol); } catch (e) {} }
  };
})();
