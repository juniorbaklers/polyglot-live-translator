import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
const messages=[];
const sockets=[];
const recorders=[];
const timers=new Map();
let timerId=0;
class LocalSocket extends EventTarget {
  static OPEN=1;
  static engine='polyglot-local-free-v3';
  readyState=0;
  sent=[];
  constructor(url){super();this.url=url;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
  reply(data){queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)})));}
  send(raw){const message=JSON.parse(raw);this.sent.push(message);
    if(message.type==='pair.request')this.reply({type:'pair.accepted',token:'local-token',engine:LocalSocket.engine});
    if(message.type==='session.start')this.reply({type:'state',state:'capturing'});
    if(message.type==='audio.chunk'||message.type==='text.chunk')this.reply({type:'audio.ack',sequence:message.sequence});
    if(message.type==='session.stop')this.reply({type:'state',state:'stopped'});
  }
  close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
}
class Recorder extends EventTarget {
  static isTypeSupported(){return true;}
  state='inactive';
  constructor(){super();this.number=recorders.length;recorders.push(this);}
  start(timeslice){assert.equal(timeslice,undefined);this.state='recording';}
  stop(){if(this.state==='inactive')return;this.state='inactive';
    const event=new Event('dataavailable');event.data=new Blob([`independent-webm-${this.number}`]);this.dispatchEvent(event);this.dispatchEvent(new Event('stop'));
  }
}
class Reader {
  readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result='data:audio/webm;base64,'+Buffer.from(bytes).toString('base64');this.onload();});}
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}

async function configure(t){
 t.mock.method(globalThis,'setTimeout',(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;});
 t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
 globalThis.chrome={runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:async message=>{messages.push(message);}}};
 globalThis.WebSocket=LocalSocket;globalThis.MediaRecorder=Recorder;globalThis.FileReader=Reader;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){},addEventListener(){}}]})}}});
 globalThis.AudioContext=class{createMediaStreamSource(){return{connect(){}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}};
 await import('../src/offscreen.ts');
}
function request(message){return new Promise(resolve=>listener(message,{},resolve));}

test('capturer en fichiers indépendants puis arrêter toutes les ressources',async t=>{
 await configure(t);
 const result=await request({type:'offscreen.start',target:'offscreen',tabId:7,streamId:'stream',settings:{pairingCode:'123456'}});
 assert.equal(result.ok,true);assert.equal(sockets[0].url,'ws://127.0.0.1:47833');
 for(let i=0;i<2;i++){
   const [id,timer]=[...timers].find(([,timer])=>timer.delay===3000);timers.delete(id);timer.fn();await flush();
 }
 const chunks=sockets[0].sent.filter(message=>message.type==='audio.chunk');
 assert.equal(chunks.length,2);assert.equal(recorders.length,3);
 assert.equal(Buffer.from(chunks[0].data,'base64').toString(),'independent-webm-0');
 assert.equal(Buffer.from(chunks[1].data,'base64').toString(),'independent-webm-1');
 sockets[0].reply({type:'subtitle',id:'phrase-1',revision:2,final:false,original:'Hello there',translation:'Bonjour'});await flush();
 const update=messages.findLast(message=>message.type==='subtitle');assert.equal(update.id,'phrase-1');assert.equal(update.final,false);assert.equal(update.revision,2);
 await request({type:'offscreen.stop',target:'offscreen'});await flush();
 assert.equal(sockets[0].sent.filter(message=>message.type==='audio.chunk').length,3);
 assert.equal(timers.size,0);assert.equal(recorders.at(-1).state,'inactive');
 assert.equal(sockets[0].sent.at(-1).type,'session.stop');
});

test('traduire une piste textuelle sans démarrer le microphone ou MediaRecorder',async t=>{
 t.mock.method(globalThis,'setTimeout',(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;});
 t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
 let mediaCalls=0; navigator.mediaDevices.getUserMedia=async()=>{mediaCalls++;throw new Error('Pas de capture audio attendue');};
 const before=recorders.length;
 const start=await request({type:'offscreen.start',target:'offscreen',tabId:7,settings:{pairingCode:'123456',inputMode:'captions',sourceLanguage:'en',domain:'geographie',glossary:'QGIS'}});
 assert.equal(start.ok,true);assert.equal(mediaCalls,0);assert.equal(recorders.length,before);
 const ws=sockets.at(-1);
 assert.equal(ws.sent.find(m=>m.type==='session.start').options.glossary,'QGIS');
 const result=await request({type:'offscreen.text',target:'offscreen',cue:{text:'A map',language:'en',start:12,end:15}});
 await flush();assert.equal(result.ok,true);assert.equal(ws.sent.at(-1).type,'text.chunk');
 assert.equal(messages.findLast(m=>m.type==='capture.metrics').pending,0);
 await request({type:'offscreen.stop',target:'offscreen'});await flush();assert.equal(timers.size,0);
 navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){},addEventListener(){}}]});
});

test('refuser un ancien serveur ou fournisseur sans identifiant gratuit',async t=>{
 // Le module conserve son écouteur ; les minuteurs sont à nouveau remplacés pour ce test.
 t.mock.method(globalThis,'setTimeout',(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;});
 t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
 LocalSocket.engine='paid-or-old-service';
 const count=recorders.length;
 const result=await request({type:'offscreen.start',target:'offscreen',tabId:7,streamId:'stream',settings:{pairingCode:'123456'}});
 assert.equal(result.ok,false);assert.equal(recorders.length,count);
 assert.equal(sockets.at(-1).sent.some(message=>message.type==='session.start'),false);
 assert.equal(messages.at(-1).type,'capture.failed');
});
