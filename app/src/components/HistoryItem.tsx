import { CloseIcon } from "../icons";

interface HistoryItemProps {
  question: string;
  answer: string;
  timestamp: number;
  isSelected: boolean;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

export function HistoryItem({ question, answer, isSelected, onClick, onDelete }: HistoryItemProps) {
  return (
    <div className={`history-item ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="history-content">
        <div className="history-question">{question}</div>
        <div className="history-preview">{answer.slice(0, 80)}...</div>
      </div>
      <button className="delete-btn" onClick={onDelete} aria-label="Delete">
        <CloseIcon />
      </button>
    </div>
  );
}
