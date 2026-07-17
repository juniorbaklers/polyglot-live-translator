# Polyglot Live Translator

Application Windows et extension Chrome/Edge destinées à transcrire, traduire
et afficher des sous-titres pour les contenus audio et vidéo auxquels
l'utilisateur a légalement accès.

> Projet de fin — version académique `1.0.0`. Le dépôt combine des prototypes
> techniques et des simulations locales clairement identifiées pour couvrir le
> cahier des charges sans utiliser de paiement ou de comptes commerciaux.

## Fonctions principales

- capture du microphone avec Windows Core Audio ;
- capture du son système avec WASAPI Loopback ;
- capture volontaire de l'onglet actif avec Manifest V3 ;
- association locale par code et jeton temporaire ;
- transcription et traduction par fournisseur configurable ;
- glossaires spécialisés, notamment SIG/QGIS ;
- sous-titres bilingues dans le navigateur ;
- fenêtre flottante Windows toujours au premier plan ;
- stockage SQLite et sauvegarde progressive ;
- historique des sessions ;
- exports TXT, SRT, VTT, CSV, JSON, DOCX et PDF ;
- résumés, quiz, fiches de révision et cartes mémoire ;
- mode démonstration sans clé API ;
- centre académique couvrant audio avancé, langues, voix, partage, comptes et administration ;
- installateurs MSI/EXE générés par GitHub Actions.

## Architecture

| Dossier | Rôle |
|---|---|
| `apps/desktop` | Application Windows Tauri, React et Rust |
| `apps/extension` | Extension Chrome/Edge Manifest V3 |
| `packages/shared` | Contrats de messages partagés |
| `docs` | Architecture, sécurité, lots et procédures |
| `.github/workflows` | Contrôles et génération des installateurs |

## Installation pour le développement

Prérequis : Windows 10/11, Node.js 20+, pnpm 9.15.4, Rust stable, Microsoft
C++ Build Tools et WebView2.

```powershell
git clone https://github.com/juniorbaklers/polyglot-live-translator.git
cd polyglot-live-translator
npm install -g pnpm@9.15.4
pnpm install
pnpm typecheck
pnpm dev:desktop
```

## Extension Chrome/Edge

```powershell
pnpm build:extension
```

Chargez `apps/extension/dist` en mode développeur dans `chrome://extensions`
ou `edge://extensions`.

## Configuration de l'IA

La clé API ne doit jamais être enregistrée dans GitHub ou dans l'extension.
Elle peut être ajoutée dans l'interface Windows, qui utilise le coffre sécurisé
du système, ou temporairement par variable d'environnement :

```powershell
$env:OPENAI_API_KEY="votre-cle"
```

Les modèles peuvent être modifiés avec `OPENAI_TRANSCRIPTION_MODEL` et
`OPENAI_TRANSLATION_MODEL`.

## Mode démonstration

Dans l'application, cliquez sur **Activer la démo**. Ce mode simule la sortie de
transcription et permet de présenter l'interface sans envoyer d'audio à un
service en ligne.

## Confidentialité

- aucune capture automatique ;
- serveur local limité à `127.0.0.1` ;
- aucune clé dans l'extension ;
- transcriptions locales par défaut ;
- aucun contournement de DRM ou de restriction d'accès.

## État du projet

Les contrôles TypeScript et les builds React/extension sont automatisés. Le
workflow Windows compile le cœur Rust et produit les installateurs. Les
fonctions commerciales — facturation, OAuth Google/Microsoft et administration
multi-utilisateur — sont représentées par une simulation locale. Consultez
`docs/VERSION-ACADEMIQUE-COMPLETE.md` pour la correspondance détaillée.

## Auteur

BAKELE — Projet Polyglot Live Translator.

## Licence

Distribué sous licence MIT. Consultez [LICENSE](LICENSE).
