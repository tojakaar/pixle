import {
  editFromPrompt as invokeEditFromPrompt,
  type EditFromPromptResult,
} from "../aiEditor";
import type {
  EditParameters,
  EditSessionContext,
  ImageAnalysis,
} from "../engine";
import type { ApiClient } from "./types";

/**
 * Development ApiClient — calls the existing Rust `edit_from_prompt` command.
 * Gemini credentials stay in the Rust process (`.env`), never in frontend JS.
 *
 * Production mobile must NOT embed a reusable Gemini API key. Replace this
 * implementation with a Pixle backend proxy:
 *
 *   Pixle mobile → Pixle backend → Gemini (or other provider)
 */
export function createTauriGeminiApiClient(): ApiClient {
  return {
    id: "tauri-gemini-dev",
    editFromPrompt(
      prompt: string,
      currentParameters: EditParameters,
      imageAnalysis: ImageAnalysis,
      sessionContext?: EditSessionContext | null,
    ): Promise<EditFromPromptResult> {
      return invokeEditFromPrompt(
        prompt,
        currentParameters,
        imageAnalysis,
        sessionContext,
      );
    },
  };
}

/**
 * Placeholder for a future production client. Not used in this spike —
 * kept so the boundary is explicit and greppable.
 */
export function createPixleBackendApiClient(baseUrl: string): ApiClient {
  return {
    id: "pixle-backend",
    async editFromPrompt(
      prompt,
      currentParameters,
      imageAnalysis,
      sessionContext,
    ) {
      void baseUrl;
      void prompt;
      void currentParameters;
      void imageAnalysis;
      void sessionContext;
      throw new Error(
        "Pixle backend ApiClient is not implemented in the iOS spike. " +
          "Use createTauriGeminiApiClient() for local device development only.",
      );
    },
  };
}
