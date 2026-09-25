# Matrice de permissions — AFRICOIN TRADING GROUP

## Principes

Les permissions sont appliquées côté serveur avant toute lecture ou mutation sensible. L’interface masque les actions non autorisées, mais elle ne constitue pas la barrière de sécurité. Toute mutation administrative exige une justification lorsque le flux le prévoit et produit une entrée d’audit.

| Capacité | Admin | Super Admin | Conformité |
|---|---:|---:|---:|
| Examiner et décider les dépôts/retraits | Oui | Oui | Non |
| Examiner les dossiers KYC | Non | Oui | Oui |
| Traiter les alertes de conformité | Non | Oui | Oui |
| Gérer les limites de risque | Non | Oui | Oui |
| Activer/restreindre/bloquer un compte | Oui | Oui | Non |
| Modifier les rôles | Non | Oui | Non |
| Lire les demandes d’approbation | Oui | Oui | Oui |
| Décider une demande d’approbation | Oui | Oui | Oui |
| Lire l’audit | Oui | Oui | Oui |
| Gérer les réglages système | Non | Oui | Non |

## Invariants

Le rôle du propriétaire configuré par `OWNER_OPEN_ID` est maintenu à `super_admin` lors de l’upsert d’authentification. Aucun administrateur ne peut modifier son propre rôle. Aucun administrateur ne peut se bloquer lui-même. Les demandes tRPC utilisent des gardes de permission dédiés et ne se fient pas uniquement à l’affichage conditionnel du frontend.

## Double approbation obligatoire

Les actions sensibles — modification de rôle, changement de statut de compte et mise à jour des limites de risque — sont enregistrées dans `admin_approval_requests` et ne sont pas exécutées au premier avis. Deux approbateurs distincts doivent produire deux décisions positives. Le demandeur ne peut pas approuver sa propre demande et un même compte ne peut pas voter deux fois. Un seul rejet clôt la demande comme rejetée. L’exécution et le quorum sont consignés dans l’audit append-only.

La page `/admin/permissions` présente la matrice, les demandes en attente et l’historique. Le serveur reste l’autorité : les boutons masqués côté interface ne remplacent pas les gardes `approvals.read` et `approvals.decide`.

## Portée affichée

Le shell d’administration et la page `/admin/users` affichent le rôle actif ainsi que son périmètre. La modification des rôles n’est rendue visible qu’au Super Admin ; l’API la refuse également pour un Admin standard ou un rôle Conformité.
