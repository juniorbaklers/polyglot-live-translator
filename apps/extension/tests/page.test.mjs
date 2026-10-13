import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const compiled=readFileSync(new URL('../dist/page.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<100;i++) await Promise.resolve();};
function setup(html, translate=async text=>'Traduit '+text){
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.org'}),w=dom.window,messages=[];let listener;
 w.chrome={runtime:{onMessage:{addListener:fn=>listener=fn},sendMessage:async message=>{messages.push(message);if(message.type==='page.chunk')return{ok:true,translation:await translate(message.text)};return{ok:true};}}};
 w.eval(compiled);
 return{dom,w,messages,receive:type=>listener({type},{},()=>{})};
}
test('traduction réelle du DOM conserve liens, champs, code et restaure les originaux',async()=>{
 const {dom,w,messages,receive}=setup('<html lang="en"><body><p>Hello <a href="/guide">world</a>.</p><input value="Private"><textarea>Private</textarea><code>source()</code><div hidden>Secret</div><div style="display:none"><p>Hidden</p></div><p translate="no">Excluded</p></body></html>');
 const anchor=w.document.querySelector('a');let clicks=0;anchor.onclick=()=>clicks++;
 receive('page.translate');await tick();
 assert.deepEqual(messages.filter(x=>x.type==='page.chunk').map(x=>x.text),['Hello','world']);
 assert.equal(anchor.textContent,'Traduit world');assert.equal(anchor.getAttribute('href'),'/guide');anchor.click();assert.equal(clicks,1);
 assert.equal(w.document.querySelector('textarea').value,'Private');assert.equal(w.document.querySelector('code').textContent,'source()');
 receive('page.restore');await tick();assert.equal(w.document.querySelector('p').textContent,'Hello world.');assert.equal(w.document.querySelector('a'),anchor);dom.window.close();
});
test('réponse de traduction traitée comme texte et changements du site préservés',async()=>{
 const {dom,w,receive}=setup('<body><p>Hello.</p></body>',async()=>'<img src=x onerror=alert(1)>');
 receive('page.translate');await tick();assert.equal(w.document.querySelectorAll('img').length,0);
 w.document.querySelector('p').firstChild.data='Updated by site';receive('page.restore');await tick();assert.equal(w.document.querySelector('p').textContent,'Updated by site');dom.window.close();
});
test('arrêter pendant un calcul empêche la réponse tardive de modifier la page',async()=>{
 let release;const {dom,w,receive}=setup('<body><p>Hello.</p></body>',()=>new Promise(resolve=>release=resolve));
 receive('page.translate');await tick();receive('page.restore');release('Bonjour.');await tick();assert.equal(w.document.querySelector('p').textContent,'Hello.');dom.window.close();
});
test('les nouveaux contenus peuvent être traduits sans retraduire ceux déjà traités',async()=>{
 const {dom,w,messages,receive}=setup('<body><p>Hello.</p></body>');receive('page.translate');await tick();
 const p=w.document.createElement('p');p.textContent='New text.';w.document.body.append(p);receive('page.translate');await tick();
 assert.deepEqual(messages.filter(x=>x.type==='page.chunk').map(x=>x.text),['Hello.','New text.']);receive('page.restore');await tick();dom.window.close();
});
