# Africoin Trading — Revue finale des libellés

## Portefeuille

Texte vérifié : « Les demandes restent sous contrôle conformité jusqu’à la connexion d’un partenaire de paiement agréé. »

Texte de protection vérifié : « Les actions de cet écran sont enregistrées et contrôlées. Les transferts seront disponibles après validation du partenaire de paiement. »

## Marchés

Texte vérifié : « Explorez les instruments disponibles, les niveaux de risque et les cours disponibles. L’effet de levier et les CFD sont désactivés. »

Statut vérifié : « Connexion partenaire en cours ».

Règle d’exécution vérifiée : « Aucun ordre réel n’est transmis tant qu’un courtier agréé et ses credentials ne sont pas connectés. »

Message de confirmation vérifié : « Cet ordre sera enregistré et transmis uniquement après connexion du courtier agréé. Aucun fonds ne sera engagé avant validation. »

## Paramètres

Libellé vérifié : « Accès aux opérations ».

Texte vérifié : « Les flux financiers seront disponibles après validation des partenaires agréés. »

## Documents

Libellé vérifié : « Document requis avant l’activation des flux financiers ».

Déclaration de risques vérifiée : « L’effet de levier et les CFD ne sont pas proposés sans autorisation réglementaire et validation distincte. »

## Conformité et administration

Statut vérifié : « Suivi ».

Réconciliation vérifiée : « Rapprochement validé après contrôle des éléments disponibles. »

## Notifications

Ordre : titre exact « Ordre enregistré » ; modèle exact « `${sideLabel} ${quantity} ${symbol} · exécution disponible après connexion du courtier agréé.` », où `sideLabel` vaut « Achat » ou « Vente ».

Dépôt : titre exact « Demande de dépôt créée » ; modèle exact « `${amount} ${currency} · ${reference}` ».

Retrait : titre exact « Demande de retrait soumise » ; modèle exact « `${amount} ${currency} · contrôle conformité en attente.` ».

Décision administrative : titre exact conditionnel « Demande approuvée » ou « Demande rejetée » ; modèle exact « `${reference} · ${note}` ».

État de lecture dans le panneau administratif : libellé exact « Notification : `${title}` · lue » lorsque `readAt` existe, sinon « Notification : `${title}` · non lue ». Aucun de ces modèles ne contient de référence legacy au mode d’exécution.

## Résultat

Les vues desktop et mobile ont été contrôlées. Un scan source ciblant les termes de démonstration, simulation et les anciens libellés d’activation n’a retourné aucune occurrence dans les fichiers applicatifs contrôlés. Les états internes de protection et de connexion partenaire restent conservés afin d’empêcher toute exécution ou tout mouvement financier avant les autorisations, contrats, credentials et validations requis.
