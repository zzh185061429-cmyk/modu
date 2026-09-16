import { useEffect, useRef } from 'react';
import { ChevronDown, Loader, PenLine, Send, X } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isGenerating: boolean;
  /** 展开态由 App 持有：选项回填要能从外部把它拉起来 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 底部输入栏 —— 与文本框内的「发送」是同一件事的两个入口。
 *
 * 展开态常驻（`#mato-input` / `#mato-send` 始终在 DOM 里），
 * 收起后只剩右下角一枚「起草行动」印章，把画面还给正文。
 */
export function ChatInput({ value, onChange, onSend, isGenerating, open, onOpenChange }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!open) {
    return (
      <div className="mato-composer" data-open="false">
        <button className="mato-composer__draft" onClick={() => onOpenChange(true)}>
          <PenLine size={15} />
          <span>行动</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mato-composer" data-open="true">
      <div className="mato-composer__field">
        <textarea
          id="mato-input"
          ref={inputRef}
          value={value}
          rows={2}
          spellCheck={false}
          autoComplete="off"
          disabled={isGenerating}
          aria-label="行动"
          placeholder={isGenerating ? '续写中…' : '行动…'}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        {Boolean(value) && !isGenerating && (
          <button className="mato-composer__clear" aria-label="清空" title="清空" onClick={() => onChange('')}>
            <X size={14} />
          </button>
        )}
      </div>
      <button
        id="mato-send"
        className="mato-composer__send"
        onClick={onSend}
        disabled={isGenerating || !value.trim()}
        title="发送 (Enter)"
      >
        {isGenerating ? <Loader className="mato-composer__spin" size={16} /> : <Send size={16} />}
        <span>发送</span>
      </button>
      <button className="mato-composer__collapse" aria-label="收起输入栏" title="收起输入栏" onClick={() => onOpenChange(false)}>
        <ChevronDown size={15} />
      </button>
    </div>
  );
}

export default ChatInput;
