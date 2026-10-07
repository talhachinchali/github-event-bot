import "dotenv/config";
import { z } from "zod";

// Fail fast on startup. Step 1 only requires the basics; later steps tighten this.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url().default("http://localhost:3000"),
});

export const config = schema.parse(process.env);
