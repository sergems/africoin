# Notifications Africoin Trading

## Comportement

Le centre de notifications est disponible dans le shell client sur desktop et mobile. Il interroge le flux utilisateur protégé toutes les quatre secondes lorsque la session est active. Les décisions administratives d’approbation ou de rejet créent une notification privée pour l’utilisateur concerné avec la référence de la demande et la note du réviseur.

## Résilience

Le centre affiche un état de synchronisation automatique lorsque le rafraîchissement fonctionne. En cas d’échec réseau ou de session indisponible, il affiche « Actualisation indisponible » et propose « Réessayer ». Les données sont limitées à l’utilisateur connecté par les procédures protégées et les mutations de lecture vérifient également son identifiant.

## Lecture

Chaque notification non lue affiche l’état « Non lue », un indicateur visuel et le compteur global. Cliquer sur une notification la marque comme lue. « Tout marquer comme lu » met à jour uniquement les notifications du compte courant.

## Validation

Le flux de décision est couvert par des tests de contrat pour les titres et messages d’approbation/rejet, la référence de demande, la note administrative, le compteur non lu, l’isolation utilisateur et l’accès non authentifié. Les tests ne déplacent aucun fonds et n’exécutent aucun ordre auprès d’un partenaire.

> Le transport actuel est un rafraîchissement quasi temps réel par polling sécurisé. Un canal push SSE/WebSocket pourra être ajouté lorsqu’un besoin de latence stricte et une infrastructure de connexion persistante seront validés.

## Scénario QA admin-client

1. Un administrateur ouvre la file des demandes et choisit une demande de dépôt ou de retrait.
2. Il saisit une note puis approuve ou rejette la demande. La décision reste soumise aux contrôles partenaires et ne déplace aucun fonds dans l’environnement actuel.
3. Le backend produit un titre de décision, la référence de la demande et la note, puis les rattache à l’utilisateur concerné.
4. Le client voit le compteur non lu dans la cloche globale après le prochain rafraîchissement sécurisé, ouvre le centre, lit le message et peut le marquer comme lu.
5. Si le navigateur passe hors ligne, le centre affiche « Connexion hors ligne » et « Réessayer ». Le retour en ligne déclenche une nouvelle lecture du flux.

La validation automatisée couvre les contrats d’approbation/rejet et l’isolation de compte. La QA rendue couvre les surfaces mobile du portail, portefeuille et activité ; une exécution financière réelle n’est pas effectuée.
