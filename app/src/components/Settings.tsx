import { useState, useEffect, useRef } from "react";
import { formatKeybindingDisplay, parseKeybindingFromEvent } from "../utils/keybinding";
import { BackIcon, CheckIcon, RecordIcon } from "../icons";

interface SettingsProps {
  apiKey: string;
  keybinding: string;
  onClose: () => void;
  onSave: (apiKey: string, keybinding: string) => Promise<void>;
}

export function Settings({ apiKey, keybinding, onClose, onSave }: SettingsProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keybindingInput, setKeybindingInput] = useState(keybinding);
  const [isRecordingKeybind, setIsRecordingKeybind] = useState(false);
  const keybindRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setKeybindingInput(keybinding);
  }, [keybinding]);

  const hasChanges =
    (apiKeyInput && apiKeyInput !== apiKey) ||
    (keybindingInput !== keybinding);

  const handleSave = async () => {
    const newApiKey = apiKeyInput || apiKey;
    await onSave(newApiKey, keybindingInput);
    setApiKeyInput("");
  };

  const handleClose = () => {
    setApiKeyInput("");
    setKeybindingInput(keybinding);
    onClose();
  };

  const handleKeybindingRecord = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isRecordingKeybind) return;

    e.preventDefault();
    e.stopPropagation();

    const newKeybinding = parseKeybindingFromEvent(e);

    if (newKeybinding === null) {
      setIsRecordingKeybind(false);
      if (keybindRef.current) keybindRef.current.blur();
      return;
    }

    if (newKeybinding) {
      setKeybindingInput(newKeybinding);
      setTimeout(() => {
        setIsRecordingKeybind(false);
        if (keybindRef.current) keybindRef.current.blur();
      }, 300);
    }
  };

  const handleRecordToggle = () => {
    if (isRecordingKeybind) {
      setIsRecordingKeybind(false);
      if (keybindRef.current) keybindRef.current.blur();
    } else {
      if (keybindRef.current) keybindRef.current.focus();
    }
  };

  return (
    <div className="container settings">
      <div className="settings-header">
        <button className="back-btn" onClick={handleClose} type="button" aria-label="Back">
          <BackIcon />
        </button>
        <h2>Settings</h2>
      </div>

        <div className="settings-section">
          <label className="settings-label">OpenAI API Key</label>
          <p className="settings-description">Enter your API key to continue</p>
          <input
            type="password"
            value={apiKeyInput || apiKey}
            onChange={(e) => setApiKeyInput(e.target.value)}
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
              onClick={handleRecordToggle}
            >
              {isRecordingKeybind ? (
                <>
                  <span className="recording-dot"></span>
                  Stop
                </>
              ) : (
                <>
                  <RecordIcon />
                  Record
                </>
              )}
            </button>

            <input
              ref={keybindRef}
              type="text"
              onFocus={() => setIsRecordingKeybind(true)}
              onBlur={() => setTimeout(() => setIsRecordingKeybind(false), 100)}
              onKeyDown={handleKeybindingRecord}
              className="keybinding-hidden-input"
              readOnly
              tabIndex={-1}
            />
          </div>
        </div>

        {hasChanges && (
          <button className="floating-save-btn" onClick={handleSave} type="button">
            <CheckIcon />
            Save Changes
          </button>
        )}
      </div>
    );
}
