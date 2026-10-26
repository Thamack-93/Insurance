import { describe, expect, it } from "vitest";
import { autoPolicyModeForCount, countInsuredVehicles } from "./auto-policy-mode";

describe("auto policy mode", () => {
  it("classifies one insured vehicle as individual and multiple as fleet", () => {
    expect(autoPolicyModeForCount(1)).toBe("INDIVIDUAL");
    expect(autoPolicyModeForCount(2)).toBe("FLOTILLA");
    expect(autoPolicyModeForCount(0)).toBe("");
  });

  it("counts populated vehicle records and ignores blank form rows", () => {
    expect(countInsuredVehicles([
      { make: "Toyota", model: "Corolla", vin: "VIN-1" },
      { make: "", model: "", vin: "" },
      { make: "Mazda", model: "CX-5", vin: "VIN-2" },
    ])).toBe(2);
    expect(countInsuredVehicles(null)).toBe(0);
  });
});
