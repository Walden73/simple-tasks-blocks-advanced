J'ai terminé les modifications demandées.

1.  **Dans `main.ts`** :
    *   J'ai déplacé le bouton `addCategoryBtn` ("+ category") du conteneur central (`stb-header-part-center`) vers le conteneur de droite (`stb-header-part-right`).
    *   Il est maintenant ajouté *avant* les boutons d'icônes (tri, déplier, nettoyer), se positionnant ainsi à leur gauche.

2.  **Dans `styles.css`** :
    *   J'ai modifié la grille `.stb-header-grid` pour passer de 3 colonnes (`1fr auto 1fr`) à 2 colonnes (`1fr auto`).
    *   J'ai masqué la partie centrale `.stb-header-part-center` avec `display: none`.
    *   J'ai ajusté `.stb-header-part-right` pour ajouter `align-items: center` et augmenter légèrement l'espacement (`gap: 12px`) pour un rendu harmonieux entre le bouton texte et les icônes.

Le bouton "+ category" se trouve désormais proprement aligné à droite avec les autres contrôles, laissant tout l'espace nécessaire à gauche pour le sélecteur de contexte (Local/Shared).