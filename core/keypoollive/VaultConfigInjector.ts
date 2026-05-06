/**
 * MIT License
 *
 * Copyright (c) 2026 Ronan LE MEILLAT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Injects vault-sourced models into Continue configuration
import { ContinueConfig, ILLM, ILLMLogger } from "../index.js";
import { loadAiVault } from "./AiVault.js";
import { buildModelDescriptions } from "./KeyPool.js";
import { configureSessionKeyManager } from "./SessionKeyManager.js";
import { AiVaultConfig, KeypoolLiveConfig } from "./types.js";

let vaultUrl: string | null = null;
let cachedVaultLlms: ILLM[] | null = null;
let currentKplConfig: KeypoolLiveConfig | null = null;

/**
 * Sets the vault URL and optional KeypoolLive gateway config.
 * Invalidates model cache when config changes.
 */
export function setVaultUrl(url: string, kplConfig?: KeypoolLiveConfig): void {
  const prevConfig = JSON.stringify(currentKplConfig);
  currentKplConfig = kplConfig ?? null;
  vaultUrl = url;
  configureSessionKeyManager(url);
  if (JSON.stringify(currentKplConfig) !== prevConfig) {
    cachedVaultLlms = null;
  }
}

/**
 * Builds ILLM instances from vault configuration
 */
async function buildLlmsFromVault(
  vault: AiVaultConfig,
  ideSettings: any,
  llmLogger: ILLMLogger,
): Promise<ILLM[]> {
  const descriptions = buildModelDescriptions(
    vault,
    currentKplConfig ?? undefined,
  );
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
        (llm as any)._keypoolVault = true;
        (llm as any)._keypoolProviderName = desc.vaultProviderName;
        (llm as any)._keypoolModelId = desc.vaultModelId;
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
