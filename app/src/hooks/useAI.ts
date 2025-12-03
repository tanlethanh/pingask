import { useState, useRef, useMemo } from "react";
import { marked } from "marked";
import { askWithStreaming } from "../services/api";

export function useAI() {
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const answerRef = useRef<string>("");

  const renderedAnswer = useMemo(() => {
    if (!answer) return "";
    return marked.parse(answer, { breaks: true }) as string;
  }, [answer]);

  const askAI = async (question: string) => {
    setLoading(true);
    setAnswer("");
    answerRef.current = "";

    try {
      let isFirstChunk = true;
      await askWithStreaming({
        question,
        onChunk: (chunk) => {
          if (isFirstChunk) {
            setLoading(false);
            isFirstChunk = false;
          }
          setAnswer((prev) => {
            const newAnswer = prev + chunk;
            answerRef.current = newAnswer;
            return newAnswer;
          });
        },
        onError: (error) => {
          const errorMsg = `Error: ${error}`;
          setAnswer(errorMsg);
          answerRef.current = errorMsg;
          setLoading(false);
        },
        onDone: () => {
          setLoading(false);
        },
      });
      return answerRef.current;
    } catch (error) {
      const errorMsg = `Error: ${error}`;
      setAnswer(errorMsg);
      answerRef.current = errorMsg;
      setLoading(false);
      throw error;
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
