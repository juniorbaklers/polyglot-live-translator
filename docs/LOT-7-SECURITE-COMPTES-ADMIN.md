# Lot 7 — Sécurité, comptes et administration

- clé API stockée dans le coffre de secrets du système ;
- aucune clé dans l'extension, GitHub ou les journaux ;
- API locale limitée à `127.0.0.1` ;
- code d'association et jeton de session ;
- structure prête pour les forfaits Gratuit et Premium ;
- séparation entre données techniques et transcriptions privées.

La facturation, Google/Microsoft OAuth et l'administration multi-utilisateur
nécessiteront un serveur de production et des comptes fournisseurs. Ils ne sont
pas activés dans le dépôt public.
