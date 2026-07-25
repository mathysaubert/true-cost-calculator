# Règles de travail — True Cost Calculator

## Actions irréversibles

Commit, push, mutation de base ou de schéma = actions irréversibles. Ne jamais les
exécuter sans un GO explicite dans un message séparé, même si une séquence d'instructions
les mentionne. S'arrêter avant, demander.

## Preuve de rendu UI

Tout changement d'UI exige un rendu local réel des surfaces touchées avant commit — les
tests purs ne prouvent pas le rendu. Outil : `node scripts/render_check.mjs` (Vite SSR +
memory router) rend les composants réels sur données chargées ET état initial vide/null.

## Rapports

Tout livrable long (plan, Phase 0, preuves, tableaux) est écrit dans un fichier Markdown
sous `docs/rapports/`, nommé `AAAA-MM-JJ_sujet.md`, en Markdown pur — aucun caractère de
dessin de terminal, aucune sortie ANSI. Dans le terminal : le chemin du fichier + un
résumé de 5 lignes maximum.
