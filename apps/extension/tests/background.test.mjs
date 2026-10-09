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
 chrome.tabs.sendMessage=async(tab,message)=>{calls.push(message);if(message.type==='overlay.ping'){if(!injected)throw new Error('Receiving end does not exist');return{ok:true,version:'1.20.0'};}return{ok:true};};
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

test('mode automatique choisit une piste accessible et sinon capture le son',async()=>{
 const calls=[];let hasCaptions=true,mediaCalls=0;
 const settings={sourceLanguage:'en',targetLanguage:'fr',inputMode:'auto',overlayReadingMode:'final'};
 chrome.storage.local={get:async()=>({...settings}),set:async()=>{}};
 chrome.runtime.ContextType={OFFSCREEN_DOCUMENT:'OFFSCREEN_DOCUMENT'};
 chrome.runtime.getURL=path=>'chrome-extension://test/'+path;
 chrome.runtime.getContexts=(_,callback)=>callback([{}]);
 chrome.offscreen={};
 chrome.tabCapture={getMediaStreamId:(_,callback)=>{mediaCalls++;callback('audio-stream');}};
 chrome.tabs.get=async()=>({url:'https://video.example'});
 chrome.tabs.sendMessage=async(_,message)=>{
  calls.push(message);
  if(message.type==='overlay.ping')return{ok:true,version:'1.20.0'};
  if(message.type==='captions.probe')return{ok:hasCaptions};
  return{ok:true};
 };
 chrome.runtime.sendMessage=async message=>{calls.push(message);return{ok:true};};
 chrome.action.setBadgeBackgroundColor=async()=>{};
 delete state.activeCapture;
 assert.equal((await request({type:'capture.start',tabId:7})).ok,true);
 assert.equal(mediaCalls,0);assert.equal(state.activeCapture.inputMode,'captions');
 assert.equal(calls.find(m=>m.type==='offscreen.start').settings.translateDrafts,false);
 assert.ok(calls.some(m=>m.type==='captions.start'));
 await request({type:'capture.stop'});
 hasCaptions=false;calls.length=0;
 settings.overlayReadingMode='progressive';
 assert.equal((await request({type:'capture.start',tabId:7})).ok,true);
 assert.equal(mediaCalls,1);assert.equal(state.activeCapture.inputMode,'audio');
 assert.equal(calls.find(m=>m.type==='offscreen.start').settings.translateDrafts,true);
 assert.equal(calls.some(m=>m.type==='captions.start'),false);
 await request({type:'capture.stop'});
});


test('voix traduite sur sous-titres : couper, réactiver, restaurer le son après arrêt ou erreur',async()=>{
 const local={};const updates=[];
 chrome.storage.local={set:async values=>Object.assign(local,values)};
 chrome.tabs.update=async(tab,options)=>{updates.push(options.muted);return{};};
 chrome.runtime.sendMessage=async()=>({ok:true});
 chrome.tabs.sendMessage=async()=>({ok:true});
 state.activeCapture={tabId:7,inputMode:'captions',outputMode:'both',targetLanguage:'fr',originalTabMuted:false};
 assert.equal((await request({type:'audio.change',muteOriginal:true})).ok,true);assert.equal(updates.at(-1),true);
 await request({type:'output.change',outputMode:'subtitles'});assert.equal(updates.at(-1),false);
 await request({type:'output.change',outputMode:'voice'});assert.equal(updates.at(-1),true);
 await request({type:'capture.stop'});assert.equal(updates.at(-1),false);
 state.activeCapture={tabId:7,inputMode:'captions',outputMode:'voice',originalTabMuted:true};
 await request({type:'audio.change',muteOriginal:false});assert.equal(updates.at(-1),true);
 await request({type:'capture.stop'});assert.equal(updates.at(-1),true);
 state.activeCapture={tabId:7,inputMode:'captions',outputMode:'voice',originalTabMuted:false};
 listener({type:'capture.failed',tabId:7,text:'Test'}, {},()=>{});await flush();
 assert.equal(updates.at(-1),false);assert.equal(state.activeCapture,undefined);
});

test('en capture audio, la coupure passe par le gain hors écran sans couper le flux source',async()=>{
 const sent=[];
 state.activeCapture={tabId:7,inputMode:'audio',outputMode:'both',targetLanguage:'fr'};
 chrome.runtime.sendMessage=async message=>{sent.push(message);return{ok:true};};
 await request({type:'audio.change',muteOriginal:true});
 assert.deepEqual(sent.at(-1),{type:'offscreen.audio',target:'offscreen',muteOriginal:true});
 await request({type:'output.change',outputMode:'subtitles'});assert.equal(sent.at(-1).muteOriginal,false);
 delete state.activeCapture;
});
