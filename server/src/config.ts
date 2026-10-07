import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

// Load the repo-root .env regardless of the process cwd (npm workspaces run from server/).
// In production there is no file; the host injects real env vars. Real env vars always win.
// Tests never read .env, so they can never touch real credentials.
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });
}

const isTest = process.env.NODE_ENV === "test";
// Required everywhere except tests, where harmless placeholders are used.
const required = (placeholder: string) =>
  isTest ? z.string().default(placeholder) : z.string().min(1);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: required("postgres://test:test@localhost:5432/test"),
  // AES-256-GCM key: 32 bytes as 64 hex chars (`openssl rand -hex 32`).
  ENCRYPTION_KEY: isTest
    ? z.string().default("0".repeat(64))
    : z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex chars (openssl rand -hex 32)"),
  GITHUB_APP_ID: required("1"),
  GITHUB_APP_CLIENT_ID: required("test-client-id"),
  GITHUB_APP_CLIENT_SECRET: required("test-client-secret"),
  GITHUB_APP_SLUG: required("test-app"),
  GITHUB_WEBHOOK_SECRET: required("test-webhook-secret"),
  // PEM stored on one line with literal \n escapes; restore real newlines.
  // AI triage is optional: without a key, rules with "use AI" simply run without it.
  GEMINI_API_KEY: z.string().optional().transform((v) => v || undefined),
  GEMINI_MODEL: z.string().default("gemini-flash-lite-latest"),
  GITHUB_APP_PRIVATE_KEY: required("test-key").transform((s) => s.replace(/\\n/g, "\n")),
});

export const config = schema.parse(process.env);
export const isProd = config.NODE_ENV === "production";
