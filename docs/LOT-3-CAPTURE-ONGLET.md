# Lot 3 — Capture audio d'un onglet Chrome/Edge

## Fonctions ajoutées

- capture explicite avec `chrome.tabCapture` ;
- document hors écran Manifest V3 ;
- maintien du son audible dans l'onglet ;
- encodage `audio/webm;codecs=opus` avec MediaRecorder ;
- segmentation toutes les secondes ;
- serveur WebSocket limité à `127.0.0.1:47832` ;
- association par code à six chiffres ;
- jeton de session aléatoire ;
- badge rouge `REC` pendant la capture ;
- couche d'état au-dessus de la page ;
- arrêt depuis l'extension.

## Sécurité

Le serveur écoute seulement sur l'ordinateur local. L'extension doit présenter
le code affiché par l'application avant de recevoir un jeton. Les connexions
sans code correct ou sans jeton sont refusées. La capture ne démarre jamais
automatiquement.

## Test prévu ultérieurement

Le test complet nécessitera l'application Windows démarrée et l'extension
chargée depuis son dossier `dist`. Le nombre de segments reçus sera affiché
dans la section d'association de l'application.
