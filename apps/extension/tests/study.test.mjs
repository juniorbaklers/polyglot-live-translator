import test from 'node:test';
import assert from 'node:assert/strict';
import {generateStudyAid,normalizeAnswer} from '../src/study.ts';
test('résumé extractif : phrases du texte complet, sans doublons, dans leur ordre',()=>{
 const sentences=Array.from({length:40},(_,i)=>`La couche cartographique numéro ${i} présente les données géographiques du territoire.`);
 const aid=generateStudyAid(sentences.join(' ')+' '+sentences[0]);
 assert.equal(aid.summary.length,6);
 assert.equal(new Set(aid.summary).size,6);
 const positions=aid.summary.map(s=>sentences.indexOf(s));assert.ok(positions.every(p=>p>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
});
test('quiz : réponse et extrait vérifiables dans la transcription en français, anglais et espagnol',()=>{
 for(const text of ['QGIS permet de visualiser les données géographiques. Les satellites observent les changements du territoire.','Python groups observations by month using a dataframe. Satellite imagery helps identify changes in vegetation.','QGIS permite visualizar los datos geográficos. Los satélites observan cambios en el territorio.']){
  const aid=generateStudyAid(text);assert.ok(aid.questions.length>0);assert.ok(aid.questions.length<=5);
  for(const q of aid.questions){assert.ok(text.includes(q.source));assert.equal(q.prompt.replace('____',q.answer),q.source);assert.ok(q.answer.length>=4);}
 }
 assert.equal(normalizeAnswer(' GÉOGRAPHIQUES! '),normalizeAnswer('géographiques'));
});
test('texte insuffisant : aucune question fictive et aucune sortie pour du texte vide',()=>{
 assert.deepEqual(generateStudyAid(''),{summary:[],questions:[]});
 assert.deepEqual(generateStudyAid('Bonjour.').questions,[]);
 assert.deepEqual(generateStudyAid('[Traduction indisponible]').questions,[]);
});
