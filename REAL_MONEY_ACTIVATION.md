# Africoin Trading — Conditions d’activation du réel

Les flux financiers et d’exécution restent suspendus jusqu’à la validation des partenaires réglementés. Aucun dépôt bancaire, retrait mobile money, ordre broker, custody ou flux de données sous licence n’est activé.

## Prérequis réglementaires

L’opérateur doit obtenir une qualification écrite et les autorisations applicables en RDC pour l’intermédiation de marché, le change, les paiements, la conservation et la conformité LBC/FT. Les documents contractuels doivent être approuvés par un conseil local et un responsable conformité.

## Prérequis partenaires

L’équipe doit signer des conventions avec un prestataire de paiement agréé, un partenaire FX, un courtier autorisé, un dépositaire/custodian et un fournisseur de données de marché. Chaque partenaire doit fournir ses limites, sa procédure de réclamation, ses conditions de règlement et ses obligations de notification.

## Prérequis techniques

Les credentials de production doivent être injectés via les secrets du projet, jamais dans le code. Chaque webhook doit être authentifié, rejouable de façon idempotente et journalisé. Le passage en réel exige des tests d’intégration, des tests de réconciliation quotidienne, une validation des plafonds, un plan de reprise et une revue de sécurité.

## Prérequis opérationnels

Le KYC/AML-CFT doit être activé, les documents privés stockés dans un espace non public, les comptes clients séparés de la trésorerie d’exploitation et les alertes de fraude reliées à l’équipe conformité. Le levier et les CFD restent désactivés jusqu’à une qualification et une approbation distinctes.

## Checklist de go-live

| Domaine | Validation requise |
|---|---|
| Réglementaire | Autorisations et avis local documentés |
| Paiement | Contrat, credentials, webhooks signés, réconciliation |
| Courtage | Compte de règlement, mapping instruments, tests d’exécution |
| Custody | Convention de conservation, positions et relevés |
| Change/FX | Limites, spreads, politique de liquidité, contrôles |
| Conformité | KYC, sanctions, PEP, alertes, conservation des preuves |
| Sécurité | MFA/renforcement d’authentification, secrets, logs, tests d’intrusion |
| Support | Tarification, risques, réclamations, SLA et escalade |

La mise en production doit être activée par un changement contrôlé, approuvé par l’administrateur, la conformité et les partenaires concernés. Tant que cette checklist n’est pas signée, l’interface doit continuer à indiquer que les partenaires sont en cours de connexion et empêcher tout mouvement réel.
