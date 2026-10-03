import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverTranslation, outputMode, stopSpeech } from '../src/output.ts';

let messages, spoken;
function reset() {
  messages = []; spoken = [];
  globalThis.chrome = {
    tabs: { sendMessage: async (tab, message) => { messages.push({ tab, ...message }); } },
    runtime: {},
    tts: { stop: () => {}, getVoices: callback => callback([{voiceName:'Français local',lang:'fr',remote:false},{voiceName:'Espagnol local',lang:'es',remote:false}]), speak: (text, options, callback) => { spoken.push({ text, options }); callback(); } }
  };
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
