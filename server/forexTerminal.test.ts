import { describe, expect, it } from "vitest";
import { calculateForexMargin, getIndicativeBidAsk } from "../shared/forex";

describe("Forex terminal calculations", () => {
  it("derives a symmetric indicative bid/ask from the admin mid price", () => {
    const quote = getIndicativeBidAsk(1.1);
    expect(quote.bid).toBeCloseTo(1.09989, 5);
    expect(quote.ask).toBeCloseTo(1.10011, 5);
    expect(quote.ask - quote.bid).toBeCloseTo(0.00022, 8);
  });

  it("keeps terminal margin at 1x unless an explicit leverage is supplied", () => {
    expect(calculateForexMargin(2500)).toBe(2500);
    expect(calculateForexMargin(2500, 2)).toBe(1250);
    expect(calculateForexMargin(-1)).toBe(0);
  });
});
