# Polyglot Live Translator

Socle du projet de traduction audio/vidéo en temps réel pour Windows 10/11,
Chrome et Microsoft Edge.

## Organisation

- `apps/desktop` : application Windows Tauri + React + TypeScript.
- `apps/extension` : extension Chrome/Edge Manifest V3.
- `packages/shared` : contrats de messages partagés.
- `docs` : architecture, sécurité et étapes de réalisation.

## Lots livrés

- monorepo TypeScript ;
- interface Windows initiale en français ;
- extension Manifest V3 initiale ;
- protocole local de connexion et d'association ;
- contrats de messages partagés ;
- architecture prête pour SQLite, la capture audio et les moteurs IA.

### Lot 2 — Audio Windows

- capture du son système avec WASAPI Loopback ;
- capture du microphone ;
- commandes Tauri de démarrage et d'arrêt ;
- jauge audio en temps réel et détection d'absence de signal ;
- messages d'erreur en français.

## Démarrage en développement

Prérequis : Node.js 20+, pnpm 9+, Rust stable et les prérequis Tauri pour
Windows.

```powershell
pnpm install
pnpm dev:desktop
```

Pour préparer l'extension :

```powershell
pnpm build:extension
```

Chargez ensuite le dossier `apps/extension/dist` comme extension non empaquetée
dans `chrome://extensions` ou `edge://extensions`.

> Le moteur audio du Lot 2 doit être compilé et validé sur Windows 10/11. Le
> traitement IA réel et les exports seront intégrés dans les lots suivants
> décrits dans `docs/ROADMAP.md`.
