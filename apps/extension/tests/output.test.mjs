import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverTranslation, outputMode, stopSpeech } from '../src/output.ts';

let messages, spoken;
function reset() {
  messages = []; spoken = [];
  globalThis.chrome = {
    tabs: { sendMessage: async (tab, message) => { messages.push({ tab, ...message }); } },
    runtime: {},
    tts: { stop: () => {}, getVoices: callback => callback([{voiceName:'Français local',lang:'fr',remote:false},{voiceName:'Espagnol local',lang:'es',remote:false}]), speak: (text, options, callback) => { spoken.push({ text, options }); callback(); options.onEvent({type:"end"}); } }
  };
  stopSpeech();
}

test('les anciens réglages et les valeurs inconnues restent en sous-titres', () => {
  assert.equal(outputMode(undefined), 'subtitles');
  assert.equal(outputMode('invalide'), 'subtitles');
});

test('sous-titres : afficher les deux textes sans lire de voix', () => {
  reset(); deliverTranslation(7, 'subtitles', 'fr', 'Hello', 'Bonjour');
  assert.deepEqual(messages, [{ tab: 7, type: 'overlay.subtitle', original: 'Hello', translation: 'Bonjour' }]);
  assert.equal(spoken.length, 0);
});

test('voix : masquer les sous-titres et lire la traduction dans la langue cible', () => {
  reset(); deliverTranslation(7, 'voice', 'fr', 'Hello', 'Bonjour');
  assert.equal(messages[0].type, 'overlay.hide');
  assert.equal(spoken[0].text, 'Bonjour');
  assert.equal(spoken[0].options.lang, 'fr');
  assert.equal(spoken[0].options.enqueue, true);
});

test('les deux : afficher et lire la traduction', () => {
  reset(); deliverTranslation(7, 'both', 'es', 'Hello', 'Hola');
  assert.equal(messages[0].type, 'overlay.subtitle');
  assert.equal(spoken[0].text, 'Hola');
  assert.equal(spoken[0].options.lang, 'es');
});

test('ne pas lire une traduction vide', () => {
  reset(); deliverTranslation(7, 'voice', 'fr', '', '  ');
  assert.equal(spoken.length, 0);
});

test('mettre à jour les sous-titres provisoires sans lancer la voix', () => {
  reset();
  deliverTranslation(7, 'both', 'fr', 'The see', 'La mer', { id: 'phrase-1', revision: 1, final: false });
  deliverTranslation(7, 'both', 'fr', 'The sea coast', 'Le littoral', { id: 'phrase-1', revision: 2, final: false });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, messages[1].id);
  assert.equal(messages[1].revision, 2);
  assert.equal(spoken.length, 0);
  deliverTranslation(7, 'both', 'fr', 'The sea coast.', 'Le littoral.', { id: 'phrase-1', revision: 3, final: true });
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, 'Le littoral.');
});

test('la finalisation à l’arrêt conserve le texte sans redémarrer la voix', () => {
  reset();
  deliverTranslation(7, 'both', 'fr', 'Final text', 'Texte final', { id: 'phrase-1', revision: 4, final: true }, false);
  assert.equal(messages[0].translation, 'Texte final');
  assert.equal(spoken.length, 0);
});

test('une erreur de synthèse vocale explique comment continuer', () => {
  reset(); deliverTranslation(7, 'voice', 'fr', 'Hello', 'Bonjour');
  spoken[0].options.onEvent({ type: 'error', errorMessage: 'Aucune voix française' });
  assert.equal(messages[1].type, 'overlay.show');
  assert.match(messages[1].text, /Aucune voix française/);
  assert.match(messages[1].text, /Sous-titres/);
});

test('une erreur immédiate de Chrome est affichée', () => {
  reset(); chrome.runtime.lastError = { message: 'Synthèse impossible' };
  deliverTranslation(7, 'voice', 'fr', 'Hello', 'Bonjour');
  assert.match(messages[1].text, /Synthèse impossible/);
});


test('refuser une voix distante : aucun service vocal payant', () => {
  reset(); chrome.tts.getVoices = callback => callback([{voiceName:'Cloud',lang:'fr',remote:true}]);
  deliverTranslation(7, 'voice', 'fr', 'Hello', 'Bonjour');
  assert.equal(spoken.length,0);
  assert.match(messages[1].text,/aucune voix locale/);
});

test('ne pas commencer une voix en attente après un arrêt', () => {
  reset(); let reply;
  chrome.tts.getVoices = callback => { reply = callback; };
  deliverTranslation(7, 'voice', 'fr', 'Hello', 'Bonjour');
  stopSpeech(); reply([{voiceName:'Français local',lang:'fr',remote:false}]);
  assert.equal(spoken.length,0);
});

test('file de voix bornée, lecture successive et arrêt de toutes les phrases', () => {
  reset(); const events=[];
  chrome.tts.speak=(text,options,callback)=>{spoken.push({text,options});events.push(options.onEvent);callback();};
  for(let i=0;i<8;i++) deliverTranslation(7,'both','fr','source',`phrase ${i}`,{id:`q-${i}`,final:true});
  assert.equal(spoken.length,1);
  assert.ok(messages.some(m=>/retard/.test(m.text??'')));
  events[0]({type:'end'});assert.equal(spoken.length,2);
  stopSpeech();events[1]({type:'end'});assert.equal(spoken.length,2);
});

test('une phrase finalisée déjà lue ne lance pas une deuxième voix', () => {
  reset();
  deliverTranslation(7,'both','fr','source','Bonjour',{id:'duplicate',final:true});
  deliverTranslation(7,'both','fr','source','Bonjour',{id:'duplicate',final:true});
  assert.equal(spoken.length,1);
});

test('Piper absent : repli système une fois puis aucun nouvel appel Piper', async () => {
  reset();let attempts=0;
  chrome.runtime.sendMessage=async()=>{attempts++;return{ok:false,error:'Voix non installée'};};
  deliverTranslation(7,'both','fr','Hello','Bonjour',undefined,true,{engine:'auto',rate:1.15});
  await Promise.resolve(); await Promise.resolve();
  assert.equal(spoken[0].options.rate,1.15);
  assert.ok(messages.some(m=>/Piper indisponible/.test(m.text??'')));
  deliverTranslation(7,'both','fr','Bye','Au revoir',undefined,true,{engine:'auto'});
  assert.equal(attempts,1);assert.equal(spoken.length,2);
  stopSpeech();
});

test('un retour Piper arrivé après l’arrêt ne commence pas la voix système', async () => {
  reset();let reply;
  chrome.runtime.sendMessage=()=>new Promise(resolve=>{reply=resolve;});
  deliverTranslation(7,'voice','fr','Hello','Bonjour',undefined,true,{engine:'piper'});
  const pending=reply;stopSpeech();pending({ok:false,error:'Trop lent'});
  await Promise.resolve();await Promise.resolve();
  assert.equal(spoken.length,0);
});
