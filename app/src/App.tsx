import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistoryItem } from "./types";
import { useSettings } from "./hooks/useSettings";
import { useHistory } from "./hooks/useHistory";
import { useAI } from "./hooks/useAI";
import { SearchInput } from "./components/SearchInput";
import { Settings } from "./components/Settings";
import { Answer } from "./components/Answer";
import { HistoryList } from "./components/HistoryList";
import { Footer } from "./components/Footer";
import "./App.css";

function App() {
  const [question, setQuestion] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const [selectedRecentIndex, setSelectedRecentIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const historyItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const recentItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { keybinding, saveKeybinding } = useSettings();
  const { history, filteredHistory, saveToHistory, deleteHistoryItem } = useHistory(question);
  const { answer, renderedAnswer, loading, askAI, resetAnswer, setAnswerFromHistory, answerRef } = useAI();

  useEffect(() => {
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 100);

    const handleKeyDown = (e: KeyboardEvent) => {
      const recentQueries = !question.trim() && !loading && !answer && history.length > 0 ? history.slice(0, 5) : [];
      
      if (e.key === "Escape") {
        // If there's an answer or question, go back to default state
        if (answer || question.trim()) {
          e.preventDefault();
          handleBackToDefault();
        } else {
          // Otherwise close the window
          handleClose();
        }
      } else if (e.key === "ArrowDown" && filteredHistory.length > 0) {
        e.preventDefault();
        setSelectedHistoryIndex((prev) =>
          prev < filteredHistory.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp" && filteredHistory.length > 0) {
        e.preventDefault();
        setSelectedHistoryIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "ArrowDown" && recentQueries.length > 0) {
        e.preventDefault();
        setSelectedRecentIndex((prev) =>
          prev < recentQueries.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp" && recentQueries.length > 0) {
        e.preventDefault();
        setSelectedRecentIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (
        e.key === "Enter" &&
        selectedHistoryIndex >= 0 &&
        filteredHistory[selectedHistoryIndex]
      ) {
        e.preventDefault();
        const item = filteredHistory[selectedHistoryIndex];
        handleHistoryItemClick(item);
      } else if (
        e.key === "Enter" &&
        selectedRecentIndex >= 0 &&
        recentQueries[selectedRecentIndex]
      ) {
        e.preventDefault();
        const item = recentQueries[selectedRecentIndex];
        handleHistoryItemClick(item);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredHistory, selectedHistoryIndex, question, loading, answer, history, selectedRecentIndex]);

  useEffect(() => {
    // Always focus input when not in settings
    if (inputRef.current && !showSettings) {
      inputRef.current.focus();
    }
  }, [showSettings, answer, question]);


  // Scroll selected history item into view
  useEffect(() => {
    if (selectedHistoryIndex >= 0 && historyItemRefs.current[selectedHistoryIndex]) {
      historyItemRefs.current[selectedHistoryIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedHistoryIndex]);

  // Scroll selected recent item into view
  useEffect(() => {
    if (selectedRecentIndex >= 0 && recentItemRefs.current[selectedRecentIndex]) {
      recentItemRefs.current[selectedRecentIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedRecentIndex]);

  const handleSaveSettings = async (newKeybinding: string) => {
    try {
      await saveKeybinding(newKeybinding);
    } catch (error) {
      alert(`Failed to save settings: ${error}`);
      throw error;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!question.trim()) return;

    setSelectedHistoryIndex(-1);
    const currentQuestion = question.trim();

    try {
      await askAI(currentQuestion);
      setTimeout(() => {
        const currentAnswer = answerRef.current;
        if (currentAnswer) {
          saveToHistory(currentQuestion, currentAnswer);
        }
      }, 500);
    } catch (error) {
      console.error("Failed to ask AI:", error);
    }
  };

  const handleQuestionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuestion(newValue);
    setSelectedHistoryIndex(-1);
    setSelectedRecentIndex(-1);

    if (!newValue.trim()) {
      resetAnswer();
    }
  };

  const handleHistoryItemClick = (item: HistoryItem) => {
    setQuestion(item.question);
    setAnswerFromHistory(item.answer);
    setSelectedHistoryIndex(-1);
    setSelectedRecentIndex(-1);

    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
  };

  const handleDeleteHistoryItem = async (timestamp: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteHistoryItem(timestamp);
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
  };

  const handleBackToDefault = () => {
    setQuestion("");
    resetAnswer();
    setSelectedHistoryIndex(-1);
    setSelectedRecentIndex(-1);

    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
  };

  const handleClose = async () => {
    setQuestion("");
    resetAnswer();
    setShowSettings(false);
    await invoke("hide_window", {});
  };

  if (showSettings) {
    return (
      <Settings
        keybinding={keybinding}
        onClose={() => setShowSettings(false)}
        onSave={handleSaveSettings}
      />
    );
  }

  return (
    <div className="container">
      <SearchInput
        inputRef={inputRef}
        value={question}
        onChange={handleQuestionChange}
        disabled={loading}
        onSubmit={handleSubmit}
      />

      {filteredHistory.length > 0 && !loading && !answer && (
        <HistoryList
          items={filteredHistory}
          selectedIndex={selectedHistoryIndex}
          itemRefs={historyItemRefs}
          onItemClick={handleHistoryItemClick}
          onItemDelete={handleDeleteHistoryItem}
        />
      )}

      <Answer content={renderedAnswer} loading={loading} />

      {!loading && !answer && !question.trim() && history.length > 0 && (
        <HistoryList
          items={history.slice(0, 5)}
          selectedIndex={selectedRecentIndex}
          itemRefs={recentItemRefs}
          onItemClick={handleHistoryItemClick}
          onItemDelete={handleDeleteHistoryItem}
          className="recent-queries"
        />
      )}

      <Footer
        hasContent={!!(answer || question.trim())}
        onSettingsClick={() => setShowSettings(true)}
      />
    </div>
  );
}

export default App;
