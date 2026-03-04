#!/usr/bin/env python3
"""Patch whisper.cpp ggml-quants.c for GCC 8 aarch64 compatibility.

GCC 8 has a bug where vld1q_{s8,u8}_x{2,4} intrinsics return int
instead of the correct struct types. This patch replaces the broken
#define aliases with inline wrapper functions.
"""
import sys, os

path = os.path.expanduser("~/whisper.cpp/ggml-quants.c")
with open(path, "r") as f:
    src = f.read()

patches = [
    (
        "#define ggml_vld1q_s16_x2 vld1q_s16_x2",
        "static inline int16x8x2_t ggml_vld1q_s16_x2(const int16_t * ptr) {\n"
        "    int16x8x2_t res;\n"
        "    res.val[0] = vld1q_s16(ptr + 0);\n"
        "    res.val[1] = vld1q_s16(ptr + 8);\n"
        "    return res;\n"
        "}"
    ),
    (
        "#define ggml_vld1q_u8_x2  vld1q_u8_x2",
        "static inline uint8x16x2_t ggml_vld1q_u8_x2(const uint8_t * ptr) {\n"
        "    uint8x16x2_t res;\n"
        "    res.val[0] = vld1q_u8(ptr + 0);\n"
        "    res.val[1] = vld1q_u8(ptr + 16);\n"
        "    return res;\n"
        "}"
    ),
    (
        "#define ggml_vld1q_u8_x4  vld1q_u8_x4",
        "static inline uint8x16x4_t ggml_vld1q_u8_x4(const uint8_t * ptr) {\n"
        "    uint8x16x4_t res;\n"
        "    res.val[0] = vld1q_u8(ptr + 0);\n"
        "    res.val[1] = vld1q_u8(ptr + 16);\n"
        "    res.val[2] = vld1q_u8(ptr + 32);\n"
        "    res.val[3] = vld1q_u8(ptr + 48);\n"
        "    return res;\n"
        "}"
    ),
    (
        "#define ggml_vld1q_s8_x2  vld1q_s8_x2",
        "static inline int8x16x2_t ggml_vld1q_s8_x2(const int8_t * ptr) {\n"
        "    int8x16x2_t res;\n"
        "    res.val[0] = vld1q_s8(ptr + 0);\n"
        "    res.val[1] = vld1q_s8(ptr + 16);\n"
        "    return res;\n"
        "}"
    ),
    (
        "#define ggml_vld1q_s8_x4  vld1q_s8_x4",
        "static inline int8x16x4_t ggml_vld1q_s8_x4(const int8_t * ptr) {\n"
        "    int8x16x4_t res;\n"
        "    res.val[0] = vld1q_s8(ptr + 0);\n"
        "    res.val[1] = vld1q_s8(ptr + 16);\n"
        "    res.val[2] = vld1q_s8(ptr + 32);\n"
        "    res.val[3] = vld1q_s8(ptr + 48);\n"
        "    return res;\n"
        "}"
    ),
]

patched = 0
for old, new in patches:
    if old in src:
        src = src.replace(old, new, 1)
        patched += 1
        print(f"  patched: {old.split()[-1]}")
    else:
        print(f"  skip (not found or already patched): {old.split()[-1]}")

with open(path, "w") as f:
    f.write(src)
print(f"OK: {patched} intrinsics patched for GCC 8 compatibility")
