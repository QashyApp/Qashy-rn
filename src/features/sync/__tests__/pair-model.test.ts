import {
  SCAN_CODE_HINT,
  TYPED_CODE_HINT,
} from "@/features/sync/pair/pair-model";
import { PAIRING_TTL_SECONDS } from "@/sync/crypto";

describe("pairing code lifetime wording", () => {
  it("says a minute and a half, which is the real deadline", () => {
    // If the deadline changes, both sentences have to be reworded with it.
    expect(PAIRING_TTL_SECONDS).toBe(90);
    expect(SCAN_CODE_HINT).toContain("a minute and a half");
    expect(TYPED_CODE_HINT).toContain("a minute and a half");
  });
});
