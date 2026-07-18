// Assistant de première utilisation, affiché jusqu'à sa validation sur cet ordinateur.
import { useEffect, useState } from "react";
import "./onboarding.css";

// Contenu pédagogique présenté successivement à l'utilisateur.
const steps=[
  ["Bienvenue","Configurez Polyglot Live Translator en quelques étapes."],
  ["Langue de l’interface","Français est sélectionné par défaut."],
  ["Microphone","Le test réel sera exécuté pendant la validation Windows."],
  ["Son de l’ordinateur","WASAPI Loopback sera utilisé avec votre autorisation."],
  ["Extension","Installez l’extension compilée depuis le dossier release."],
  ["Association","Un code temporaire relie uniquement votre navigateur à votre application."],
  ["Moteurs","Choisissez le mode démonstration, en ligne ou hors ligne simulé."],
  ["Terminé","Vous pouvez commencer votre première traduction."],
];

export function Onboarding(){
  // L'étape active détermine le texte et la progression affichés.
  const [open,setOpen]=useState(false);const [step,setStep]=useState(0);
  useEffect(()=>{if(!localStorage.getItem("polyglot-onboarding-complete"))setOpen(true)},[]);
  if(!open)return <button className="restart-wizard" onClick={()=>{setStep(0);setOpen(true)}}>Assistant de configuration</button>;
  function finish(){localStorage.setItem("polyglot-onboarding-complete","1");setOpen(false)}
  return <div className="wizard-backdrop"><div className="wizard"><span>Étape {step+1} sur {steps.length}</span><h2>{steps[step][0]}</h2><p>{steps[step][1]}</p><div className="wizard-progress"><i style={{width:`${(step+1)/steps.length*100}%`}}/></div><div><button disabled={step===0} onClick={()=>setStep(value=>value-1)}>Précédent</button>{step<steps.length-1?<button className="next" onClick={()=>setStep(value=>value+1)}>Suivant</button>:<button className="next" onClick={finish}>Commencer</button>}</div></div></div>
}
