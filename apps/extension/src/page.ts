(() => {
  const scope = globalThis as typeof globalThis & {__polyglotPage?: boolean};
  if (scope.__polyglotPage) return;
  scope.__polyglotPage = true;
  const records = new Map<Text, {original: string; translated: string}>();
  let running = false, epoch = 0;
  let languageKey = "";
  const host = document.createElement("div"); host.id = "polyglot-page-toolbar";
  const root = host.attachShadow({mode: "open"});
  root.innerHTML = `<style>:host{all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483647}section{font:14px/1.4 'Segoe UI',sans-serif;color:#eef3ff;background:#152238;padding:14px;border:1px solid #6b82b9;border-radius:14px;box-shadow:0 8px 30px #0005;max-width:340px}p{margin:0 0 10px}button{font:inherit;color:white;background:#405dca;border:0;border-radius:7px;padding:8px;margin:3px;cursor:pointer}</style><section><p role="status" aria-live="polite">Polyglot · Traduction de la page</p><button id="original">Voir l’original / arrêter</button><button id="hide">Masquer</button></section>`;
  const status = root.querySelector("p")!;
  function show(text: string) { host.style.display = ""; if (!host.isConnected) document.documentElement.append(host); status.textContent = text; }
  function restore() {
    epoch++; running = false;
    for (const [node, value] of records) if (node.isConnected && node.data === value.translated) node.data = value.original;
    records.clear();
    chrome.runtime.sendMessage({type: "page.stop"}).catch(() => undefined);
    show("Texte original rétabli.");
  }
  root.querySelector<HTMLButtonElement>("#original")!.onclick = restore;
  root.querySelector<HTMLButtonElement>("#hide")!.onclick = () => { host.style.display = "none"; };
  function texts() {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let next;
    while ((next = walker.nextNode())) {
      const node = next as Text, parent = node.parentElement;
      if (!parent || !node.data.trim() || !/[\p{L}]/u.test(node.data) || records.has(node)) continue;
      if (parent.closest('script,style,noscript,textarea,input,select,option,button,pre,code,svg,math,iframe,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[aria-hidden="true"],#polyglot-live-subtitles,#polyglot-page-toolbar')) continue;
      let visible = true;
      for (let element: Element | null = parent; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") { visible = false; break; }
      }
      if (visible) nodes.push(node);
    }
    return nodes;
  }
  async function translate(nextLanguageKey = "") {
    if (running) { show("Traduction déjà en cours. Vous pouvez l’arrêter avec Voir l’original."); return; }
    if (languageKey !== nextLanguageKey) {
      for (const [node, value] of records) if (node.isConnected && node.data === value.translated) node.data = value.original;
      records.clear(); languageKey = nextLanguageKey;
    }
    running = true; const current = ++epoch;
    let translated = 0, skipped = 0, checked = 0;
    try {
      const nodes = texts();
      if (!nodes.length) { show("Aucun nouveau texte traduisible sur cette page."); return; }
      show("Connexion au moteur local…");
      const begin = await chrome.runtime.sendMessage({type: "page.start", language: document.documentElement.lang});
      if (!begin?.ok) throw new Error(begin?.error ?? "Connexion impossible");
      if (epoch !== current) { await chrome.runtime.sendMessage({type: "page.stop"}); return; }
      // Une seule requête à la fois ; aucune file de calcul massive.
      for (const node of nodes) {
        if (epoch !== current) return;
        if (translated >= 500) { skipped += nodes.length - checked; break; }
        checked++;
        const original = node.data;
        if (!node.isConnected || original.trim().length > 4000) { skipped++; continue; }
        show(`Traduction de la page : ${translated} passages terminés…`);
        const result = await chrome.runtime.sendMessage({type: "page.chunk", text: original.trim()});
        if (epoch !== current) return;
        if (!result?.ok) throw new Error(result?.error ?? "Traduction interrompue");
        if (!node.isConnected || node.data !== original) { skipped++; continue; }
        if (typeof result.translation !== "string" || !result.translation.trim()) { skipped++; continue; }
        const value = (original.match(/^\s*/)?.[0] ?? "") + result.translation + (original.match(/\s*$/)?.[0] ?? "");
        records.set(node, {original, translated: value}); node.data = value; translated++;
      }
      show(`${translated} passages traduits.${skipped ? ` ${skipped} passages conservés : relancez pour poursuivre, ou texte trop long/modifié.` : ""} Voir l’original reste disponible.`);
    } catch (error) {
      if (epoch === current) show(`${String(error).replace(/^Error: /, "")} — ${translated} passages traduits. Vous pouvez retrouver l’original.`);
    } finally {
      if (epoch === current) { running = false; await chrome.runtime.sendMessage({type: "page.stop"}).catch(() => undefined); }
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === "page.translate") { void translate(message.languageKey); reply({ok: true}); }
    if (message.type === "page.restore") { restore(); reply({ok: true}); }
  });
})();
