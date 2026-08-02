#!/usr/bin/env node
/**
 * Linux-safe check that Rust and Swift agree on the Photos bridge symbol name.
 * Does not require Xcode; catches @_cdecl / extern "C" drift.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const symbol = "pixle_save_image_to_photos";

const swift = readFileSync(
  path.join(root, "src-tauri/ios-bridge/PhotosBridge.swift"),
  "utf8",
);
const rust = readFileSync(path.join(root, "src-tauri/src/photos.rs"), "utf8");
const buildRs = readFileSync(path.join(root, "src-tauri/build.rs"), "utf8");
const projectYml = readFileSync(
  path.join(root, "src-tauri/ios-project.yml"),
  "utf8",
);

const errors = [];

if (!swift.includes(`@_cdecl("${symbol}")`)) {
  errors.push(`PhotosBridge.swift missing @_cdecl("${symbol}")`);
}
if (!swift.includes(`func ${symbol}(`)) {
  errors.push(`PhotosBridge.swift missing func ${symbol}(`);
}
if (!rust.includes(`fn ${symbol}(`)) {
  errors.push(`photos.rs missing extern fn ${symbol}(`);
}
if (!buildRs.includes(`-Wl,-U,_${symbol}`)) {
  errors.push(`build.rs missing cdylib allow-list for _${symbol}`);
}
if (!projectYml.includes("../../ios-bridge")) {
  errors.push("ios-project.yml missing ../../ios-bridge source path");
}
if (!projectYml.includes("Photos.framework")) {
  errors.push("ios-project.yml missing Photos.framework");
}

if (errors.length) {
  console.error("[verify-ios-photos-bridge] FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `[verify-ios-photos-bridge] OK — Swift @_cdecl, Rust extern, build.rs -U, and ios-project.yml agree on ${symbol}`,
);
