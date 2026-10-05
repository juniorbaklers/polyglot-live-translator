import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
let state = { activeCapture: { tabId: 7, outputMode: 'both', targetLanguage: 'fr' } };
let releaseDisplay;
const displayed = [];
let spoken = 0;
function request(message) { return new Promise(resolve => listener(message, {}, resolve)); }
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

globalThis.chrome = {
  storage: { session: {
    get: async key => ({ [key]: state[key] }),
    set: async values => Object.assign(state, values),
    remove: async key => { delete state[key]; }
  } },
  tabs: { sendMessage: async (tab, message) => {
    displayed.push(message);
    if (message.type === 'overlay.subtitle') await new Promise(resolve => { releaseDisplay = resolve; });
  } },
  action: { setBadgeText: async () => {} },
  tts: { stop() {}, getVoices: callback => callback([{ lang: 'fr', remote: false }]), speak: () => { spoken++; } },
  runtime: { onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: async message => {
      assert.equal(message.type, 'offscreen.stop');
      const result = await request({ type: 'subtitle', tabId: 7, id: 'phrase-1', revision: 2,
        final: true, original: 'Final words.', translation: 'Derniers mots.' });
      assert.equal(result.ok, true);
      return { ok: true };
    }
  }
};
// Tester le worker réellement livré, avec ses imports compilés.
await import('../dist/background.js');

test('conserver la session pendant la livraison finale à l’arrêt, sans voix', async () => {
  const done = request({ type: 'capture.stop' });
  await flush();
  assert.equal(state.activeCapture.stopping, true);
  const subtitle = displayed.find(message => message.type === 'overlay.subtitle');
  assert.ok(subtitle);
  assert.equal(subtitle.final, true);
  assert.equal(spoken, 0);
  releaseDisplay();
  assert.equal((await done).ok, true);
  assert.equal(state.activeCapture, undefined);
  assert.equal(displayed.at(-1).type, 'overlay.stopped');
});

test('acquitter et ignorer un sous-titre reçu après la fermeture', async () => {
  const count = displayed.length;
  const result = await request({ type: 'subtitle', tabId: 7, id: 'phrase-1', revision: 3,
    final: false, original: 'Stale words', translation: 'Ancien texte' });
  assert.equal(result.ok, false);
  assert.equal(displayed.length, count);
});

test('réafficher injecte le contenu absent et garde la session avec une fenêtre en mode voix',async()=>{
 const originalSend=chrome.tabs.sendMessage;
 state.activeCapture={tabId:7,outputMode:'voice',targetLanguage:'fr'};
 let injected=false;const calls=[];const local={};
 chrome.storage.local={set:async values=>Object.assign(local,values)};
 chrome.tabs.get=async()=>({id:7,url:'https://video.example'});
 chrome.tabs.update=async()=>({});
 chrome.scripting={executeScript:async options=>{assert.deepEqual(options.files,['content.js']);injected=true;}};
 chrome.tabs.sendMessage=async(tab,message)=>{calls.push(message);if(message.type==='overlay.ping'){if(!injected)throw new Error('Receiving end does not exist');return{ok:true,version:'1.13.0'};}return{ok:true};};
 const result=await request({type:'overlay.reveal',tabId:7});
 assert.equal(result.ok,true);assert.equal(injected,true);assert.equal(local.outputMode,'both');assert.equal(state.activeCapture.outputMode,'both');
 assert.equal(calls.at(-1).type,'overlay.reveal');assert.equal(calls.at(-1).active,true);
 chrome.tabs.sendMessage=originalSend;delete state.activeCapture;
});

test('page interdite et ancien contenu donnent une instruction claire',async()=>{
 const originalSend=chrome.tabs.sendMessage;
 chrome.tabs.get=async()=>({id:7,url:'chrome://extensions'});
 let result=await request({type:'overlay.reveal',tabId:7});assert.equal(result.ok,false);assert.match(result.error,/page web/);
 chrome.tabs.get=async()=>({id:7,url:'https://video.example'});
 chrome.tabs.sendMessage=async()=>undefined;
 result=await request({type:'overlay.reveal',tabId:7});assert.equal(result.ok,false);assert.match(result.error,/Actualisez/);
 chrome.tabs.sendMessage=originalSend;
});
