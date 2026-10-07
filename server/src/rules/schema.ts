import { z } from "zod";

// Rules are user input that ends up driving GitHub/Slack calls, so everything is bounded and whitelisted.
export const EVENT_TYPES = ["issues", "pull_request", "push"] as const;

export const conditionSchema = z.object({
  field: z.enum(["title", "body", "author", "label", "branch"]),
  op: z.enum(["contains", "not_contains", "equals", "starts_with"]),
  value: z.string().trim().min(1).max(200),
});

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_label"), label: z.string().trim().min(1).max(50) }),
  z.object({ type: z.literal("comment"), body: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("slack") }),
]);

export const ruleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
    eventType: z.enum(EVENT_TYPES),
    conditions: z.array(conditionSchema).max(10).default([]),
    actions: z.array(actionSchema).min(1).max(5),
    useAi: z.boolean().default(false),
  })
  .superRefine((rule, ctx) => {
    // A push has no issue/PR to label or comment on; only notifications make sense.
    if (rule.eventType === "push" && rule.actions.some((a) => a.type !== "slack")) {
      ctx.addIssue({ code: "custom", path: ["actions"], message: "push rules can only send Slack notifications" });
    }
    // Branch is meaningless for issues; label/body/title/author exist for issues and PRs only on non-push.
    if (rule.eventType === "issues" && rule.conditions.some((c) => c.field === "branch")) {
      ctx.addIssue({ code: "custom", path: ["conditions"], message: "issues have no branch" });
    }
    if (rule.eventType === "push" && rule.conditions.some((c) => ["body", "label"].includes(c.field))) {
      ctx.addIssue({ code: "custom", path: ["conditions"], message: "pushes have no body or labels" });
    }
  });

export type Condition = z.infer<typeof conditionSchema>;
export type RuleAction = z.infer<typeof actionSchema>;
export type RuleInput = z.infer<typeof ruleInputSchema>;
export type EventType = (typeof EVENT_TYPES)[number];

export interface Rule extends RuleInput {
  id: number;
  repoId: number;
  createdAt: Date;
}
