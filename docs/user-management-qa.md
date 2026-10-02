# QA User Management — Africoin Trading v2

La console `/admin/users` a été vérifiée sur desktop (1280×720) et mobile (390×844). La navigation affiche l’entrée « Utilisateurs » uniquement dans l’espace administrateur. Le répertoire présente la recherche, les filtres de rôle et de statut, un résumé KYC/alertes/wallets, ainsi que les contrôles « Précédent » et « Suivant ».

La fiche utilisateur est maintenant ouverte dans un drawer latéral sur desktop et dans un panneau pleine largeur sur mobile. Les actions « Restreindre », « Bloquer », « Réactiver » et « Modifier le rôle » passent par une confirmation et demandent une justification. Le drawer conserve une lisibilité correcte sur mobile, sans débordement horizontal observé.

Validation technique : `pnpm check` réussi et 29 tests Vitest réussis.

Après l’ajout de la pagination et du drawer responsive, une nouvelle vérification desktop/mobile confirme que les boutons de pagination restent dans le cadre, que le répertoire ne déborde pas sur mobile et que le panneau de contexte est remplacé par un drawer d’action adapté. Les statuts Restreint, Bloqué et Actif sont exposés depuis ce drawer et passent par la confirmation avec justification.
