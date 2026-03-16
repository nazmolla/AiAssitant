import {
  decodeEmbeddingFromBinary,
  decodeEmbeddingFromJson,
  encodeEmbeddingToBinary,
} from "@/lib/knowledge/vector-codec";

describe("vector-codec", () => {
  test("roundtrip works for gzip compression", () => {
    const source = [0.1, -2.25, 3.5, 42.75];
    const encoded = encodeEmbeddingToBinary(source, "gzip");
    const decoded = decodeEmbeddingFromBinary(encoded.binary, encoded.encoding, encoded.compression);

    expect(decoded).toBeTruthy();
    expect(decoded).toHaveLength(source.length);
    decoded!.forEach((value, idx) => {
      expect(value).toBeCloseTo(source[idx], 5);
    });
  });

  test("roundtrip works for uncompressed binary", () => {
    const source = [1, 2, 3, 4, 5];
    const encoded = encodeEmbeddingToBinary(source, "none");
    const decoded = decodeEmbeddingFromBinary(encoded.binary, encoded.encoding, encoded.compression);

    expect(decoded).toEqual(source);
  });

  test("decodeEmbeddingFromJson parses legacy JSON vectors", () => {
    expect(decodeEmbeddingFromJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("decodeEmbeddingFromBinary returns null for invalid payload", () => {
    const invalid = Buffer.from("not-a-vector", "utf8");
    const decoded = decodeEmbeddingFromBinary(invalid, "f32le", "gzip");
    expect(decoded).toBeNull();
  });
});
