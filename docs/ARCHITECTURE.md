# Architecture technique proposée

## 1. Application Windows

Tauri 2 fournit la fenêtre native, l'installateur et les API système. React et
TypeScript gèrent l'interface. Le cœur Rust prendra en charge WASAPI Loopback,
le microphone, SQLite, les secrets Windows et le serveur WebSocket limité à
`127.0.0.1`.

## 2. Extension Chrome/Edge

L'extension Manifest V3 utilise `tabCapture` uniquement après un clic de
l'utilisateur. Un document hors écran traite le flux audio et l'envoie par
petits segments à l'application Windows. Un content script affiche les
sous-titres sans modifier définitivement le site.

## 3. Communication locale

1. L'application ouvre un serveur WebSocket sur `127.0.0.1`.
2. Elle affiche un code d'association à usage unique.
3. L'extension transmet ce code et son identifiant autorisé.
4. L'application délivre un jeton de session court, conservé localement.
5. Chaque message porte un identifiant, un horodatage et le jeton.
6. Le jeton est révoqué à l'arrêt de l'application ou de la session.

Le serveur ne doit jamais écouter sur `0.0.0.0` et aucune clé de fournisseur IA
ne doit être incluse dans l'extension.

## 4. Chaîne de traitement prévue

Audio -> normalisation -> détection de voix -> transcription -> glossaire ->
traduction -> sous-titres -> synthèse vocale -> stockage/export.

Chaque moteur respecte une interface commune afin de pouvoir choisir un moteur
local ou en ligne depuis les paramètres.
