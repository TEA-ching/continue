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

import React, { useCallback, useContext, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

interface VaultKeyRotateButtonProps {
  sessionId: string;
  providerName?: string;
  modelId?: string;
}

export function VaultKeyRotateButton({
  sessionId,
  providerName,
  modelId,
}: VaultKeyRotateButtonProps): React.ReactElement | null {
  const ideMessenger = useContext(IdeMessengerContext);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const handleRotateKey = useCallback(async () => {
    if (!providerName) return;

    setStatus("loading");
    setStatusMessage("Rotating key...");

    try {
      const response = await ideMessenger.request(
        "keypoollive/rotateKey" as any,
        {
          sessionId,
          providerName,
          modelId,
        },
      );

      const payload =
        response.status === "success" ? (response.content as any) : null;

      if (
        response.status === "success" &&
        payload?.success &&
        payload?.newKeyInfo
      ) {
        setStatus("success");
        setStatusMessage(
          `Now using key ${payload.newKeyInfo.keyHint} (${payload.newKeyInfo.keyOwner})`,
        );
        setTimeout(() => {
          setStatus("idle");
          setStatusMessage("");
        }, 3000);
      } else {
        setStatus("error");
        setStatusMessage(
          (response.status === "success" ? payload?.error : response.error) ??
            "Failed to rotate key",
        );
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

  if (!providerName) {
    return null;
  }

  const statusColor =
    status === "success"
      ? "var(--vscode-terminal-ansiGreen, #4ec9b0)"
      : status === "error"
        ? "var(--vscode-terminal-ansiRed, #f48771)"
        : "var(--vscode-foreground)";

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
          ? `KeypoolLive: Change API key for ${providerName}`
          : statusMessage
      }
    >
      <button
        onClick={handleRotateKey}
        disabled={status === "loading"}
        style={{
          background: "none",
          border: "1px solid var(--vscode-button-border, #555)",
          borderRadius: "3px",
          padding: "2px 6px",
          cursor: status === "loading" ? "not-allowed" : "pointer",
          color: statusColor,
          fontSize: "11px",
          display: "flex",
          alignItems: "center",
          gap: "3px",
        }}
        aria-label="Change KeypoolLive vault API key"
      >
        {status === "loading" && <span>⟳</span>}
        {status === "idle" && <span>🔄</span>}
        {status === "success" && <span>✓</span>}
        {status === "error" && <span>✗</span>}
        <span>
          {status === "idle" && "🔑"}
          {status === "loading" && "..."}
          {status === "success" && "Done"}
          {status === "error" && "Error"}
        </span>
      </button>

      {statusMessage && status !== "idle" && (
        <span
          style={{
            fontSize: "10px",
            color: statusColor,
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
