j'ai découvert l'extension vscode de Continue @file:package.json qui est un outil extraordinaire.
J'ai lié le dépôt original de Continue dans apps/continue
Pour les besoins de fufuni j'ai développé une architecture de coffre for crypté de clefs et de modèles gratuits d'intelligence artificielle qui utilise une version cryptée de @file:ai.json via @file:ai-enc.ts
Je voudrais que tu analyses la possibilité de forker l'extension vscode de Continue pour lui ajouter une fonctionnalité multi modèle avec round-robin qui utiliserait mon coffre-fort contenant le pool de clefs via une url publique et la clé de décryptage CRYPTOKEN dans une variable d'environnement.

- Je voudrais que les modèles proposés par le vsix Continue soient constuits avec le coffre fort
- Je voudrais qu'à chaque nouvelle session de chat dans Continue VSIX une clef correcte soit utilisée pour le modèle sélectionné.
- Un bouton doit permettre dans le chat de l'extension de changer de clef et de migrer le contexte sur la nouvelle clef
- Je voudrais que mes modifications puissent être rapidement adaptée à chaque évolution du dépôt original Continue

Je veux que tu me rédiges un pan d'action dans `.github/prompt/plan_action_cotinue_ai_json_key_pool.md`
Ce plan d'action doit :

- faire au minimum 10000 mots.
- s'adresser à des développeurs junior ne connaissant pas le projet Continue ni son extension vsix
- être écrit en français
- comporter des exemples de code en anglais adapté au code actuel de Constinue et de son extension vsix. Les exemples de code dooivent être commentés en anglais.
