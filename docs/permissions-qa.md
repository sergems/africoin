# QA Version 2.2 — permissions et double approbation

## Périmètre

La version 2.2 couvre la matrice Admin, Super Admin et Conformité, la page `/admin/permissions`, les demandes persistantes `admin_approval_requests`, les décisions persistantes `admin_approval_decisions` et l’exécution après quorum.

## Flux fonctionnel vérifié

1. Une mutation sensible crée une demande avec une justification, une cible et une expiration à sept jours. Le changement n’est pas exécuté au premier avis.
2. Le demandeur ne peut pas approuver sa propre demande. Une deuxième tentative du même approbateur est refusée.
3. Un premier avis positif laisse la demande en attente avec un compteur `1/2`.
4. Un avis positif provenant d’un second compte habilité atteint le quorum `2/2`, marque la demande comme exécutée et applique l’action cible.
5. Un avis négatif clôt la demande comme rejetée sans exécution.
6. Les événements de demande, avis et exécution sont envoyés à l’audit. Les tables et l’historique existants sont conservés sans suppression de données.

## Matrice de décision

| Action | Rôles pouvant demander | Rôles pouvant approuver | Quorum |
|---|---|---|---:|
| Modification de rôle | Super Admin | Super Admin distinct | 2 |
| Statut de compte | Admin, Super Admin | Admin ou Super Admin distinct | 2 |
| Limites de risque | Conformité, Super Admin | Conformité ou Super Admin distinct | 2 |

## QA visuelle

### Desktop

- `/admin/permissions` affiche le badge du rôle actif, la portée, trois métriques, la matrice complète, la règle des deux personnes, la file des demandes et l’historique.
- La table est contenue dans une zone défilable horizontalement et ne déforme pas la carte de gouvernance.
- Une demande héritée de l’historique est affichée avec son libellé normalisé, son compteur d’avis et sa justification.
- Les actions Approuver/Rejeter sont désactivées pour le demandeur, un approbateur déjà enregistré ou un rôle non habilité.

### Mobile

- Le shell conserve son header compact et la page reste lisible en une colonne.
- Les métriques passent en pile ; les cartes de demandes utilisent des boutons pleine largeur.
- La matrice conserve une largeur minimale dans son conteneur avec défilement horizontal contrôlé, sans débordement de la page.
- Les notes et justifications passent à la ligne ; aucune action critique ne sort de l’écran.

## Validation automatisée

- TypeScript : `pnpm check` réussi.
- Vitest : **11 fichiers, 40 tests réussis**.
- Migration : `drizzle/0007_icy_bedlam.sql`, création additive des deux tables de gouvernance pour les environnements ne possédant pas encore ces tables.
- Base courante : les tables déjà présentes ont été conservées et le code a été aligné sur leur contrat physique (`requestedBy`, `targetId`, `approverId`, statuts `pending/approved/rejected/expired/executed`).

## Limites connues

La page rafraîchit la file toutes les dix secondes ; un transport push pourra remplacer ce polling dans une itération ultérieure. Les flux financiers et de marché restent soumis aux garde-fous partenaires existants et aucun mouvement réel n’est déclenché par cette version.

## Contrôle d’accès navigateur

La navigation sandbox vers `/admin/permissions` sans session authentifiée présente correctement le fallback « Votre espace financier sécurisé » avec le bouton de connexion ; aucune donnée de gouvernance n’est exposée avant authentification. La capture WebDev avec session projet authentifiée confirme ensuite le rendu complet de la matrice, de la file et de l’historique.
