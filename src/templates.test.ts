import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";

describe("TEMPLATES", () => {
  it("each template builds a valid tree with non-empty root text", () => {
    for (const template of TEMPLATES) {
      const root = template.build();
      expect(typeof root.text).toBe("string");
      expect(root.text.length).toBeGreaterThan(0);
      expect(Array.isArray(root.children)).toBe(true);
    }
  });

  it("includes a Blank template with no children", () => {
    const blank = TEMPLATES.find((t) => t.name === "Blank")!;
    expect(blank.build().children).toHaveLength(0);
  });

  it("gives every non-Blank template at least one child", () => {
    for (const template of TEMPLATES.filter((t) => t.name !== "Blank")) {
      expect(template.build().children.length).toBeGreaterThan(0);
    }
  });

  it("builds an independent tree (fresh ids) on each call", () => {
    const projectPlan = TEMPLATES.find((t) => t.name === "Project Plan")!;
    const a = projectPlan.build();
    const b = projectPlan.build();
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });
});
