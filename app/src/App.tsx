import { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { marked } from "marked";
import "./App.css";

function App() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInput, setSettingsInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const renderedAnswer = useMemo(() => {
    if (!answer) return "";
    return marked.parse(answer, { breaks: true }) as string;
  }, [answer]);

  useEffect(() => {
    loadApiKey();

    const appWindow = getCurrentWindow();
    const unlisten = appWindow.listen<string>("ai-response-chunk", (event) => {
      setAnswer((prev) => prev + event.payload);
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      unlisten.then((fn) => fn());
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, [showSettings]);

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

  const saveApiKey = async () => {
    try {
      const store = await load("settings.json");
      await store.set("openai_api_key", settingsInput);
      await store.save();
      setApiKey(settingsInput);
      setShowSettings(false);
      setSettingsInput("");
    } catch (error) {
      console.error("Failed to save API key:", error);
      alert("Failed to save API key. Please try again.");
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

    try {
      await invoke("ask_ai", {
        question: question.trim(),
        apiKey: apiKey,
      });
    } catch (error) {
      setAnswer(`Error: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    setQuestion("");
    setAnswer("");
    setShowSettings(false);
    setSettingsInput("");
    await invoke("hide_window", {});
  };

  if (showSettings) {
    return (
      <div className="container settings">
        <h2>Settings</h2>
        <p>Enter your OpenAI API Key</p>
        <form onSubmit={(e) => { e.preventDefault(); saveApiKey(); }}>
          <input
            ref={inputRef}
            type="password"
            value={settingsInput}
            onChange={(e) => setSettingsInput(e.target.value)}
            placeholder="sk-..."
            className="settings-input"
          />
          <div className="settings-actions">
            <button type="submit" disabled={!settingsInput.trim()}>
              Save
            </button>
            <button type="button" onClick={() => setShowSettings(false)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="container">
      <form onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything... (e.g., 'Neovim jump to line')"
          className="search-input"
          disabled={loading}
        />
      </form>

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

      <div className="footer">
        <span className="shortcut">Esc to close</span>
        {apiKey && (
          <button
            className="settings-btn"
            onClick={() => setShowSettings(true)}
            type="button"
          >
            ⚙️
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
