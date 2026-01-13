Toutes les actions demandées ont été effectuées avec succès dans `main.ts` :

1.  **Mise à jour des paramètres par défaut** :
    *   `futureTasksCount` est passé de 5 à **10** dans `DEFAULT_SETTINGS`.

2.  **Correction de `FutureOccurrencesModal`** :
    *   Suppression de la ligne forcée `this.count = 15;` dans le constructeur. `this.count` est maintenant correctement initialisé avec la valeur passée en argument.
    *   Dans `onOpen()`, la limite d'affichage utilise désormais `this.count` au lieu de la valeur fixe `15`.

3.  **Mise à jour des réglages (`SimpleTasksBlocksSettingTab`)** :
    *   Le menu déroulant pour "Number of future tasks to display" propose maintenant des valeurs de **1 à 15** (au lieu de 1 à 10), permettant à l'utilisateur de choisir le maximum s'il le souhaite.

4.  **Vérification de l'appel** :
    *   J'ai confirmé que `renderTask` appelle bien la modal avec `this.plugin.settings.futureTasksCount` comme troisième argument. Comme la modal respecte maintenant ce paramètre, le nombre de tâches affichées sera bien celui choisi par l'utilisateur.

Le comportement est maintenant dynamique et piloté par les préférences de l'utilisateur.