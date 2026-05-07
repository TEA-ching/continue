// Handles KeypoolLive vault-related messages from webview
import {
  getSessionKeyInfo,
  rotateSessionKey,
} from "core/keypoollive/SessionKeyManager";
import * as vscode from "vscode";
import type { VsCodeWebviewProtocol } from "../webviewProtocol.js";

const KEYPOOLLIVE_GLOBAL_SESSION_ID = "global";

/**
 * Type representing a request to rotate a session key
 */
type FufuniRotateKeyRequest = any;

/**
 * Type representing a response from a key rotation request
 */
type FufuniRotateKeyResponse = any;

/**
 * Type representing a request to get key information
 */
type FufuniGetKeyInfoRequest = any;

/**
 * Type representing a response containing key information
 */
type FufuniGetKeyInfoResponse = any;

/**
 * Masks an API key for display purposes by showing only the first and last 6 characters
 * @param apiKey - The API key to be masked
 * @returns The masked API key or an empty string if the input is empty
 */
function maskKeyForDisplay(apiKey: string): string {
  if (!apiKey) {
    return "";
  }
  if (apiKey.length <= 12) {
    return apiKey;
  }
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-6)}`;
}

/**
 * Registers all KeypoolLive vault-related message handlers
 * @param webviewProtocol - The webview protocol instance for communication
 * @param context - The extension context provided by VS Code
 */
export function registerVaultHandlers(
  webviewProtocol: VsCodeWebviewProtocol,
  context: vscode.ExtensionContext,
): void {
  // Handler for key rotation requests
  webviewProtocol.on(
    "keypoollive/rotateKey" as any,
    async (msg: { data: FufuniRotateKeyRequest }) => {
      const { sessionId, providerName, modelId } = msg.data;
      const rotationSessionId = sessionId || KEYPOOLLIVE_GLOBAL_SESSION_ID;

      if (!providerName) {
        const response: FufuniRotateKeyResponse = {
          success: false,
          error: "providerName is required",
        };
        return response;
      }

      try {
        const newConfig = await rotateSessionKey(
          rotationSessionId,
          providerName,
          modelId,
          "user_request",
        );

        if (newConfig) {
          const keyHint = maskKeyForDisplay(newConfig.apiKey);
          const response: FufuniRotateKeyResponse = {
            success: true,
            newKeyInfo: {
              providerName: newConfig.providerName,
              keyOwner: newConfig.keyOwner,
              keyHint,
              modelId: newConfig.modelId,
            },
          };

          void vscode.window.showInformationMessage(
            [
              "KeypoolLive: RotateKey",
              `owner: ${newConfig.keyOwner}`,
              `key: ${keyHint}`,
            ].join("\n"),
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
          error: error.message ?? "Unknown error",
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

  // Register VS Code command
  const rotateKeyCommand = vscode.commands.registerCommand(
    "continue.keypoollive.rotateKey",
    async () => {
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
        webviewProtocol.send("keypoollive/requestKeyRotation" as any, {
          providerName: selected,
        });
      }
    },
  );

  context.subscriptions.push(rotateKeyCommand);
}
