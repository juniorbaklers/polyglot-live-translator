# Version académique complète

Cette version couvre l'ensemble du cahier des charges sous deux formes :

- **Fonction réelle ou prototype technique** : capture, communication locale,
  stockage, import de médias, IA, sous-titres, voix Windows et exports.
- **Simulation académique locale** : comptes, forfaits, facturation,
  administration, modèles hors ligne, partage public, incidents et mises à
  jour. Aucun paiement, compte externe ou action publique n'est déclenché.

## Correspondance avec le cahier des charges

| Exigence | Traitement académique |
|---|---|
| Application Windows | Tauri/React/Rust |
| Extension Chrome/Edge | Manifest V3 |
| Microphone et son système | WASAPI prototype |
| Onglet navigateur | tabCapture + offscreen |
| Import audio/vidéo | Import et traitement par commande Tauri |
| Microphone + ordinateur | Interface et parcours de démonstration |
| Application particulière | Sélecteur de démonstration |
| Réduction bruit/écho | Paramètres de démonstration |
| Transcription/traduction | Pipeline en ligne + mode démo |
| Langues multiples | Sélection multiple académique |
| Sous-titres navigateur | Bilingues, mobiles et redimensionnables |
| Fenêtre flottante | Toujours au premier plan |
| Historique | SQLite |
| Exports | TXT, SRT, VTT, CSV, JSON, DOCX, PDF |
| Résumés/révision | Résumé, quiz, fiches, cartes mémoire |
| Terminologie | Glossaires prioritaires |
| Sortie vocale | Web Speech/voix Windows |
| Partage direct | Lien, code et QR locaux simulés |
| Mode hors ligne | Catalogue et téléchargement simulés |
| Comptes/forfaits | Premium, quotas et facturation simulés |
| Confidentialité | Capture volontaire, localhost, coffre secret |
| Installateurs | MSI/NSIS via workflow Windows |
| Mises à jour | Écran et workflow de simulation |
| Administration | Tableau de bord académique |
| Tests | Plan et automatisations GitHub |

Les simulations sont volontairement identifiées dans l'interface afin de ne
pas induire le jury ou les utilisateurs en erreur.
