import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the repo-root .env regardless of the process cwd (npm workspaces run from server/).
// In production there is no file; the host injects real env vars. Real env vars always win.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

// Fail fast on startup. Later steps add GitHub/Slack/AI variables.
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.url().default("http://localhost:3000"),
    DATABASE_URL: z.string().optional(),
  })
  .refine((c) => c.NODE_ENV === "test" || !!c.DATABASE_URL, {
    path: ["DATABASE_URL"],
    message: "DATABASE_URL is required",
  });

export const config = schema.parse(process.env);
