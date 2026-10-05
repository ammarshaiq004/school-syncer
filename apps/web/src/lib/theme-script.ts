export const THEME_KEY = "schoolsyncer.theme";

/** Inline script for <head>: applies the saved theme before first paint (no flash). Light is the default. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;
