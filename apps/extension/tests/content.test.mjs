import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const compiled = readFileSync(new URL('../dist/content.js', import.meta.url),'utf8');
function setup(html='<body></body>') {
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://video.example'}); const w=dom.window;
 let listener;const messages=[];let saved;
 w.chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{messages.push(message);return {ok:true};}},storage:{local:{get:async()=>({}),set:async values=>{saved=values;}}}};
 w.eval(compiled);
 const receive=(message)=>{let response;listener(message,{},value=>{response=value});return response;};
 receive({type:'overlay.show',text:'Connexion au moteur local…'});
 return {dom,w,messages,receive,root:w.document.getElementById('polyglot-live-subtitles').shadowRoot};
}
const tick=async()=>{for(let i=0;i<20;i++) await Promise.resolve();};
test('révisions, texte sécurisé et repères d’incertitude dans l’interface livrée',async()=>{
 const {dom,receive,root}=setup();await tick();
 receive({type:'overlay.subtitle',id:'x',revision:1,final:false,original:'Hello QGIS <img>',translation:'<script>bad</script>',uncertainWords:['QGIS']});
 assert.equal(root.querySelector('mark').textContent,'QGIS');assert.equal(root.querySelector('.translation').children.length,0);
 receive({type:'overlay.subtitle',id:'x',revision:2,final:true,original:'Hello QGIS.',translation:'Bonjour QGIS.'});
 assert.equal(root.querySelectorAll('.phrase').length,1);
 receive({type:'overlay.subtitle',id:'x',revision:1,final:false,original:'old',translation:'ancien'});
 assert.equal(root.querySelector('.translation').textContent,'Bonjour QGIS.');
 for(let i=0;i<151;i++) receive({type:'overlay.subtitle',id:`row-${i}`,revision:1,final:true,original:`Source ${i}`,translation:`Texte ${i}`});
 assert.equal(root.querySelectorAll('.phrase').length,150);dom.window.close();
});
test('corriger une phrase finalisée transmet sa paire de langues et actualise l’affichage',async()=>{
 const {dom,receive,root,messages}=setup();await tick();
 receive({type:'overlay.subtitle',id:'x',revision:1,final:true,original:'A map',translation:'Une mauvaise phrase',sourceLanguage:'en',targetLanguage:'fr'});
 root.querySelector('.phrase .tools button').click();
 const fields=root.querySelectorAll('.editor textarea');fields[0].value='A map.';fields[1].value='Une carte.';
 root.querySelector('.editor button').click();await tick();
 assert.equal(messages.at(-1).correction.original,'A map');assert.equal(messages.at(-1).correction.source,'en');
 assert.equal(root.querySelector('.translation').textContent,'Une carte.');assert.match(root.querySelector('.phrase .note').textContent,/personnelle/);dom.window.close();
});
test('exports TXT et SRT utilisent les seules phrases finalisées et des temps réels',async()=>{
 const {dom,w,receive,root}=setup();await tick();
 let blob,download;
 w.URL.createObjectURL=value=>{blob=value;return 'blob:local'};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){download=this.download;};
 receive({type:'overlay.subtitle',id:'a',revision:1,final:true,original:'Original',translation:'Bonjour',start:12.5,end:15,timing:'video'});
 receive({type:'overlay.subtitle',id:'b',revision:1,final:false,original:'En cours',translation:'Provisoire',start:15,end:18});
 root.querySelector('[data-export=srt]').click();assert.match(download,/\.srt$/);
 const read=new w.FileReader();const text=new Promise(resolve=>{read.onload=()=>resolve(read.result);});read.readAsText(blob);
 assert.equal(await text,'1\n00:00:12,500 --> 00:00:15,000\nBonjour\n');
 root.querySelector('[data-export=txt]').click();assert.match(download,/\.txt$/);dom.window.close();
});
test('piste accessible : transmettre une seule fois le texte, refuser une vidéo sans piste',async()=>{
 const {dom,w,receive,messages}=setup('<body><video></video></body>');await tick();
 const video=w.document.querySelector('video');
 assert.equal(receive({type:'captions.start',sourceLanguage:'en'}).ok,false);
 const track=new w.EventTarget();Object.assign(track,{kind:'subtitles',mode:'showing',language:'en',activeCues:[{text:'<i>A map</i>',startTime:4,endTime:7}]});
 Object.defineProperty(video,'textTracks',{value:[track]});Object.defineProperty(video,'paused',{value:false});
 assert.equal(receive({type:'captions.start',sourceLanguage:'en'}).ok,true);await tick();
 track.dispatchEvent(new w.Event('cuechange'));await tick();
 const cues=messages.filter(m=>m.type==='caption.cue');assert.equal(cues.length,1);assert.equal(cues[0].cue.text,'A map');assert.equal(cues[0].cue.start,4);
 receive({type:'captions.stop'});track.activeCues=[{text:'Another',startTime:7,endTime:10}];track.dispatchEvent(new w.Event('cuechange'));await tick();
 assert.equal(messages.filter(m=>m.type==='caption.cue').length,1);dom.window.close();
});

test('réafficher la fenêtre masquée conserve les phrases et fonctionne avant le démarrage',async()=>{
 const {dom,receive,root}=setup();await tick();
 assert.deepEqual(JSON.parse(JSON.stringify(receive({type:'overlay.ping'}))),{ok:true,version:'1.4.0'});
 receive({type:'overlay.subtitle',id:'x',revision:1,final:true,original:'Hello',translation:'Bonjour'});
 root.querySelector('[data-close]').click();const host=dom.window.document.getElementById('polyglot-live-subtitles');assert.equal(host.style.display,'none');
 assert.equal(receive({type:'overlay.reveal',active:true}).ok,true);assert.equal(host.style.display,'block');assert.equal(root.querySelectorAll('.phrase').length,1);
 assert.equal(root.querySelector('.translation').textContent,'Bonjour');
 receive({type:'overlay.reveal',active:false});assert.equal(root.querySelector('[data-stop]').disabled,true);assert.equal(root.querySelector('[data-status]').textContent,'Prêt à traduire');
 // Une seconde injection ne crée pas un deuxième écouteur ou un panneau supplémentaire.
 dom.window.eval(compiled);assert.equal(receive({type:'overlay.ping'}).ok,true);assert.equal(dom.window.document.querySelectorAll('#polyglot-live-subtitles').length,1);
 dom.window.close();
});
