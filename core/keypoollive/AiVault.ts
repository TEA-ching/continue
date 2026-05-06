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

// Handles fetching and decrypting the KeypoolLive AI vault
import { AiConfig, AiVaultConfig } from "./types.js";

interface VaultCache {
  config: AiVaultConfig;
  fetchedAt: number;
}

const VAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let vaultCache: VaultCache | null = null;

/**
 * Decrypt and parse an AI config file encrypted with:
 *   openssl enc -aes-256-cbc -a -pbkdf2 -iter 100000 -salt \
 *     -in ai.json -out ai.json.enc -pass pass:"${CRYPTOKEN}"
 *
 * Uses only the Web Crypto API — no Node.js-specific modules.
 *
 * @param base64Ciphertext  Full text content of ai.json.enc (base64 OpenSSL output)
 * @param password          Value of the CRYPTOKEN environment variable
 */
export async function decryptAiConfig(
  base64Ciphertext: string,
  password: string,
): Promise<AiConfig> {
  // 1. base64 decode → raw bytes
  const raw = Uint8Array.from(atob(base64Ciphertext.trim()), (c) =>
    c.charCodeAt(0),
  );

  // 2. Verify OpenSSL "Salted__" magic header (bytes 0–7)
  if (new TextDecoder().decode(raw.slice(0, 8)) !== "Salted__") {
    throw new Error(
      'ai.json.enc: invalid format — expected OpenSSL "Salted__" header. ' +
        "Make sure the file was encrypted with the -a flag.",
    );
  }

  const salt = raw.slice(8, 16); // bytes 8–15
  const ciphertext = raw.slice(16); // bytes 16–end

  // 3. PBKDF2-SHA256 → 48 bytes (32 key + 16 IV), matching -pbkdf2 -iter 100000
  const pwBytes = new TextEncoder().encode(password);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    pwBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
      baseKey,
      384, // 48 bytes × 8 bits
    ),
  );

  // 4. AES-256-CBC decrypt
  const aesKey = await crypto.subtle.importKey(
    "raw",
    derived.slice(0, 32),
    "AES-CBC",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: derived.slice(32, 48) },
    aesKey,
    ciphertext,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as AiConfig;
}
/**
 * Decrypts AES-256-GCM encrypted vault
 * Format: base64(IV(12) || Ciphertext(...) || AuthTag(16))
 */
async function decryptVault(
  encryptedBase64: string,
  KEYPOOL_LIVE_SECRET: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const encryptedBytes = Buffer.from(encryptedBase64, "base64");
  const encryptedArray = Uint8Array.from(encryptedBytes);

  // Extract components: IV (first 12 bytes), AuthTag (last 16 bytes), Ciphertext (middle)
  const iv = encryptedArray.slice(0, 12);
  const ciphertext = encryptedArray.slice(12, encryptedArray.length - 16);
  const authTag = encryptedArray.slice(encryptedArray.length - 16);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(KEYPOOL_LIVE_SECRET),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("keypoollive-ai-vault-salt-v1"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
  ciphertextWithTag.set(ciphertext, 0);
  ciphertextWithTag.set(authTag, ciphertext.length);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    ciphertextWithTag,
  );

  return Buffer.from(decryptedBuffer).toString("utf-8");
}

/**
 * Fetches encrypted vault from public URL
 */
async function fetchEncryptedVault(url: string): Promise<string> {
  const response = await fetch(url, {
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
 * Loads the AI vault configuration with caching
 */
export async function loadAiVault(vaultUrl: string): Promise<AiVaultConfig> {
  if (vaultCache && Date.now() - vaultCache.fetchedAt < VAULT_CACHE_TTL_MS) {
    return vaultCache.config;
  }

  const KEYPOOL_LIVE_SECRET = process.env.KEYPOOL_LIVE_SECRET;
  if (!KEYPOOL_LIVE_SECRET) {
    throw new Error(
      "KEYPOOL_LIVE_SECRET environment variable is not set. " +
        "Please set it to the vault decryption key to use KeypoolLive AI models.",
    );
  }

  const encryptedContent = await fetchEncryptedVault(vaultUrl);
  console.log(
    `[KeypoolLive] Successfully fetched encrypted vault, decrypting... ${encryptedContent.length} bytes received ${encryptedContent.slice(0, 30)}...`,
  );
  const aiConfig = await decryptAiConfig(encryptedContent, KEYPOOL_LIVE_SECRET);
  console.log(
    `[KeypoolLive] Vault decryption successful. Loaded config with version ${aiConfig.version} and ${Object.keys(aiConfig.providers).length} providers.`,
  );
  const config: AiVaultConfig = await getAiVaultConfigFromAiConfig(aiConfig);

  vaultCache = { config, fetchedAt: Date.now() };
  return config;
}

/**
 * Converts AiConfig format from Fufuni project to AiVaultConfig format, applying defaults and transformations as needed
 * @param aiConfig
 * @returns
 */
export async function getAiVaultConfigFromAiConfig(
  aiConfig: AiConfig,
): Promise<AiVaultConfig> {
  // Convert AiConfig to AiVaultConfig format
  const vaultConfig: AiVaultConfig = {
    version: aiConfig.version,
    providers: {},
  };

  for (const [providerName, provider] of Object.entries(aiConfig.providers)) {
    vaultConfig.providers[providerName] = {
      protocol: provider.protocol,
      endpoint: provider.endpoint,
      gatewayEndpoint: provider.gatewayEndpoint,
      gatewayModelPrefix: provider.gatewayModelPrefix,
      keys: provider.keys.map((key) => ({
        key: key.key,
        owner: key.owner || "unknown",
        type: key.type || "free",
      })),
      models: provider.models.map((model) => ({
        id: model.id,
        usage: model.usage || "chat",
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        tpmLimit: model.tpmLimit,
        priority: model.priority,
        tags: model.tags || [],
        defaultDimensions: model.defaultDimensions,
      })),
    };
  }

  return vaultConfig;
}
/**
 * Clears the vault cache for fresh fetch
 */
export function clearVaultCache(): void {
  vaultCache = null;
}
