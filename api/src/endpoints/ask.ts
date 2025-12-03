import OpenAI from "openai";
import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { AskResponseChunk, type AppContext } from "../types";
import { env } from "cloudflare:workers";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

const INSTRUCTIONS = `
Give ultra-concise answer. MAX 100 WORDS. \
- For quick fact, command: super short, concise, essential answer. \
- For 'how to' question: short brief steps. \
- For general question: a concise but thorough answer. \
Note: code/command must be wrapped in code block. NO assumptions/guessing.
`.trim();

export class Ask extends OpenAPIRoute {
	schema = {
		tags: ["Ask"],
		summary: "Ask a question",
		request: {
			query: z.object({
				question: Str({
					description: "Question to ask",
				}),
			}),
		},
		responses: {
			"200": {
				description: "Quick answer to your question",
				content: {
					"application/json": {
						schema: AskResponseChunk,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const { question } = data.query;

		if (question.length > 100) {
			return c.json({ error: "Question is too long. Please keep it under 100 characters." }, 400);
		}

		const response = await client.chat.completions.create({
			model: "gpt-4.1-nano",
			messages: [
				{ role: "system", content: INSTRUCTIONS },
				{ role: "user", content: question },
			],
			temperature: 0.7,
			max_completion_tokens: 200,
			stream: true,
			stream_options: { include_usage: true },
		});

		const stream = new ReadableStream({
			async start(controller) {
				try {
					for await (const chunk of response) {
						if (chunk.choices[0].delta.content) {
							const delta = chunk.choices[0].delta.content
							controller.enqueue(encodeChunk({ type: "content", delta }));
						}
						if (chunk.choices[0].finish_reason) {
							controller.enqueue(encodeChunk({ type: "done", usage: chunk.usage }));
							controller.close();
							// Save the usage to the database
						}
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					controller.enqueue(encodeChunk({ type: "error", error: message }));
					controller.close()
				}
			}
		})

		return new Response(stream, {
			headers: {
				'Content-Type': 'application/x-ndjson',
				'Cache-Control': 'no-cache',
			},
		});
	}
}

const encodeChunk = (chunk: AskResponseChunk) => {
	return new TextEncoder().encode(JSON.stringify(chunk) + '\n');
}