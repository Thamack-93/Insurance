import { describe, expect, it } from "vitest";
import { getWorkItemHref } from "@/lib/work-item-navigation";

describe("work item navigation", () => {
  it("routes renewal envelopes to their policy instead of a non-task source id", () => {
    expect(getWorkItemHref({
      id: "wi-1",
      sourceType: "Renewal",
      sourceId: "policy:pol-1:renewal-workItem",
      workItemType: "TASK",
      entityType: "WorkItem",
      entityId: "policy:pol-1:renewal-workItem",
      policyId: "pol-1",
    })).toBe("/policies/pol-1");
  });

  it("preserves legacy Task route ids", () => {
    expect(getWorkItemHref({
      id: "wi-2",
      sourceType: "Task",
      sourceId: "task-2",
      workItemType: "TASK",
      entityType: "WorkItem",
      entityId: "task-2",
    })).toBe("/tasks/task-2");
  });

  it("uses the WorkItem id for canonical task entries", () => {
    expect(getWorkItemHref({
      id: "wi-3",
      sourceType: "WorkItem",
      workItemType: "TASK",
      entityType: "WorkItem",
      entityId: "wi-3",
    })).toBe("/tasks/wi-3");
  });

  it("routes task-backed renewals to their resolved policy", () => {
    expect(getWorkItemHref({
      id: "wi-4",
      sourceType: "Task",
      sourceId: "legacy-task-4",
      workItemType: "TASK",
      taskType: "RENEWAL",
      entityType: "WorkItem",
      entityId: "legacy-task-4",
      policyId: "pol-4",
    })).toBe("/policies/pol-4");
  });
});
