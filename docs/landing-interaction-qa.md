# QA — Landing interactive

La landing publique `/` a été vérifiée dans Chromium. La navigation principale expose les ancres Marchés, Parcours et FAQ ainsi que la page publique Tarifs & risques. La section Marchés expose trois boutons accessibles : Actions, Forex spot et CDF / USD ; le clic change le panneau de contexte à droite. La FAQ expose trois boutons avec `aria-expanded` et ouverture/fermeture individuelle. Le menu mobile utilise un bouton avec `aria-expanded`, fermeture explicite et liens d’ancrage.

Le rendu desktop présente le hero navy, la carte de produit, les surfaces mint et les accents or/teal. Le rendu mobile empile correctement le hero, les signaux de marché, les contrôles de confiance, le parcours et la FAQ sans débordement observé. Le contenu reste prudent : aucune promesse de rendement, aucun avis client ou témoignage inventé, et le statut partenaire en attente est affiché explicitement.

La vérification interactive a confirmé que le clic sur « Forex spot » active bien le panneau « Le change sans opacité » et que le clic sur « Quels sont les frais annoncés ? » ouvre cette réponse tout en refermant la précédente. Les contrôles restent utilisables au clavier via des boutons natifs.
