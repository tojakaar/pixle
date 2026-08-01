import { useRef, useState, type FormEvent } from "react";
import { editFromPrompt } from "../aiEditor";
import { shortenEditSummary, type EditParameters, type ImageAnalysis } from "../engine";

interface AiEditorPanelProps {
  params: EditParameters;
  imageAnalysis: ImageAnalysis | null;
  disabled: boolean;
  onApply: (params: EditParameters) => void;
}

/**
 * Conversational edit controls. Talks to `editFromPrompt` only — LLM access
 * stays in the Tauri backend so the API key never reaches the webview.
 */
export function AiEditorPanel({
  params,
  imageAnalysis,
  disabled,
  onApply,
}: AiEditorPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"ok" | "error">("ok");
  const requestIdRef = useRef(0);
  const paramsRef = useRef(params);
  const analysisRef = useRef(imageAnalysis);

  paramsRef.current = params;
  analysisRef.current = imageAnalysis;

  const chatReady = Boolean(imageAnalysis) && !disabled;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    const analysis = analysisRef.current;
    if (!trimmed || !chatReady || busy || !analysis) return;

    const requestId = ++requestIdRef.current;
    setBusy(true);
    setStatus(null);

    try {
      const result = await editFromPrompt(
        trimmed,
        paramsRef.current,
        analysis,
      );
      if (requestId !== requestIdRef.current) return;

      try {
        onApply(result.parameters);
        setPrompt("");
        setStatusTone("ok");
        setStatus(
          shortenEditSummary(result.editSummary) || "Edit applied",
        );
      } catch (applyError) {
        // Applying must never leave the panel stuck in Sending…
        const message =
          applyError instanceof Error && applyError.message.trim()
            ? applyError.message
            : "Could not apply that edit";
        setStatusTone("error");
        setStatus(message);
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
              : !imageAnalysis
                ? "Preparing image analysis…"
                : 'Try “cinematic”, “warm sunset”, or “recover the highlights”'
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
