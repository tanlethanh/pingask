type AskResponseChunk =
  | { type: "content"; delta: string }
  | { type: "done"; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }
  | { type: "error"; error: string };

interface AskOptions {
  question: string;
  onChunk: (chunk: string) => void;
  onError?: (error: string) => void;
  onDone?: () => void;
}

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";

export async function askWithStreaming({ question, onChunk, onError, onDone }: AskOptions) {
  const url = `${API_URL}/api/ask?question=${encodeURIComponent(question)}`;

  console.log("[API] Connecting to:", url);

  try {
    const response = await fetch(url, {
      method: "GET",
    });

    console.log("[API] Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[API] Error response:", errorText);
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const chunk = JSON.parse(line) as AskResponseChunk;

          if (chunk.type === "content") {
            onChunk(chunk.delta);
          } else if (chunk.type === "error") {
            onError?.(chunk.error);
          } else if (chunk.type === "done") {
            onDone?.();
          }
        } catch (error) {
          console.error("Failed to parse chunk:", line, error);
        }
      }
    }
  } catch (error) {
    console.error("[API] Request failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    onError?.(message);
    throw error;
  }
}
