// Outils extractifs locaux : les phrases et les réponses viennent du texte fourni.
export interface StudyQuestion { prompt: string; answer: string; source: string; }
export interface StudyAid { summary: string[]; questions: StudyQuestion[]; }
const ignored = new Set((
  'the this that these those with from into onto about there their they them then than when where which what who whom whose have has had does doing done will would could should shall must been being are was were you your yours our ours and but for not only also some any each all can ' +
  'le la les un une des du de dans sur sous pour par avec sans ce cet cette ces cela ceci est sont était être avoir avons vous nous ils elles leur leurs aux ses son sa mes tes vos nos que qui quoi quand comme donc alors mais plus moins très bien ainsi aussi tout tous toute toutes fait faire peut peux cette entre chaque autre mêmes même dont depuis après avant ' +
  'el la los las un una unos unas del en de con sin por para sobre este esta estos estas ese esa esos esas que quien cuando donde como pero porque más menos muy también todo todos toda todas sus su nos vosotros nosotros ellas ellos son está están ser estar haber tiene tienen puede hacer'
).split(/\s+/));
const tokenize = (text: string) => {
  if (/\p{Script=Han}/u.test(text)) {
    const segmenter = new Intl.Segmenter('zh', {granularity:'word'});
    return Array.from(segmenter.segment(text)).filter(part => part.isWordLike)
      .map(part => ({word:part.segment, index:part.index, key:part.segment.toLocaleLowerCase()}));
  }
  return Array.from(text.matchAll(/\p{L}[\p{L}\p{N}’'-]*/gu), m => ({word:m[0], index:m.index!, key:m[0].toLocaleLowerCase()}));
};
export const normalizeAnswer = (text: string) => text.trim().toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[.!?。！？]+$/,'');
export function generateStudyAid(text: string): StudyAid {
  const segmenter = new Intl.Segmenter(undefined, {granularity:'sentence'});
  const seen = new Set<string>();
  const sentences = Array.from(segmenter.segment(text), part => part.segment.trim()).filter(sentence => {
    const key = sentence.toLocaleLowerCase().replace(/\s+/g,' ');
    if (!sentence || seen.has(key) || sentence === '[Traduction indisponible]') return false;
    seen.add(key); return true;
  });
  const terms = sentences.map(sentence => tokenize(sentence).filter(t => t.word.length >= (/\p{Script=Han}/u.test(t.word) ? 2 : 4) && !ignored.has(t.key)));
  const frequency = new Map<string,number>();
  const documents = new Map<string,number>();
  for (const tokens of terms) {
    for (const token of tokens) frequency.set(token.key, (frequency.get(token.key) ?? 0) + 1);
    for (const key of new Set(tokens.map(t => t.key))) documents.set(key,(documents.get(key) ?? 0) + 1);
  }
  const weight = (key: string) => (1 + Math.log(frequency.get(key) ?? 1)) * (1 + Math.log((sentences.length + 1) / ((documents.get(key) ?? 0) + 1)));
  const ranked = sentences.map((sentence,index) => ({sentence,index,score:Array.from(new Set(terms[index].map(t => t.key))).reduce((sum,key)=>sum+weight(key),0)/Math.sqrt(Math.max(1,tokenize(sentence).length))})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const count = Math.min(6,Math.max(1,Math.ceil(sentences.length * .3)));
  const selected = ranked.slice(0,count).sort((a,b)=>a.index-b.index);
  const used = new Set<string>();
  const questions: StudyQuestion[] = [];
  for (const item of ranked) {
    if (tokenize(item.sentence).length < 5 || item.sentence.length > 600) continue;
    const candidates = terms[item.index].filter(t=>!used.has(t.key)).sort((a,b)=>weight(b.key)-weight(a.key)||a.index-b.index);
    const token = candidates[0]; if (!token) continue;
    // Ne masquer qu'une occurrence : les nombres, négations et mots-outils restent visibles.
    used.add(token.key);
    questions.push({prompt:item.sentence.slice(0,token.index)+'____'+item.sentence.slice(token.index+token.word.length),answer:token.word,source:item.sentence});
    if (questions.length >= 5) break;
  }
  return {summary:selected.map(item=>item.sentence),questions};
}
