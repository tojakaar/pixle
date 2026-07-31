# pixle

A cross-platform desktop application built with [Tauri v2](https://tauri.app/), [React 19](https://react.dev/), and [TypeScript](https://www.typescriptlang.org/). The frontend is bundled with [Vite](https://vite.dev/), and the native backend is written in Rust.

## Tech stack

- **Tauri v2** — native desktop shell (Rust) with a system webview
- **React 19 + TypeScript** — frontend UI
- **Vite** — dev server and frontend bundler
- **Rust** — backend commands exposed to the frontend via Tauri's `invoke` API

## Project layout

```
.
├── src/                # React + TypeScript frontend
│   ├── App.tsx         # Main UI component (calls the `greet` Rust command)
│   └── main.tsx        # React entry point
├── src-tauri/          # Rust backend (Tauri)
│   ├── src/lib.rs      # Tauri app setup + `greet` command
│   ├── src/main.rs     # Binary entry point
│   ├── Cargo.toml      # Rust dependencies
│   ├── tauri.conf.json # Tauri configuration
│   └── rust-toolchain.toml # Pins a modern stable Rust toolchain
├── index.html          # Vite HTML entry
├── package.json        # Frontend dependencies + scripts
└── vite.config.ts      # Vite configuration (fixed port 1420 for Tauri)
```

## Prerequisites

- **Node.js** (v18+) and **npm**
- **Rust** (stable, >= 1.85 — pinned via `src-tauri/rust-toolchain.toml`)
- **Linux system libraries** for Tauri (WebKitGTK, GTK, etc.). On Debian/Ubuntu:

  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```

  See the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for macOS/Windows.

## Getting started

Install frontend dependencies:

```bash
npm install
```

### Run the desktop app (Tauri, dev mode)

Builds the Rust backend and launches the native window with hot-reload for the frontend:

```bash
npm run tauri dev
```

### Run only the frontend (in a browser)

Useful for pure UI work. Note: Rust `invoke` commands (e.g. `greet`) only work inside the Tauri window.

```bash
npm run dev          # serves at http://localhost:1420
```

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server (frontend only) at `http://localhost:1420` |
| `npm run build` | Type-check (`tsc`) and build the frontend to `dist/` |
| `npm run preview` | Preview the production frontend build |
| `npm run tauri dev` | Run the full desktop app in development mode |
| `npm run tauri build` | Build a production desktop bundle |

## How it works

The React frontend calls a Rust command via Tauri's `invoke` API:

```ts
import { invoke } from "@tauri-apps/api/core";
const message = await invoke("greet", { name });
```

The command is defined in `src-tauri/src/lib.rs`:

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
```
