import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { marked } from "marked";

export function useAI() {
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const answerRef = useRef<string>("");

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<string>("ai-response-chunk", (event) => {
      setAnswer((prev) => {
        const newAnswer = prev + event.payload;
        answerRef.current = newAnswer;
        return newAnswer;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const renderedAnswer = useMemo(() => {
    if (!answer) return "";
    return marked.parse(answer, { breaks: true }) as string;
  }, [answer]);

  const askAI = async (question: string, apiKey: string) => {
    setLoading(true);
    setAnswer("");
    answerRef.current = "";

    try {
      await invoke("ask_ai", { question, apiKey });
      return answerRef.current;
    } catch (error) {
      const errorMsg = `Error: ${error}`;
      setAnswer(errorMsg);
      answerRef.current = errorMsg;
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const resetAnswer = () => {
    setAnswer("");
    answerRef.current = "";
  };

  const setAnswerFromHistory = (historyAnswer: string) => {
    setAnswer(historyAnswer);
    answerRef.current = historyAnswer;
  };

  return { answer, renderedAnswer, loading, askAI, resetAnswer, setAnswerFromHistory, answerRef };
}
