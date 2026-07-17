# Lot 8 — Installateur Windows

Tauri produit deux formats : MSI et NSIS/EXE. Le workflow GitHub Actions
`windows-build.yml` compile les installateurs sur une machine Windows et les
conserve comme artefacts.

La signature nécessite les secrets de certificat du propriétaire. Aucun
certificat ni mot de passe ne doit être enregistré dans GitHub.
