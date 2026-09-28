import { describe, expect, it } from "vitest";
import { DESIGN_STYLE_SOURCE_DIGESTS } from "./design-style-digests";
import { DESIGN_STYLE_SLUGS } from "./design-styles";

describe("design style digest manifest", () => {
  it("pins every supported style to one SHA-256 digest", () => {
    expect(Object.keys(DESIGN_STYLE_SOURCE_DIGESTS).sort()).toEqual(
      [...DESIGN_STYLE_SLUGS].sort(),
    );
    expect(
      Object.values(DESIGN_STYLE_SOURCE_DIGESTS).every((digest) =>
        /^[a-f0-9]{64}$/.test(digest),
      ),
    ).toBe(true);
  });
});
