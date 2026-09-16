import { useEffect, useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useGameContext } from '../../store/GameContext';
import { readFloorText } from '../../utils/tavernBridge';
import { separateThinking, type ThinkingSection } from '../../utils/stripThinking';

/**
 * 神识 —— 当前楼层的思维链查看器。
 *
 * 与正文剥离共用同一个 separateThinking（单一真相）：面板里看到的，
 * 就是正文里被剥掉的那些段，不会出现"面板看得到、正文也漏着"的不一致。
 */
export function ThinkingPanel() {
  const targetFloorId = useGameContext(c => c.targetFloorId);
  const [sections, setSections] = useState<ThinkingSection[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>([]);

  useEffect(() => {
    const raw = targetFloorId != null ? readFloorText(targetFloorId) : null;
    setSections(raw ? separateThinking(raw).sections : []);
    setCollapsed([]);
  }, [targetFloorId]);

  return (
    <div className="mato-thinking">
      <header className="mato-thinking__head">
        <Brain size={18} />
        <div>
          <strong>推演记录</strong>
          <small>{targetFloorId != null ? `当前楼层 #${targetFloorId}` : '尚未定位楼层'}</small>
        </div>
        <span className="mato-thinking__count">{sections.length} 段</span>
      </header>

      {sections.length === 0 ? (
        <p className="mato-thinking__empty">本楼没有思维链内容。</p>
      ) : (
        <div className="mato-thinking__list">
          {sections.map((section, i) => {
            const isCollapsed = collapsed.includes(i);
            return (
              <article key={`${section.label}-${i}`} className="mato-thinking__item">
                <button
                  onClick={() =>
                    setCollapsed(prev => (isCollapsed ? prev.filter(x => x !== i) : [...prev, i]))
                  }
                >
                  {isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <span>{section.label}</span>
                  <small>{section.content.length} 字</small>
                </button>
                {!isCollapsed && <pre>{section.content}</pre>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ThinkingPanel;
