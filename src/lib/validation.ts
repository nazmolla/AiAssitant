/**
 * API Request Validation
 *
 * Zod-based validation utilities for Next.js API routes.
 * Provides a consistent pattern for validating request bodies
 * and returning structured 400 errors.
 */

import { NextResponse } from "next/server";
import { z, ZodSchema } from "zod";

export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  response: NextResponse;
}

/**
 * Validate a request body against a Zod schema.
 * Returns parsed data on success, or a 400 NextResponse on failure.
 */
export function validateBody<T>(
  body: unknown,
  schema: ZodSchema<T>,
): ValidationResult<T> | ValidationError {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

  return {
    success: false,
    response: NextResponse.json(
      { error: "Validation failed", details: errors },
      { status: 400 },
    ),
  };
}
