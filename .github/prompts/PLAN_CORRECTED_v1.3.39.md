# Plan d'action corrigé : KeypoolLive AI Vault pour Continue v1.3.39

**Auteur :** Équipe KeypoolLive  
**Date :** Mai 2026  
**Version :** 2.0 (Corrigée pour v1.3.39)

---

## Changements par rapport au plan v1.0

La version 1.3.39 de Continue a une architecture de configuration et d'extension légèrement différente. Voici les adaptations principales :

### Points d'intégration corrigés

| v1.0                                                 | v1.3.39                                            | Raison                               |
| ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| `core/config/profile/doLoadConfig.ts`                | Même fichier, ligne 490 retourne `config`          | Pas de `ConfigResult`, retour direct |
| `extensions/vscode/src/extension/VsCodeExtension.ts` | Même fichier, propriété `webviewProtocolPromise`   | Architecture de protocole actuelle   |
| Import de `llmFromDescription`                       | Via `core/llm/llms/index.ts`                       | Vérifier export exact                |
| GUI React                                            | `gui/src/components/Chat.tsx` ou `gui/src/App.tsx` | Localisation du composant chat       |

### Modifications minimales aux fichiers existants

Nous allons modifier **exactement 3 fichiers** :

1. **`core/config/profile/doLoadConfig.ts`** - Ligne 490 : Ajouter un appel `await injectVaultModels()`
2. **`extensions/vscode/src/extension/VsCodeExtension.ts`** - Dans le constructeur : Enregistrer les handlers de vault
3. **`gui/src/components/Chat.tsx` ou autre** - Ajouter le bouton de rotation de clé

---

## Implémentation (v1.3.39)

### Étape 1 : Créer les répertoires KeypoolLive

```bash
mkdir -p core/keypoollive
mkdir -p extensions/vscode/src/keypoollive
mkdir -p gui/src/keypoollive
```

### Étape 2 : Créer les modules TypeScript dans core/keypoollive

#### 2.1 `core/keypoollive/types.ts` - Types du coffre-fort

[Même contenu que v1.0 - voir section 6.2 du plan original]

#### 2.2 `core/keypoollive/AiVault.ts` - Déchiffrement et chargement

[Même contenu que v1.0 - voir section 6.3 du plan original]

#### 2.3 `core/keypoollive/KeyPool.ts` - Pool de clés et round-robin

[Même contenu que v1.0 - voir section 7.2 du plan original]

#### 2.4 `core/keypoollive/SessionKeyManager.ts` - Gestion de session

[Même contenu que v1.0 - voir section 9.2 du plan original]

#### 2.5 `core/keypoollive/VaultLlmWrapper.ts` - Wrapper de proxy pour LLM

[Même contenu que v1.0 - voir section 9.3 du plan original]

#### 2.6 `core/keypoollive/VaultConfigInjector.ts` - Injecteur de configuration

[Même contenu que v1.0 - voir section 8.2 du plan original]

#### 2.7 `core/keypoollive/ContextMigration.ts` - Migration de contexte

[Même contenu que v1.0 - voir section 11 du plan original]

#### 2.8 `core/keypoollive/protocol.ts` - Protocole de messages webview

[Même contenu que v1.0 - voir section 10.2 du plan original]

### Étape 3 : Modifications minimales dans les fichiers existants

#### 3.1 `core/config/profile/doLoadConfig.ts` (FUFUNI VAULT: Injection du coffre)

Modification unique à la ligne 490 (avant le `return config;`) :

```typescript
// FUFUNI VAULT: Inject vault-sourced models (v1.3.39 compatible)
// Vault injection must happen after all config assembly but before returning
const { injectVaultModels } = await import(
  "../../keypoollive/VaultConfigInjector.js"
);
const { setVaultUrl } = await import(
  "../../keypoollive/VaultConfigInjector.js"
);

// Get vault URL from environment or IDE settings
const vaultUrl =
  process.env.KEYPOOL_LIVE_VAULT_URL ||
  (await ide.getIdeSettings())?.["continue.keypoollive.vaultUrl"];
if (vaultUrl) {
  setVaultUrl(vaultUrl);
  config = await injectVaultModels(config, ideSettings, llmLogger);
}

return config;
```

#### 3.2 `extensions/vscode/src/extension/VsCodeExtension.ts` (Enregistrement des handlers)

Dans la méthode `activate()` du constructeur, après initialisation de `webviewProtocolPromise` :

```typescript
// FUFUNI VAULT: Register vault-related message handlers (v1.3.39)
this.webviewProtocolPromise.then((protocol) => {
  const {
    registerVaultHandlers,
  } = require("./keypoollive/VaultCommandHandler");
  registerVaultHandlers(protocol, this.extensionContext);
});
```

#### 3.3 Intégration du bouton dans le GUI

À localiser dans le composant chat principal (probablement `gui/src/components/Chat.tsx` ou équivalent) :

```tsx
// FUFUNI VAULT: Add key rotation button for vault models (v1.3.39)
import { VaultKeyRotateButton } from "../keypoollive/VaultKeyRotateButton";

// Dans le rendu du chat, ajouter le bouton après le sélecteur de modèle :
{
  currentModel?._fufuniVault && (
    <VaultKeyRotateButton
      sessionId={sessionId}
      providerName={(currentModel as any)._fufuniProviderName}
      modelId={currentModel.model}
    />
  );
}
```

### Étape 4 : Créer les handlers de commandes VS Code

#### 4.1 `extensions/vscode/src/keypoollive/VaultCommandHandler.ts`

[Même contenu que v1.0 - voir section 10.3 du plan original]

### Étape 5 : Créer le composant React

#### 5.1 `gui/src/keypoollive/VaultKeyRotateButton.tsx`

[Même contenu que v1.0 - voir section 10.4 du plan original]

### Étape 6 : Configuration VS Code

Ajouter à `extensions/vscode/package.json` sous `contributes.configuration.properties` :

```json
"continue.keypoollive.vaultUrl": {
  "type": "string",
  "default": "",
  "description": "URL of the encrypted KeypoolLive AI vault (ai.json.enc)"
},
"continue.keypoollive.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Enable KeypoolLive vault models"
}
```

Et enregistrer la commande dans `contributes.commands` :

```json
{
  "command": "continue.keypoollive.rotateKey",
  "title": "Continue: Rotate KeypoolLive API Key",
  "category": "Continue"
}
```

---

## Différences clés v1.0 → v1.3.39

1. **Module import dynamique** : Utiliser `await import()` pour les imports dans `doLoadConfig.ts`
2. **Pas de `ConfigResult`** : `doLoadConfig` retourne directement `ContinueConfig`
3. **WebviewProtocol** : V1.3.39 utilise une Promise pour `webviewProtocolPromise`, pas d'accès direct
4. **IDE settings** : V1.3.39 utilise `ide.getIdeSettings()` pour les paramètres de config

---

## Checklist d'implémentation (v1.3.39)

- [ ] Créer `core/keypoollive/` avec les 8 fichiers TypeScript
- [ ] Modifier `core/config/profile/doLoadConfig.ts` (1 modification)
- [ ] Créer `extensions/vscode/src/keypoollive/VaultCommandHandler.ts`
- [ ] Modifier `extensions/vscode/src/extension/VsCodeExtension.ts` (1 modification)
- [ ] Créer `gui/src/keypoollive/VaultKeyRotateButton.tsx`
- [ ] Localiser le composant Chat et ajouter le bouton
- [ ] Mettre à jour `extensions/vscode/package.json`
- [ ] Tester : les modèles vault apparaissent dans Continue
- [ ] Tester : rotation de clé fonctionne
- [ ] Tester : contexte préservé lors du changement de clé

---

## Variables d'environnement

```bash
# Required for vault decryption
export KEYPOOL_LIVE_SECRET="votre-clé-secrète"

# Optional: vault URL (peut aussi être via VS Code settings)
export KEYPOOL_LIVE_VAULT_URL="https://mcp.fufuni.pp.ua/ai.json.enc"

# Lancer VS Code avec les variables
KEYPOOL_LIVE_SECRET="..." code .
```

---

## Synchronisation upstream (v1.3.39)

La stratégie reste identique car nous minimisons les modifications :

```bash
git fetch upstream
git checkout main
git rebase upstream/main
git push origin main

git checkout keypoollive
git rebase main
# Résoudre les conflits si nécessaire (probablement aucun)
git push --force-with-lease origin keypoollive
```

Tous les conflits potentiels seront dans les fichiers marqués `// FUFUNI VAULT:`, faciles à identifier.

---

_Ce plan v2.0 est adapté à Continue v1.3.39 et prêt pour l'implémentation._
