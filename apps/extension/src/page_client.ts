// WebSocket réservé au document d'extension, jamais au JavaScript du site.
let connection: WebSocket | undefined;
let token = "";
let owner: number | undefined;
let sequence = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
let pending: {resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; match: (value: any) => boolean} | undefined;
function closePage() {
  clearTimeout(idle);
  const tabId = owner;
  const current = connection; connection = undefined; token = ""; owner = undefined;
  if (pending) { clearTimeout(pending.timer); pending.reject(new Error("Traduction de page interrompue")); pending = undefined; }
  current?.close();
  if (tabId !== undefined) chrome.runtime.sendMessage({type: "page.closed", tabId}).catch(() => undefined);
}
function exchange(message: object, match: (value: any) => boolean): Promise<any> {
  if (pending || connection?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Moteur de page indisponible"));
  clearTimeout(idle);
  return new Promise((resolve, reject) => {
    pending = {resolve, reject, match, timer: setTimeout(() => closePage(), 60000)};
    connection!.send(JSON.stringify({...message, token}));
  });
}
async function startPage(tabId: number, settings: Record<string, unknown>) {
  if (connection) throw new Error("Une traduction de page est déjà en cours");
  owner = tabId;
  const ws = new WebSocket("ws://127.0.0.1:47833"); connection = ws;
  ws.onmessage = event => {
    if (connection !== ws) return;
    let value; try { value = JSON.parse(event.data); } catch { closePage(); return; }
    const request = pending;
    if (!request) return;
    if (value.type === "error" || value.type === "pair.rejected") {
      clearTimeout(request.timer); pending = undefined;
      request.reject(new Error(value.message ?? value.reason)); closePage();
    } else if (request.match(value)) {
      clearTimeout(request.timer); pending = undefined; request.resolve(value);
      idle = setTimeout(closePage, 90000);
    }
  };
  ws.onclose = () => { if (connection === ws) closePage(); };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { closePage(); reject(new Error("Moteur local inaccessible. Démarrez Polyglot.")); }, 8000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); closePage(); reject(new Error("Moteur local inaccessible. Démarrez Polyglot.")); };
  });
  const pair = await exchange({type: "pair.request", extensionId: chrome.runtime.id}, value => value.type === "pair.accepted");
  if (pair.engine !== "polyglot-local-free-v12") { closePage(); throw new Error("Mettez à jour le moteur et l’extension en version 1.24."); }
  token = pair.token;
  await exchange({type: "session.start", options: {...settings, inputMode: "page", translateDrafts: false}}, value => value.type === "state" && value.state === "capturing");
}
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message.target !== "offscreen" || !message.type.startsWith("offscreen.page.")) return;
  (async () => {
    if (message.type === "offscreen.page.start") {
      try { await startPage(message.tabId, message.settings); } catch (error) { closePage(); throw error; }
      return {ok: true};
    }
    if (owner !== message.tabId) throw new Error("Session de page expirée. Relancez Traduire la page.");
    if (message.type === "offscreen.page.stop") { closePage(); return {ok: true}; }
    if (message.type !== "offscreen.page.chunk") throw new Error("Commande de page invalide");
    const id = sequence++;
    const value = await exchange({type: "page.chunk", id, text: message.text}, value => value.type === "page.result" && value.id === id);
    return {ok: true, translation: value.translation, notices: value.notices};
  })().then(reply).catch(error => reply({ok: false, error: String(error).replace(/^Error: /, "")}));
  return true;
});
