# Réalisation partie par partie

## Lot 1 — Socle technique

- Architecture et arborescence
- Application Tauri initiale
- Extension Manifest V3 initiale
- Contrats partagés et protocole d'association

## Lot 2 — Capture audio Windows (implémenté)

- Microphone
- WASAPI Loopback
- Sélection des périphériques
- Jauge, test audio, absence de signal

Le moteur natif utilise Windows Core Audio en mode partagé. Le son système est
capturé avec `AUDCLNT_STREAMFLAGS_LOOPBACK`; le microphone utilise le point de
capture par défaut. La jauge RMS/Peak est renvoyée à React toutes les 100 ms.

## Lot 3 — Capture d'onglet (implémenté)

- `tabCapture` après autorisation
- Document hors écran
- Envoi audio local par segments
- Indicateur permanent de capture

L'extension obtient le flux seulement après un clic de l'utilisateur. Un
document hors écran encode l'audio en Opus par segments d'une seconde et les
transmet à l'application par WebSocket local sur `127.0.0.1:47832`.

## Lot 4 — Transcription et traduction (implémenté)

- Interfaces interchangeables de fournisseurs
- Détection automatique de langue
- Transcription et traduction progressives
- Glossaires prioritaires

## Lot 5 — Sous-titres (implémenté)

- Fenêtre flottante Windows
- Couche vidéo dans Chrome/Edge
- Panneau latéral et raccourcis

## Lot 6 — Données et exports (implémenté)

- SQLite
- Historique et sauvegarde progressive
- TXT, SRT, VTT, DOCX et PDF
- Résumés et fiches de révision

## Lot 7 — Sécurité, compte et administration (socle implémenté)

- Coffre de secrets Windows
- Authentification et forfaits
- Partage temporaire révocable
- Administration sans accès aux contenus privés

## Lot 8 — Livraison Windows (automatisée)

- Tests fonctionnels et de sécurité
- Installateur EXE/MSI
- Signature et mises à jour
- Documentation utilisateur

## Lot 9 — Publication et stabilisation (préparé)

- contrôles automatiques GitHub ;
- création des artefacts Windows et extension ;
- politique de confidentialité ;
- préparation Chrome Web Store et Microsoft Edge Add-ons.
