import { useState, useEffect, useRef } from "react";
import { formatKeybindingDisplay, parseKeybindingFromEvent } from "../utils/keybinding";
import { BackIcon, CheckIcon, RecordIcon } from "../icons";

interface SettingsProps {
  keybinding: string;
  onClose: () => void;
  onSave: (keybinding: string) => Promise<void>;
}

export function Settings({ keybinding, onClose, onSave }: SettingsProps) {
  const [keybindingInput, setKeybindingInput] = useState(keybinding);
  const [isRecordingKeybind, setIsRecordingKeybind] = useState(false);
  const keybindRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setKeybindingInput(keybinding);
  }, [keybinding]);

  const hasChanges = keybindingInput !== keybinding;

  const handleSave = async () => {
    await onSave(keybindingInput);
  };

  const handleClose = () => {
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
