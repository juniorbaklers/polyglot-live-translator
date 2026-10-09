import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const compiled = readFileSync(new URL('../dist/content.js', import.meta.url),'utf8');
function setup(html='<body></body>', settings={}) {
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://video.example'}); const w=dom.window;
 let listener;const messages=[];let saved;
 w.chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{messages.push(message);return {ok:true};}},storage:{local:{get:async()=>({...settings}),set:async values=>{saved=values;}}}};
 w.eval(compiled);
 const receive=(message)=>{let response;listener(message,{},value=>{response=value});return response;};
 receive({type:'overlay.show',text:'Connexion au moteur local…'});
 return {dom,w,messages,receive,saved:()=>saved,root:w.document.getElementById('polyglot-live-subtitles').shadowRoot};
}
const tick=async()=>{for(let i=0;i<20;i++) await Promise.resolve();};
test('révisions, texte sécurisé et repères d’incertitude dans l’interface livrée',async()=>{
 const {dom,w,receive,root}=setup('<body></body>',{overlayReadingMode:'progressive'});await tick();
 receive({type:'overlay.subtitle',id:'x',revision:1,final:false,original:'Hello QGIS <img>',translation:'<script>bad</script>',uncertainWords:['QGIS']});
 assert.equal(root.querySelector('.state-label').textContent,'Provisoire');
 assert.equal(root.querySelector('mark').textContent,'QGIS');assert.equal(root.querySelector('.translation').children.length,0);
 receive({type:'overlay.subtitle',id:'x',revision:2,final:true,original:'Hello QGIS.',translation:'Bonjour QGIS.'});
 assert.equal(root.querySelectorAll('.phrase').length,1);
 assert.equal(root.querySelector('.state-label').textContent,'Finalisée');
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
 assert.deepEqual(JSON.parse(JSON.stringify(receive({type:'overlay.ping'}))),{ok:true,version:'1.19.0'});
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

test('taille de fenêtre : réduire, agrandir et mémoriser sans changer le texte',async()=>{
 const {dom,w,root,saved}=setup();await tick();
 const host=w.document.getElementById('polyglot-live-subtitles');
 const width=parseFloat(host.style.width),height=parseFloat(host.style.height),font=host.style.getPropertyValue('--text-size');
 root.querySelector('[data-size=smaller]').click();await tick();
 assert.ok(parseFloat(host.style.width)<width);assert.ok(parseFloat(host.style.height)<height);
 assert.equal(saved().overlayDimensions.width,parseFloat(host.style.width));
 const smaller=parseFloat(host.style.width);root.querySelector('[data-size=larger]').click();await tick();
 assert.ok(parseFloat(host.style.width)>smaller);assert.equal(host.style.getPropertyValue('--text-size'),font);
 dom.window.close();
});

test('taille enregistrée : restauration, limites et écran réduit',async()=>{
 const {dom,w,root}=setup('<body></body>',{overlayDimensions:{width:900,height:600}});await tick();
 const host=w.document.getElementById('polyglot-live-subtitles');assert.equal(host.style.width,'900px');assert.equal(host.style.height,'600px');
 host.style.left='900px';host.style.top='650px';host.style.right='auto';host.style.bottom='auto';
 for(let i=0;i<15;i++)root.querySelector('[data-size=larger]').click();
 assert.ok(parseFloat(host.style.width)<=w.innerWidth-16);assert.ok(parseFloat(host.style.left)+parseFloat(host.style.width)<=w.innerWidth-8);
 assert.equal(root.querySelector('[data-size=larger]').disabled,true);
 Object.defineProperties(w,{innerWidth:{value:300,configurable:true},innerHeight:{value:260,configurable:true}});w.dispatchEvent(new w.Event('resize'));
 assert.equal(host.style.width,'284px');assert.equal(host.style.height,'244px');
 assert.equal(host.style.left,'8px');assert.equal(host.style.top,'8px');dom.window.close();
});

test('piste chinoise zh-Hans : détection automatique et affichage Unicode',async()=>{
 const {dom,w,receive,messages,root}=setup('<body><video></video></body>');await tick();
 const video=w.document.querySelector('video');
 const track=new w.EventTarget();Object.assign(track,{kind:'subtitles',mode:'showing',language:'zh-Hans',activeCues:[{text:'你好，欢迎。',startTime:0,endTime:2}]});
 Object.defineProperty(video,'textTracks',{value:[track]});Object.defineProperty(video,'paused',{value:false});
 assert.equal(receive({type:'captions.start',sourceLanguage:'auto'}).ok,true);await tick();
 const cue=messages.find(m=>m.type==='caption.cue');assert.equal(cue.cue.language,'zh');assert.equal(cue.cue.text,'你好，欢迎。');
 receive({type:'overlay.subtitle',id:'zh',revision:1,final:true,original:'Hello.',translation:'你好。',sourceLanguage:'en',targetLanguage:'zh'});
 assert.equal(root.querySelector('.translation').textContent,'你好。');assert.match(root.querySelector('.phrase-head').textContent,/Chinois simplifié/);
 receive({type:'captions.stop'});dom.window.close();
});

test('lecture finale par défaut : masquer les brouillons, publier une fois, garder la relecture stable', async()=>{
 const {dom,w,receive,root}=setup();await tick();
 assert.equal(root.querySelector('#reading-mode').value,'final');
 receive({type:'overlay.subtitle',id:'a',revision:1,final:false,original:'A',translation:'Un'});
 receive({type:'overlay.subtitle',id:'a',revision:2,final:false,original:'A map',translation:'Une carte'});
 assert.equal(root.querySelectorAll('.phrase').length,0);
 assert.match(root.querySelector('.empty').textContent,/finalisée/);
 receive({type:'overlay.subtitle',id:'a',revision:3,final:true,original:'A map.',translation:'Une carte.'});
 const row=root.querySelector('.phrase');assert.equal(row.querySelector('.translation').textContent,'Une carte.');
 const log=root.querySelector('.transcript');Object.defineProperties(log,{scrollHeight:{get:()=>2000},clientHeight:{get:()=>300}});
 root.querySelector('[data-history-previous]').onclick();const scroll=log.scrollTop;
 receive({type:'overlay.subtitle',id:'b',revision:1,final:false,original:'Next',translation:'Suite'});
 assert.equal(root.querySelector('.phrase'),row);assert.equal(log.scrollTop,scroll);
 assert.doesNotMatch(root.querySelector('[data-history-live]').textContent,/\+/);
 receive({type:'overlay.subtitle',id:'b',revision:2,final:true,original:'Next sentence.',translation:'Phrase suivante.'});
 assert.match(root.querySelector('[data-history-live]').textContent,/\+1/);
 assert.equal(root.querySelectorAll('.phrase').length,1);
 root.querySelector('[data-history-live]').click();assert.equal(root.querySelectorAll('.phrase').length,2);
 receive({type:'overlay.subtitle',id:'b',revision:3,final:false,original:'Stale',translation:'Ancien'});
 assert.equal([...root.querySelectorAll('.translation')].at(-1).textContent,'Phrase suivante.');dom.window.close();
});

test('choix de lecture immédiat et mémorisé : retirer les brouillons et conserver un extrait interrompu signalé',async()=>{
 const {dom,w,receive,root,saved}=setup();await tick();
 receive({type:'overlay.subtitle',id:'a',revision:1,final:false,original:'Still speaking',translation:'En cours'});
 const mode=root.querySelector('#reading-mode');mode.value='progressive';mode.dispatchEvent(new w.Event('change'));await tick();
 assert.equal(saved().overlayReadingMode,'progressive');assert.equal(root.querySelector('.state-label').textContent,'Provisoire');
 mode.value='final';mode.dispatchEvent(new w.Event('change'));await tick();
 assert.equal(saved().overlayReadingMode,'final');assert.equal(root.querySelectorAll('.phrase').length,0);
 receive({type:'overlay.stopped'});
 assert.equal(root.querySelector('.state-label').textContent,'Finalisée · à relire');
 assert.match(root.querySelector('.phrase').textContent,/Fin de phrase non confirmée/);
 assert.equal(root.querySelector('.translation').textContent,'En cours');dom.window.close();
});

test('coin de redimensionnement : taille compacte, limites et choix mémorisé',async()=>{
 const {dom,w,root,saved}=setup();await tick();
 const host=w.document.getElementById('polyglot-live-subtitles');const grip=root.querySelector('.resize-grip');
 grip.setPointerCapture=()=>{};
 const send=(type,x,y,id=7)=>{const e=new w.MouseEvent(type,{clientX:x,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:id});grip.dispatchEvent(e);};
 send('pointerdown',760,480);send('pointermove',360,260);
 assert.equal(host.style.width,'360px');assert.equal(host.style.height,'260px');assert.equal(host.hasAttribute('data-compact'),true);
 send('pointerup',360,260);await tick();assert.deepEqual(JSON.parse(JSON.stringify(saved().overlayDimensions)),{width:360,height:260});
 send('pointermove',500,500);assert.equal(host.style.width,'360px');
 send('pointerdown',360,260);send('pointermove',-500,-500);send('pointercancel',-500,-500);await tick();
 assert.equal(host.style.width,'320px');assert.equal(host.style.height,'240px');assert.equal(saved().overlayDimensions.height,240);
 dom.window.close();
});

test('petite fenêtre : remonter à la molette garde la relecture malgré les nouveaux passages',async()=>{
 const {dom,w,receive,root}=setup('<body></body>',{overlayDimensions:{width:360,height:260}});await tick();
 for(let i=0;i<4;i++) receive({type:'overlay.subtitle',id:`compact-${i}`,revision:1,final:true,original:`Source ${i}`,translation:`Texte ${i}`});
 const log=root.querySelector('.transcript');log.scrollTop=25;
 log.dispatchEvent(new w.WheelEvent('wheel',{deltaY:-10}));
 receive({type:'overlay.subtitle',id:'next',revision:1,final:true,original:'Next',translation:'Suivant'});
 assert.equal(log.scrollTop,25);assert.equal(root.querySelectorAll('.phrase').length,4);
 assert.match(root.querySelector('[data-history-live]').textContent,/\(\+1\)/);
 root.querySelector('[data-history-live]').click();assert.equal(root.querySelectorAll('.phrase').length,5);
 assert.equal([...root.querySelectorAll('.translation')].at(-1).textContent,'Suivant');
 dom.window.close();
});

test('fin de vidéo sans ponctuation : finaliser une fois puis permettre la relecture',async()=>{
 const {dom,w,receive,messages}=setup('<body><video></video></body>');await tick();
 const video=w.document.querySelector('video');
 const track=new w.EventTarget();Object.assign(track,{kind:'subtitles',language:'en',mode:'showing',activeCues:[{text:'Last words',startTime:4,endTime:6}]});
 Object.defineProperty(video,'textTracks',{value:[track]});
 Object.defineProperty(video,'paused',{value:false,configurable:true});
 Object.defineProperty(video,'ended',{value:false,writable:true});
 assert.equal(receive({type:'captions.probe',sourceLanguage:'en'}).ok,true);
 assert.equal(receive({type:'captions.probe',sourceLanguage:'fr'}).ok,false);
 assert.equal(messages.filter(m=>m.type==='caption.cue').length,0);
 receive({type:'captions.start',sourceLanguage:'en'});await tick();
 video.currentTime=6;video.ended=true;
 Object.defineProperty(video,'paused',{value:true});
 video.dispatchEvent(new w.Event('ended'));await tick();
 assert.equal(messages.filter(m=>m.type==='caption.flush').length,1);
 assert.equal(messages.find(m=>m.type==='caption.flush').position,6.75);
 video.dispatchEvent(new w.Event('ended'));await tick();
 assert.equal(messages.filter(m=>m.type==='caption.flush').length,1);
 video.ended=false;Object.defineProperty(video,'paused',{value:false});
 video.dispatchEvent(new w.Event('seeking'));track.dispatchEvent(new w.Event('cuechange'));await tick();
 assert.equal(messages.filter(m=>m.type==='caption.cue').length,2);
 receive({type:'captions.stop'});dom.window.close();
});

test('sauvegarder les textes relus à l’arrêt et rouvrir la dernière session',async()=>{
 const archive={version:1,rows:[{id:'saved',final:true,revision:1,original:'A map',translation:'Une carte',start:1,end:2}],documentTranslation:'Texte relu'};
 const {dom,receive,root,saved}=setup('<body></body>',{transcriptArchive:archive});await tick();
 root.querySelector('[data-restore]').click();await tick();
 assert.match(root.querySelector('.notice').textContent,/Arrêtez/);
 receive({type:'overlay.stopped'});
 root.querySelector('[data-restore]').click();await tick();
 assert.equal(root.querySelector('.translation').textContent,'Une carte');
 assert.equal(root.querySelector('#document-translation').value,'Texte relu');
 const field=root.querySelector('#document-translation');field.value='Correction conservée';field.dispatchEvent(new dom.window.Event('input'));await tick();
 assert.equal(saved().transcriptArchive.documentTranslation,'Correction conservée');
 assert.equal(saved().transcriptArchive.rows[0].start,1);
 dom.window.close();
});
