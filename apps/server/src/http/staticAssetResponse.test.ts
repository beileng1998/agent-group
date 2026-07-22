import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  prepareStaticAsset,
  selectStaticContentEncoding,
  staticCacheControl,
} from "./staticAssetResponse";

describe("static asset responses", () => {
  it("prefers the best supported encoding and respects disabled encodings", () => {
    expect(selectStaticContentEncoding("gzip, br")).toBe("br");
    expect(selectStaticContentEncoding("br;q=0.4, gzip;q=0.9")).toBe("gzip");
    expect(selectStaticContentEncoding("br;q=0, gzip;q=0")).toBeNull();
  });

  it("keeps hashed assets immutable while forcing the app shell and worker to revalidate", () => {
    expect(staticCacheControl("/assets/main-abc.js", "text/javascript")).toContain("immutable");
    expect(staticCacheControl("/index.html", "text/html; charset=utf-8")).toBe("no-cache");
    expect(staticCacheControl("/sw.js", "text/javascript")).toBe("no-cache");
  });

  it.each([
    ["br", brotliDecompressSync],
    ["gzip", gunzipSync],
  ] as const)("compresses large text assets with %s", async (encoding, decompress) => {
    const data = new TextEncoder().encode("streamed application code\n".repeat(400));
    const response = await prepareStaticAsset({
      pathname: "/assets/main-abc.js",
      filePath: "/static/assets/main-abc.js",
      version: "1",
      contentType: "text/javascript",
      acceptEncoding: encoding,
      data,
    });

    expect(response.headers["Content-Encoding"]).toBe(encoding);
    expect(response.body.byteLength).toBeLessThan(data.byteLength);
    expect(decompress(response.body)).toEqual(Buffer.from(data));
  });
});
