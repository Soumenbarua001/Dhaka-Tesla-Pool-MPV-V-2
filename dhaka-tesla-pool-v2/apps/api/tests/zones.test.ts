import { describe, expect, it } from "vitest";
import { routesAreCompatible } from "../src/domain/zones.js";

 describe("matching rule", () => {
  it("pools Nusrat and Rafiq because pickup is equal and destinations share a corridor", () => {
    expect(routesAreCompatible("Banani", ["Mohakhali"], "Banani", "Gulshan 1")).toBe(true);
  });

  it("rejects a different pickup zone", () => {
    expect(routesAreCompatible("Banani", ["Mohakhali"], "Farmgate", "Gulshan 1")).toBe(false);
  });
});
