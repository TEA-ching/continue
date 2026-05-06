// Injects vault-sourced models into Continue configuration
import { ContinueConfig, ILLM, ILLMLogger } from "../index.js";
import { loadAiVault } from "./AiVault.js";
import { buildModelDescriptions } from "./KeyPool.js";
import { configureSessionKeyManager } from "./SessionKeyManager.js";
import { AiVaultConfig } from "./types.js";

let vaultUrl: string | null = null;

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

  const vaultLlms = await buildLlmsFromVault(vault, ideSettings, llmLogger);

  if (vaultLlms.length === 0) {
    console.log("[KeypoolLive] No vault models created, skipping injection");
    return config;
  }

  const augmentedConfig = { ...config } as any;
  // Add vault models to chat/edit/apply roles.
  // Apply can use chat-capable models as generation backends.
  augmentedConfig.modelsByRole = augmentedConfig.modelsByRole || {};
  augmentedConfig.modelsByRole.chat = [
    ...(augmentedConfig.modelsByRole.chat ?? []),
    ...vaultLlms,
  ];
  augmentedConfig.modelsByRole.edit = [
    ...(augmentedConfig.modelsByRole.edit ?? []),
    ...vaultLlms,
  ];
  augmentedConfig.modelsByRole.apply = [
    ...(augmentedConfig.modelsByRole.apply ?? []),
    ...vaultLlms,
  ];

  console.log(
    `[KeypoolLive] Injected ${vaultLlms.length} vault models into augmentedConfig`,
  );
  return augmentedConfig as ContinueConfig;
}
