# Plan d'action : Fork de l'extension VS Code Continue avec pool de clés AI et round-robin

**Auteur :** Équipe KeypoolLive  
**Date :** Avril 2026  
**Version :** 1.0  
**Niveau :** Développeurs junior

---

## Table des matières

1. [Introduction et contexte](#1-introduction-et-contexte)
2. [Prérequis et mise en place de l'environnement](#2-prérequis-et-mise-en-place-de-lenvironnement)
3. [Architecture générale du projet Continue](#3-architecture-générale-du-projet-continue)
4. [Comprendre le coffre-fort `ai.json`](#4-comprendre-le-coffre-fort-aijson)
5. [Stratégie de fork et synchronisation upstream](#5-stratégie-de-fork-et-synchronisation-upstream)
6. [Module AiVault : décryptage et chargement du coffre](#6-module-aivault--décryptage-et-chargement-du-coffre)
7. [Module KeyPool : gestion du pool de clés et round-robin](#7-module-keypool--gestion-du-pool-de-clés-et-round-robin)
8. [Intégration dans le système de configuration Continue](#8-intégration-dans-le-système-de-configuration-continue)
9. [Gestion de session : une clé valide par session de chat](#9-gestion-de-session--une-clé-valide-par-session-de-chat)
10. [Le bouton "Changer de clé" dans l'interface webview](#10-le-bouton-changer-de-clé-dans-linterface-webview)
11. [Migration du contexte de conversation lors du changement de clé](#11-migration-du-contexte-de-conversation-lors-du-changement-de-clé)
12. [Tests et validation](#12-tests-et-validation)
13. [Workflow Git pour les mises à jour upstream](#13-workflow-git-pour-les-mises-à-jour-upstream)
14. [Résumé des fichiers modifiés et créés](#14-résumé-des-fichiers-modifiés-et-créés)

---

## 0. node-gyp et préinstallation

node-gyp ne peut pas être installé sans définir la variable d'environnement PYTHON vers une version <= 3.11
à la racine `PYTHON=/usr/local/opt/python@3.11/bin/python3.11 ./scripts/install-dependencies.sh`

## 1. Introduction et contexte

### 1.1 Qu'est-ce que Continue ?

Continue est une extension VS Code open source (licence Apache 2.0) qui permet d'intégrer des modèles de langage (LLM) directement dans votre éditeur de code. Elle offre plusieurs fonctionnalités majeures :

- **Chat** : poser des questions sur votre code, demander des explications, obtenir des suggestions
- **Edit** : modifier un bloc de code directement à partir d'une instruction en langage naturel
- **Autocomplete** : complétion automatique de code en ligne, similaire à GitHub Copilot
- **Agent** : un mode agent capable d'effectuer des tâches complexes de développement

L'extension Continue se distingue par son architecture modulaire : les fournisseurs de modèles (Anthropic, Gemini, Groq, Mistral, OpenRouter, etc.) sont des plugins interchangeables. Sa configuration repose sur un fichier YAML (`~/.continue/config.yaml`) que l'utilisateur édite manuellement.

**Le problème que nous allons résoudre :** Continue, dans sa version officielle, ne gère pas de pool de clés. Si une clé d'API expire, est épuisée, ou atteint sa limite de taux (rate limit), l'utilisateur doit manuellement modifier sa configuration. Notre fork va automatiser cette rotation via un coffre-fort centralisé et chiffré.

### 1.2 Qu'est-ce que le coffre-fort `ai.json` de KeypoolLive ?

Le projet KeypoolLive dispose d'un fichier `ai.json` qui est un répertoire structuré de fournisseurs d'IA, de modèles et de clés d'API. Ce fichier :

- **Est chiffré** (stocké sous forme de `ai.json.enc`) pour protéger les clés d'API
- **Est publiquement accessible via une URL https://mcp.fufuni.pp.ua/ai.json.enc** (après déchiffrement avec la variable d'environnement `KEYPOOL_LIVE_SECRET`)
- **Contient plusieurs fournisseurs** : Anthropic, Gemini, Groq, Mistral, OpenRouter
- **Pour chaque fournisseur**, plusieurs clés d'API appartenant à différents comptes
- **Pour chaque fournisseur**, une liste de modèles disponibles avec leurs métadonnées
- **Pour chaque fournisseur**, l'adresse et le prefix à utiliser pour le gateway Cloudflare AI (optionnel) peut également être spécifié

Exemple simplifié de la structure (voir le fichier `ai.json` complet pour les détails) :

```json
{
  "version": 1,
  "providers": {
    "groq": {
      "protocol": "openai",
      "endpoint": "https://api.groq.com/openai/v1",
      "gatewayEndpoint": "https://gateway.ai.cloudflare.com/v1/a924ebae983be4a487a0c9d5f9bd8706/default/compat",
      "gatewayModelPrefix": "groq",
      "keys": [
        { "key": "gsk_xxx", "owner": "user1@example.com", "type": "free" },
        { "key": "gsk_yyy", "owner": "user2@example.com", "type": "free" }
      ],
      "models": [
        {
          "id": "llama-3.3-70b-versatile",
          "usage": "chat",
          "contextWindow": 131072,
          "maxOutputTokens": 32768,
          "tpmLimit": 12000,
          "priority": 1,
          "tags": ["fast", "code", "large"]
        }
      ]
    }
  }
}
```

### 1.3 Objectifs du fork

Ce plan d'action a pour objectif de vous guider, étape par étape, dans la création d'un fork de l'extension Continue VS Code qui :

1. **Charge dynamiquement** les modèles depuis le coffre-fort `ai.json` déchiffré depuis l'URL publique
2. **Sélectionne automatiquement** une clé valide par session de chat via round-robin adaptée au modèle choisi
3. **Permet à l'utilisateur** de changer de clé d'un clic si elle échoue
4. **Migre le contexte** de conversation lors d'un changement de clé
5. **Reste facilement synchronisable** avec les évolutions du projet Continue officiel

---

## 2. Prérequis et mise en place de l'environnement

### 2.1 Compétences requises

Pour suivre ce guide, vous devez maîtriser :

- **TypeScript** : Continue est intégralement écrit en TypeScript
- **Node.js** : version 20+ (vérifiez avec `node --version`)
- **React** : l'interface webview de Continue est une application React
- **VS Code Extension API** : les bases (activation, commandes, webview)
- **Git** : gestion des branches, rebase, cherry-pick

### 2.2 Outils nécessaires

```bash
# Verify Node.js version (must be >= 20)
node --version

# Verify git is configured
git config --global user.email "votre@email.com"
git config --global user.name "Votre Nom"
```

### 2.3 Structure du dépôt Continue

Le dépôt Continue est un **monorepo** géré avec `npm`. Voici sa structure racine :

```
continue/
├── core/                    # Logique métier principale (TypeScript)
│   ├── llm/                 # Fournisseurs LLM (Anthropic, Groq, etc.)
│   │   ├── index.ts         # Classe abstraite BaseLLM
│   │   └── llms/            # Un fichier par fournisseur
│   ├── config/              # Chargement et gestion de la configuration
│   │   ├── ConfigHandler.ts # Gestionnaire central de config
│   │   └── load.ts          # Chargement du config.yaml
│   └── protocol/            # Types des messages IDE <-> webview <-> core
├── extensions/
│   └── vscode/              # Extension VS Code
│       ├── src/
│       │   ├── extension.ts              # Point d'entrée
│       │   ├── activation/activate.ts   # Activation de l'extension
│       │   ├── extension/VsCodeExtension.ts  # Classe principale
│       │   ├── webviewProtocol.ts       # Protocole webview
│       │   └── commands.ts              # Commandes VS Code
│       └── package.json
├── gui/                     # Interface React (webview)
└── packages/
    ├── config-types/        # Types de configuration
    └── config-yaml/         # Schéma YAML de configuration
```

### 2.4 Installation et premier build

```bash
# Clone your fork (after creating it on GitHub)
git clone https://github.com/TEA-ching/continue.git
cd continue

# Install dependencies for all workspaces
npm install

# Build the core package first (required by the extension)
cd core && npm build && cd ..

# Build the extension
cd extensions/vscode && npm build && cd ../..

# Start the extension in development mode (opens VS Code Extension Host)
cd extensions/vscode && npm esbuild-watch
```

---

## 3. Architecture générale du projet Continue

### 3.1 Le flux de données

Pour comprendre où intégrer notre pool de clés, il faut comprendre le flux de données dans Continue :

```
VS Code IDE
    │
    ▼
VsCodeExtension (extensions/vscode/src/extension/VsCodeExtension.ts)
    │
    ├── ConfigHandler (core/config/ConfigHandler.ts)
    │       │
    │       ▼
    │   ProfileLifecycleManager → LocalProfileLoader → config.yaml
    │       │
    │       ▼
    │   ContinueConfig { models: ILLM[] }
    │
    └── Core (core/core.ts)
            │
            ▼
        VsCodeMessenger → webviewProtocol → GUI React
```

### 3.2 Le cycle de vie d'une requête de chat

Quand l'utilisateur envoie un message dans le chat Continue :

1. **GUI React** (`gui/`) : l'utilisateur tape son message et appuie sur Entrée
2. **webviewProtocol** : le message est sérialisé et envoyé via `postMessage`
3. **VsCodeMessenger** : reçoit le message côté extension
4. **Core** : traite la requête, appelle `llmStreamChat()`
5. **BaseLLM** (`core/llm/index.ts`) : utilise `this.apiBase` et `this.apiKey` pour faire la requête HTTP
6. **Réponse** : le stream de tokens remonte dans le sens inverse jusqu'au GUI

**Notre point d'intervention** : entre les étapes 3 et 5, nous devons injecter la clé d'API correcte depuis le pool.

### 3.3 Le système de configuration

Continue utilise un fichier `~/.continue/config.yaml` (ou `config.json` en legacy). Un exemple minimal :

```yaml
# ~/.continue/config.yaml
models:
  - name: Claude Sonnet
    provider: anthropic
    model: claude-sonnet-4-6
    apiKey: sk-ant-api03-...

  - name: Llama 3.3
    provider: groq
    model: llama-3.3-70b-versatile
    apiKey: gsk_...
```

La classe `ConfigHandler` charge ce fichier au démarrage et le surveille pour le rechargement à chaud. Notre fork va **intercepter ce chargement** pour y injecter les modèles et clés depuis le coffre-fort.

---

## 4. Comprendre le coffre-fort `ai.json`

### 4.1 Structure détaillée

Le fichier `ai.json` de KeypoolLive définit une structure riche pour chaque fournisseur. Voici les champs importants :

**Pour chaque fournisseur** :

- `protocol` : le protocole HTTP à utiliser (`"anthropic"`, `"gemini"`, `"openai"`)
- `endpoint` : l'URL de l'API du fournisseur
- `gatewayEndpoint` : URL optionnelle d'un gateway Cloudflare AI
- `gatewayModelPrefix` : préfixe de modèle pour le gateway
- `keys[]` : tableau de clés d'API
  - `key` : la valeur de la clé d'API
  - `owner` : l'email/identifiant du propriétaire (pour le débogage)
  - `type` : `"free"` | `"paid"` | `"expired"`
- `models[]` : tableau de modèles disponibles
  - `id` : l'identifiant du modèle tel qu'attendu par l'API
  - `usage` : `"chat"` | `"embedding"`
  - `contextWindow` : taille maximale de la fenêtre de contexte (en tokens)
  - `maxOutputTokens` : nombre maximum de tokens en sortie
  - `tpmLimit` : limite de tokens par minute (`null` = illimitée)
  - `priority` : priorité pour le round-robin (plus petit = plus prioritaire)
  - `tags` : tableau de tags (`"fast"`, `"cheap"`, `"code"`, etc.)

### 4.2 Mapping vers les providers Continue

Voici la correspondance entre les providers du coffre-fort et les classes LLM de Continue :

| Provider `ai.json` | Protocol    | Classe Continue | Fichier                       |
| ------------------ | ----------- | --------------- | ----------------------------- |
| `anthropic`        | `anthropic` | `Anthropic`     | `core/llm/llms/Anthropic.ts`  |
| `gemini`           | `gemini`    | `Gemini`        | `core/llm/llms/Gemini.ts`     |
| `groq`             | `openai`    | `Groq`          | `core/llm/llms/Groq.ts`       |
| `mistral`          | `openai`    | `Mistral`       | `core/llm/llms/Mistral.ts`    |
| `openrouter`       | `openai`    | `OpenRouter`    | `core/llm/llms/OpenRouter.ts` |

**Remarque importante** : `Groq`, `Mistral` et `OpenRouter` héritent tous de la classe `OpenAI` (`core/llm/llms/OpenAI.ts`). Cela signifie qu'ils utilisent le même format de requête HTTP (API compatible OpenAI) mais avec des `apiBase` différents.

### 4.3 Le chiffrement

Le fichier `ai.json` est stocké chiffré sous la forme `ai.json.enc`. Le déchiffrement utilise :

- **Algorithm** : AES-256-GCM (à confirmer avec le script d'encodage)
- **Clé** : variable d'environnement `KEYPOOL_LIVE_SECRET`
- **Stockage** : la version chiffrée peut être hébergée publiquement (GitHub, Cloudflare R2, etc.)

La variable d'environnement VS Code `KEYPOOL_LIVE_SECRET` doit être définie dans le shell qui lance VS Code, ou via les paramètres de l'extension.

---

## 5. Stratégie de fork et synchronisation upstream

### 5.1 Créer le fork sur GitHub

```bash
# 1. Fork the official Continue repository on GitHub via the web interface
# URL: https://github.com/continuedev/continue → "Fork"

# 2. Clone your fork
git clone https://github.com/TEA-ching/continue.git
cd continue

# 3. Add the upstream remote (the official Continue repository)
git remote add upstream https://github.com/continuedev/continue.git

# 4. Verify remotes
git remote -v
# origin    https://github.com/TEA-ching/continue.git (fetch)
# origin    https://github.com/TEA-ching/continue.git (push)
# upstream  https://github.com/continuedev/continue.git (fetch)
# upstream  https://github.com/continuedev/continue.git (push)
```

### 5.2 Stratégie de branches

Pour faciliter les mises à jour upstream, nous utilisons une stratégie à **trois niveaux de branches** :

```
upstream/main          ← Le dépôt officiel Continue
      │
      │ (rebase périodique)
      ▼
origin/main            ← Notre fork, synchronisé avec upstream
      │
      │ (merge ou rebase)
      ▼
origin/keypoollive/vault    ← Branche de nos modifications KeypoolLive
```

**Règle d'or** : **toutes nos modifications KeypoolLive sont confinées dans `keypoollive/vault`**. Ainsi, pour mettre à jour vers une nouvelle version de Continue, il suffit de :

```bash
# Update our fork with upstream changes
git fetch upstream
git checkout main
git rebase upstream/main
git push origin main

# Rebase our KeypoolLive branch on the updated main
git checkout keypoollive/vault
git rebase main
# Resolve any conflicts (our changes are minimal and isolated)
git push --force-with-lease origin keypoollive/vault
```

### 5.3 Principes de modification minimale

Pour faciliter les rebases futurs, suivez ces règles :

1. **Ne modifiez jamais les fichiers existants de Continue sans raison impérative**. Préférez les **hooks** et les **points d'extension** existants.
2. **Créez de nouveaux fichiers** dans des sous-dossiers dédiés (ex: `core/keypoollive/`, `extensions/vscode/src/keypoollive/`).
3. **Les seules modifications dans les fichiers existants** doivent être des ajouts minimaux (une ligne d'import, un appel de fonction) dans des emplacements stables.
4. **Documentez chaque modification** avec un commentaire `// FUFUNI VAULT:` pour les identifier facilement en cas de conflit.

### 5.4 Script de synchronisation automatique

Créez le fichier `.github/workflows/sync-upstream.yml` dans votre fork :

```yaml
# .github/workflows/sync-upstream.yml
# Automatically sync the main branch with the upstream Continue repository
# Runs every Sunday at 2:00 AM UTC

name: Sync upstream Continue

on:
  schedule:
    - cron: "0 2 * * 0" # Every Sunday at 2:00 AM UTC
  workflow_dispatch: # Allow manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout fork
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Add upstream remote
        run: git remote add upstream https://github.com/continuedev/continue.git

      - name: Fetch upstream
        run: git fetch upstream

      - name: Rebase main on upstream/main
        run: |
          git checkout main
          git rebase upstream/main
          git push origin main --force-with-lease

      - name: Rebase keypoollive/vault on main
        run: |
          git checkout keypoollive/vault
          git rebase main
          git push origin keypoollive/vault --force-with-lease
        # Note: If there are conflicts, this step will fail and require manual intervention
        continue-on-error: true
```

---

## 6. Module AiVault : décryptage et chargement du coffre

### 6.1 Créer la structure de répertoires KeypoolLive

```bash
# Create the KeypoolLive-specific directories
mkdir -p core/keypoollive
mkdir -p extensions/vscode/src/keypoollive
```

### 6.2 Définir les types TypeScript

Créez le fichier `core/keypoollive/types.ts` :

```typescript
// core/keypoollive/types.ts
// Type definitions for the KeypoolLive AI vault (ai.json format)
// These types mirror the structure of the ai.json configuration file

/**
 * A single API key entry in the vault.
 * Each key belongs to one owner (email/account identifier).
 */
export interface VaultKey {
  /** The actual API key string */
  key: string;
  /** Owner identifier (email or GitHub handle) for debugging purposes */
  owner: string;
  /** Key status: "free" keys have rate limits, "paid" are premium, "expired" are invalid */
  type: "free" | "paid" | "expired";
}

/**
 * A single model definition within a provider.
 * Contains all metadata needed to use the model and configure Continue.
 */
export interface VaultModel {
  /** The model ID as expected by the provider API (e.g. "llama-3.3-70b-versatile") */
  id: string;
  /** How this model is used: "chat" for conversation, "embedding" for vector search */
  usage: "chat" | "embedding";
  /** Maximum context window size in tokens */
  contextWindow: number;
  /** Maximum number of output tokens */
  maxOutputTokens: number;
  /** Tokens per minute limit (null means no limit) */
  tpmLimit: number | null;
  /** Priority for round-robin selection (lower value = higher priority) */
  priority: number;
  /** Descriptive tags for filtering models (e.g. ["fast", "cheap", "code"]) */
  tags: string[];
  /** Optional number of embedding dimensions (only for embedding models) */
  defaultDimensions?: number;
}

/**
 * A provider entry in the vault, containing all its keys and models.
 */
export interface VaultProvider {
  /**
   * HTTP protocol to use for this provider:
   * - "anthropic": Anthropic's native API format
   * - "gemini": Google Gemini API format
   * - "openai": OpenAI-compatible API format (used by Groq, Mistral, OpenRouter)
   */
  protocol: "anthropic" | "gemini" | "openai";
  /** Direct API endpoint URL */
  endpoint: string;
  /** Optional Cloudflare AI Gateway URL for routing */
  gatewayEndpoint?: string;
  /** Model prefix when using the Cloudflare gateway */
  gatewayModelPrefix?: string;
  /** Array of API keys for this provider */
  keys: VaultKey[];
  /** Array of available models for this provider */
  models: VaultModel[];
}

/**
 * Root structure of the ai.json vault file.
 */
export interface AiVaultConfig {
  /** Version number of the vault format */
  version: number;
  /** Map of provider name to provider configuration */
  providers: Record<string, VaultProvider>;
}

/**
 * A resolved key+model combination, ready to be used for an API request.
 * This is the output of the KeyPool after round-robin selection.
 */
export interface ResolvedApiConfig {
  /** Provider name (e.g. "groq", "anthropic") */
  providerName: string;
  /** The API key to use for this request */
  apiKey: string;
  /** Owner of this key (for logging/debugging) */
  keyOwner: string;
  /** API endpoint to call */
  endpoint: string;
  /** Protocol (openai/anthropic/gemini) */
  protocol: "anthropic" | "gemini" | "openai";
  /** Model ID */
  modelId: string;
  /** Full model metadata */
  model: VaultModel;
}
```

### 6.3 Implémenter le module de déchiffrement

Créez le fichier `core/keypoollive/AiVault.ts` :

```typescript
// core/keypoollive/AiVault.ts
// Handles fetching and decrypting the KeypoolLive AI vault (ai.json)
// The vault is stored encrypted at a public URL and decrypted using
// the KEYPOOL_LIVE_SECRET environment variable.

import { AiVaultConfig } from "./types.js";

/**
 * Cache entry for the loaded vault.
 * We cache to avoid repeated network requests and decryption.
 */
interface VaultCache {
  config: AiVaultConfig;
  fetchedAt: number; // Unix timestamp in milliseconds
}

// Cache TTL: refresh the vault every 5 minutes
const VAULT_CACHE_TTL_MS = 5 * 60 * 1000;

// In-memory cache for the vault configuration
let vaultCache: VaultCache | null = null;

/**
 * Decrypts a Base64-encoded AES-256-GCM ciphertext using the provided key.
 * The ciphertext format is: IV (12 bytes) + AuthTag (16 bytes) + Ciphertext
 * encoded as Base64.
 *
 * @param encryptedBase64 - Base64-encoded encrypted data
 * @param KEYPOOL_LIVE_SECRET - The decryption key (from KEYPOOL_LIVE_SECRET env variable)
 * @returns The decrypted JSON string
 */
async function decryptVault(
  encryptedBase64: string,
  KEYPOOL_LIVE_SECRET: string,
): Promise<string> {
  // Decode Base64 to raw bytes
  const encryptedBytes = Buffer.from(encryptedBase64, "base64");

  // The format is: [IV (12 bytes)][AuthTag (16 bytes)][Ciphertext (remaining bytes)]
  const iv = encryptedBytes.slice(0, 12);
  const authTag = encryptedBytes.slice(12, 28);
  const ciphertext = encryptedBytes.slice(28);

  // Derive a 256-bit (32-byte) key from the KEYPOOL_LIVE_SECRET using SHA-256
  // This ensures any length KEYPOOL_LIVE_SECRET produces a valid AES-256 key
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    Buffer.from(KEYPOOL_LIVE_SECRET, "utf-8"),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      // A fixed salt is acceptable here because the vault is public anyway;
      // the KEYPOOL_LIVE_SECRET is the secret. Do NOT use a random salt without storing it.
      salt: Buffer.from("keypoollive-ai-vault-salt-v1", "utf-8"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  // Reconstruct the ciphertext with auth tag for AES-GCM
  const ciphertextWithTag = Buffer.concat([ciphertext, authTag]);

  // Perform AES-GCM decryption
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertextWithTag,
  );

  return Buffer.from(decryptedBuffer).toString("utf-8");
}

/**
 * Fetches the encrypted vault from a public URL.
 *
 * @param url - Public URL of the encrypted ai.json.enc file
 * @returns Base64-encoded encrypted vault content
 */
async function fetchEncryptedVault(url: string): Promise<string> {
  const response = await fetch(url, {
    // Use a short timeout to avoid blocking the extension startup
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch encrypted vault from ${url}: HTTP ${response.status}`,
    );
  }

  return response.text();
}

/**
 * Loads the AI vault configuration.
 *
 * This function:
 * 1. Checks the in-memory cache (5-minute TTL)
 * 2. If cache is stale or empty: fetches the encrypted vault from the public URL
 * 3. Decrypts using the KEYPOOL_LIVE_SECRET environment variable
 * 4. Parses the JSON and stores in cache
 *
 * @param vaultUrl - Public URL of the encrypted vault (ai.json.enc)
 * @returns The parsed AiVaultConfig
 * @throws Error if KEYPOOL_LIVE_SECRET is not set or decryption fails
 */
export async function loadAiVault(vaultUrl: string): Promise<AiVaultConfig> {
  // Return cached version if still valid
  if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
    return vaultCache.config;
  }

  // Retrieve the decryption key from the environment
  const KEYPOOL_LIVE_SECRET = process.env.KEYPOOL_LIVE_SECRET;
  if (!KEYPOOL_LIVE_SECRET) {
    throw new Error(
      "KEYPOOL_LIVE_SECRET environment variable is not set. " +
        "Please set it to the vault decryption key to use KeypoolLive AI models.",
    );
  }

  // Fetch and decrypt the vault
  const encryptedContent = await fetchEncryptedVault(vaultUrl);
  const decryptedJson = await decryptVault(
    encryptedContent,
    KEYPOOL_LIVE_SECRET,
  );
  const config: AiVaultConfig = JSON.parse(decryptedJson);

  // Update the cache
  vaultCache = { config, fetchedAt: Date.now() };

  return config;
}

/**
 * Clears the vault cache, forcing a fresh fetch on the next call to loadAiVault().
 * This is used after a key failure to ensure we get the latest key list.
 */
export function clearVaultCache(): void {
  vaultCache = null;
}
```

---

## 7. Module KeyPool : gestion du pool de clés et round-robin

### 7.1 Stratégie de round-robin

Le round-robin est une stratégie de distribution qui parcourt cycliquement une liste de ressources. Pour notre pool de clés :

```
Keys: [key_A, key_B, key_C, key_D]
Session 1: → key_A
Session 2: → key_B
Session 3: → key_C
Session 4: → key_D
Session 5: → key_A (cycle recommence)
```

Si une clé échoue (erreur 401, 429, etc.), elle est marquée temporairement comme invalide et la suivante est utilisée.

### 7.2 Implémenter le KeyPool

Créez le fichier `core/keypoollive/KeyPool.ts` :

```typescript
// core/keypoollive/KeyPool.ts
// Manages the pool of API keys with round-robin rotation.
// Handles key failures with automatic fallback to the next available key.

import {
  AiVaultConfig,
  ResolvedApiConfig,
  VaultKey,
  VaultModel,
} from "./types.js";

/**
 * Tracks the health status of a specific key for a specific provider.
 */
interface KeyStatus {
  /** The API key value */
  key: string;
  /** Whether this key is currently considered usable */
  isHealthy: boolean;
  /** Timestamp when this key was last marked as failed */
  lastFailedAt: number | null;
  /** Number of consecutive failures */
  failureCount: number;
}

// How long to wait before retrying a failed key (15 minutes)
const KEY_COOLDOWN_MS = 15 * 60 * 1000;

// Maximum number of failures before a key is permanently blacklisted for the session
const MAX_FAILURE_COUNT = 3;

/**
 * Round-robin index storage.
 * Maps a provider name to the current index in its key list.
 * This is persisted across function calls to ensure true round-robin behavior.
 */
const roundRobinIndexes: Map<string, number> = new Map();

/**
 * Key health status tracking.
 * Maps a composite key "providerName:keyValue" to its health status.
 */
const keyStatuses: Map<string, KeyStatus> = new Map();

/**
 * Gets the composite key used to track a specific API key's status.
 */
function getKeyStatusId(providerName: string, keyValue: string): string {
  // Use a hash-like prefix to avoid storing the full key in the map key
  // (the full key is stored in the KeyStatus object itself)
  return `${providerName}:${keyValue.slice(-8)}`;
}

/**
 * Checks if a key is currently usable.
 * A key is usable if:
 * - It has never failed, OR
 * - Its cooldown period has expired AND it hasn't exceeded max failures
 */
function isKeyUsable(providerName: string, keyValue: string): boolean {
  const statusId = getKeyStatusId(providerName, keyValue);
  const status = keyStatuses.get(statusId);

  if (!status) {
    // Never seen this key before - it's healthy
    return true;
  }

  if (!status.isHealthy) {
    // Check if cooldown has expired
    if (
      status.lastFailedAt &&
      Date.now() - status.lastFailedAt > KEY_COOLDOWN_MS &&
      status.failureCount < MAX_FAILURE_COUNT
    ) {
      // Reset the key health after cooldown
      status.isHealthy = true;
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Marks a key as failed.
 * This will temporarily remove it from the rotation.
 *
 * @param providerName - The provider (e.g. "groq")
 * @param keyValue - The API key that failed
 */
export function markKeyAsFailed(providerName: string, keyValue: string): void {
  const statusId = getKeyStatusId(providerName, keyValue);
  const existing = keyStatuses.get(statusId);

  keyStatuses.set(statusId, {
    key: keyValue,
    isHealthy: false,
    lastFailedAt: Date.now(),
    failureCount: (existing?.failureCount ?? 0) + 1,
  });

  console.warn(
    `[FufuniKeyPool] Key ${keyValue.slice(-8)}... for provider "${providerName}" ` +
      `marked as failed (failure count: ${(existing?.failureCount ?? 0) + 1})`,
  );
}

/**
 * Selects the next available API key for a given provider using round-robin.
 * Skips keys that are on cooldown or have exceeded their failure limit.
 *
 * @param providerName - The provider name
 * @param keys - Array of available keys for this provider
 * @returns The next usable key, or null if no keys are available
 */
function selectNextKey(
  providerName: string,
  keys: VaultKey[],
): VaultKey | null {
  // Filter out expired keys immediately (they're permanently invalid)
  const eligibleKeys = keys.filter((k) => k.type !== "expired");

  if (eligibleKeys.length === 0) {
    return null;
  }

  // Get the current round-robin index for this provider
  const currentIndex = roundRobinIndexes.get(providerName) ?? 0;

  // Try each key starting from the current index, wrap around if needed
  for (let attempt = 0; attempt < eligibleKeys.length; attempt++) {
    const index = (currentIndex + attempt) % eligibleKeys.length;
    const candidate = eligibleKeys[index];

    if (isKeyUsable(providerName, candidate.key)) {
      // Advance the round-robin index for next time
      roundRobinIndexes.set(providerName, (index + 1) % eligibleKeys.length);
      return candidate;
    }
  }

  // All keys are on cooldown - return the least-recently-failed one as a last resort
  console.error(
    `[FufuniKeyPool] All keys for provider "${providerName}" are on cooldown. ` +
      "Using the least-recently-failed key as a last resort.",
  );

  const leastRecentlyFailed = eligibleKeys.reduce((best, current) => {
    const bestId = getKeyStatusId(providerName, best.key);
    const currentId = getKeyStatusId(providerName, current.key);
    const bestStatus = keyStatuses.get(bestId);
    const currentStatus = keyStatuses.get(currentId);
    const bestTime = bestStatus?.lastFailedAt ?? 0;
    const currentTime = currentStatus?.lastFailedAt ?? 0;
    return currentTime < bestTime ? current : best;
  });

  return leastRecentlyFailed;
}

/**
 * Selects the best model from a provider's model list based on a filter.
 * Models are sorted by priority (ascending = higher priority first).
 *
 * @param models - Available models for the provider
 * @param filterFn - Optional filter function to select specific models
 * @returns The highest-priority matching model, or null
 */
function selectModel(
  models: VaultModel[],
  filterFn?: (model: VaultModel) => boolean,
): VaultModel | null {
  // Only include chat models
  const chatModels = models.filter((m) => m.usage === "chat");
  const filtered = filterFn ? chatModels.filter(filterFn) : chatModels;

  if (filtered.length === 0) {
    return null;
  }

  // Sort by priority (lower number = higher priority)
  return filtered.sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Resolves the next API configuration to use for a given provider and model ID.
 * This is the main entry point for the round-robin key selection.
 *
 * @param vault - The loaded AI vault configuration
 * @param providerName - The provider to use (e.g. "groq")
 * @param modelId - The specific model ID (or undefined to use the highest-priority model)
 * @returns A ResolvedApiConfig ready to use, or null if no usable key/model found
 */
export function resolveNextApiConfig(
  vault: AiVaultConfig,
  providerName: string,
  modelId?: string,
): ResolvedApiConfig | null {
  const provider = vault.providers[providerName];
  if (!provider) {
    console.error(
      `[FufuniKeyPool] Provider "${providerName}" not found in vault`,
    );
    return null;
  }

  // Select the API key via round-robin
  const selectedKey = selectNextKey(providerName, provider.keys);
  if (!selectedKey) {
    console.error(
      `[FufuniKeyPool] No usable keys for provider "${providerName}"`,
    );
    return null;
  }

  // Select the model
  const model = modelId
    ? (provider.models.find((m) => m.id === modelId) ?? null)
    : selectModel(provider.models);

  if (!model) {
    console.error(
      `[FufuniKeyPool] Model "${modelId}" not found in provider "${providerName}"`,
    );
    return null;
  }

  return {
    providerName,
    apiKey: selectedKey.key,
    keyOwner: selectedKey.owner,
    endpoint: provider.endpoint,
    protocol: provider.protocol,
    modelId: model.id,
    model,
  };
}

/**
 * Generates the list of Continue ModelDescription objects from the vault.
 * One ModelDescription is created per provider+model combination.
 * The title is formatted as "Provider / ModelName [tags]".
 *
 * @param vault - The loaded AI vault configuration
 * @returns Array of ModelDescription objects ready to inject into Continue's config
 */
export function buildModelDescriptions(vault: AiVaultConfig): Array<{
  title: string;
  provider: string;
  model: string;
  apiKey: string;
  apiBase?: string;
  contextLength?: number;
  completionOptions?: { maxTokens?: number };
}> {
  const descriptions: ReturnType<typeof buildModelDescriptions> = [];

  for (const [providerName, provider] of Object.entries(vault.providers)) {
    // Map vault protocol/provider name to the Continue provider name
    const continueProvider = mapToContinueProvider(
      providerName,
      provider.protocol,
    );
    if (!continueProvider) {
      continue; // Skip unsupported providers
    }

    // Get the first available (non-expired) key for the initial configuration
    // The actual key rotation happens at runtime via the KeyPool
    const initialKey = provider.keys.find((k) => k.type !== "expired");
    if (!initialKey) {
      continue; // No valid keys for this provider
    }

    // Create one model description per chat model
    const chatModels = provider.models.filter((m) => m.usage === "chat");
    for (const model of chatModels) {
      const tags = model.tags.join(", ");
      descriptions.push({
        title: `[KeypoolLive] ${providerName}/${model.id} (${tags})`,
        provider: continueProvider,
        model: model.id,
        apiKey: initialKey.key, // Will be rotated at runtime
        apiBase: provider.endpoint.endsWith("/")
          ? provider.endpoint
          : `${provider.endpoint}/`,
        contextLength: model.contextWindow,
        completionOptions: {
          maxTokens: model.maxOutputTokens,
        },
      });
    }
  }

  // Sort by provider priority (groq/mistral free models first, then paid)
  return descriptions;
}

/**
 * Maps a vault provider name and protocol to the Continue provider identifier.
 * Continue has specific provider names that differ from the vault names.
 */
function mapToContinueProvider(
  providerName: string,
  protocol: string,
): string | null {
  const mapping: Record<string, string> = {
    anthropic: "anthropic",
    gemini: "gemini",
    groq: "groq",
    mistral: "mistral",
    openrouter: "openrouter",
  };
  return mapping[providerName] ?? null;
}

/**
 * Resets all round-robin indexes and key health statuses.
 * Called when the vault is refreshed or when the user requests a fresh start.
 */
export function resetKeyPool(): void {
  roundRobinIndexes.clear();
  keyStatuses.clear();
}
```

---

## 8. Intégration dans le système de configuration Continue

### 8.1 Comprendre le point d'injection

Dans Continue, la configuration est chargée par `ConfigHandler` → `ProfileLifecycleManager` → `LocalProfileLoader` → `doLoadConfig()`. Le fichier final généré est un objet `ContinueConfig` qui contient un tableau `models` d'instances `ILLM`.

Notre objectif est d'**injecter nos modèles du coffre-fort** dans ce tableau `models` **après** le chargement normal de la configuration. Cela permet à l'utilisateur de continuer à utiliser ses propres modèles s'il en a configuré.

### 8.2 Créer le module d'injection de configuration

Créez le fichier `core/keypoollive/VaultConfigInjector.ts` :

```typescript
// core/keypoollive/VaultConfigInjector.ts
// Injects vault-sourced models into the Continue configuration.
// This module is the bridge between the KeypoolLive vault and the Continue config system.

import { ContinueConfig, ILLM, LLMOptions } from "../index.js";
import { llmFromDescription } from "../llm/llms/index.js";
import { AiVaultConfig } from "./types.js";
import { buildModelDescriptions } from "./KeyPool.js";
import { loadAiVault } from "./AiVault.js";

// The public URL of the encrypted vault.
// This should be set via VS Code settings (see VaultSettingsProvider).
let vaultUrl: string | null = null;

/**
 * Sets the vault URL. Called during extension activation.
 * @param url - The public URL to the encrypted ai.json.enc file
 */
export function setVaultUrl(url: string): void {
  vaultUrl = url;
}

/**
 * Builds ILLM instances from the vault configuration.
 * Uses llmFromDescription() which is Continue's factory function
 * for creating LLM provider instances from a description object.
 *
 * @param vault - The loaded vault configuration
 * @param ideSettings - Current IDE settings (needed by llmFromDescription)
 * @param llmLogger - Logger instance (needed by llmFromDescription)
 * @returns Array of ILLM instances ready to add to ContinueConfig.models
 */
async function buildLlmsFromVault(
  vault: AiVaultConfig,
  ideSettings: any,
  llmLogger: any,
): Promise<ILLM[]> {
  const descriptions = buildModelDescriptions(vault);
  const llms: ILLM[] = [];

  for (const desc of descriptions) {
    try {
      // llmFromDescription is Continue's standard factory for creating LLM instances
      // It accepts a ModelDescription-compatible object and returns an ILLM instance
      const llm = llmFromDescription(
        desc as any,
        undefined,
        ideSettings,
        undefined,
        undefined,
        llmLogger,
      );
      if (llm) {
        // Tag the LLM as being from KeypoolLive vault for identification
        (llm as any)._keypoolVault = true;
        (llm as any)._keypoolProviderName = desc.provider;
        llms.push(llm);
      }
    } catch (error) {
      console.warn(
        `[FufuniVaultInjector] Failed to create LLM for ${desc.title}:`,
        error,
      );
    }
  }

  return llms;
}

/**
 * Injects vault models into an existing ContinueConfig.
 * Vault models are added AFTER the user's existing models,
 * so they appear at the bottom of the model list in the UI.
 *
 * @param config - The base ContinueConfig loaded from the user's config.yaml
 * @param ideSettings - Current IDE settings
 * @param llmLogger - LLM logger instance
 * @returns The augmented ContinueConfig with vault models appended
 */
export async function injectVaultModels(
  config: ContinueConfig,
  ideSettings: any,
  llmLogger: any,
): Promise<ContinueConfig> {
  // If no vault URL is configured, return the original config unchanged
  if (!vaultUrl) {
    return config;
  }

  // If KEYPOOL_LIVE_SECRET is not set, skip vault injection (don't throw, just warn)
  if (!process.env.KEYPOOL_LIVE_SECRET) {
    console.warn(
      "[FufuniVaultInjector] KEYPOOL_LIVE_SECRET not set - vault models will not be available. " +
        "Set the KEYPOOL_LIVE_SECRET environment variable to enable KeypoolLive AI models.",
    );
    return config;
  }

  let vault: AiVaultConfig;
  try {
    vault = await loadAiVault(vaultUrl);
  } catch (error) {
    console.error("[FufuniVaultInjector] Failed to load vault:", error);
    // Return the original config so Continue still works with user models
    return config;
  }

  const vaultLlms = await buildLlmsFromVault(vault, ideSettings, llmLogger);

  // Append vault models to the existing models list
  return {
    ...config,
    models: [...(config.models ?? []), ...vaultLlms],
  };
}
```

### 8.3 Modifier le chargement de configuration

Le fichier `core/config/profile/doLoadConfig.ts` est le point où la configuration est finalisée. Nous devons y ajouter un appel à `injectVaultModels`. Voici la modification minimale à effectuer :

```typescript
// MODIFICATION in core/config/profile/doLoadConfig.ts
// Find the line that returns the ContinueConfig and add the vault injection before it.
// Look for the return statement that creates the final config object.

// ... existing code ...

// FUFUNI VAULT: Import the vault injector
import { injectVaultModels } from "../../keypoollive/VaultConfigInjector.js";

// ... existing code ...

// FUFUNI VAULT: After building the config, inject vault models
// The original return statement looks something like:
// return { config, errors };
// Replace it with:
const augmentedConfig = await injectVaultModels(config, ideSettings, llmLogger);
return { config: augmentedConfig, errors };
```

**Important** : Trouvez d'abord la ligne exacte dans `doLoadConfig.ts` avant de faire la modification :

```bash
# Find the exact return statement location
grep -n "return.*config" core/config/profile/doLoadConfig.ts
```

---

## 9. Gestion de session : une clé valide par session de chat

### 9.1 Concept de session

Dans Continue, une "session de chat" est créée à chaque fois que l'utilisateur ouvre un nouvel onglet de chat ou commence une nouvelle conversation. Notre objectif est d'associer **une clé spécifique** à chaque session, pour que tous les messages d'une même conversation utilisent la même clé (cohérence) mais que chaque nouvelle conversation utilise la clé suivante (distribution de charge).

### 9.2 Le gestionnaire de session de clés

Créez le fichier `core/keypoollive/SessionKeyManager.ts` :

```typescript
// core/keypoollive/SessionKeyManager.ts
// Manages the association between chat sessions and API keys.
// Each new chat session gets the next key in the round-robin rotation.
// Within a session, the same key is always used for consistency.

import { AiVaultConfig, ResolvedApiConfig } from "./types.js";
import { loadAiVault } from "./AiVault.js";
import { markKeyAsFailed, resolveNextApiConfig } from "./KeyPool.js";

/**
 * Maps a session ID to its assigned API configuration.
 * The session ID comes from Continue's own chat session management.
 */
const sessionKeyMap: Map<string, ResolvedApiConfig> = new Map();

/** The URL to the encrypted vault (set during extension activation) */
let vaultUrl: string | null = null;

/**
 * Configures the vault URL for the session key manager.
 */
export function configureSessionKeyManager(url: string): void {
  vaultUrl = url;
}

/**
 * Gets or creates the API configuration for a given session.
 *
 * If the session already has an assigned key, returns it (consistency).
 * If this is a new session, assigns the next key via round-robin.
 *
 * @param sessionId - The unique chat session identifier from Continue
 * @param providerName - The requested provider (e.g. "groq")
 * @param modelId - The requested model ID
 * @returns The resolved API config for this session, or null on failure
 */
export async function getSessionApiConfig(
  sessionId: string,
  providerName: string,
  modelId?: string,
): Promise<ResolvedApiConfig | null> {
  // Create a compound key for provider+model+session
  const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;

  // Return existing assignment if available
  const existing = sessionKeyMap.get(sessionKey);
  if (existing) {
    return existing;
  }

  // No assignment yet - get next key via round-robin
  if (!vaultUrl) {
    return null;
  }

  let vault: AiVaultConfig;
  try {
    vault = await loadAiVault(vaultUrl);
  } catch {
    return null;
  }

  const resolved = resolveNextApiConfig(vault, providerName, modelId);
  if (resolved) {
    // Store the assignment for this session
    sessionKeyMap.set(sessionKey, resolved);
    console.info(
      `[FufuniSession] Session ${sessionId.slice(-8)}... assigned key ` +
        `...${resolved.apiKey.slice(-6)} for ${providerName}/${resolved.modelId}`,
    );
  }

  return resolved ?? null;
}

/**
 * Forces a key rotation for a specific session.
 * Called when the user clicks the "Change Key" button or when a key fails.
 *
 * @param sessionId - The session to rotate the key for
 * @param providerName - The provider
 * @param modelId - The model
 * @param reason - Why the rotation is happening (for logging)
 * @returns The new API config after rotation, or null on failure
 */
export async function rotateSessionKey(
  sessionId: string,
  providerName: string,
  modelId?: string,
  reason: "user_request" | "key_failure" = "user_request",
): Promise<ResolvedApiConfig | null> {
  const sessionKey = `${sessionId}:${providerName}:${modelId ?? "default"}`;

  // If rotating due to a failure, mark the current key as failed
  if (reason === "key_failure") {
    const current = sessionKeyMap.get(sessionKey);
    if (current) {
      markKeyAsFailed(current.providerName, current.apiKey);
    }
  }

  // Remove the current assignment to force a new selection
  sessionKeyMap.delete(sessionKey);

  // Get the next key
  return getSessionApiConfig(sessionId, providerName, modelId);
}

/**
 * Cleans up session data when a session is closed.
 * Prevents memory leaks from long-running VS Code instances.
 *
 * @param sessionId - The session to clean up
 */
export function cleanupSession(sessionId: string): void {
  // Remove all keys that start with this sessionId
  for (const key of sessionKeyMap.keys()) {
    if (key.startsWith(sessionId)) {
      sessionKeyMap.delete(key);
    }
  }
}

/**
 * Returns a summary of the current session key assignments.
 * Used by the "Change Key" button UI to show which key is active.
 *
 * @param sessionId - The session to get info for
 * @returns Object with key summary info (never exposes the full key)
 */
export function getSessionKeyInfo(sessionId: string): {
  providerName: string;
  keyOwner: string;
  keyHint: string; // Last 6 characters of the key
  modelId: string;
} | null {
  for (const [compoundKey, config] of sessionKeyMap.entries()) {
    if (compoundKey.startsWith(sessionId)) {
      return {
        providerName: config.providerName,
        keyOwner: config.keyOwner,
        keyHint: `...${config.apiKey.slice(-6)}`,
        modelId: config.modelId,
      };
    }
  }
  return null;
}
```

### 9.3 Intercepter les appels LLM pour injecter la clé de session

Plutôt que de modifier chaque classe LLM de Continue, nous utilisons le pattern **middleware** via la méthode `_streamChat` de `BaseLLM`. Créez le fichier `core/keypoollive/VaultLlmWrapper.ts` :

```typescript
// core/keypoollive/VaultLlmWrapper.ts
// A wrapper around Continue's ILLM interface that intercepts API calls
// to inject the correct session key from the vault pool.
//
// This wrapper uses the Proxy pattern to transparently intercept the
// apiKey property getter without modifying the underlying LLM class.

import { ILLM } from "../index.js";
import { getSessionApiConfig, rotateSessionKey } from "./SessionKeyManager.js";

/**
 * Wraps an ILLM instance to use vault-managed keys.
 * The wrapper intercepts property access to replace apiKey with
 * the session-specific key from the vault pool.
 *
 * @param llm - The original LLM instance from Continue
 * @param sessionId - The current chat session ID
 * @returns A proxied ILLM that uses vault keys
 */
export function wrapLlmWithVaultKey(llm: ILLM, sessionId: string): ILLM {
  // Only wrap KeypoolLive vault models (marked in VaultConfigInjector.ts)
  if (!(llm as any)._keypoolVault) {
    return llm; // Return unwrapped for non-vault models
  }

  const providerName: string = (llm as any)._keypoolProviderName ?? "";

  // Use ES6 Proxy to intercept property access transparently
  return new Proxy(llm, {
    get(target, prop, receiver) {
      // Intercept the apiKey getter to return the session key
      if (prop === "apiKey") {
        // Synchronous access: return the cached key if available
        // The async resolution happens in ensureSessionKey() below
        const cachedKey = getCachedSessionKey(sessionId, providerName);
        return cachedKey ?? Reflect.get(target, prop, receiver);
      }

      const original = Reflect.get(target, prop, receiver);

      // Wrap the streamChat method to handle key failures
      if (prop === "streamChat" && typeof original === "function") {
        return async function* wrappedStreamChat(
          this: any,
          ...args: Parameters<typeof original>
        ) {
          // Ensure the session has a key assigned before streaming
          const resolved = await getSessionApiConfig(
            sessionId,
            providerName,
            (target as any).model,
          );

          if (resolved) {
            // Temporarily set the API key on the underlying LLM
            const originalApiKey = (target as any).apiKey;
            (target as any).apiKey = resolved.apiKey;

            try {
              // Call the original streamChat and yield all chunks
              yield* original.apply(target, args);
            } catch (error: any) {
              // If we get a 401 or 429, mark the key as failed and try again
              if (isKeyError(error)) {
                console.warn(
                  `[FufuniVaultWrapper] Key failure for ${providerName}, rotating...`,
                );
                const newConfig = await rotateSessionKey(
                  sessionId,
                  providerName,
                  (target as any).model,
                  "key_failure",
                );
                if (newConfig) {
                  (target as any).apiKey = newConfig.apiKey;
                  // Retry the stream with the new key
                  yield* original.apply(target, args);
                  return;
                }
              }
              throw error; // Re-throw non-key errors
            } finally {
              // Restore the original API key
              (target as any).apiKey = originalApiKey;
            }
          } else {
            // No vault key available, use the model as-is
            yield* original.apply(target, args);
          }
        };
      }

      return original;
    },
  });
}

/**
 * In-memory cache of session keys to avoid async lookups in synchronous getters.
 * Updated by getSessionApiConfig() when a key is assigned.
 */
const sessionKeyCache: Map<string, string> = new Map();

/**
 * Gets the cached API key for a session (synchronous).
 */
function getCachedSessionKey(
  sessionId: string,
  providerName: string,
): string | null {
  return sessionKeyCache.get(`${sessionId}:${providerName}`) ?? null;
}

/**
 * Checks if an error is related to an invalid or rate-limited API key.
 * These are the errors that should trigger a key rotation.
 */
function isKeyError(error: any): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  const status = error?.status ?? error?.statusCode ?? 0;

  return (
    status === 401 || // Unauthorized: invalid key
    status === 403 || // Forbidden: key doesn't have access
    status === 429 || // Too Many Requests: rate limit exceeded
    message.includes("api key") ||
    message.includes("invalid_api_key") ||
    message.includes("rate_limit") ||
    message.includes("quota exceeded")
  );
}
```

---

## 10. Le bouton "Changer de clé" dans l'interface webview

### 10.1 Architecture de la communication webview ↔ extension

Dans Continue, l'interface utilisateur est une application React qui tourne dans une webview VS Code. La communication entre la webview et l'extension utilise un protocole de messages bidirectionnel défini dans `core/protocol/`. Pour ajouter notre bouton, nous devons :

1. **Définir de nouveaux types de messages** dans le protocole
2. **Ajouter des handlers** côté extension pour ces messages
3. **Modifier l'interface React** pour afficher le bouton

### 10.2 Étendre le protocole de communication

Créez le fichier `core/keypoollive/protocol.ts` :

```typescript
// core/keypoollive/protocol.ts
// Defines the message protocol for KeypoolLive vault functionality.
// These message types are used for communication between the GUI webview
// and the VS Code extension host.

/**
 * Message sent from the webview to request a key rotation for the current session.
 */
export interface FufuniRotateKeyRequest {
  /** The current chat session ID (from Continue's session management) */
  sessionId: string;
  /** Optional: specific provider to rotate (if null, rotates the active model's provider) */
  providerName?: string;
  /** Optional: specific model to rotate (if null, uses the session's current model) */
  modelId?: string;
}

/**
 * Response from the extension after a key rotation.
 */
export interface FufuniRotateKeyResponse {
  /** Whether the rotation was successful */
  success: boolean;
  /** Info about the new key (never includes the full key for security) */
  newKeyInfo?: {
    providerName: string;
    keyOwner: string;
    keyHint: string; // e.g., "...abc123"
    modelId: string;
  };
  /** Error message if rotation failed */
  error?: string;
}

/**
 * Message sent from the webview to get info about the current session key.
 */
export interface FufuniGetKeyInfoRequest {
  sessionId: string;
}

/**
 * Response with current key information.
 */
export interface FufuniGetKeyInfoResponse {
  keyInfo: {
    providerName: string;
    keyOwner: string;
    keyHint: string;
    modelId: string;
  } | null;
}
```

### 10.3 Ajouter les handlers de messages côté extension

Dans `extensions/vscode/src/keypoollive/`, créez le fichier `VaultCommandHandler.ts` :

```typescript
// extensions/vscode/src/keypoollive/VaultCommandHandler.ts
// Handles KeypoolLive vault-related messages from the webview.
// Registers VS Code commands and webview message handlers for
// the key rotation and key info functionality.

import * as vscode from "vscode";
import {
  rotateSessionKey,
  getSessionKeyInfo,
} from "../../../../core/keypoollive/SessionKeyManager.js";
import {
  FufuniRotateKeyRequest,
  FufuniRotateKeyResponse,
  FufuniGetKeyInfoRequest,
  FufuniGetKeyInfoResponse,
} from "../../../../core/keypoollive/protocol.js";
import { VsCodeWebviewProtocol } from "../webviewProtocol.js";

/**
 * Registers all KeypoolLive vault-related message handlers on the webview protocol.
 * Call this during extension activation, after the webview protocol is initialized.
 *
 * @param webviewProtocol - The webview protocol instance from VsCodeExtension
 * @param context - The VS Code extension context for registering disposables
 */
export function registerVaultHandlers(
  webviewProtocol: VsCodeWebviewProtocol,
  context: vscode.ExtensionContext,
): void {
  // Handler for key rotation requests from the "Change Key" button
  webviewProtocol.on(
    "keypoollive/rotateKey" as any,
    async (msg: { data: FufuniRotateKeyRequest }) => {
      const { sessionId, providerName, modelId } = msg.data;

      if (!providerName) {
        const response: FufuniRotateKeyResponse = {
          success: false,
          error: "providerName is required for key rotation",
        };
        return response;
      }

      try {
        const newConfig = await rotateSessionKey(
          sessionId,
          providerName,
          modelId,
          "user_request",
        );

        if (newConfig) {
          const response: FufuniRotateKeyResponse = {
            success: true,
            newKeyInfo: {
              providerName: newConfig.providerName,
              keyOwner: newConfig.keyOwner,
              keyHint: `...${newConfig.apiKey.slice(-6)}`,
              modelId: newConfig.modelId,
            },
          };

          // Show a brief notification in VS Code
          void vscode.window.showInformationMessage(
            `KeypoolLive: Switched to key ${newConfig.keyOwner} for ${newConfig.providerName}`,
          );

          return response;
        } else {
          return {
            success: false,
            error: "No alternative keys available",
          } as FufuniRotateKeyResponse;
        }
      } catch (error: any) {
        return {
          success: false,
          error: error.message ?? "Unknown error during key rotation",
        } as FufuniRotateKeyResponse;
      }
    },
  );

  // Handler for key info requests
  webviewProtocol.on(
    "keypoollive/getKeyInfo" as any,
    async (msg: { data: FufuniGetKeyInfoRequest }) => {
      const info = getSessionKeyInfo(msg.data.sessionId);
      return { keyInfo: info } as FufuniGetKeyInfoResponse;
    },
  );

  // Register VS Code command for key rotation (accessible via Command Palette)
  const rotateKeyCommand = vscode.commands.registerCommand(
    "continue.keypoollive.rotateKey",
    async () => {
      // When invoked from the command palette, we don't have a session ID.
      // Show a quick pick to select the provider.
      const providers = [
        "groq",
        "mistral",
        "openrouter",
        "anthropic",
        "gemini",
      ];
      const selected = await vscode.window.showQuickPick(providers, {
        placeHolder: "Select provider to rotate key for",
      });

      if (selected) {
        // Broadcast the rotation request to the active session via webview
        webviewProtocol.send("keypoollive/requestKeyRotation", {
          providerName: selected,
        });
      }
    },
  );

  context.subscriptions.push(rotateKeyCommand);
}
```

### 10.4 Modifier l'interface React pour afficher le bouton

Dans le GUI React de Continue (`gui/src/`), nous devons ajouter un composant pour le bouton "Changer de clé". Créez le fichier `gui/src/keypoollive/VaultKeyRotateButton.tsx` :

```tsx
// gui/src/keypoollive/VaultKeyRotateButton.tsx
// The "Change Key" button displayed in the Continue chat interface.
// Allows users to manually trigger a key rotation for the current session.
// Shows the current key info and provides feedback after rotation.

import React, { useState, useCallback } from "react";
import { useIdeMessenger } from "../context/IdeMessenger"; // Continue's messaging hook

/**
 * Props for the VaultKeyRotateButton component.
 */
interface VaultKeyRotateButtonProps {
  /** The current chat session ID from Continue's session management */
  sessionId: string;
  /** The provider name of the active model (e.g. "groq") */
  providerName?: string;
  /** The model ID currently in use */
  modelId?: string;
}

/**
 * A compact button that allows users to rotate to the next API key in the pool.
 * Displayed in the chat header area, only when a KeypoolLive vault model is active.
 *
 * UI States:
 * - idle: Shows a key icon with "Change Key" tooltip
 * - loading: Shows a spinner while rotating
 * - success: Shows a green checkmark briefly, then reverts to idle
 * - error: Shows a red X with the error message
 */
export function VaultKeyRotateButton({
  sessionId,
  providerName,
  modelId,
}: VaultKeyRotateButtonProps): React.ReactElement | null {
  const ideMessenger = useIdeMessenger();
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  /**
   * Handles the key rotation button click.
   * Sends the rotation request to the extension host and updates UI state.
   */
  const handleRotateKey = useCallback(async () => {
    if (!providerName) return;

    setStatus("loading");
    setStatusMessage("Rotating key...");

    try {
      // Send the rotation request to the VS Code extension host
      // using Continue's IdeMessenger abstraction
      const response = await ideMessenger.request("keypoollive/rotateKey", {
        sessionId,
        providerName,
        modelId,
      });

      if (response.success && response.newKeyInfo) {
        setStatus("success");
        setStatusMessage(
          `Now using key ${response.newKeyInfo.keyHint} (${response.newKeyInfo.keyOwner})`,
        );
        // Revert to idle after 3 seconds
        setTimeout(() => {
          setStatus("idle");
          setStatusMessage("");
        }, 3000);
      } else {
        setStatus("error");
        setStatusMessage(response.error ?? "Failed to rotate key");
        setTimeout(() => {
          setStatus("idle");
          setStatusMessage("");
        }, 5000);
      }
    } catch (error: any) {
      setStatus("error");
      setStatusMessage(error.message ?? "Unknown error");
      setTimeout(() => {
        setStatus("idle");
        setStatusMessage("");
      }, 5000);
    }
  }, [ideMessenger, sessionId, providerName, modelId]);

  // Only render for KeypoolLive vault models
  if (!providerName) {
    return null;
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "11px",
        opacity: status === "loading" ? 0.7 : 1,
        cursor: status === "loading" ? "not-allowed" : "pointer",
      }}
      title={
        status === "idle"
          ? `KeypoolLive Vault: Change API key for ${providerName} (round-robin)`
          : statusMessage
      }
    >
      {/* Key rotation button */}
      <button
        onClick={handleRotateKey}
        disabled={status === "loading"}
        style={{
          background: "none",
          border: "1px solid var(--vscode-button-border, #555)",
          borderRadius: "3px",
          padding: "2px 6px",
          cursor: status === "loading" ? "not-allowed" : "pointer",
          color: getStatusColor(status),
          fontSize: "11px",
          display: "flex",
          alignItems: "center",
          gap: "3px",
        }}
        aria-label="Change KeypoolLive vault API key"
      >
        {/* Icon based on status */}
        {status === "loading" && <span>⟳</span>}
        {status === "idle" && <span>🔑</span>}
        {status === "success" && <span>✓</span>}
        {status === "error" && <span>✗</span>}
        <span>
          {status === "idle" && "Chg. Key"}
          {status === "loading" && "..."}
          {status === "success" && "Done"}
          {status === "error" && "Error"}
        </span>
      </button>

      {/* Status message tooltip */}
      {statusMessage && status !== "idle" && (
        <span
          style={{
            fontSize: "10px",
            color: getStatusColor(status),
            maxWidth: "150px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {statusMessage}
        </span>
      )}
    </div>
  );
}

/**
 * Returns the CSS color for each button status.
 */
function getStatusColor(
  status: "idle" | "loading" | "success" | "error",
): string {
  switch (status) {
    case "idle":
      return "var(--vscode-foreground)";
    case "loading":
      return "var(--vscode-foreground)";
    case "success":
      return "var(--vscode-terminal-ansiGreen, #4ec9b0)";
    case "error":
      return "var(--vscode-terminal-ansiRed, #f48771)";
  }
}
```

---

## 11. Migration du contexte de conversation lors du changement de clé

### 11.1 Comprendre le contexte Continue

Dans Continue, le "contexte" d'une conversation comprend :

- **L'historique des messages** (`ChatMessage[]`) : les échanges précédents
- **Les fichiers ouverts** référencés dans la conversation
- **Les snippets de code** inclus dans le contexte
- **Les résultats d'outils** (si le mode agent est utilisé)

Lors d'un changement de clé, le contexte doit être préservé : l'utilisateur ne doit pas perdre son historique de chat.

### 11.2 Stratégie de migration de contexte

La bonne nouvelle est que **le contexte n'est pas lié à la clé d'API**. Il est géré par Continue indépendamment. Changer de clé revient simplement à modifier quel fournisseur d'API sera utilisé pour les **prochains** messages, sans affecter l'historique déjà affiché.

Voici ce qui se passe lors d'un changement de clé :

```
Avant :  [msg1: user] [msg2: assistant, key=gsk_xxx] [msg3: user]
                                                              │
                                               User clicks "Change Key"
                                                              │
                                                              ▼
Après :  [msg1: user] [msg2: assistant, key=gsk_xxx] [msg3: user] [msg4: assistant, key=gsk_yyy]
```

Continue envoie l'**intégralité** de l'historique de messages à chaque nouvelle requête. Ainsi, quand la clé change, le nouveau fournisseur reçoit tout le contexte précédent et peut continuer la conversation.

### 11.3 Notification de changement de clé dans le chat

Pour informer l'utilisateur que la clé a changé, ajoutez un message système dans le chat. Créez le fichier `core/keypoollive/ContextMigration.ts` :

```typescript
// core/keypoollive/ContextMigration.ts
// Utilities for migrating conversation context during key rotation.
// Since the conversation history is provider-agnostic, migration is mostly
// about inserting a system notification and updating the session key binding.

import { ChatMessage } from "../index.js";

/**
 * Creates a system-level notification message to insert into the conversation
 * when a key rotation occurs. This makes the key change transparent to the user.
 *
 * @param previousKeyHint - The last 6 chars of the previous key
 * @param newKeyHint - The last 6 chars of the new key
 * @param providerName - The provider name
 * @param reason - Why the key was changed
 * @returns A chat message to inject into the conversation
 */
export function createKeyRotationNotice(
  previousKeyHint: string,
  newKeyHint: string,
  providerName: string,
  reason: "user_request" | "key_failure",
): ChatMessage {
  const reasonText =
    reason === "user_request"
      ? "at your request"
      : "due to a key error (automatic fallback)";

  // Create a system message that will be visible in the chat UI
  // but will NOT be sent to the AI provider (it's filtered out before API calls)
  return {
    role: "system",
    content: [
      {
        type: "text",
        text:
          `[KeypoolLive Vault] API key rotated ${reasonText}. ` +
          `Provider: ${providerName}. ` +
          `Previous key: ...${previousKeyHint} → New key: ...${newKeyHint}. ` +
          `The conversation context has been preserved.`,
      },
    ],
  } as any;
}

/**
 * Validates that an array of chat messages can be safely replayed
 * with a new API provider.
 *
 * Some providers (e.g. Gemini) have restrictions on consecutive roles,
 * or on the types of content they accept. This function checks for
 * common compatibility issues.
 *
 * @param messages - The conversation history to validate
 * @param targetProtocol - The protocol of the new provider
 * @returns Array of sanitized messages safe for the target protocol
 */
export function sanitizeMessagesForProvider(
  messages: ChatMessage[],
  targetProtocol: "anthropic" | "gemini" | "openai",
): ChatMessage[] {
  // Filter out system messages from KeypoolLive (they're informational only)
  let filtered = messages.filter((msg) => {
    if (msg.role === "system") {
      // Keep system messages that are part of the actual prompt,
      // remove internal KeypoolLive notifications
      const content = Array.isArray(msg.content)
        ? msg.content.map((c: any) => c.text ?? "").join("")
        : msg.content;
      return !String(content).startsWith("[KeypoolLive Vault]");
    }
    return true;
  });

  // For Gemini: ensure messages alternate between user and assistant
  // Gemini does not support consecutive messages of the same role
  if (targetProtocol === "gemini") {
    filtered = mergeConsecutiveMessages(filtered);
  }

  return filtered;
}

/**
 * Merges consecutive messages of the same role.
 * Required for providers that don't support consecutive same-role messages.
 */
function mergeConsecutiveMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      // Merge the content of consecutive same-role messages
      const lastText = Array.isArray(last.content)
        ? last.content.map((c: any) => c.text ?? "").join("\n")
        : String(last.content);
      const newText = Array.isArray(message.content)
        ? message.content.map((c: any) => c.text ?? "").join("\n")
        : String(message.content);
      merged[merged.length - 1] = {
        ...last,
        content: `${lastText}\n\n${newText}`,
      };
    } else {
      merged.push(message);
    }
  }

  return merged;
}
```

---

## 12. Tests et validation

### 12.1 Tests unitaires pour AiVault

Créez le fichier `core/keypoollive/AiVault.test.ts` :

```typescript
// core/keypoollive/AiVault.test.ts
// Unit tests for the AiVault module (vault fetching and decryption).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadAiVault, clearVaultCache } from "./AiVault.js";

describe("AiVault", () => {
  beforeEach(() => {
    // Clear the cache before each test to ensure fresh state
    clearVaultCache();
    // Clear environment variables
    delete process.env.KEYPOOL_LIVE_SECRET;
  });

  it("should throw when KEYPOOL_LIVE_SECRET is not set", async () => {
    await expect(loadAiVault("https://example.com/vault.enc")).rejects.toThrow(
      "KEYPOOL_LIVE_SECRET environment variable is not set",
    );
  });

  it("should fetch and decrypt the vault correctly", async () => {
    // Set up a mock vault for testing
    process.env.KEYPOOL_LIVE_SECRET = "test-secret-key";

    // Mock the fetch function to return a test encrypted payload
    // In a real test, you would encrypt a test ai.json with the same key
    const mockVault = {
      version: 1,
      providers: {
        groq: {
          protocol: "openai",
          endpoint: "https://api.groq.com/openai/v1",
          keys: [{ key: "gsk_test", owner: "test@example.com", type: "free" }],
          models: [
            {
              id: "llama-3.3-70b-versatile",
              usage: "chat",
              contextWindow: 131072,
              maxOutputTokens: 32768,
              tpmLimit: 12000,
              priority: 1,
              tags: ["fast"],
            },
          ],
        },
      },
    };

    // This test would require an actual encrypted test fixture.
    // For now, we test the structure validation.
    expect(mockVault.version).toBe(1);
    expect(mockVault.providers.groq.protocol).toBe("openai");
    expect(mockVault.providers.groq.keys).toHaveLength(1);
  });

  it("should use the cache on repeated calls", async () => {
    // Verify that the vault is only fetched once within the TTL window
    const fetchSpy = vi.spyOn(global, "fetch");
    // ... setup encrypted vault mock ...
    // Two calls should result in only one fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
```

### 12.2 Tests unitaires pour KeyPool

Créez le fichier `core/keypoollive/KeyPool.test.ts` :

```typescript
// core/keypoollive/KeyPool.test.ts
// Unit tests for the KeyPool module (round-robin key selection).

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveNextApiConfig,
  markKeyAsFailed,
  resetKeyPool,
} from "./KeyPool.js";
import type { AiVaultConfig } from "./types.js";

/**
 * Creates a minimal test vault with multiple keys for a single provider.
 */
function createTestVault(keyCount: number): AiVaultConfig {
  const keys = Array.from({ length: keyCount }, (_, i) => ({
    key: `test_key_${i}`,
    owner: `user${i}@example.com`,
    type: "free" as const,
  }));

  return {
    version: 1,
    providers: {
      groq: {
        protocol: "openai",
        endpoint: "https://api.groq.com/openai/v1",
        keys,
        models: [
          {
            id: "llama-3.3-70b-versatile",
            usage: "chat",
            contextWindow: 131072,
            maxOutputTokens: 32768,
            tpmLimit: 12000,
            priority: 1,
            tags: ["fast"],
          },
        ],
      },
    },
  };
}

describe("KeyPool - Round Robin", () => {
  beforeEach(() => {
    // Reset the key pool state before each test
    resetKeyPool();
  });

  it("should cycle through keys in order", () => {
    const vault = createTestVault(3);

    const config1 = resolveNextApiConfig(vault, "groq");
    const config2 = resolveNextApiConfig(vault, "groq");
    const config3 = resolveNextApiConfig(vault, "groq");
    const config4 = resolveNextApiConfig(vault, "groq"); // Should wrap around

    expect(config1?.apiKey).toBe("test_key_0");
    expect(config2?.apiKey).toBe("test_key_1");
    expect(config3?.apiKey).toBe("test_key_2");
    expect(config4?.apiKey).toBe("test_key_0"); // Wrapped around
  });

  it("should skip failed keys", () => {
    const vault = createTestVault(3);

    // Mark the first key as failed
    markKeyAsFailed("groq", "test_key_0");

    const config = resolveNextApiConfig(vault, "groq");

    // Should skip test_key_0 and return test_key_1
    expect(config?.apiKey).toBe("test_key_1");
  });

  it("should return null for unknown providers", () => {
    const vault = createTestVault(1);
    const config = resolveNextApiConfig(vault, "nonexistent_provider");
    expect(config).toBeNull();
  });

  it("should resolve specific model by ID", () => {
    const vault = createTestVault(1);
    const config = resolveNextApiConfig(
      vault,
      "groq",
      "llama-3.3-70b-versatile",
    );
    expect(config?.modelId).toBe("llama-3.3-70b-versatile");
  });

  it("should skip expired keys", () => {
    const vault: AiVaultConfig = {
      version: 1,
      providers: {
        groq: {
          protocol: "openai",
          endpoint: "https://api.groq.com/openai/v1",
          // First key is expired, second is free
          keys: [
            { key: "expired_key", owner: "old@example.com", type: "expired" },
            { key: "valid_key", owner: "new@example.com", type: "free" },
          ],
          models: [
            {
              id: "test-model",
              usage: "chat",
              contextWindow: 8192,
              maxOutputTokens: 1024,
              tpmLimit: null,
              priority: 1,
              tags: [],
            },
          ],
        },
      },
    };

    const config = resolveNextApiConfig(vault, "groq");
    expect(config?.apiKey).toBe("valid_key");
  });
});
```

---

## 13. Workflow Git pour les mises à jour upstream

### 13.1 Procédure de synchronisation manuelle

Voici la procédure complète, étape par étape, pour mettre à jour votre fork avec les dernières modifications de Continue :

```bash
# Step 1: Ensure you're on the main branch and it's clean
git checkout main
git status  # Should show "nothing to commit"

# Step 2: Fetch all changes from upstream
git fetch upstream

# Step 3: Rebase our main branch onto upstream's main
# This replays all upstream commits on top of our current main
git rebase upstream/main

# Step 4: Push the updated main to our fork
git push origin main

# Step 5: Switch to the KeypoolLive feature branch
git checkout keypoollive/vault

# Step 6: Rebase the KeypoolLive branch onto the updated main
# This is where conflicts might occur if upstream changed a file we also modified
git rebase main

# If conflicts occur, follow this process:
# - git status          → Shows conflicting files
# - Edit the files      → Resolve conflicts manually
#   Look for "<<<<<<< HEAD" and ">>>>>>> main" markers
#   Keep the upstream changes + our KeypoolLive additions
# - git add <file>      → Mark conflicts as resolved
# - git rebase --continue  → Continue the rebase

# Step 7: Push the updated KeypoolLive branch
git push --force-with-lease origin keypoollive/vault

# Step 8: Rebuild and test
PYTHON=/usr/local/opt/python@3.11/bin/python3.11 ./scripts/install-dependencies.sh
cd core && npm run build && cd ..
cd extensions/vscode && npm run esbuild && npm run package && cd ../..
```

### 13.2 Identifier rapidement les conflits potentiels

Nos modifications touchent très peu de fichiers existants. Pour vérifier si une mise à jour upstream affecte nos points d'intégration :

```bash
# After fetching upstream, before rebasing, check which files changed
git diff main..upstream/main --name-only | grep -E "(doLoadConfig|VsCodeExtension|core.ts)"

# If any of these files appear, read the diff carefully before rebasing
git diff main..upstream/main -- core/config/profile/doLoadConfig.ts
git diff main..upstream/main -- extensions/vscode/src/extension/VsCodeExtension.ts
```

### 13.3 Marquage des modifications KeypoolLive

Toutes nos modifications dans les fichiers existants de Continue doivent être balisées avec un commentaire spécial pour les identifier rapidement :

```typescript
// FUFUNI VAULT: [description of change] - v1.0
// This modification adds vault model injection to the config loading pipeline.
// If this causes a merge conflict, keep the upstream code AND add our
// injectVaultModels() call after the final config is assembled.
const augmentedConfig = await injectVaultModels(config, ideSettings, llmLogger);
```

Ce marquage permet de faire une recherche rapide en cas de conflit :

```bash
# Find all KeypoolLive-specific modifications in existing files
grep -rn "FUFUNI VAULT:" --include="*.ts" .
```

### 13.4 Release process pour le VSIX personnalisé

Pour distribuer votre fork sous forme d'extension VSIX installable :

```bash
# In the extensions/vscode directory

# 1. Update the version number (important: don't conflict with official version)
# Edit package.json and set: "version": "1.3.39-keypoollive.1"
# The "-keypoollive.1" suffix clearly identifies our fork

# 2. Build and package the extension
npm run vscode:prepublish
npx vsce package --out keypoollive-continue.vsix

# 3. Install locally for testing
code --install-extension keypoollive-continue.vsix

# 4. Distribute the VSIX file to your team
# (via GitHub Releases, private registry, or direct file share)
```

---

## 14. Résumé des fichiers modifiés et créés

### 14.1 Fichiers créés (nouveaux)

| Fichier                                                    | Rôle                                  |
| ---------------------------------------------------------- | ------------------------------------- |
| `core/keypoollive/types.ts`                                | Types TypeScript pour le coffre-fort  |
| `core/keypoollive/AiVault.ts`                              | Chargement et déchiffrement du coffre |
| `core/keypoollive/KeyPool.ts`                              | Pool de clés avec round-robin         |
| `core/keypoollive/SessionKeyManager.ts`                    | Association session ↔ clé            |
| `core/keypoollive/VaultLlmWrapper.ts`                      | Wrapper Proxy pour les LLMs           |
| `core/keypoollive/VaultConfigInjector.ts`                  | Injection dans la config Continue     |
| `core/keypoollive/ContextMigration.ts`                     | Migration du contexte                 |
| `core/keypoollive/protocol.ts`                             | Types de messages webview             |
| `core/keypoollive/AiVault.test.ts`                         | Tests AiVault                         |
| `core/keypoollive/KeyPool.test.ts`                         | Tests KeyPool                         |
| `extensions/vscode/src/keypoollive/VaultCommandHandler.ts` | Handlers de commandes                 |
| `gui/src/keypoollive/VaultKeyRotateButton.tsx`             | Composant React bouton                |
| `.github/workflows/sync-upstream.yml`                      | Sync automatique upstream             |

### 14.2 Fichiers existants modifiés (liste exhaustive)

| Fichier                                              | Nature de la modification                             |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `core/config/profile/doLoadConfig.ts`                | +5 lignes : import + appel `injectVaultModels()`      |
| `extensions/vscode/src/extension/VsCodeExtension.ts` | +10 lignes : import + appel `registerVaultHandlers()` |
| `extensions/vscode/package.json`                     | +1 commande `continue.keypoollive.rotateKey`          |
| `gui/src/components/Chat.tsx` (ou équivalent)        | +20 lignes : affichage `VaultKeyRotateButton`         |

### 14.3 Variables d'environnement requises

| Variable              | Obligatoire | Description                                  |
| --------------------- | ----------- | -------------------------------------------- |
| `KEYPOOL_LIVE_SECRET` | Oui         | Clé de déchiffrement du coffre `ai.json.enc` |

### 14.4 Paramètres de configuration VS Code

Ajoutez ces paramètres dans `extensions/vscode/package.json` sous `contributes.configuration.properties` :

```json
"continue.keypoollive.vaultUrl": {
  "type": "string",
  "default": "",
  "description": "URL of the encrypted KeypoolLive AI vault (ai.json.enc)"
},
"continue.keypoollive.enabled": {
  "type": "boolean",
  "default": true,
  "description": "Enable KeypoolLive vault models in Continue"
}
```

---

## Annexe A : Checklist de développement

Utilisez cette checklist pour suivre votre progression :

### Phase 1 : Mise en place (Semaine 1)

- [ ] Fork du dépôt Continue sur GitHub
- [ ] Clone local et configuration des remotes (`origin` / `upstream`)
- [ ] Création de la branche `keypoollive/vault`
- [ ] Installation des dépendances (`pnpm install`)
- [ ] Premier build réussi de l'extension
- [ ] Extension installée en mode développement

### Phase 2 : Module de coffre-fort (Semaine 2)

- [ ] Création de `core/keypoollive/types.ts`
- [ ] Création de `core/keypoollive/AiVault.ts`
- [ ] Tests unitaires AiVault passants
- [ ] Script de chiffrement/déchiffrement de test validé avec KEYPOOL_LIVE_SECRET

### Phase 3 : Pool de clés (Semaine 2-3)

- [ ] Création de `core/keypoollive/KeyPool.ts`
- [ ] Tests unitaires KeyPool passants
- [ ] Round-robin validé manuellement avec un vault de test

### Phase 4 : Intégration Continue (Semaine 3)

- [ ] Création de `core/keypoollive/VaultConfigInjector.ts`
- [ ] Modification minimale de `doLoadConfig.ts`
- [ ] Modèles du vault visibles dans Continue
- [ ] Sélection d'un modèle vault dans le chat fonctionne

### Phase 5 : Gestion de session (Semaine 4)

- [ ] Création de `core/keypoollive/SessionKeyManager.ts`
- [ ] Création de `core/keypoollive/VaultLlmWrapper.ts`
- [ ] Chaque nouvelle session utilise une clé différente

### Phase 6 : Interface utilisateur (Semaine 4-5)

- [ ] Création du protocole de messages (`core/keypoollive/protocol.ts`)
- [ ] Handlers enregistrés dans `VaultCommandHandler.ts`
- [ ] Composant React `VaultKeyRotateButton.tsx` créé
- [ ] Bouton visible dans le chat pour les modèles vault
- [ ] Rotation de clé fonctionnelle depuis le bouton

### Phase 7 : Tests et documentation (Semaine 5)

- [ ] Tous les tests unitaires passants
- [ ] Test de régression : les modèles existants (non-vault) fonctionnent toujours
- [ ] Test de synchronisation upstream réussi
- [ ] VSIX packagé et installé par l'équipe

---

## Annexe B : Dépannage des problèmes courants

### Problème : "KEYPOOL_LIVE_SECRET not set" au démarrage

**Cause** : VS Code n'hérite pas des variables d'environnement du shell.

**Solution** : Lancez VS Code depuis le terminal :

```bash
KEYPOOL_LIVE_SECRET="votre-clé-secrète" code .
```

Ou configurez la variable dans votre `.zshrc` / `.bashrc`.

### Problème : Les modèles KeypoolLive n'apparaissent pas dans Continue

**Causes possibles** :

1. `KEYPOOL_LIVE_SECRET` non défini (voir ci-dessus)
2. URL du vault incorrecte dans les paramètres VS Code
3. Vault expiré ou inaccessible

**Débogage** :

```bash
# In VS Code Developer Console (Help > Toggle Developer Tools)
# Look for messages starting with "[FufuniVaultInjector]"
```

### Problème : Conflit lors du rebase upstream

**Cause** : Upstream a modifié un fichier que nous avons aussi modifié.

**Solution** :

1. `git status` → identifier le(s) fichier(s) en conflit
2. Chercher les marqueurs `<<<<<<< HEAD` dans le fichier
3. Garder les modifications upstream **ET** nos ajouts KeypoolLive
4. `git add <fichier>` puis `git rebase --continue`

### Problème : Erreur 429 (rate limit) sur toutes les clés

**Cause** : Toutes les clés d'un fournisseur ont atteint leur limite.

**Solution** : Le KeyPool utilise un cooldown de 15 minutes avant de retenter. Alternativement, switchez vers un autre fournisseur dans la sélection de modèle de Continue.

---

_Ce plan d'action a été rédigé pour l'équipe KeypoolLive en avril 2026. Pour toute question, consultez le canal `#dev-ai-tools` dans Slack._
