import { HistoryItem as HistoryItemType } from "../types";
import { HistoryItem } from "./HistoryItem";

interface HistoryListProps {
  items: HistoryItemType[];
  selectedIndex: number;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onItemClick: (item: HistoryItemType) => void;
  onItemDelete: (timestamp: number, e: React.MouseEvent) => void;
  className?: string;
}

export function HistoryList({
  items,
  selectedIndex,
  itemRefs,
  onItemClick,
  onItemDelete,
  className = "history-dropdown"
}: HistoryListProps) {
  if (items.length === 0) return null;

  return (
    <div className={className}>
      {items.map((item, index) => (
        <div key={item.timestamp} ref={(el) => { itemRefs.current[index] = el; }}>
          <HistoryItem
            question={item.question}
            answer={item.answer}
            timestamp={item.timestamp}
            isSelected={index === selectedIndex}
            onClick={() => onItemClick(item)}
            onDelete={(e) => onItemDelete(item.timestamp, e)}
          />
        </div>
      ))}
    </div>
  );
}
