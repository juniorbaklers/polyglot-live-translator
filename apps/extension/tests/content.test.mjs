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
 const {dom,w,receive,root}=setup();await tick();
 receive({type:'overlay.subtitle',id:'x',revision:1,final:false,original:'Hello QGIS <img>',translation:'<script>bad</script>',uncertainWords:['QGIS']});
 assert.equal(root.querySelector('mark').textContent,'QGIS');assert.equal(root.querySelector('.translation').children.length,0);
 receive({type:'overlay.subtitle',id:'x',revision:2,final:true,original:'Hello QGIS.',translation:'Bonjour QGIS.'});
 assert.equal(root.querySelectorAll('.phrase').length,1);
 receive({type:'overlay.subtitle',id:'x',revision:1,final:false,original:'old',translation:'ancien'});
 assert.equal(root.querySelector('.translation').textContent,'Bonjour QGIS.');
 for(let i=0;i<151;i++) receive({type:'overlay.subtitle',id:`row-${i}`,revision:1,final:true,original:`Source ${i}`,translation:`Texte ${i}`});
 assert.equal(root.querySelectorAll('.phrase').length,150);
 // L’affichage est limité, mais l’export conserve aussi les premières phrases.
 let blob;w.URL.createObjectURL=value=>{blob=value;return 'blob:local'};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){};
 receive({type:'overlay.subtitle',id:'x',revision:1,final:false,original:'obsolete',translation:'ancien'});
 root.querySelector('[data-export=txt]').click();
 const reader=new w.FileReader();const text=new Promise(resolve=>{reader.onload=()=>resolve(reader.result);});reader.readAsText(blob);
 const content=await text;assert.match(content,/Bonjour QGIS/);assert.match(content,/Source 0/);assert.match(content,/Texte 150/);assert.doesNotMatch(content,/obsolete/);
 dom.window.close();
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
 assert.deepEqual(JSON.parse(JSON.stringify(receive({type:'overlay.ping'}))),{ok:true,version:'1.10.0'});
 receive({type:'overlay.subtitle',id:'x',revision:1,final:true,original:'Hello',translation:'Bonjour'});
 root.querySelector('[data-close]').click();const host=dom.window.document.getElementById('polyglot-live-subtitles');assert.equal(host.style.display,'none');
 assert.equal(receive({type:'overlay.reveal',active:true}).ok,true);assert.equal(host.style.display,'block');assert.equal(root.querySelectorAll('.phrase').length,1);
 assert.equal(root.querySelector('.translation').textContent,'Bonjour');
 receive({type:'overlay.reveal',active:false});assert.equal(root.querySelector('[data-stop]').disabled,true);assert.equal(root.querySelector('[data-status]').textContent,'Prêt à traduire');
 // Une seconde injection ne crée pas un deuxième écouteur ou un panneau supplémentaire.
 dom.window.eval(compiled);assert.equal(receive({type:'overlay.ping'}).ok,true);assert.equal(dom.window.document.querySelectorAll('#polyglot-live-subtitles').length,1);
 dom.window.close();
});

test('document complet : finalisation, retouches TXT, SRT par phrase et nouvelle session',async()=>{
 const {dom,w,receive,root}=setup();await tick();
 let blob,download;
 w.URL.createObjectURL=value=>{blob=value;return 'blob:local'};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){download=this.download;};
 const read=()=>new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(blob);});
 receive({type:'overlay.subtitle',id:'a',revision:1,final:true,original:'A map',translation:'Une carte',start:0,end:2,sourceLanguage:'en',targetLanguage:'fr'});
 root.querySelector('.phrase .tools button').click();
 root.querySelectorAll('.editor textarea')[1].value='Une carte corrigée.';
 root.querySelector('.editor button').click();await tick();
 receive({type:'overlay.subtitle',id:'b',revision:1,final:false,original:'Last words',translation:'Derniers mots',start:2,end:4});
 root.querySelector('[data-document]').click();
 const original=root.querySelector('#document-original'),translation=root.querySelector('#document-translation');
 assert.equal(translation.readOnly,true);assert.equal(translation.value,'Une carte corrigée.');
 receive({type:'overlay.stopped'});assert.equal(translation.readOnly,false);assert.match(translation.value,/Derniers mots/);
 original.value='Texte original relu.';original.dispatchEvent(new w.Event('input'));
 translation.value='Une traduction complète relue. <img>';translation.dispatchEvent(new w.Event('input'));
 root.querySelector('[data-document-close]').click();root.querySelector('[data-document]').click();assert.equal(translation.value,'Une traduction complète relue. <img>');
 root.querySelector('#document-format').value='bilingual';root.querySelector('[data-document-export]').click();
 assert.match(download,/bilingual.*\.txt$/);const complete=await read();assert.match(complete,/Texte original relu/);assert.match(complete,/traduction complète relue/);
 root.querySelector('#document-format').value='srt';root.querySelector('[data-document-export]').click();
 const srt=await read();assert.match(srt,/Une carte corrigée/);assert.match(srt,/Derniers mots/);assert.doesNotMatch(srt,/complète relue/);
 receive({type:'overlay.show',text:'Connexion au moteur local…'});assert.equal(translation.value,'');assert.equal(original.value,'');assert.equal(translation.readOnly,true);
 root.querySelector('[data-document-export]').click();assert.match(root.querySelector('[data-document-note]').textContent,/Aucune phrase/);
 dom.window.close();
});

test('résumé et quiz réels : texte relu, vérification, export et invalidation après modification',async()=>{
 const {dom,w,receive,root}=setup();await tick();
 let blob,download;
 w.URL.createObjectURL=value=>{blob=value;return 'blob:local'};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){download=this.download;};
 receive({type:'overlay.subtitle',id:'a',revision:1,final:true,original:'A map of the world.',translation:'Une carte du monde.'});
 root.querySelector('[data-document]').click();root.querySelector('[data-study=quiz]').click();assert.match(root.querySelector('[data-document-note]').textContent,/Arrêtez/);
 assert.equal(root.querySelector('.study-result').children.length,0);
 receive({type:'overlay.stopped'});
 const input=root.querySelector('#document-translation');
 input.value='QGIS permet de visualiser les données géographiques. Les satellites observent les changements du territoire. <img onerror=alert(1)>';input.dispatchEvent(new w.Event('input'));
 root.querySelector('[data-study=summary]').click();assert.ok(root.querySelectorAll('.study-result li').length);assert.match(root.querySelector('.study-result').textContent,/QGIS|satellites/);assert.equal(root.querySelector('.study-result img'),null);
 root.querySelector('[data-study=quiz]').click();const question=root.querySelector('.study-result article');assert.ok(question);
 const answer=question.querySelector('details > p').textContent.split('\n')[0].replace('Réponse : ','');
 question.querySelector('input').value='incorrect';question.querySelector('button').click();assert.match(question.querySelector('[role=status]').textContent,/À revoir/);
 question.querySelector('input').value=answer.toUpperCase();question.querySelector('button').click();assert.equal(question.querySelector('[role=status]').textContent,'Bonne réponse.');
 root.querySelector('[data-study-export]').click();assert.match(download,/fiche-revision.*\.txt$/);
 const reader=new w.FileReader();const text=new Promise(resolve=>{reader.onload=()=>resolve(reader.result);});reader.readAsText(blob);const exported=await text;assert.match(exported,/CORRIGÉ ET EXTRAITS/);assert.ok(exported.includes(answer));
 input.value='Texte corrigé.';input.dispatchEvent(new w.Event('input'));assert.equal(root.querySelector('.study-result').children.length,0);assert.equal(root.querySelector('[data-study-export]').hidden,true);
 dom.window.close();
});

test('rafraîchissement incrémental : conserver les lignes et la correction ouverte',async()=>{
 const {dom,receive,root}=setup();await tick();
 receive({type:'overlay.subtitle',id:'a',final:true,original:'A map',translation:'Une carte',uncertainWords:['map']});
 const first=root.querySelector('.phrase');assert.equal(first.querySelector('.state-label').textContent,'Finalisée · à relire');
 first.querySelector('.tools button').click();const editor=first.querySelector('.editor');editor.querySelector('textarea').value='Brouillon conservé';
 receive({type:'overlay.subtitle',id:'b',revision:1,final:false,original:'Next',translation:'Suite'});
 assert.equal(root.querySelector('.phrase'),first);assert.equal(first.querySelector('.editor'),editor);assert.equal(editor.querySelector('textarea').value,'Brouillon conservé');
 receive({type:'overlay.subtitle',id:'b',revision:2,final:true,original:'Next sentence',translation:'Phrase suivante'});
 assert.equal(root.querySelector('.phrase'),first);assert.equal(root.querySelectorAll('.phrase').length,2);dom.window.close();
});

test('lignes précédentes : relecture stable, nouvelles phrases et retour au direct',async()=>{
 const {dom,w,receive,root}=setup();await tick();
 const log=root.querySelector('.transcript');
 Object.defineProperties(log,{scrollHeight:{get:()=>3000},clientHeight:{get:()=>300}});
 for(let i=0;i<3;i++)receive({type:'overlay.subtitle',id:`h${i}`,final:true,original:`Source ${i}`,translation:`Ligne ${i}`});
 assert.equal(log.scrollTop,3000);
 root.querySelector('[data-history-previous]').click();assert.equal(log.scrollTop,2760);
 const position=log.scrollTop;
 receive({type:'overlay.subtitle',id:'h3',final:true,original:'Next',translation:'Nouvelle ligne'});
 assert.equal(log.scrollTop,position);assert.equal(root.querySelectorAll('.phrase').length,3);
 assert.match(root.querySelector('[data-history-live]').textContent,/\+1/);
 assert.match(root.querySelector('[data-document-count]').textContent,/4 phrase/);
 root.querySelector('[data-history-live]').click();assert.equal(log.scrollTop,3000);
 assert.equal(root.querySelectorAll('.phrase').length,4);assert.equal(root.querySelector('[data-history-live]').disabled,true);
 log.scrollTop=1800;log.dispatchEvent(new w.Event('scroll'));
 receive({type:'overlay.subtitle',id:'h4',final:true,original:'More',translation:'Encore'});
 assert.equal(log.scrollTop,1800);assert.match(root.querySelector('[data-history-status]').textContent,/Relecture/);
 receive({type:'overlay.show',text:'Connexion au moteur local…'});
 assert.equal(root.querySelector('[data-history-live]').disabled,true);assert.equal(root.querySelectorAll('.phrase').length,0);dom.window.close();
});

test('historique ancien : pages bornées et accès aux premières phrases',async()=>{
 const {dom,receive,root}=setup();await tick();
 for(let i=0;i<260;i++)receive({type:'overlay.subtitle',id:`p${i}`,final:true,original:`S${i}`,translation:`T${i}`});
 const log=root.querySelector('.transcript');log.scrollTop=0;
 root.querySelector('[data-history-previous]').click();
 assert.equal(root.querySelectorAll('.phrase').length,150);assert.equal(root.querySelector('.translation').textContent,'T10');
 root.querySelector('[data-history-previous]').click();assert.equal(root.querySelector('.translation').textContent,'T0');
 receive({type:'overlay.subtitle',id:'p260',final:true,original:'S260',translation:'T260'});
 assert.equal(root.querySelector('.translation').textContent,'T0');assert.match(root.querySelector('[data-history-live]').textContent,/\+111/);
 root.querySelector('[data-history-live]').click();assert.equal(root.querySelector('.translation').textContent,'T111');
 assert.equal([...root.querySelectorAll('.translation')].at(-1).textContent,'T260');dom.window.close();
});
