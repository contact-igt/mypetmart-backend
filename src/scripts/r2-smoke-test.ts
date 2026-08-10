import { randomUUID } from "node:crypto";

import { environmentConfig } from "../config/environment.config.js";
import { R2ObjectStorageProvider } from "../services/object-storage/r2-object-storage.provider.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64"
);

async function main(): Promise<void> {
  const provider = new R2ObjectStorageProvider();
  const key = `diagnostics/r2-smoke/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.png`;
  try {
    const { uploadUrl } = await provider.createPresignedPut({ key, contentType: "image/png", expiresInSeconds: 60 });
    const preflightResponse = await fetch(uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: environmentConfig.ADMIN_ORIGIN,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type"
      }
    });
    const allowedOrigin = preflightResponse.headers.get("access-control-allow-origin");
    const allowedMethods = preflightResponse.headers.get("access-control-allow-methods")?.toUpperCase() ?? "";
    const allowedHeaders = preflightResponse.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    if (!preflightResponse.ok || (allowedOrigin !== environmentConfig.ADMIN_ORIGIN && allowedOrigin !== "*")) {
      throw new Error("R2 bucket CORS does not allow the configured Admin origin.");
    }
    if (!allowedMethods.split(",").map((method) => method.trim()).includes("PUT")) {
      throw new Error("R2 bucket CORS does not allow PUT.");
    }
    if (allowedHeaders !== "*" && !allowedHeaders.split(",").map((header) => header.trim()).includes("content-type")) {
      throw new Error("R2 bucket CORS does not allow the Content-Type request header.");
    }

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(ONE_PIXEL_PNG)
    });
    if (!uploadResponse.ok) throw new Error(`R2 smoke upload returned HTTP ${uploadResponse.status}.`);

    const metadata = await provider.headObject(key);
    if (!metadata) throw new Error("R2 smoke object was not found after upload.");
    if (metadata.contentType !== "image/png") throw new Error("R2 smoke object content type did not match.");
    if (metadata.sizeBytes !== ONE_PIXEL_PNG.byteLength) throw new Error("R2 smoke object size did not match.");

    console.log(
      JSON.stringify({
        result: "R2_LIVE_SMOKE_PASS",
        key,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
        corsPreflightVerified: true,
        uploaded: true,
        headVerified: true
      })
    );
  } finally {
    await provider.deleteObject(key);
    console.log(JSON.stringify({ result: "R2_LIVE_SMOKE_CLEANUP_PASS", key, deleted: true }));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown R2 smoke-test failure.";
  console.error(JSON.stringify({ result: "R2_LIVE_SMOKE_FAIL", message }));
  process.exitCode = 1;
});
