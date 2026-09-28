import { describe, expect, it } from "vitest";
import { canTransitionPool } from "../src/domain/transitions.js";

 describe("pool lifecycle", () => {
  it("allows the intended driver sequence", () => {
    expect(canTransitionPool("MATCHING", "ACCEPTED")).toBe(true);
    expect(canTransitionPool("ACCEPTED", "DRIVER_ARRIVED")).toBe(true);
    expect(canTransitionPool("DRIVER_ARRIVED", "STARTED")).toBe(true);
    expect(canTransitionPool("STARTED", "COMPLETED")).toBe(true);
  });

  it("rejects skipping stages or reopening completed pools", () => {
    expect(canTransitionPool("MATCHING", "STARTED")).toBe(false);
    expect(canTransitionPool("ACCEPTED", "COMPLETED")).toBe(false);
    expect(canTransitionPool("COMPLETED", "STARTED")).toBe(false);
  });
});
