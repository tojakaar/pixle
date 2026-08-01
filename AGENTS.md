# AGENTS.md

## Project overview

`pixle` is a cross-platform photo editor built with **Tauri v2 + React 19 + TypeScript** (Vite bundler, Rust backend). See `README.md` for the full stack, project layout, prerequisites, and the complete list of commands.

- Frontend: `src/` (React + TypeScript, entry `src/main.tsx`)
- Platform adapters: `src/platform/` (`ImagePicker`, `ImageExporter`, `ApiClient`)
- Backend: `src-tauri/` (Rust; Tauri commands live in `src-tauri/src/lib.rs`)
- iOS spike docs: `docs/ios-feasibility-spike.md`

## Cursor Cloud specific instructions

These are durable, non-obvious caveats for running this project in the cloud VM. Standard commands are documented in `README.md` (`npm run dev`, `npm run build`, `npm run tauri dev`, etc.); prefer those.

- **Rust toolchain gotcha:** The VM's base default Rust is too old for this project. Tauri v2's dependency tree (e.g. `zbus`) needs Rust ≥ 1.85 (`edition2024`). The repo pins a modern stable toolchain via `src-tauri/rust-toolchain.toml`, so `cargo`/`tauri` commands run from `src-tauri/` (or anywhere under it) auto-select the correct toolchain. Don't rely on the machine's global `rustc --version`; it may still report the old default.
- **Running the full desktop app (headless VM):** `npm run tauri dev` launches a native GTK/WebKit window and requires a display. Export `DISPLAY=:1` before running (that is the desktop the computer-use/VNC session shows). Example: `DISPLAY=:1 npm run tauri dev`.
- **Harmless rendering warnings:** On this GPU-less VM, WebKitGTK falls back to software rendering and prints `libEGL warning: DRI3 error ...`. These warnings are expected and do not prevent the window from rendering or functioning.
- **Frontend-only vs. full app:** `npm run dev` serves the React UI at `http://localhost:1420` in a browser, but Tauri `invoke()` calls to Rust commands (e.g. `edit_from_prompt`) only work inside the native Tauri window (`npm run tauri dev`). Use the full app to exercise frontend↔backend IPC.
- **AI editing API key:** Conversational edits use Rust (`src-tauri/src/ai_editor.rs`). Put keys in project-root **`.env`** (copy from `.env.example`; the app does **not** load `.env.example`). **Gemini (Google AI Studio):** `GEMINI_API_KEY` or `GOOGLE_API_KEY` (+ optional `GEMINI_MODEL`, default `gemini-2.0-flash`). **Claude:** `ANTHROPIC_API_KEY`. **OpenAI-compatible:** `OPENAI_API_KEY`. Auto-detect prefers Gemini → Anthropic → OpenAI unless `LLM_PROVIDER` is set. Never put keys in frontend / `VITE_*` vars.
- **AI image context:** On open, the frontend runs local analysis (`src/engine/imageAnalysis.ts`) on a downscaled copy and sends compact metadata (histogram, colour temperature, dominant colours, clipping, dimensions, faces when `FaceDetector` exists) with the prompt. Full-resolution pixels are never sent to the LLM.
- **Large photos on macOS:** Images are decoded into a working buffer capped at 1600px on the long edge (`src/engine/imageDecode.ts`) using header probe + resized `createImageBitmap`, so WKWebView does not freeze on multi‑megapixel camera JPEGs. Opening clears as soon as pixels are ready; analysis runs afterward.
- **First Rust build is slow:** The initial `cargo build` / `tauri dev` compiles the whole Tauri dependency tree (~1 min) and is cached under `src-tauri/target/` afterward.
- **Lint/type-check:** Frontend type-checking is `npx tsc --noEmit` (also part of `npm run build`). Rust linting is `cargo clippy` and `cargo fmt --check` from `src-tauri/`. There is no ESLint config. Lightweight JS smokes: `npm run test:js`.
- **iOS spike on Linux VMs:** `npx tauri ios` is unavailable (CLI has `android` only). Scaffolding (`Info.ios.plist`, `tauri.ios.conf.json`, `ios-bridge/`, platform adapters) is in-repo; real `ios init` / simulator / device runs require macOS + Xcode. Never present simulator results as device proof. Do not commit Gemini keys; production mobile needs a backend proxy.
