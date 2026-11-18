/* Pokelike Companion – cargador con actualización automática.
   Descarga la última versión de companion.js y companion.css desde GitHub cada vez
   que abres el juego. Si GitHub no responde, usa la copia incluida en la extensión. */
(() => {
  const REPO = 'Gmoralescostas/pokelike-companion', BRANCH = 'main';
  const remote = f => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${f}?t=${Math.floor(Date.now() / 60000)}`;
  const get = (url, ms) => Promise.race([
    fetch(url, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);
  const load = async f => { try { return { src: 'github', text: await get(remote(f), 5000) }; } catch (e) { return { src: 'local', text: await get(chrome.runtime.getURL(f), 3000) }; } };
  (async () => {
    const [css, js] = await Promise.all([load('companion.css'), load('companion.js')]);
    const st = document.createElement('style'); st.id = 'plc-style'; st.textContent = css.text; document.head.appendChild(st);
    const sc = document.createElement('script'); sc.textContent = `window.__PLC_SOURCE=${JSON.stringify(js.src)};\n` + js.text; document.documentElement.appendChild(sc); sc.remove();
  })();
})();
