import test from 'node:test';
import assert from 'node:assert/strict';
let listener;const sockets=[];const messages=[];
class LocalSocket {
 static OPEN=1;
 readyState=0;
 constructor(){sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
 send(raw){const value=JSON.parse(raw);messages.push(value);
 const response=value.type==='pair.request'?{type:'pair.accepted',engine:'polyglot-local-free-v12',token:'test-token'}:value.type==='session.start'?{type:'state',state:'capturing'}:{type:'page.result',id:value.id,translation:'Bonjour.',notices:[]};
 queueMicrotask(()=>this.onmessage?.({data:JSON.stringify(response)}));
 }
 close(){this.readyState=3;this.onclose?.();}
}
globalThis.WebSocket=LocalSocket;
globalThis.chrome={runtime:{id:'a'.repeat(32),onMessage:{addListener:fn=>listener=fn},sendMessage:async()=>({ok:true})}};
await import('../src/page_client.ts');
const request=message=>new Promise(resolve=>listener({...message,target:'offscreen'},{},resolve));
test('client de page associe le moteur, transporte du texte sans audio, puis libère la connexion',async()=>{
 assert.equal((await request({type:'offscreen.page.start',tabId:7,settings:{sourceLanguage:'en',targetLanguage:'fr'}})).ok,true);
 const value=await request({type:'offscreen.page.chunk',tabId:7,text:'Hello.'});assert.equal(value.translation,'Bonjour.');
 assert.equal(messages.find(x=>x.type==='session.start').options.inputMode,'page');
 assert.equal(messages.at(-1).token,'test-token');assert.equal(messages.some(x=>x.type==='audio.chunk'),false);
 assert.equal((await request({type:'offscreen.page.stop',tabId:7})).ok,true);assert.equal(sockets[0].readyState,3);
});
test('un autre onglet ne peut pas utiliser ou fermer la connexion de page',async()=>{
 await request({type:'offscreen.page.start',tabId:7,settings:{sourceLanguage:'en',targetLanguage:'fr'}});
 assert.equal((await request({type:'offscreen.page.chunk',tabId:8,text:'Hello.'})).ok,false);
 assert.equal((await request({type:'offscreen.page.stop',tabId:8})).ok,false);assert.equal(sockets.at(-1).readyState,1);
 await request({type:'offscreen.page.stop',tabId:7});
});
