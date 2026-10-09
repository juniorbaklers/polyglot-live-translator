import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
let instance=0;
async function setup(settings={}) {
 const html=readFileSync(new URL('../dist/popup.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.example'});
 globalThis.document=dom.window.document;
 globalThis.MutationObserver=dom.window.MutationObserver;
 globalThis.fetch=async()=>({});
 const local={...settings},session={},sent=[];
 globalThis.chrome={storage:{local:{get:async()=>({...local}),set:async values=>Object.assign(local,values)},session:{get:async()=>({...session})},onChanged:{addListener(){}}},tabs:{query:async()=>[{id:7}]},runtime:{sendMessage:async message=>{sent.push(message);return{ok:true,active:false};}}};
 await import(`../dist/popup.js?test=${++instance}`);await tick();
 return{dom,local,session,sent,document:dom.window.document};
}
async function tick(){for(let i=0;i<30;i++)await Promise.resolve();}
test('commandes essentielles et démarrage direct sans code',async()=>{
 const {dom,document,local,sent}=await setup();
 assert.equal(document.querySelector('#advanced').open,false);
 assert.ok(document.querySelector('#capture').compareDocumentPosition(document.querySelector('#advanced')) & 4);
 assert.equal(document.querySelector('#code'), null);assert.equal(document.querySelector('#pair'), null);document.querySelector('#source').value='en';
 document.querySelector('#capture').click();await tick();
assert.equal(local.sourceLanguage,'en');
 assert.equal(sent.at(-1).type,'capture.start');assert.equal(document.querySelector('#capture').textContent,'Arrêter la traduction');dom.window.close();
});
test('ancien code enregistré ignoré ; affichage indépendant du moteur',async()=>{
 const {dom,document,sent}=await setup({pairingCode:'ancien'});
 document.querySelector('#capture').click();await tick();assert.equal(sent.at(-1).type,'capture.start');
 document.querySelector('#reveal').click();await tick();assert.equal(sent.at(-1).type,'overlay.reveal');dom.window.close();
});

test('chinois simplifié : choix source/cible, restauration et persistance',async()=>{
 const {dom,document,local}=await setup({sourceLanguage:'zh',targetLanguage:'fr'});
 assert.equal(document.querySelector('#source').value,'zh');
 assert.equal(document.querySelector('#target option[value="zh"]').textContent,'Chinois simplifié');
 document.querySelector('#source').value='en';document.querySelector('#target').value='zh';
 document.querySelector('#capture').click();await tick();
 assert.equal(local.sourceLanguage,'en');assert.equal(local.targetLanguage,'zh');
 dom.window.close();
});

test('glossaire extensible : ajout allemand vers portugais et persistance des experts',async()=>{
 const {dom,document,local}=await setup();
 document.querySelector('#term-source').value='de';document.querySelector('#term-target').value='pt-br';
 document.querySelector('#term-original').value='Neuron';document.querySelector('#term-translation').value='neurônio';
 document.querySelector('#add-term').click();
 document.querySelector('#translation-engine').value='ollama';document.querySelector('#expert').value='technical';
 document.querySelector('#voice-engine').value='auto';document.querySelector('#voice-rate').value='1.15';
 document.querySelector('#save-preferences').click();await tick();
 assert.equal(local.terminology.entries[0].target,'pt-br');assert.equal(local.terminology.entries[0].translation,'neurônio');
 assert.equal(local.expert,'technical');assert.equal(local.voiceRate,1.15);assert.equal(local.translationEngine,'ollama');
 dom.window.close();
});

test('les termes IA couvrent douze directions sans écraser les termes personnels',async()=>{
 const {dom,document,local}=await setup({terminology:{version:1,entries:[{source:'en',target:'fr',term:'deep learning',translation:'Mon terme',domain:'*'}]}});
 document.querySelector('#builtin-terms').click();document.querySelector('#builtin-terms').click();
 document.querySelector('#save-preferences').click();await tick();
 assert.equal(local.terminology.entries.length,72);
 assert.equal(local.terminology.entries.find(t=>t.source==='en'&&t.target==='fr'&&t.term==='deep learning').translation,'Mon terme');
 assert.equal(new Set(local.terminology.entries.map(t=>`${t.source}-${t.target}`)).size,12);
 dom.window.close();
});

test('glossaire malformé bloque le démarrage sans perdre les réglages existants',async()=>{
 const {dom,document,sent}=await setup();
 document.querySelector('#terminology').value='{invalid';document.querySelector('#capture').click();await tick();
 assert.equal(sent.some(m=>m.type==='capture.start'),false);assert.ok(document.querySelector('#state').classList.contains('error'));
 dom.window.close();
});
