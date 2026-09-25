# AFRICOIN TRADING GROUP — QA des pages

## Périmètre vérifié

La revue a couvert la landing publique et les espaces principaux du portail avec un viewport mobile de 390 × 844 px, ainsi qu’une capture desktop de 1280 × 720 px pour la landing. Les routes métier restent servies par `DashboardLayout`; la racine `/` sert la landing et `/dashboard` sert le tableau de bord client.

| Route | Surface vérifiée | Navigation / shell | État vide ou contenu contrôlé | Résultat |
|---|---|---|---|---|
| `/` | Landing publique | Header responsive, menu mobile, CTA de connexion, footer | Sections marchés, sécurité, parcours et CTA final | Conforme |
| `/dashboard` | Tableau de bord client | Header mobile, notification center, accès marché | Portefeuille CDF/USD à zéro, conformité à compléter, actions rapides | Conforme |
| `/market` | Catalogue actions & forex spot | Recherche, filtres, lien watchlist, règles de marché | Instruments visibles et état partenaire clairement présenté | Conforme |
| `/watchlist` | Liste des instruments suivis | Shell cohérent et retour vers Marchés | Empty state explicite avec consigne d’ajout | Conforme |
| `/wallets` | Liquidités et demandes | Cartes USD/CDF, actions dépôt/retrait | Soldes à zéro, demandes récentes vides, garde-fous visibles | Conforme |
| `/activity` | Historique et contrôles | Header et notification center | Aucun ordre/transaction, état KYC explicite, journal de confiance | Conforme |
| `/documents` | Documents obligatoires | Navigation client persistante | Cinq documents versionnés avec lecture extensible | Conforme |
| `/settings` | Profil & paramètres | Formulaire responsive et cartes de protection | Profil de risque non déterminé affiché sans ambiguïté | Conforme |
| `/compliance` | Supervision conformité | Onglets KYC, alertes, flux, réconciliation, audit | Compteurs à zéro et dossier KYC vide lisibles | Conforme |
| `/admin` | Console d’administration | File de décisions, filtres, panneau de décision | File vide, contrôles de réconciliation et audit expliqués | Conforme |

## Contrôles d’accès

La landing publique est rendue uniquement pour `/`. Les routes `/dashboard`, `/market`, `/watchlist`, `/wallets`, `/activity`, `/documents`, `/settings`, `/compliance` et `/admin` passent par le shell authentifié. Les pages conformité et administration conservent en plus leurs garde-fous de rôle dans leurs composants et procédures serveur.

## Responsive et accessibilité

La navigation mobile utilise un header compact avec déclencheur de sidebar et centre de notifications. Les cartes, formulaires, tableaux et panneaux s’empilent sans débordement sur 390 px. Les CTA disposent de libellés explicites, les boutons de navigation mobile ont un nom accessible, et les états de connexion/hors ligne des notifications restent visibles.

## Note de sécurité

La landing présente la proposition de valeur et les contrôles de parcours sans promettre une exécution réelle. Les textes rappellent que les fonctions financières réelles dépendent des validations réglementaires et des partenaires agréés. Aucun mouvement de fonds n’est déclenché par la landing.

## QA complémentaire — tarifs et marché temps réel

| Route | Vérification ajoutée | Résultat |
|---|---|---|
| `/tarifs-risques-conditions` | Tableau de tarification sans montants inventés, six risques structurés, conditions extensibles, CTA de connexion et lien vers Documents | Conforme desktop et mobile |
| `/market` | Badge visible « Catalogue partenaire en attente », catalogue initial conservé, statut WebSocket et actions spot inchangées | Conforme desktop et mobile |
| `/dashboard` | Bloc « Marché en temps réel », badge de transport, dernière mise à jour et fallback tRPC affiché si le flux n’est pas disponible | Conforme desktop et mobile |

Le smoke test local du canal `/api/market-stream` a reçu un message `market_status` avec `providerState: pending_activation`, puis un `market_update` avec six instruments. Les tests du hook couvrent la réception du snapshot, l’erreur WebSocket, la conservation du dernier état, le passage hors ligne et la reconnexion après reprise réseau. Aucun prix live n’est simulé : tant que le fournisseur de données n’est pas activé, le flux transmet uniquement le catalogue sûr existant et son statut d’attente.
