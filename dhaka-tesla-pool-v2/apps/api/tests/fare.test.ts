import { describe, expect, it } from "vitest";
import { estimateSoloFare, pooledFare } from "../src/domain/fare.js";

 describe("fare model", () => {
  it("keeps Nusrat's Banani → Mohakhali fare hand-checkable", () => {
    expect(estimateSoloFare("Banani", "Mohakhali")).toBe(8_100); // ৳45 + 2×৳18
    expect(pooledFare(8_100, 2)).toBe(6_480); // 20% pool discount
  });

  it("keeps Rafiq's Banani → Gulshan 1 fare hand-checkable", () => {
    expect(estimateSoloFare("Banani", "Gulshan 1")).toBe(6_300); // ৳45 + 1×৳18
    expect(pooledFare(6_300, 2)).toBe(5_040);
  });

  it("does not discount a solo trip", () => {
    expect(pooledFare(8_100, 1)).toBe(8_100);
  });
});
