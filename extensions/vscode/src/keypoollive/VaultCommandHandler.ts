// Handles KeypoolLive vault-related messages from webview
import * as vscode from "vscode";
import type { VsCodeWebviewProtocol } from "../webviewProtocol.js";
import {
  rotateSessionKey,
  getSessionKeyInfo,
} from "core/keypoollive/SessionKeyManager";

type FufuniRotateKeyRequest = any;
type FufuniRotateKeyResponse = any;
type FufuniGetKeyInfoRequest = any;
type FufuniGetKeyInfoResponse = any;

/**
 * Registers all KeypoolLive vault-related message handlers
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

      if (!providerName) {
        const response: FufuniRotateKeyResponse = {
          success: false,
          error: "providerName is required",
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

          void vscode.window.showInformationMessage(
            `KeypoolLive: Switched to key ${newConfig.keyOwner}`,
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
