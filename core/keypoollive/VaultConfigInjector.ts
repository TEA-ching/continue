// Injects vault-sourced models into Continue configuration
import { ContinueConfig, ILLM, ILLMLogger } from "../index.js";
import { loadAiVault } from "./AiVault.js";
import { buildModelDescriptions } from "./KeyPool.js";
import { configureSessionKeyManager } from "./SessionKeyManager.js";
import { AiVaultConfig } from "./types.js";

let vaultUrl: string | null = null;
let cachedVaultLlms: ILLM[] | null = null;

/**
 * Sets the vault URL
 */
export function setVaultUrl(url: string): void {
  vaultUrl = url;
  configureSessionKeyManager(url);
}

/**
 * Builds ILLM instances from vault configuration
 */
async function buildLlmsFromVault(
  vault: AiVaultConfig,
  ideSettings: any,
  llmLogger: ILLMLogger,
): Promise<ILLM[]> {
  const descriptions = buildModelDescriptions(vault);
  const llms: ILLM[] = [];

  // Dynamically import llmFromDescription to avoid circular dependencies
  const { llmFromDescription } = await import("../llm/llms/index.js");

  for (const desc of descriptions) {
    try {
      const llmOrPromise = (llmFromDescription as any)(
        desc as any,
        undefined,
        ideSettings,
        undefined,
        undefined,
        llmLogger,
      );
      const llm = await Promise.resolve(llmOrPromise);
      if (llm) {
        (llm as any)._fufuniVault = true;
        (llm as any)._fufuniProviderName = desc.provider;
        // Ensure required properties are set for model selection
        if (!llm.title) {
          (llm as any).title = desc.title;
        }
        llms.push(llm);
      }
    } catch (error) {
      console.warn(
        `[KeypoolLive] Failed to create LLM for ${desc.title}:`,
        error,
      );
    }
  }

  return llms;
}

/**
 * Injects vault models into existing ContinueConfig
 */
export async function injectVaultModels(
  config: ContinueConfig,
  ideSettings: any,
  llmLogger: ILLMLogger,
): Promise<ContinueConfig> {
  if (!vaultUrl) {
    return config;
  }

  if (!process.env.KEYPOOL_LIVE_SECRET) {
    console.warn(
      "[KeypoolLive] KEYPOOL_LIVE_SECRET not set - vault models will not be available",
    );
    return config;
  }

  let vault: AiVaultConfig;
  try {
    vault = await loadAiVault(vaultUrl);
    console.log(
      `[KeypoolLive] Loaded vault config version ${vault.version} with ${Object.keys(vault.providers).length} providers`,
    );
  } catch (error) {
    console.error("[KeypoolLive] Failed to load vault:", error);
    return config;
  }

  // Use cached models if available to avoid recreating them on every config reload
  let vaultLlms = cachedVaultLlms;
  if (!vaultLlms) {
    vaultLlms = await buildLlmsFromVault(vault, ideSettings, llmLogger);
    cachedVaultLlms = vaultLlms;
    console.log(
      `[KeypoolLive] Created and cached ${vaultLlms.length} vault models`,
    );
    vaultLlms.forEach((m, i) => {
      const model = m as any;
      console.log(
        `[KeypoolLive] Model ${i}: title="${model.title}", provider="${model.providerName}", apiKey=${model.apiKey ? "SET" : "EMPTY"}`,
      );
    });
  } else {
    console.log(`[KeypoolLive] Using cached ${vaultLlms.length} vault models`);
  }

  if (vaultLlms.length === 0) {
    console.log("[KeypoolLive] No vault models available, skipping injection");
    return config;
  }

  // Check if vault models are already in the config to avoid duplication
  const existingModels = config.models ?? [];
  const hasVaultModels = existingModels.some(
    (m) => (m as any)._fufuniVault === true,
  );

  if (hasVaultModels) {
    console.log(
      "[KeypoolLive] Vault models already in config, skipping injection",
    );
    return config;
  }

  // Add vault models to the main models array
  const augmentedConfig = { ...config } as any;
  augmentedConfig.models = [...(augmentedConfig.models ?? []), ...vaultLlms];

  console.log(
    `[KeypoolLive] Injected ${vaultLlms.length} vault models into config.models`,
  );
  return augmentedConfig as ContinueConfig;
}
