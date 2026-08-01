import { useRef, useState, type FormEvent } from "react";

export interface AiPromptResult {
  message: string;
  tone: "ok" | "error" | "clarify";
}

interface AiEditorPanelProps {
  disabled: boolean;
  /** True while image analysis is still preparing. */
  analysisReady: boolean;
  onSubmitPrompt: (prompt: string) => Promise<AiPromptResult>;
}

/**
 * Conversational edit controls. Delegates prompt resolution to App so
 * EditSession follow-ups, clarifications, and Gemini share one path.
 */
export function AiEditorPanel({
  disabled,
  analysisReady,
  onSubmitPrompt,
}: AiEditorPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "error" | "clarify">(
    "ok",
  );
  const requestIdRef = useRef(0);

  const chatReady = analysisReady && !disabled;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || !chatReady || busy) return;

    const requestId = ++requestIdRef.current;
    setBusy(true);
    setStatus(null);

    try {
      const result = await onSubmitPrompt(trimmed);
      if (requestId !== requestIdRef.current) return;
      setStatusTone(result.tone);
      setStatus(result.message);
      if (result.tone === "ok") {
        setPrompt("");
      }
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : "Could not apply that edit";
      setStatusTone("error");
      setStatus(message);
    } finally {
      if (requestId === requestIdRef.current) {
        setBusy(false);
      }
    }
  }

  return (
    <section className="ai-panel" aria-label="AI editing">
      <header className="ai-panel__header">
        <h2 className="ai-panel__title">Ask pixle</h2>
        {status ? (
          <span
            className={
              statusTone === "error"
                ? "ai-panel__status ai-panel__status--error"
                : statusTone === "clarify"
                  ? "ai-panel__status ai-panel__status--clarify"
                  : "ai-panel__status"
            }
            title={status}
          >
            {status}
          </span>
        ) : null}
      </header>

      <form className="ai-panel__form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="ai-panel__input"
          value={prompt}
          disabled={!chatReady || busy}
          placeholder={
            disabled
              ? "Open an image to edit with AI"
              : !analysisReady
                ? "Preparing image analysis…"
                : 'Try “darken the sky”, then “a little more”'
          }
          onChange={(e) => setPrompt(e.currentTarget.value)}
          aria-label="Edit instruction"
        />
        <button
          type="submit"
          className="ai-panel__send"
          disabled={!chatReady || busy || !prompt.trim()}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
