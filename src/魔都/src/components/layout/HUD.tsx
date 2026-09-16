import { useState } from 'react';
import { Menu } from 'lucide-react';
import { ModalType } from '../../types';
import { useGameContext } from '../../store/GameContext';
import { useFloorNav } from '../../store/useFloorNav';
import { MatoSidebar } from './MatoSidebar';

interface HUDProps {
  onOpenModal: (type: ModalType) => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  playerName: string;
  locationName?: string;
}

/**
 * 常驻顶栏 —— 只留「我是谁 / 我在哪 / 我读到第几层 / 菜单」。
 *
 * 功能入口全部收进右侧抽屉（MatoSidebar）：常驻区越干净，正文越像 galgame。
 * 楼层上下卷不在这里 —— 它属于阅读动作，放在文本框控制条右下角。
 */
export function HUD({ onOpenModal, onToggleFullscreen, playerName, locationName }: HUDProps) {
  const isGenerating = useGameContext(c => c.isGenerating);
  const isLocalDemo = useGameContext(c => c.isLocalDemo);
  const nav = useFloorNav();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="mato-hud">
        <div className="mato-hud__brand">
          <b aria-hidden="true">七</b>
          <div>
            <span>魔防队</span>
            <strong>第七组</strong>
          </div>
        </div>

        <div className="mato-hud__meta">
          <span className="mato-hud__place">{locationName ?? '魔都'}</span>
          <i aria-hidden="true" />
          <span className="mato-hud__player">
            {playerName}
            {isLocalDemo && <em>本地演示</em>}
          </span>
          <i aria-hidden="true" />
          <span className="mato-hud__floor" title="阅读进度">
            #{nav.total === 0 ? '—' : nav.currentIndex + 1}
            <small>/{nav.total}</small>
          </span>
        </div>

        <button
          id="btn-hud-menu"
          className="mato-hud__menu"
          aria-expanded={menuOpen}
          aria-label="打开菜单"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={17} />
          <span>菜单</span>
        </button>

        {isGenerating && (
          <span className="mato-hud__generating" role="status">
            续写中…
          </span>
        )}
      </header>

      <MatoSidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onOpenModal={onOpenModal}
        onToggleFullscreen={onToggleFullscreen}
        playerName={playerName}
        locationName={locationName}
      />
    </>
  );
}

export default HUD;
