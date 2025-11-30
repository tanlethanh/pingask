import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { AskResponseChunk, type AppContext } from "../types";

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

		const encoder = new TextEncoder();
		const words = `The answer to your question "${question}" is quite interesting. Let me explain it in detail with a comprehensive response that demonstrates streaming capabilities.`.split(' ');

		const stream = new ReadableStream({
			async start(controller) {
				for (const word of words) {
					const chunk = JSON.stringify({
						type: "content",
						delta: word + ' ',
					} satisfies z.infer<typeof AskResponseChunk>) + '\n';

					controller.enqueue(encoder.encode(chunk));
					await new Promise(resolve => setTimeout(resolve, 50));
				}

				const doneChunk = JSON.stringify({
					type: "done",
					usage: {
						prompt_tokens: 10,
						completion_tokens: words.length,
						total_tokens: 10 + words.length,
					},
				} satisfies z.infer<typeof AskResponseChunk>) + '\n';

				controller.enqueue(encoder.encode(doneChunk));
				controller.close();
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'application/x-ndjson',
				'Cache-Control': 'no-cache',
			},
		});
	}
}
