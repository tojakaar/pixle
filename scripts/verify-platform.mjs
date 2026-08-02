/**
 * Smoke checks for platform adapters (no Tauri / no DOM file picker).
 * Run: node scripts/verify-platform.mjs
 */

import assert from "node:assert/strict";

function describeFile(file) {
  const name = file.name || "image";
  const match = /\.([^.]+)$/.exec(name);
  const extension = match ? match[1].toLowerCase() : "";
  const type = (file.type || "").toLowerCase();
  const isHeic =
    type === "image/heic" ||
    type === "image/heif" ||
    extension === "heic" ||
    extension === "heif";
  return { name, size: file.size, type: file.type, extension, isHeic };
}

function isJpegOrPng(file) {
  const meta = describeFile(file);
  return (
    meta.type === "image/jpeg" ||
    meta.type === "image/png" ||
    meta.extension === "jpg" ||
    meta.extension === "jpeg" ||
    meta.extension === "png"
  );
}

function isSupportedMobileStill(file) {
  return isJpegOrPng(file) || describeFile(file).isHeic;
}

// Desktop rejects HEIC
assert.equal(
  isJpegOrPng({ name: "x.heic", type: "image/heic", size: 1 }),
  false,
);
assert.equal(
  isSupportedMobileStill({ name: "x.heic", type: "image/heic", size: 1 }),
  true,
);
assert.equal(
  isSupportedMobileStill({ name: "x.jpg", type: "image/jpeg", size: 1 }),
  true,
);
assert.equal(
  describeFile({ name: "IMG_0001.HEIC", type: "", size: 10 }).isHeic,
  true,
);

console.log("verify-platform: ok");
