/**
 * Inlined into <head> by app/layout.tsx (a server component, so this lives
 * outside the "use client" theme module). Applies the saved theme before first
 * paint. Must stay dependency-free; the key matches lib/client/theme.ts.
 */
export const THEME_KEY = "feynman-lab:theme";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;
