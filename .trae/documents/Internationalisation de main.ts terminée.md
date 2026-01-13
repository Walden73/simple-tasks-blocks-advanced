J'ai terminé l'internationalisation de `main.ts`.

Voici ce que j'ai fait :
1.  **Import de `t`** : J'ai ajouté l'import de `t` depuis `./l10n` au début du fichier.
2.  **Remplacement des chaînes** : J'ai parcouru le fichier `main.ts` et remplacé les chaînes de caractères visibles par l'utilisateur par des appels à `t('CLE')` ou `t('CLE', variable)`.
    *   **Plugin** : Titre du ruban, commandes, messages de nettoyage.
    *   **Vue** : Titres, boutons, infobulles, menus contextuels, messages de confirmation.
    *   **Paramètres** : Noms, descriptions, options, boutons.
    *   **Modals** : Titres, labels, placeholders, boutons, messages d'erreur et de confirmation.
3.  **Respect des clés** : J'ai utilisé exclusivement les clés présentes dans `l10n.ts`.
4.  **Formatage** : J'ai veillé à ce que les messages dynamiques utilisent correctement les arguments.

**Notes :**
*   Certaines erreurs techniques (logs console ou messages d'erreur très spécifiques liés aux fichiers partagés) n'avaient pas de clés correspondantes dans `l10n.ts`, je les ai laissées telles quelles pour éviter d'inventer des clés ou de casser le fonctionnement, conformément à la contrainte d'utiliser les clés existantes.
*   Les termes "ascending" et "descending" pour le tri sont restés en anglais car il n'y a pas de clés pour eux dans `l10n.ts`.
