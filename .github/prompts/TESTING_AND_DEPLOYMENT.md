# Guide de Test et Déploiement - KeypoolLive Vault

**Dernière mise à jour :** 5 mai 2026  
**Pour :** Continue v1.3.39 fork KeypoolLive

---

## Phase 1 : Vérification de la compilation

### 1.1 Build du core

```bash
cd /Users/rlemeill/Development/continue

# Variables d'environnement requises
export PYTHON=/usr/local/opt/python@3.11/bin/python3.11
export KEYPOOL_LIVE_SECRET="test-secret-key"

# Installation des dépendances
npm install

# Build du core
cd core
npm run build
cd ..

# Résultat attendu : ✅ build/ généré sans erreur
```

### 1.2 Build de l'extension VS Code

```bash
cd extensions/vscode

# Vérification de la syntaxe TypeScript
npm run tsc:check

# Build esbuild
npm run esbuild

# Résultat attendu : ✅ out/ généré, pas d'erreurs TypeScript
```

### 1.3 Build du GUI

```bash
cd gui

# TypeScript check
npm run type-check

# Vérification des imports
npm run eslint

# Résultat attendu : ✅ Pas d'erreurs ESLint
```

---

## Phase 2 : Tests unitaires (optionnel)

```bash
# Dans core/
npm run test

# Dans extensions/vscode/
npm run test

# Résultats attendus :
# ✅ Tous les tests passent
# ✅ Pas de avertissements
```

---

## Phase 3 : Tests d'intégration locaux

### 3.1 Lancer l'extension en mode développement

```bash
cd /Users/rlemeill/Development/continue/extensions/vscode

# Terminal 1 : Mode watch (rechargement automatique)
npm run esbuild-watch

# Terminal 2 : Lancer VS Code avec l'extension
KEYPOOL_LIVE_SECRET="test-secret" code --extensionDevelopmentPath=. ../../gui
```

### 3.2 Tester sans vault (mode dégradé)

**Action :** Lancer Continue sans `KEYPOOL_LIVE_SECRET`

**Résultat attendu :**

- ✅ Continue démarre normalement
- ✅ Les modèles vault n'apparaissent pas
- ✅ Les modèles utilisateur (s'il en existe) fonctionnent
- ⚠️ Un avertissement est logué en console (console VS Code)

### 3.3 Tester avec vault (mode complet)

**Prérequis :**

- Variable `KEYPOOL_LIVE_SECRET` définie avec la vraie clé
- URL du vault dans `KEYPOOL_LIVE_VAULT_URL` ou paramètres VS Code

**Actions de test :**

1. **Démarrage**

   - [ ] Continue démarre sans erreur
   - [ ] Console ne montre pas d'erreurs KeypoolLive
   - [ ] Pas de 30-secondes hang au démarrage

2. **Modèles disponibles**

   - [ ] Ouvrir le sélecteur de modèle
   - [ ] Chercher "[KeypoolLive]" dans la liste
   - [ ] Au moins un modèle vault visible (ex: `[KeypoolLive] groq/llama-3.3-70b-versatile`)

3. **Sélection d'un modèle vault**

   - [ ] Cliquer sur un modèle vault
   - [ ] Modèle sélectionné apparaît dans l'input toolbar
   - [ ] **Nouveau :** Bouton "Chg. Key" 🔑 visible à côté du sélecteur

4. **Première requête**

   - [ ] Taper : "Hello, what's your name?"
   - [ ] Appuyer Entrée
   - [ ] La réponse arrive (30-60 secondes max)
   - [ ] Pas d'erreur 401/429

5. **Rotation de clé manuelle**

   - [ ] Cliquer sur le bouton "Chg. Key"
   - [ ] État passe à "..." (loading)
   - [ ] Après 1-2 sec, passe à "Done" avec checkmark ✓
   - [ ] Notification VS Code : "KeypoolLive: Switched to key [owner]"
   - [ ] Bouton revient à "Chg. Key"

6. **Contexte préservé**

   - [ ] Envoyer une autre requête après rotation de clé
   - [ ] La conversation continue normalement
   - [ ] Pas de perte d'historique

7. **Fallback automatique (si applicable)**
   - [ ] Attendre que la clé actuelle atteigne sa limite (429)
   - [ ] Continue effectue fallback automatiquement
   - [ ] Requête est relancée avec nouvelle clé
   - [ ] Aucune interaction utilisateur requise

---

## Phase 4 : Scénarios edge cases

### 4.1 Toutes les clés épuisées

**Setup :**

```bash
# Modifier temporairement KeyPool.ts pour forcer échecs
# ou attendre que toutes les clés soient en cooldown
```

**Test :**

- [ ] Console affiche : `[KeypoolLive] All keys for groq are on cooldown, using fallback`
- [ ] Continue utilise la clé la moins récemment échouée
- [ ] Pas de crash

### 4.2 Vault inaccessible

**Setup :**

- Couper la connexion réseau ou modifier l'URL du vault

**Test :**

- [ ] Erreur loggée : `[KeypoolLive] Failed to load vault: ...`
- [ ] Continue continue de fonctionner avec modèles existants
- [ ] Modèles vault ne sont pas disponibles

### 4.3 Vault invalide (mauvaise clé de déchiffrement)

**Setup :**

- `KEYPOOL_LIVE_SECRET` incorrect

**Test :**

- [ ] Erreur loggée : `KEYPOOL_LIVE_SECRET not set` ou erreur de déchiffrement
- [ ] Modèles vault ne chargent pas
- [ ] Continue fonctionne normalement avec modèles existants

### 4.4 Changement rapide de clés

**Test :**

- [ ] Cliquer "Chg. Key" plusieurs fois rapidement
- [ ] Pas de race condition
- [ ] La dernière action est respectée
- [ ] Pas de crash

### 4.5 Sélection rapide de modèles différents

**Test :**

- [ ] Sélectionner modèle vault A
- [ ] Rapidement changer pour modèle vault B
- [ ] Les clés sont indépendantes par (sessionId, provider, model)
- [ ] Pas de collision

---

## Phase 5 : Tests de régression

### 5.1 Les modèles non-vault continuent de fonctionner

**Test :**

- [ ] Ajouter un modèle Anthropic personnel dans `~/.continue/config.yaml`
- [ ] Modèle apparaît dans le sélecteur
- [ ] Sélectionner et utiliser le modèle
- [ ] ✅ Fonctionne normalement (pas affecté par vault)

### 5.2 Pas de ralentissement de démarrage

**Test :**

- [ ] Mesurer temps de démarrage avec vault ON vs OFF
- [ ] Écart acceptable : < 2-3 secondes
- [ ] Pas de freeze pendant le chargement

### 5.3 Autocomplete non affecté

**Test :**

- [ ] Tab autocomplete activé
- [ ] Écrire du code
- [ ] ✅ Les suggestions apparaissent normalement
- [ ] Aucun impact du vault

### 5.4 Edit mode non affecté

**Test :**

- [ ] Ouvrir un fichier
- [ ] Sélectionner du code, Cmd+I
- [ ] Edit panel s'ouvre
- [ ] Modifier le code avec un modèle vault
- [ ] ✅ Fonctionne correctement

---

## Phase 6 : Packaging et distribution

### 6.1 Empaqueter l'extension VSIX

```bash
cd extensions/vscode

# Mettre à jour la version dans package.json
# "version": "1.3.39-keypoollive.1"

# Mettre à jour la version du publisher si nécessaire
# "publisher": "KeypoolLive"

# Préparer le package
npm run vscode:prepublish

# Générer le VSIX
npx vsce package --out ./continue-keypoollive.vsix

# Résultat attendu :
# ✅ Fichier : extensions/vscode/continue-keypoollive.vsix (20-50 MB)
```

### 6.2 Tester l'installation du VSIX

```bash
# Fermer toutes les instances de VS Code
pkill -f "code --extensionDevelopmentPath"

# Installer l'extension
code --install-extension ./extensions/vscode/continue-keypoollive.vsix

# Lancer VS Code
KEYPOOL_LIVE_SECRET="..." code .

# Tester (voir Phase 3.3)
```

### 6.3 Distribution

**Options :**

1. **GitHub Releases**

   - Créer un release avec le VSIX attaché
   - URL : `https://github.com/TEA-ching/continue/releases/`

2. **VS Code Marketplace**

   - Soumettre l'extension publiée officiellement
   - Nécessite un compte publisher

3. **Distribution manuelle**
   - Envoyer le VSIX par email ou partage de fichier
   - Instructions d'installation : `code --install-extension continue-keypoollive.vsix`

---

## Déploiement en production

### Checklist de production

- [ ] Tous les tests passent
- [ ] Pas d'avertissements console
- [ ] Variables d'environnement documentées
- [ ] VSIX packagé et testé
- [ ] Documentation équipe mise à jour
- [ ] Backups des clés de déchiffrement
- [ ] Plan de rollback défini

### Rollback en cas de problème

```bash
# Désinstaller l'extension KeypoolLive
code --uninstall-extension KeypoolLive.continue

# Installer la version officielle (si nécessaire)
code --install-extension Continue.continue

# Ou réinstaller la version précédente du VSIX
code --install-extension ./continue-[old-version].vsix
```

---

## Logs et débogage

### Localiser les logs

**VS Code Console :**

```
Help → Toggle Developer Tools → Console tab
```

**Chercher :**

- `[KeypoolLive]` pour logs du vault
- `[FufuniKeyPool]` pour logs du round-robin
- `[FufuniVaultInjector]` pour logs d'injection
- `[FufuniSession]` pour logs de session

### Niveaux de log

| Prefix          | Niveau | Raison                                   |
| --------------- | ------ | ---------------------------------------- |
| `[KeypoolLive]` | INFO   | Opérations normales                      |
| `[KeypoolLive]` | WARN   | Fallback, cooldown                       |
| `[KeypoolLive]` | ERROR  | Vault inaccessible, déchiffrement échoué |

### Exemples de logs attendus

```
[KeypoolLive] Session abc123... assigned key ...gsk_yyy
[KeypoolLive] Key ...abc... for groq failed (count: 1)
[KeypoolLive] All keys for groq are on cooldown, using fallback
[KeypoolLive] Failed to inject vault models: Error: KEYPOOL_LIVE_SECRET not set
```

---

## Dépannage courant

### Symptôme : Modèles vault n'apparaissent pas

**Diagnostic :**

1. Vérifier console Continue : chercher `[KeypoolLive]`
2. Vérifier `KEYPOOL_LIVE_SECRET` défini
3. Vérifier `continue.keypoollive.vaultUrl` configuré
4. Vérifier connexion réseau (accès à https://mcp.fufuni.pp.ua/)

**Solutions :**

```bash
# Vérifier env var
echo $KEYPOOL_LIVE_SECRET

# Redémarrer VS Code avec env var
KEYPOOL_LIVE_SECRET="..." code .

# Vérifier le vault est accessible
curl -I https://mcp.fufuni.pp.ua/ai.json.enc
```

### Symptôme : Erreur 401 en utilisant un modèle vault

**Cause probable :** Clé API expirée ou quota atteint

**Solutions :**

1. Cliquer "Chg. Key" pour basculer vers une autre clé
2. Vérifier dans le vault que les clés ne sont pas marquées `"type": "expired"`
3. Attendre le cooldown de 15 minutes avant de retenter

### Symptôme : Fallback automatique trop agressif

**Cause :** Configurations réseau lente ou rate-limit faible

**Solutions :**

1. Augmenter le cooldown (ligne 13 de KeyPool.ts) : `KEY_COOLDOWN_MS = 30 * 60 * 1000` (30 min)
2. Augmenter `MAX_FAILURE_COUNT` si besoin
3. Ajouter un délai avant retry (voir VaultLlmWrapper.ts)

---

## Performance et optimisation

### Métriques à surveiller

| Métrique                      | Cible   | Acceptable |
| ----------------------------- | ------- | ---------- |
| Temps démarrage (avec vault)  | < 5s    | < 10s      |
| Latence première requête      | < 3s    | < 5s       |
| Temps rotation clé            | < 1s    | < 2s       |
| Taille mémoire (clés cachées) | < 10 MB | < 50 MB    |

### Profiling (opcional)

```bash
# Lancer VS Code avec Node profiler
NODE_OPTIONS="--prof" code .

# Analyser après avoir fermé :
node --prof-process isolate-*.log > profile.txt
```

---

## Support et escalade

**Issues:**

- Ouvrir une issue sur https://github.com/TEA-ching/continue/issues
- Tag : `keypoollive`, `vault`, `ai-api-keys`

**Contact:**

- Slack : `#dev-ai-tools`
- Email : ronan.le_meillat@cdvl59.eu.org

---

_Guide mis à jour pour la v1.3.39. Procédures testées et validées._
