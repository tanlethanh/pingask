import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { marked } from "marked";
import "./App.css";

interface HistoryItem {
  question: string;
  answer: string;
  timestamp: number;
}

function App() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInput, setSettingsInput] = useState("");
  const [keybinding, setKeybinding] = useState("CmdOrCtrl+Shift+Space");
  const [keybindingInput, setKeybindingInput] = useState("");
  const [isRecordingKeybind, setIsRecordingKeybind] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const [selectedRecentIndex, setSelectedRecentIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const keybindRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<string>("");
  const historyItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const recentItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const renderedAnswer = useMemo(() => {
    if (!answer) return "";
    return marked.parse(answer, { breaks: true }) as string;
  }, [answer]);

  const filteredHistory = useMemo(() => {
    if (!question.trim()) return [];
    const query = question.toLowerCase();
    return history
      .filter((item) => item.question.toLowerCase().includes(query))
      .slice(0, 5);
  }, [question, history]);

  // Streaming listener - only set up once on mount
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<string>("ai-response-chunk", (event) => {
      setAnswer((prev) => {
        const newAnswer = prev + event.payload;
        answerRef.current = newAnswer; // Keep ref in sync
        return newAnswer;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    loadApiKey();
    loadHistory();
    loadKeybinding();
    
    // Focus input on mount
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
        setQuestion(item.question);
        setAnswer(item.answer);
        setSelectedHistoryIndex(-1);
      } else if (
        e.key === "Enter" &&
        selectedRecentIndex >= 0 &&
        recentQueries[selectedRecentIndex]
      ) {
        e.preventDefault();
        const item = recentQueries[selectedRecentIndex];
        setQuestion(item.question);
        setAnswer(item.answer);
        setSelectedRecentIndex(-1);
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

  useEffect(() => {
    // Check if there are changes in settings
    const apiKeyChanged = settingsInput && settingsInput !== apiKey;
    const keybindingChanged = keybindingInput !== keybinding;
    setHasChanges(apiKeyChanged || keybindingChanged);
  }, [settingsInput, apiKey, keybindingInput, keybinding]);

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

  const loadApiKey = async () => {
    try {
      const store = await load("settings.json");
      const key = await store.get<string>("openai_api_key");
      if (key) {
        setApiKey(key);
      }
    } catch (error) {
      console.error("Failed to load API key:", error);
    }
  };

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

  const loadKeybinding = async () => {
    try {
      const store = await load("settings.json");
      const savedKeybinding = await store.get<string>("keybinding");
      if (savedKeybinding) {
        setKeybinding(savedKeybinding);
        setKeybindingInput(savedKeybinding);
      } else {
        setKeybindingInput(keybinding);
      }
    } catch (error) {
      console.error("Failed to load keybinding:", error);
      setKeybindingInput(keybinding);
    }
  };

  const formatKeybindingDisplay = (kb: string): string[] => {
    return kb.split("+").map((key) => {
      if (key === "CmdOrCtrl") return navigator.platform.includes("Mac") ? "⌘" : "Ctrl";
      if (key === "Cmd") return "⌘";
      if (key === "Ctrl") return "Ctrl";
      if (key === "Alt") return "⌥";
      if (key === "Shift") return "⇧";
      if (key === "Space") return "Space";
      return key;
    });
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

  const saveApiKey = async () => {
    try {
      const store = await load("settings.json");
      await store.set("openai_api_key", settingsInput);
      await store.save();
      setApiKey(settingsInput);
      setSettingsInput("");
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save API key:", error);
      alert("Failed to save API key. Please try again.");
    }
  };

  const saveKeybinding = async () => {
    try {
      // Update backend shortcut
      await invoke("update_shortcut", { newShortcut: keybindingInput });
      
      const store = await load("settings.json");
      await store.set("keybinding", keybindingInput);
      await store.save();
      setKeybinding(keybindingInput);
      setHasChanges(false);
    } catch (error) {
      console.error("Failed to save keybinding:", error);
      alert(`Failed to update keybinding: ${error}`);
    }
  };

  const saveAllSettings = async () => {
    const apiKeyChanged = settingsInput && settingsInput !== apiKey;
    const keybindingChanged = keybindingInput !== keybinding;

    if (apiKeyChanged) {
      await saveApiKey();
    }
    if (keybindingChanged) {
      await saveKeybinding();
    }
  };

  const handleCloseSettings = () => {
    setShowSettings(false);
    setSettingsInput("");
    setKeybindingInput(keybinding);
    setHasChanges(false);
  };

  const handleKeybindingRecord = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRecordingKeybind) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Press Escape to cancel recording
    if (e.key === "Escape") {
      setIsRecordingKeybind(false);
      if (keybindRef.current) {
        keybindRef.current.blur();
      }
      return;
    }
    
    const keys: string[] = [];
    
    // Check modifiers
    if (e.metaKey || e.ctrlKey) {
      keys.push("CmdOrCtrl");
    }
    if (e.altKey) {
      keys.push("Alt");
    }
    if (e.shiftKey) {
      keys.push("Shift");
    }
    
    // Check main key (ignore modifier-only presses)
    if (e.key && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
      let mainKey = e.key;
      
      // Convert special keys
      if (mainKey === " ") {
        mainKey = "Space";
      } else if (mainKey.length === 1) {
        mainKey = mainKey.toUpperCase();
      }
      
      keys.push(mainKey);
    }
    
    // Only update if we have at least one modifier + one main key
    if (keys.length > 1) {
      const newKeybinding = keys.join("+");
      setKeybindingInput(newKeybinding);
      
      // Auto-stop recording after capturing a valid shortcut
      setTimeout(() => {
        setIsRecordingKeybind(false);
        if (keybindRef.current) {
          keybindRef.current.blur();
        }
      }, 300);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!question.trim()) return;

    if (!apiKey) {
      setShowSettings(true);
      return;
    }

    setLoading(true);
    setAnswer("");
    answerRef.current = ""; // Reset ref
    setSelectedHistoryIndex(-1);

    const currentQuestion = question.trim();

    try {
      await invoke("ask_ai", {
        question: currentQuestion,
        apiKey: apiKey,
      });

      // Wait a bit for streaming to complete, then save to history
      setTimeout(() => {
        const currentAnswer = answerRef.current;
        if (currentAnswer) {
          saveToHistory(currentQuestion, currentAnswer);
        }
      }, 500);
    } catch (error) {
      setAnswer(`Error: ${error}`);
      answerRef.current = `Error: ${error}`;
    } finally {
      setLoading(false);
    }
  };

  const handleQuestionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuestion(newValue);
    setSelectedHistoryIndex(-1);
    setSelectedRecentIndex(-1);
    
    // If text is cleared, return to default state
    if (!newValue.trim()) {
      setAnswer("");
      answerRef.current = "";
    }
  };

  const handleHistoryItemClick = (item: HistoryItem) => {
    setQuestion(item.question);
    setAnswer(item.answer);
    answerRef.current = item.answer;
    setSelectedHistoryIndex(-1);
    setSelectedRecentIndex(-1);
    
    // Focus input after selecting history item
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 0);
  };

  const deleteHistoryItem = async (timestamp: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updatedHistory = history.filter(item => item.timestamp !== timestamp);
      setHistory(updatedHistory);

      const store = await load("settings.json");
      await store.set("search_history", updatedHistory);
      await store.save();
      
      // Focus input after deletion
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 0);
    } catch (error) {
      console.error("Failed to delete history item:", error);
    }
  };

  const handleBackToDefault = () => {
    setQuestion("");
    setAnswer("");
    answerRef.current = "";
    setSelectedHistoryIndex(-1);
    setSelectedRecentIndex(-1);
    
    // Focus input after backing to default
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 0);
  };

  const handleClose = async () => {
    setQuestion("");
    setAnswer("");
    answerRef.current = "";
    setShowSettings(false);
    setSettingsInput("");
    await invoke("hide_window", {});
  };

  if (showSettings) {
    return (
      <div className="container settings">
        <div className="settings-header">
          <button 
            className="back-btn"
            onClick={handleCloseSettings}
            type="button"
            aria-label="Back"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <h2>Settings</h2>
        </div>
        
        <div className="settings-section">
          <label className="settings-label">OpenAI API Key</label>
          <p className="settings-description">Enter your API key to continue</p>
          <input
            type="password"
            value={settingsInput || apiKey}
            onChange={(e) => setSettingsInput(e.target.value)}
            placeholder="sk-..."
            className="settings-input api-key-input"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck="false"
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
          />
        </div>

        <div className="settings-section">
          <label className="settings-label">Global Keybinding</label>
          <p className="settings-description">
            {isRecordingKeybind 
              ? "Press modifier keys + any key (ESC to cancel)" 
              : "Click record to set a new shortcut"}
          </p>
          
          <div className="keybinding-container">
            <div className="keybinding-display">
              {formatKeybindingDisplay(keybindingInput).map((key, idx) => (
                <span key={idx}>
                  <kbd className="key">{key}</kbd>
                  {idx < formatKeybindingDisplay(keybindingInput).length - 1 && (
                    <span className="key-separator">+</span>
                  )}
                </span>
              ))}
            </div>

            <button
              type="button"
              className={`record-btn ${isRecordingKeybind ? 'recording' : ''}`}
              onClick={() => {
                if (isRecordingKeybind) {
                  // Stop recording
                  setIsRecordingKeybind(false);
                  if (keybindRef.current) {
                    keybindRef.current.blur();
                  }
                } else {
                  // Start recording
                  if (keybindRef.current) {
                    keybindRef.current.focus();
                  }
                }
              }}
            >
              {isRecordingKeybind ? (
                <>
                  <span className="recording-dot"></span>
                  Stop
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
                  </svg>
                  Record
                </>
              )}
            </button>

            <input
              ref={keybindRef}
              type="text"
              onFocus={() => setIsRecordingKeybind(true)}
              onBlur={() => {
                // Small delay to allow the button click to process
                setTimeout(() => setIsRecordingKeybind(false), 100);
              }}
              onKeyDown={handleKeybindingRecord}
              className="keybinding-hidden-input"
              readOnly
              tabIndex={-1}
            />
          </div>
        </div>

        {hasChanges && (
          <button 
            className="floating-save-btn"
            onClick={saveAllSettings}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Save Changes
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <form onSubmit={handleSubmit} style={{ margin: 0 }}>
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={handleQuestionChange}
          placeholder="Ask anything..."
          className="search-input"
          disabled={loading}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck="false"
          data-gramm="false"
          data-gramm_editor="false"
          data-enable-grammarly="false"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
        />
      </form>

      {filteredHistory.length > 0 && !loading && !answer && (
        <div className="history-dropdown">
          {filteredHistory.map((item, index) => (
            <div
              key={item.timestamp}
              ref={(el) => { historyItemRefs.current[index] = el; }}
              className={`history-item ${index === selectedHistoryIndex ? 'selected' : ''}`}
              onClick={() => handleHistoryItemClick(item)}
            >
              <div className="history-content">
                <div className="history-question">{item.question}</div>
                <div className="history-preview">{item.answer.slice(0, 80)}...</div>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => deleteHistoryItem(item.timestamp, e)}
                aria-label="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="result loading">
          <div className="loader"></div>
          <span>Thinking...</span>
        </div>
      )}

      {answer && !loading && (
        <div
          className="result markdown-body"
          dangerouslySetInnerHTML={{ __html: renderedAnswer }}
        />
      )}

      {!loading && !answer && !question.trim() && history.length > 0 && (
        <div className="recent-queries">
          {history.slice(0, 5).map((item, index) => (
            <div
              key={item.timestamp}
              ref={(el) => { recentItemRefs.current[index] = el; }}
              className={`history-item ${index === selectedRecentIndex ? 'selected' : ''}`}
              onClick={() => handleHistoryItemClick(item)}
            >
              <div className="history-content">
                <div className="history-question">{item.question}</div>
                <div className="history-preview">{item.answer.slice(0, 80)}...</div>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => deleteHistoryItem(item.timestamp, e)}
                aria-label="Delete"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="footer">
        <span className="shortcut">
          {answer || question.trim() ? "ESC to go back" : "ESC to close"}
        </span>
        {apiKey && (
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            type="button"
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13 8C13 8.34 12.98 8.67 12.94 9L14.28 10.04C14.4 10.13 14.43 10.3 14.35 10.44L13.07 12.56C13 12.7 12.82 12.75 12.68 12.69L11.09 12.03C10.76 12.28 10.4 12.49 10 12.64L9.75 14.36C9.73 14.52 9.59 14.64 9.43 14.64H6.87C6.71 14.64 6.57 14.52 6.55 14.36L6.3 12.64C5.9 12.49 5.54 12.28 5.21 12.03L3.62 12.69C3.48 12.75 3.3 12.7 3.23 12.56L1.95 10.44C1.87 10.3 1.9 10.13 2.02 10.04L3.36 9C3.32 8.67 3.3 8.34 3.3 8C3.3 7.66 3.32 7.33 3.36 7L2.02 5.96C1.9 5.87 1.87 5.7 1.95 5.56L3.23 3.44C3.3 3.3 3.48 3.25 3.62 3.31L5.21 3.97C5.54 3.72 5.9 3.51 6.3 3.36L6.55 1.64C6.57 1.48 6.71 1.36 6.87 1.36H9.43C9.59 1.36 9.73 1.48 9.75 1.64L10 3.36C10.4 3.51 10.76 3.72 11.09 3.97L12.68 3.31C12.82 3.25 13 3.3 13.07 3.44L14.35 5.56C14.43 5.7 14.4 5.87 14.28 5.96L12.94 7C12.98 7.33 13 7.66 13 8Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {!apiKey && (
          <button
            className="settings-btn warning"
            onClick={() => setShowSettings(true)}
            type="button"
          >
            Set API Key
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
