// Manages pool of API keys with round-robin rotation
import {
  AiVaultConfig,
  ResolvedApiConfig,
  VaultKey,
  VaultModel,
} from "./types.js";

interface KeyStatus {
  key: string;
  isHealthy: boolean;
  lastFailedAt: number | null;
  failureCount: number;
}

const KEY_COOLDOWN_MS = 15 * 60 * 1000;
const MAX_FAILURE_COUNT = 3;

const roundRobinIndexes: Map<string, number> = new Map();
const keyStatuses: Map<string, KeyStatus> = new Map();

function getKeyStatusId(providerName: string, keyValue: string): string {
  return `${providerName}:${keyValue.slice(-8)}`;
}

function isKeyUsable(providerName: string, keyValue: string): boolean {
  const statusId = getKeyStatusId(providerName, keyValue);
  const status = keyStatuses.get(statusId);

  if (!status) {
    return true;
  }

  if (!status.isHealthy) {
    if (
      status.lastFailedAt &&
      Date.now() - status.lastFailedAt > KEY_COOLDOWN_MS &&
      status.failureCount < MAX_FAILURE_COUNT
    ) {
      status.isHealthy = true;
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Marks a key as failed for rotation
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
    `[KeypoolLive] Key ${keyValue.slice(-8)}... for ${providerName} failed (count: ${(existing?.failureCount ?? 0) + 1})`,
  );
}

function selectNextKey(
  providerName: string,
  keys: VaultKey[],
): VaultKey | null {
  const eligibleKeys = keys.filter((k) => k.type !== "expired");

  if (eligibleKeys.length === 0) {
    return null;
  }

  const currentIndex = roundRobinIndexes.get(providerName) ?? 0;

  for (let attempt = 0; attempt < eligibleKeys.length; attempt++) {
    const index = (currentIndex + attempt) % eligibleKeys.length;
    const candidate = eligibleKeys[index];

    if (isKeyUsable(providerName, candidate.key)) {
      roundRobinIndexes.set(providerName, (index + 1) % eligibleKeys.length);
      return candidate;
    }
  }

  console.error(
    `[KeypoolLive] All keys for ${providerName} are on cooldown, using fallback`,
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

function selectModel(
  models: VaultModel[],
  filterFn?: (model: VaultModel) => boolean,
): VaultModel | null {
  const chatModels = models.filter((m) => m.usage === "chat");
  const filtered = filterFn ? chatModels.filter(filterFn) : chatModels;

  if (filtered.length === 0) {
    return null;
  }

  return filtered.sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Resolves the next API configuration using round-robin
 */
export function resolveNextApiConfig(
  vault: AiVaultConfig,
  providerName: string,
  modelId?: string,
): ResolvedApiConfig | null {
  const provider = vault.providers[providerName];
  if (!provider) {
    console.error(`[KeypoolLive] Provider "${providerName}" not found`);
    return null;
  }

  const selectedKey = selectNextKey(providerName, provider.keys);
  if (!selectedKey) {
    console.error(`[KeypoolLive] No usable keys for ${providerName}`);
    return null;
  }

  const model = modelId
    ? (provider.models.find((m) => m.id === modelId) ?? null)
    : selectModel(provider.models);

  if (!model) {
    console.error(
      `[KeypoolLive] Model "${modelId}" not found in ${providerName}`,
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
 * Builds model descriptions from vault
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
    const continueProvider = mapToContinueProvider(
      providerName,
      provider.protocol,
    );
    if (!continueProvider) {
      continue;
    }

    const initialKey = provider.keys.find((k) => k.type !== "expired");
    if (!initialKey) {
      continue;
    }

    const chatModels = provider.models.filter((m) => m.usage === "chat");
    for (const model of chatModels) {
      const tags = model.tags.join(", ");
      descriptions.push({
        title: `[KeypoolLive] ${providerName}/${model.id} (${tags})`,
        provider: continueProvider,
        model: model.id,
        apiKey: initialKey.key,
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

  return descriptions;
}

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
 * Resets all state
 */
export function resetKeyPool(): void {
  roundRobinIndexes.clear();
  keyStatuses.clear();
}
