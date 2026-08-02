#!/usr/bin/env node
/**
 * Ensure the Photos Swift bridge is compiled into the Tauri iOS app target.
 *
 * Two link stages matter for `_pixle_save_image_to_photos`:
 *
 * 1. Rust/cargo (Xcode "Build Rust Code"): cdylib link needs the symbol allowed
 *    as undefined until the app links — handled in `src-tauri/build.rs`.
 * 2. Final app link: PhotosBridge.swift must be a Compile Sources member of
 *    `pixle_iOS` so the real `@_cdecl` export is present.
 *
 * This script handles (2):
 *   - Patches gen/apple/project.yml to include ../../ios-bridge + Photos.framework
 *   - Regenerates the Xcode project with xcodegen
 *   - Copies PhotosBridge.swift into Sources/ only as a fallback when the
 *     ios-bridge path cannot be added (avoids compiling the file twice)
 *
 * Safe to re-run. No-op (exit 0) when gen/apple is missing (e.g. Linux CI).
 */

import { execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bridgeSrc = path.join(
  root,
  "src-tauri",
  "ios-bridge",
  "PhotosBridge.swift",
);
const appleDir = path.join(root, "src-tauri", "gen", "apple");
const sourcesDir = path.join(appleDir, "Sources");
const bridgeDest = path.join(sourcesDir, "PhotosBridge.swift");
const projectYml = path.join(appleDir, "project.yml");

if (!existsSync(bridgeSrc)) {
  console.error(`[ios-bridge] missing canonical Swift file: ${bridgeSrc}`);
  process.exit(1);
}

if (!existsSync(appleDir)) {
  console.log(
    "[ios-bridge] src-tauri/gen/apple not found — run `npx tauri ios init` on macOS first.",
  );
  console.log(
    "[ios-bridge] Custom template (src-tauri/ios-project.yml) will include the bridge on init.",
  );
  process.exit(0);
}

let hasIosBridgeSource = false;

if (existsSync(projectYml)) {
  let yml = readFileSync(projectYml, "utf8");
  let changed = false;
  hasIosBridgeSource =
    yml.includes("ios-bridge") || yml.includes("PixleBridge");

  if (!hasIosBridgeSource) {
    // Insert after the first "- path: Sources" under the iOS target sources list.
    const marker = "    sources:\n      - path: Sources\n";
    const insertion =
      "    sources:\n" +
      "      - path: Sources\n" +
      "      - path: ../../ios-bridge\n" +
      "        name: PixleBridge\n" +
      "        buildPhase: sources\n";
    if (yml.includes(marker)) {
      yml = yml.replace(marker, insertion);
      changed = true;
      hasIosBridgeSource = true;
      console.log("[ios-bridge] patched project.yml sources → ../../ios-bridge");
    } else {
      console.warn(
        "[ios-bridge] could not locate Sources entry in project.yml; " +
          "will copy into Sources/ as fallback. Prefer re-running `npx tauri ios init` " +
          "so src-tauri/ios-project.yml applies.",
      );
    }
  } else {
    console.log("[ios-bridge] project.yml already references ios-bridge");
  }

  if (!yml.includes("Photos.framework")) {
    const uiKit = "      - sdk: UIKit.framework\n";
    if (yml.includes(uiKit)) {
      yml = yml.replace(uiKit, `${uiKit}      - sdk: Photos.framework\n`);
      changed = true;
      console.log(
        "[ios-bridge] patched project.yml dependencies → Photos.framework",
      );
    }
  }

  if (changed) {
    writeFileSync(projectYml, yml);
  }
} else {
  console.warn("[ios-bridge] project.yml missing — run `npx tauri ios init`");
}

// Prefer a single Compile Sources membership via ../../ios-bridge. Copying into
// Sources/ as well would compile the same @_cdecl twice (duplicate symbol).
if (!hasIosBridgeSource) {
  mkdirSync(sourcesDir, { recursive: true });
  copyFileSync(bridgeSrc, bridgeDest);
  console.log(
    `[ios-bridge] fallback copy → ${path.relative(root, bridgeDest)}`,
  );
} else if (existsSync(bridgeDest)) {
  // Remove a stale Sources copy left by older sync runs to avoid duplicates.
  unlinkSync(bridgeDest);
  console.log(
    "[ios-bridge] removed stale Sources/PhotosBridge.swift (using ../../ios-bridge)",
  );
}

function haveXcodegen() {
  try {
    execSync("xcodegen --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (haveXcodegen() && existsSync(projectYml)) {
  console.log("[ios-bridge] regenerating Xcode project with xcodegen…");
  execSync(`xcodegen generate --spec "${projectYml}"`, {
    cwd: appleDir,
    stdio: "inherit",
  });
  console.log("[ios-bridge] xcodegen complete");
} else if (!haveXcodegen()) {
  // Without regenerate, Compile Sources may still omit PhotosBridge.swift
  // and the final app linker reports undefined _pixle_save_image_to_photos.
  console.error(
    "[ios-bridge] xcodegen not on PATH. Install it (brew install xcodegen) and re-run\n" +
      "  npm run ios:sync-bridge\n" +
      "or re-run:\n" +
      "  npx tauri ios init\n" +
      "so src-tauri/ios-project.yml is applied and the Xcode project is regenerated.",
  );
  process.exit(1);
}

console.log("[ios-bridge] ready — rebuild with: npx tauri ios dev");
