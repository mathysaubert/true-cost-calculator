# Sauvegarde complète de la base de production avant D2-4 (2026-09-26)

Statut : **faite et vérifiée.** Aucune donnée modifiée. D2-4 n'est pas commencé.

## 1. Les fichiers

Sur votre Bureau (`C:\Users\mathy\OneDrive\Bureau`), deux fichiers du 26 septembre à 12:07 UTC, soit 14:07 à Paris :

| Fichier | Taille | À quoi il sert |
|---|---|---|
| `tcc-production-sauvegarde-2026-09-26_12h07.dump` | 487 Ko | archive compressée, pour une restauration avec `pg_restore` (format recommandé) |
| `tcc-production-sauvegarde-2026-09-26_12h07.sql` | 497 Ko | même contenu en texte lisible : structure et données |

Contenu : **toute la base** du projet `true-cost-calculator` (production, eu-west-1). Cela comprend les 42 tables de l'app (schéma `public`) avec leurs fonctions, déclencheurs et droits, ainsi que les schémas propres à Supabase (`auth`, `storage`, `realtime`, `vault`, `supabase_migrations`).

## 2. Les étapes, simplement

1. **Trouver l'accès à la base sans l'afficher.** Votre fichier `.env` local contient déjà l'adresse de connexion (`DIRECT_URL`, le « session pooler » de Supabase, port 5432). J'ai seulement vérifié, sans jamais l'afficher, trois choses :
   - elle pointe vers la région eu-west-1 ;
   - c'est le même projet que l'app ;
   - ce n'est pas `tcc-test`.
2. **Relever l'état de la base.** Une lecture seule donne :
   - la version du serveur : PostgreSQL 17.6 ;
   - la liste des tables et le nombre de lignes de chaque table de l'app.

   C'est la référence pour vérifier la sauvegarde.
3. **Préparer l'outil.** `pg_dump`, l'outil officiel de PostgreSQL, n'était pas installé, et l'outil Supabase demande Docker, absent. J'ai téléchargé la version portable officielle de PostgreSQL 17.7 pour Windows (archive EnterpriseDB, sans installation) dans un dossier de travail temporaire. Un `pg_dump` 17.7 sait sauvegarder un serveur 17.6.
4. **Faire la sauvegarde.** Un petit script lit l'adresse dans `.env` et la transmet à `pg_dump` par des variables d'environnement. Elle n'apparaît donc ni à l'écran, ni dans une commande, ni dans les messages d'erreur, qui sont masqués. Deux passes, sans erreur (code de sortie 0) :
   - le format compressé (`.dump`) ;
   - le format texte (`.sql`).
5. **Vérifier le fichier.** Trois contrôles, détaillés en section 3.

## 3. Vérification

| Contrôle | Résultat |
|---|---|
| Archive `.dump` lisible par `pg_restore` | oui |
| Tables présentes, par schéma | `public` 42 sur 42, `auth` 27 sur 27, `storage` 8 sur 8, `realtime` 3 sur 3, `supabase_migrations` 1 sur 1, `vault` : données présentes (sa table vient de l'extension Supabase) |
| Lignes par table de l'app, `.sql` comparé à la base | **42 tables sur 42 identiques** |
| Lignes par table de l'app, `.dump` comparé à la base | **42 tables sur 42 identiques**, 339 lignes au total |
| Objets que D2-4 va modifier | présents : fonction `purge_shop`, déclencheur `trg_shop_plans_sync_settings` et sa fonction, fonction `increment_usage_orders` |

Principales tables (lignes dans la sauvegarde / dans la base) :

| Table | Lignes |
|---|---|
| shop_settings | 4 / 4 |
| shop_plans | 4 / 4 |
| orders | 24 / 24 |
| order_margins | 39 / 39 |
| variant_costs | 28 / 28 |
| decision_log | 5 / 5 |
| insight_log | 10 / 10 |
| calculations | 3 / 3 |
| margin_alerts | 2 / 2 |
| Session | 2 / 2 |
| webhook_events | 64 / 64 |
| sync_jobs | 17 / 17 |

## 4. À savoir

- **Données sensibles.** La sauvegarde contient les jetons d'accès Shopify des boutiques (table `Session`), les données des commandes et le reste de la base. Votre Bureau est synchronisé avec **OneDrive**, donc ces fichiers partent dans votre espace OneDrive.
  - Si vous préférez qu'ils restent hors du cloud, déplacez-les dans un dossier local non synchronisé ou sur un support chiffré.
  - Ne les partagez pas.
- **Restauration (pour mémoire, seulement si besoin, et jamais sans décision) :** avec le même outil, `pg_restore --clean --if-exists --no-owner --dbname <adresse de la base cible> <fichier .dump>`. Je la préparerais avec vous, sur la base de test d'abord.
- **Outil téléchargé :** PostgreSQL 17.7, dans le dossier de travail temporaire de la session. Il n'est ni installé ni ajouté à Windows. Je peux le réutiliser pour D2-4.

**Prochaine étape, sur votre GO :** D2-4, la migration de la base. D'abord la relecture des calculs restants (X10), puis la base de test avec preuve du retour arrière, puis la production, avec un GO par étape.
