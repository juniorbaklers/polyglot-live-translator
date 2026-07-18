// Centre de démonstration académique présenté au jury.
// Les simulations sont signalées afin de ne pas les confondre avec des services commerciaux.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "qrcode";
import "./academic.css";

// Identifiants internes des huit onglets fonctionnels.
type Tab = "audio"|"languages"|"voice"|"share"|"transcripts"|"glossary"|"account"|"admin";
interface Session { id:number; title:string; sourceLanguage:string; targetLanguage:string; segmentCount:number }
interface Glossary { source:string; translation:string; domain:string }

const languages = ["Français","Anglais","Espagnol","Portugais","Allemand","Italien","Arabe","Russe","Chinois","Japonais","Coréen","Turc","Grec","Baoulé (en ligne)","Dioula (en ligne)"];

export function AcademicFeatures() {
  // États locaux qui rendent les différents scénarios de démonstration interactifs.
  const [tab,setTab]=useState<Tab>("audio");
  const [targets,setTargets]=useState(["Français"]);
  const [offline,setOffline]=useState<string[]>([]);
  const [sessions,setSessions]=useState<Session[]>([]);
  const [glossary,setGlossary]=useState<Glossary[]>([]);
  const [search,setSearch]=useState("");
  const [shareCode]=useState(()=>String(Math.floor(100000+Math.random()*900000)));
  const [qr,setQr]=useState("");
  const [message,setMessage]=useState("Simulation académique prête");
  const [fileName,setFileName]=useState("");
  const [newTerm,setNewTerm]=useState({source:"",translation:"",domain:"Géomatique"});
  const [quota,setQuota]=useState(118);

  // Charge l'historique et le glossaire, puis prépare le QR code de partage local.
  useEffect(()=>{invoke<Session[]>("list_sessions").then(setSessions).catch(()=>undefined);invoke<Glossary[]>("list_glossary").then(setGlossary).catch(()=>undefined)},[]);
  useEffect(()=>{QRCode.toDataURL(`http://127.0.0.1:47832/session/${shareCode}`,{width:180,margin:1}).then(setQr)},[shareCode]);
  const filtered=useMemo(()=>sessions.filter(s=>s.title.toLowerCase().includes(search.toLowerCase())),[sessions,search]);

  // Transmet un média importé au backend après conversion en Base64.
  async function importFile(file?:File){
    if(!file)return; setFileName(file.name); setMessage("Traitement du fichier…");
    const data=await fileToBase64(file);
    try{const result=await invoke<{original:string;translation:string}>("process_imported_media",{data,mimeType:file.type||"audio/webm",sourceLanguage:"auto",targetLanguage:"fr"});setMessage(`${result.original} → ${result.translation}`)}catch(error){setMessage(String(error))}
  }
  // Démonstration de la synthèse vocale intégrée au système.
  function speak(){const utterance=new SpeechSynthesisUtterance("Bienvenue dans Polyglot Live Translator. La synthèse vocale est opérationnelle.");utterance.lang="fr-FR";utterance.rate=1;speechSynthesis.cancel();speechSynthesis.speak(utterance)}
  // Ajoute ou retire une langue de la sélection multiple.
  function toggleTarget(language:string){setTargets(current=>current.includes(language)?current.filter(item=>item!==language):[...current,language])}
  // Simule le téléchargement d'un modèle hors ligne pour la présentation académique.
  function downloadModel(language:string){setMessage(`Téléchargement simulé du modèle ${language}…`);setTimeout(()=>{setOffline(current=>[...new Set([...current,language])]);setMessage(`Modèle ${language} disponible hors ligne`)},900)}
  // Enregistre un terme métier dans le glossaire local.
  async function addTerm(){if(!newTerm.source||!newTerm.translation)return;await invoke("upsert_glossary",{entry:newTerm});setGlossary(await invoke("list_glossary"));setNewTerm({source:"",translation:"",domain:"Géomatique"})}

  return <section className="academic">
    <div className="academic-title"><div><h2>Centre de démonstration académique</h2><p>Toutes les fonctions commerciales sont simulées localement, sans paiement réel.</p></div><span>VERSION JURY</span></div>
    <nav>{(["audio","languages","voice","share","transcripts","glossary","account","admin"] as Tab[]).map(item=><button className={tab===item?"on":""} onClick={()=>setTab(item)} key={item}>{label(item)}</button>)}</nav>
    <div className="academic-body">
      {tab==="audio"&&<div className="grid2"><Panel title="Sources audio avancées"><Check text="Microphone + son de l’ordinateur"/><Check text="Son d’une application particulière"/><Check text="Réduction du bruit"/><Check text="Suppression de l’écho"/><Check text="Amélioration de la voix"/><label>Application<select><option>Navigateur actif</option><option>Microsoft Teams</option><option>Zoom</option><option>Lecteur multimédia</option></select></label></Panel><Panel title="Importer un fichier"><input type="file" accept="audio/*,video/*" onChange={e=>importFile(e.target.files?.[0])}/><p>{fileName||"MP3, WAV, M4A, MP4, WEBM"}</p><div className="notice">{message}</div></Panel></div>}
      {tab==="languages"&&<div className="grid2"><Panel title="Langues cibles multiples"><div className="chips">{languages.map(language=><button className={targets.includes(language)?"chosen":""} onClick={()=>toggleTarget(language)} key={language}>{language}</button>)}</div><p>{targets.length} langue(s) sélectionnée(s)</p></Panel><Panel title="Modèles hors ligne"><p>Espace simulé disponible : 8,4 Go</p>{["Français","Anglais","Espagnol","Portugais"].map(language=><div className="model" key={language}><span>{language} · 450 Mo</span><button onClick={()=>downloadModel(language)}>{offline.includes(language)?"Installé":"Télécharger"}</button></div>)}<div className="notice">{message}</div></Panel></div>}
      {tab==="voice"&&<div className="grid2"><Panel title="Synthèse vocale"><label>Voix<select><option>Voix française Windows</option><option>Voix masculine</option><option>Voix féminine</option></select></label><label>Vitesse<input type="range" min="0.5" max="2" step="0.1" defaultValue="1"/></label><label>Volume<input type="range" min="0" max="1" step="0.1" defaultValue="1"/></label><button className="primary" onClick={speak}>Tester la voix</button></Panel><Panel title="Mode interprétation"><Check text="Lecture automatique progressive"/><Check text="Diminuer la voix originale"/><Check text="Sortie dans les écouteurs"/><p>La Web Speech API de Windows est utilisée pour la démonstration locale.</p></Panel></div>}
      {tab==="share"&&<div className="share"><div><h3>Partage en direct</h3><p>Code de session : <strong>{shareCode}</strong></p><p>Lien temporaire : http://127.0.0.1:47832/session/{shareCode}</p><Check text="Afficher l’original et la traduction"/><button className="danger" onClick={()=>setMessage("Partage arrêté et lien révoqué")}>Arrêter le partage</button><div className="notice">{message}</div></div>{qr&&<img src={qr} alt="QR code de session"/>}</div>}
      {tab==="transcripts"&&<Panel title="Historique des transcriptions"><input className="search" placeholder="Rechercher une session…" value={search} onChange={e=>setSearch(e.target.value)}/>{filtered.length?filtered.map(session=><div className="row" key={session.id}><div><strong>{session.title}</strong><small>{session.sourceLanguage} → {session.targetLanguage} · {session.segmentCount} segments</small></div><div><button onClick={()=>setMessage("Signet ajouté")}>Signet</button><button onClick={()=>invoke("generate_study_aid",{sessionId:session.id,kind:"revision"}).then(result=>setMessage(String(result))).catch(error=>setMessage(String(error)))}>Fiche</button></div></div>):<p>Aucune session. Le mode démo créera des données lors du test complet.</p>}<div className="notice">{message}</div></Panel>}
      {tab==="glossary"&&<div className="grid2"><Panel title="Ajouter un terme"><input placeholder="Terme source" value={newTerm.source} onChange={e=>setNewTerm({...newTerm,source:e.target.value})}/><input placeholder="Traduction obligatoire" value={newTerm.translation} onChange={e=>setNewTerm({...newTerm,translation:e.target.value})}/><select value={newTerm.domain} onChange={e=>setNewTerm({...newTerm,domain:e.target.value})}><option>Géomatique</option><option>QGIS</option><option>Santé</option><option>HSE</option><option>Domaine minier</option></select><button className="primary" onClick={addTerm}>Ajouter</button></Panel><Panel title="Glossaire actif">{glossary.map(item=><div className="row" key={item.source}><span>{item.source} → {item.translation}</span><small>{item.domain}</small></div>)}</Panel></div>}
      {tab==="account"&&<div className="grid2"><Panel title="Compte académique"><p><strong>Jean Jacques BAKELE</strong></p><p>Formule Premium — démonstration</p><div className="quota"><span style={{width:`${Math.min(100,quota/2)}%`}}/></div><p>{quota} minutes restantes</p><button onClick={()=>setQuota(value=>Math.max(0,value-10))}>Simuler 10 minutes</button></Panel><Panel title="Facturation simulée"><div className="row"><span>Premium mensuel</span><strong>9 900 FCFA</strong></div><div className="row"><span>Statut</span><strong>PAYÉ — DÉMO</strong></div><button>Exporter les données</button><button className="danger">Supprimer le compte de démonstration</button></Panel></div>}
      {tab==="admin"&&<div className="grid2"><Panel title="Administration académique"><Metric name="Utilisateurs" value="128"/><Metric name="Sessions aujourd’hui" value="347"/><Metric name="Minutes traitées" value="12 480"/><Metric name="Incidents" value="2"/><button onClick={()=>setMessage("Rapport anonymisé exporté en mode démonstration")}>Exporter les statistiques</button></Panel><Panel title="Services, mises à jour et support"><div className="row"><span>Transcription</span><strong>Opérationnel</strong></div><div className="row"><span>Traduction</span><strong>Opérationnel</strong></div><div className="row"><span>Version installée</span><strong>1.0.0</strong></div><div className="row"><span>Signature</span><strong>DÉMO ACADÉMIQUE</strong></div><button onClick={()=>setMessage("Vous utilisez la dernière version académique disponible")}>Vérifier les mises à jour</button><button onClick={()=>setMessage("Ticket de support académique créé : SUP-2026-001")}>Contacter le support</button><button onClick={()=>setMessage("Message de maintenance publié en mode démonstration")}>Publier une maintenance</button><div className="notice">{message}</div></Panel></div>}
    </div>
  </section>
}

// Composants visuels simples réutilisés dans les différents onglets.
function Panel({title,children}:{title:string;children:ReactNode}){return <div className="panel"><h3>{title}</h3>{children}</div>}
function Check({text}:{text:string}){return <label className="check"><input type="checkbox" defaultChecked/><span>{text}</span></label>}
function Metric({name,value}:{name:string;value:string}){return <div className="metric"><span>{name}</span><strong>{value}</strong></div>}
// Traduit l'identifiant technique d'un onglet en libellé lisible.
function label(tab:Tab){return({audio:"Audio avancé",languages:"Langues",voice:"Voix",share:"Partage",transcripts:"Transcriptions",glossary:"Terminologie",account:"Compte",admin:"Administration"})[tab]}
// Lit un fichier et retire le préfixe Data URL pour ne conserver que son contenu Base64.
function fileToBase64(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]||"");reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)})}
