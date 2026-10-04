# DevOps de Polyglot

DevOps organise la fabrication et la vérification du logiciel. Il ne traduit pas les vidéos : il aide à livrer des mises à jour contrôlées. GitHub Actions convient au dépôt actuel ; migrer vers Azure DevOps n’est pas nécessaire.

## À chaque changement

Le workflow « Extension quality and package » s’exécute sur les propositions de modification, les push et les lancements manuels. Il contrôle TypeScript, compile l’extension, teste le code réellement compilé et produit une archive ZIP avec une somme SHA-256. Les tests Python tournent sous Windows et Linux, avec Python 3.11. L’archive n’est produite que si ces tests réussissent.

Ces tests vérifient les comportements logiciels. Les doubles des modèles IA n’établissent pas la qualité réelle de reconnaissance ou de traduction. Avant de distribuer une version, mesurez quelques extraits représentatifs avec le moteur réellement installé et écoutez les phrases traduites. `benchmark.py` donne le taux d’erreurs de reconnaissance (WER) et le temps de calcul ; utilisez la même référence pour comparer normal et précision. Un WER peut dépasser 100 % si le moteur ajoute beaucoup de mots.

## Où trouver le ZIP

1. Dans GitHub, ouvrir le dépôt puis **Actions**.
2. Ouvrir **Extension quality and package**, puis une exécution verte correspondant au commit voulu.
3. Dans **Artifacts**, télécharger **polyglot-extension-1.3.1**. L’archive GitHub contient le ZIP installable et sa somme SHA-256.
4. Décompresser puis suivre `INSTALLATION.txt`. Les modèles et `.venv` de l’installation actuelle restent en place.

L’exécution manuelle est disponible quand ce workflow est présent sur la branche par défaut ; avant cela, un push sur la branche de travail déclenche ses contrôles. Aucun envoi au Chrome Web Store ni fusion automatique n’est configuré. La validation et la distribution restent des actions distinctes.

## Retour à une version précédente

Conserver le ZIP de la version précédente. Arrêter le moteur, remplacer ensemble les fichiers du moteur et de l’extension, recharger l’extension puis actualiser la vidéo. Ne pas supprimer les modèles ou `.venv`. Les corrections locales restent enregistrées dans le navigateur ; le popup permet de les effacer. Les anciennes versions peuvent ignorer les nouveaux réglages.

## Coût et confidentialité

L’extension et son moteur utilisent les modèles locaux sans API payante. GitHub annonce les runners standard gratuits pour les dépôts publics ; les dépôts privés ont des quotas dépendant du forfait. Les workflows utilisent des runners standard et limitent les archives à sept jours ; cela n’est pas une garantie de gratuité pour toute configuration du compte. Aucun service cloud supplémentaire ni secret de traduction n’est ajouté.

Sources : [facturation GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [artifacts GitHub](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).

Les logs de CI ne contiennent pas vos vidéos ni votre glossaire : ils utilisent les fixtures du dépôt. Le protocole de production ne transmet ces données qu’au moteur localhost. Les rapports du benchmark peuvent contenir les paroles : conservez-les localement ou partagez-les volontairement pour diagnostiquer une erreur.

## Vérifier localement

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build:extension
node --test apps/extension/tests/*.test.mjs
python -m pip install -r apps/local-engine/tests/requirements.txt
python -m unittest discover -s apps/local-engine/tests
python scripts/package_extension.py
```

Node 22.18 ou ultérieur et Python 3.11 sont requis pour ces contrôles. L’installation du moteur de production utilise son propre fichier `requirements.txt`, distinct de celui des tests.
