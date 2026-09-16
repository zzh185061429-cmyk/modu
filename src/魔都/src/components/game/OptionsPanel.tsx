import React from 'react';
import { X, ChevronRight } from 'lucide-react';
interface OptionsPanelProps { show: boolean; options: string[]; onSelect: (option: string) => void; onDismiss: () => void }
export function OptionsPanel({ show, options, onSelect, onDismiss }: OptionsPanelProps) {
  if (!show || !options.length) return null;
  return <div className="mato-choices">
    <div className="mato-choices__list">
      <header><h2>抉择</h2><button className="mato-icon-button" aria-label="关闭选项" onClick={onDismiss}><X size={20} /></button></header>
      {options.map((option, i) => <button key={`${i}-${option}`} className="surface-slip" onClick={() => onSelect(option)}><span>{String(i + 1).padStart(2, '0')}</span><strong>{option}</strong><ChevronRight size={18} /></button>)}
    </div>
  </div>;
}
export default OptionsPanel;
