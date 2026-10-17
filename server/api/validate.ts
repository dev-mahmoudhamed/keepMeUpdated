import type { Request, Response } from 'express';
import type { z } from 'zod';

/** Parse the request body; on failure send 400 with the first issue and return undefined. */
export function parseBody<S extends z.ZodType>(schema: S, req: Request, res: Response): z.infer<S> | undefined {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue.path.join('.');
  res.status(400).json({ error: field ? `${field}: ${issue.message}` : issue.message });
  return undefined;
}

export const httpUrl = (zod: typeof z) =>
  zod
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'Use an http or https link');

export const tagList = (zod: typeof z, max: number) =>
  zod
    .array(zod.string().trim().max(40))
    .max(max)
    .transform((tags) => [...new Set(tags.map((t) => t.toLowerCase()).filter(Boolean))]);
