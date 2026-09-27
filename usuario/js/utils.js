// ═══════════════════════════════════════════════════
// PLATAFORMA : Usuario — Portal del cliente MercaDate
// ARCHIVO    : utils.js
// ═══════════════════════════════════════════════════
// utils.js — Helpers de seguridad, sanitización, formato y notificaciones
// CUALQUIER contenido externo (servidor, usuario, localStorage, querystring)
// DEBE pasar por escapeHtml() antes de inyectarse vía innerHTML.

(function () {
  'use strict';

  // Sanitiza URLs. Bloquea javascript:/data:/vbscript:/file:
  window.sanitizarUrl = function (url) {
    if (!url) return '#';
    const u = String(url).trim();
    const lower = u.toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:') ||
        lower.startsWith('vbscript:')   || lower.startsWith('file:')) return '#';
    if (/^(https?:|tel:|mailto:|whatsapp:)/i.test(u))     return u;
    if (/^https?:\/\/wa\.me\//i.test(u))                  return u;
    if (u.startsWith('/') || u.startsWith('./') || u.startsWith('#')) return u;
    return '#';
  };

  window.limitarTexto = function (str, maxLen) {
    if (!str) return '';
    const s = String(str);
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  };

  window.numeroSeguro = function (val, min, max, defecto) {
    const n = parseFloat(val);
    if (isNaN(n)) return defecto;
    return Math.max(min, Math.min(max, n));
  };

  window.esEmailValido = function (s) {
    if (!s || typeof s !== 'string' || s.length > 254) return false;
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(s);
  };

  // ═══ LOCALSTORAGE SEGURO ═════════════════════════════════════════════════
  window.SafeStorage = {
    get(key, defecto = null) {
      try { const v = localStorage.getItem(key); return v === null ? defecto : v; }
      catch { return defecto; }
    },
    getJson(key, defecto = null) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return defecto;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
            Object.getPrototypeOf(parsed) !== Object.prototype) {
          console.warn('[SafeStorage] prototype no estándar bloqueado:', key);
          return defecto;
        }
        return parsed;
      } catch { return defecto; }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        return true;
      } catch (e) { console.warn('[SafeStorage] error escribiendo:', e.message); return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch {} }
  };

  // ═══ FORMATO ═════════════════════════════════════════════════════════════
  window.formatoCLP = function (n) {
    const num = parseFloat(n);
    if (isNaN(num)) return '$0';
    return '$' + Math.round(num).toLocaleString('es-CL');
  };

  window.formatoDistancia = function (metros) {
    if (!isFinite(metros) || metros < 0) return '';
    return metros < 1000 ? Math.round(metros) + ' m' : (metros / 1000).toFixed(1) + ' km';
  };

  // ═══ TOAST GLOBAL ════════════════════════════════════════════════════════
  window.mostrarToast = function (msg, ms = 3500, tipo = 'info') {
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      t.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(15,17,23,0.95);padding:14px 22px;border-radius:12px;border:1px solid rgba(240,180,41,0.4);font-size:14px;font-weight:700;z-index:99999;opacity:0;transition:opacity .25s;pointer-events:none;max-width:90vw;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
      document.body.appendChild(t);
    }
    t.textContent = String(msg);
    t.style.color       = tipo === 'err' ? '#ff6b6b' : '#f0b429';
    t.style.borderColor = tipo === 'err' ? 'rgba(255,107,107,0.4)' : 'rgba(240,180,41,0.4)';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, ms);
  };

  // ═══ AVATARES PREDEFINIDOS — Latinoamericanos ════════════════════════════
  // Usamos emoji con modificador 🏽 (tono medio) que representa
  // a la mayoría de personas en Sudamérica.
  window.AVATARS = {
    nino:    { emoji: '🧒🏽', label: 'Niño',     bg: '#1a8a8a' },
    nina:    { emoji: '👧🏽', label: 'Niña',     bg: '#f0b429' },
    joven_m: { emoji: '👦🏽', label: 'Chico',    bg: '#3a7bd5' },
    joven_f: { emoji: '👩🏽‍🦱', label: 'Chica',  bg: '#c89c25' },
    hombre:  { emoji: '👨🏽', label: 'Hombre',   bg: '#0d6b6b' },
    mujer:   { emoji: '👩🏽', label: 'Mujer',    bg: '#a3556a' },
    tio:     { emoji: '🧔🏽', label: 'Tío',      bg: '#7a4c2e' },
    tia:     { emoji: '👩🏽‍🦰', label: 'Tía',    bg: '#9c4f6e' },
    abuelo:  { emoji: '👴🏽', label: 'Abuelo',   bg: '#64748b' },
    abuela:  { emoji: '👵🏽', label: 'Abuela',   bg: '#8b7195' }
  };

  // Compatibilidad con avatares viejos (versión sin tono): redireccionarlos
  const _AVATAR_LEGACY = { hombre: 'hombre', mujer: 'mujer', abuelo: 'abuelo', abuela: 'abuela' };

  // Devuelve { tipo: 'url'|'preset'|'inicial', valor: string }
  window.parsearAvatar = function (avatar_url, fallback_nombre) {
    if (avatar_url && typeof avatar_url === 'string') {
      // Avatar combinado (género × edad × piel × pelo) guardado como 'emoji:<emoji>'
      if (avatar_url.startsWith('emoji:')) {
        return { tipo: 'emoji', valor: avatar_url.slice(6) };
      }
      if (avatar_url.startsWith('avatar:')) {
        const key = avatar_url.slice(7);
        if (window.AVATARS[key]) return { tipo: 'preset', valor: key };
      }
      if (avatar_url.startsWith('http')) {
        return { tipo: 'url', valor: window.sanitizarUrl(avatar_url) };
      }
      // Foto comprimida guardada como data URI (thumbnail 80×80 ~5 KB)
      if (avatar_url.startsWith('data:image')) {
        return { tipo: 'url', valor: avatar_url };
      }
    }
    const inicial = (fallback_nombre || 'U').toString().trim()[0]?.toUpperCase() || 'U';
    return { tipo: 'inicial', valor: inicial };
  };

  // Renderiza el contenido HTML de un avatar dado el parseo
  window.renderAvatarHtml = function (parsed) {
    if (parsed.tipo === 'url') {
      return `<img src="${parsed.valor}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover"/>`;
    }
    if (parsed.tipo === 'emoji') {
      return `<span style="font-size:1.1em;line-height:1">${parsed.valor}</span>`;
    }
    if (parsed.tipo === 'preset') {
      const a = window.AVATARS[parsed.valor];
      return `<span style="font-size:1.1em;line-height:1">${a.emoji}</span>`;
    }
    return window.escapeHtml(parsed.valor);
  };

  // ═══ COMPOSITOR DE AVATAR (género × edad × tono de piel × pelo) ═══
  // Devuelve el emoji compuesto. Reutilizable en cualquier panel.
  window.componerAvatarEmoji = function (p) {
    p = p || {};
    const genero = p.genero || 'neutro';   // 'hombre' | 'mujer' | 'neutro'
    const edad   = p.edad   || 'adulto';   // 'joven' | 'adulto' | 'mayor'
    const tono   = p.tono   || '';         // '' | 🏻🏼🏽🏾🏿
    const pelo   = p.pelo   || '';         // '' | rojo | rizado | canoso | calvo
    const BASE = {
      'neutro-joven':  '\u{1F9D2}', 'neutro-adulto': '\u{1F9D1}', 'neutro-mayor': '\u{1F9D3}',
      'hombre-joven':  '\u{1F466}', 'hombre-adulto': '\u{1F468}', 'hombre-mayor': '\u{1F474}',
      'mujer-joven':   '\u{1F467}', 'mujer-adulto':  '\u{1F469}', 'mujer-mayor':  '\u{1F475}',
    };
    const HAIR = { rojo: '\u200D\u{1F9B0}', rizado: '\u200D\u{1F9B1}', canoso: '\u200D\u{1F9B3}', calvo: '\u200D\u{1F9B2}' };
    const base = BASE[genero + '-' + edad] || BASE['neutro-adulto'];
    // El pelo (componente ZWJ) solo combina bien con adultos
    const hair = (edad === 'adulto' && pelo && HAIR[pelo]) ? HAIR[pelo] : '';
    return base + (tono || '') + hair;
  };

  if (!window.apiCall) {
    window.apiCall = function () {
      console.warn('[utils] apiCall no disponible — falta cargar api.js');
      return Promise.resolve({ ok: false, error: 'api not loaded', data: {} });
    };
  }
})();
