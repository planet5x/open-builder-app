import { z } from "zod";

const UNSAFE_DISPLAY_CHARACTER_RE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;

export function skillDisplayTextSchema(maxChars: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maxChars)
    .refine((value) => !UNSAFE_DISPLAY_CHARACTER_RE.test(value), {
      message: "must not contain control or invisible formatting characters",
    });
}
