import zlib from "zlib";

export type EmbeddingCompression = "none" | "gzip" | "zstd";

export interface EncodedEmbedding {
  binary: Buffer;
  encoding: "f32le";
  compression: EmbeddingCompression;
}

function maybeZstdCompress(input: Buffer): Buffer | null {
  const zstdCompressSync = (zlib as unknown as { zstdCompressSync?: (buf: Buffer) => Buffer }).zstdCompressSync;
  if (!zstdCompressSync) return null;
  return zstdCompressSync(input);
}

function maybeZstdDecompress(input: Buffer): Buffer | null {
  const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync?: (buf: Buffer) => Buffer }).zstdDecompressSync;
  if (!zstdDecompressSync) return null;
  return zstdDecompressSync(input);
}

export function normalizeCompression(value?: string): EmbeddingCompression {
  const normalized = String(value || "gzip").trim().toLowerCase();
  if (normalized === "none" || normalized === "gzip" || normalized === "zstd") {
    return normalized;
  }
  return "gzip";
}

export function encodeEmbeddingToBinary(
  vector: number[],
  compression: EmbeddingCompression
): EncodedEmbedding {
  const floatArray = Float32Array.from(vector);
  const raw = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);

  if (compression === "none") {
    return { binary: raw, encoding: "f32le", compression };
  }

  if (compression === "zstd") {
    const zstd = maybeZstdCompress(raw);
    if (zstd) {
      return { binary: zstd, encoding: "f32le", compression: "zstd" };
    }
  }

  return { binary: zlib.gzipSync(raw), encoding: "f32le", compression: "gzip" };
}

export function decodeEmbeddingFromBinary(
  binary: Buffer,
  encoding: string,
  compression: string
): number[] | null {
  if (!binary || binary.length === 0) return null;
  if (encoding !== "f32le") return null;

  let payload = binary;
  const normalizedCompression = normalizeCompression(compression);

  try {
    if (normalizedCompression === "gzip") {
      payload = zlib.gunzipSync(binary);
    } else if (normalizedCompression === "zstd") {
      const zstd = maybeZstdDecompress(binary);
      payload = zstd ?? zlib.gunzipSync(binary);
    }
  } catch {
    return null;
  }

  if (payload.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    return null;
  }

  const floatView = new Float32Array(payload.buffer, payload.byteOffset, payload.byteLength / Float32Array.BYTES_PER_ELEMENT);
  return Array.from(floatView);
}

export function decodeEmbeddingFromJson(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value) => Number.isFinite(value)) as number[];
  } catch {
    return null;
  }
}
