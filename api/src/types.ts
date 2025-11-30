import { Str } from "chanfana";
import type { Context } from "hono";
import { z } from "zod";

export type AppContext = Context<{ Bindings: Env }>;

export const AskResponseChunk = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("content"),
		delta: Str({ description: "Text delta to append" }),
	}),
	z.object({
		type: z.literal("done"),
		usage: z.object({
			prompt_tokens: z.number().optional(),
			completion_tokens: z.number().optional(),
			total_tokens: z.number().optional(),
		}).optional(),
	}),
	z.object({
		type: z.literal("error"),
		error: Str({ description: "Error message" }),
	}),
]);
