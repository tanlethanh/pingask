import { useState, useEffect, useMemo } from "react";
import { load } from "@tauri-apps/plugin-store";
import { HistoryItem } from "../types";

export function useHistory(question: string) {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const store = await load("settings.json");
      const savedHistory = await store.get<HistoryItem[]>("search_history");
      if (savedHistory && Array.isArray(savedHistory)) {
        setHistory(savedHistory);
      }
    } catch (error) {
      console.error("Failed to load history:", error);
    }
  };

  const saveToHistory = async (q: string, a: string) => {
    try {
      const newItem: HistoryItem = {
        question: q,
        answer: a,
        timestamp: Date.now(),
      };
      const updatedHistory = [newItem, ...history.filter(item => item.question !== q)].slice(0, 50);
      setHistory(updatedHistory);

      const store = await load("settings.json");
      await store.set("search_history", updatedHistory);
      await store.save();
    } catch (error) {
      console.error("Failed to save history:", error);
    }
  };

  const deleteHistoryItem = async (timestamp: number) => {
    try {
      const updatedHistory = history.filter(item => item.timestamp !== timestamp);
      setHistory(updatedHistory);

      const store = await load("settings.json");
      await store.set("search_history", updatedHistory);
      await store.save();
    } catch (error) {
      console.error("Failed to delete history item:", error);
    }
  };

  const filteredHistory = useMemo(() => {
    if (!question.trim()) return [];
    const query = question.toLowerCase();
    return history
      .filter((item) => item.question.toLowerCase().includes(query))
      .slice(0, 5);
  }, [question, history]);

  return { history, filteredHistory, saveToHistory, deleteHistoryItem };
}
