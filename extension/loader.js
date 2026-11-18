/* Pokelike Companion – cargador con actualización automática.
   Se ejecuta en la página. Descarga la última versión de companion.js y companion.css
   desde GitHub cada vez que abres el juego; si GitHub no responde, usa la copia local. */
(() => {
  if (window.__PLC_LOADER) return;
  window.__PLC_LOADER = true;
  const REPO = 'Gmoralescostas/pokelike-companion', BRANCH = 'main';
  const remote = f => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${f}?t=${Math.floor(Date.now() / 60000)}`;
  const local = f => (document.documentElement.dataset.plcBase || '') + f;
  const get = (url, ms) => Promise.race([
    fetch(url, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
  const load = async f => { try { return { src: 'github', text: await get(remote(f), 5000) }; } catch (e) { return { src: 'local', text: await get(local(f), 3000) }; } };
  (async () => {
    const [css, js] = await Promise.all([load('companion.css'), load('companion.js')]);
    if (!document.getElementById('plc-style')) { const st = document.createElement('style'); st.id = 'plc-style'; st.textContent = css.text; document.head.appendChild(st); }
    const sc = document.createElement('script'); sc.textContent = `window.__PLC_SOURCE=${JSON.stringify(js.src)};\n` + js.text; document.documentElement.appendChild(sc); sc.remove();
  })().catch(e => console.warn('[Pokelike Companion] no se pudo cargar', e));
})();
