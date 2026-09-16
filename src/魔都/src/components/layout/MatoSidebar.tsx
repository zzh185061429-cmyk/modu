import { useEffect, useRef } from 'react';
import { BookOpen, Brain, History, Map, Minimize, RotateCw, ScrollText, Settings, Swords, Trash2, X } from 'lucide-react';
import { ModalType } from '../../types';
import { useGameContext } from '../../store/GameContext';
import { useFloorNav } from '../../store/useFloorNav';

interface MatoSidebarProps {
  open: boolean;
  onClose: () => void;
  onOpenModal: (type: ModalType) => void;
  onToggleFullscreen: () => void;
  playerName: string;
  locationName?: string;
}

/**
 * 指挥终端 —— 右侧滑出的边栏（galgame 惯例：菜单不是下拉浮层）。
 *
 * 只做「入口聚合」：所有条目仍调 App 传下来的既有回调，不新增业务逻辑。
 * 层级 z-40（弹窗级），与 TacticalModal 互斥显隐。
 */
export function MatoSidebar({ open, onClose, onOpenModal, onToggleFullscreen, playerName, locationName }: MatoSidebarProps) {
  const isGenerating = useGameContext(c => c.isGenerating);
  const targetFloorId = useGameContext(c => c.targetFloorId);
  const regenerate = useGameContext(c => c.regenerate);
  const isLocalDemo = useGameContext(c => c.isLocalDemo);
  const nav = useFloorNav();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!open) return null;

  const openModal = (type: ModalType) => {
    onClose();
    onOpenModal(type);
  };

  return (
    <div className="mato-sidebar" data-mato-sidebar="true">
      <div className="mato-sidebar__scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className="mato-sidebar__panel"
        role="dialog"
        aria-modal="true"
        aria-label="指挥终端"
        tabIndex={-1}
        onKeyDown={event => {
          // 与 TacticalModal 同一套：React 合成事件里 stopPropagation 才能拦住
          // document 上 App 的全局 Esc（否则关抽屉会顺手退出全屏）
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="mato-sidebar__head">
          <div>
            <strong>指挥终端</strong>
            <small>
              {locationName ?? '魔都'} · {playerName}
              {isLocalDemo ? ' · 本地演示' : ''}
            </small>
          </div>
          <button className="mato-icon-button" aria-label="关闭终端" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="mato-sidebar__body">
          <section className="mato-sidebar__group">
            <h3>系统</h3>
            <div className="mato-sidebar__grid">
              <button id="btn-nav-database" onClick={() => openModal('database')}>
                <BookOpen size={16} />
                <strong>人物档案</strong>
                <small>FILE</small>
              </button>
              <button id="btn-nav-map" onClick={() => openModal('map')}>
                <Map size={16} />
                <strong>魔都领域</strong>
                <small>AREA</small>
              </button>
              <button id="btn-nav-combat" onClick={() => openModal('combat')}>
                <Swords size={16} />
                <strong>战斗演习</strong>
                <small>SORTIE</small>
              </button>
              <button id="btn-nav-settings" onClick={() => openModal('settings')}>
                <Settings size={16} />
                <strong>系统设置</strong>
                <small>SYSTEM</small>
              </button>
            </div>
          </section>

          <section className="mato-sidebar__group">
            <h3>辅助</h3>
            <div className="mato-sidebar__rows">
              <button id="btn-nav-history" onClick={() => openModal('history')}>
                <History size={16} />
                <strong>记录</strong>
                <small>本楼已播出的内容</small>
              </button>
              <button id="btn-nav-thinking" onClick={() => openModal('thinking')}>
                <Brain size={16} />
                <strong>推演</strong>
                <small>查看本楼思维链</small>
              </button>
              <button id="btn-nav-manual" onClick={() => openModal('manual')}>
                <ScrollText size={16} />
                <strong>手册</strong>
                <small>操作说明</small>
              </button>
            </div>
          </section>

          <section className="mato-sidebar__group">
            <h3>
              篇章 <span>{nav.total}</span>
            </h3>
            {nav.total === 0 ? (
              <p className="mato-sidebar__empty">暂无楼层</p>
            ) : (
              <div className="mato-sidebar__list">
                {nav.visibleFloors.map((floor, i) => (
                  <button
                    key={floor}
                    aria-current={i === nav.currentIndex ? 'true' : undefined}
                    onClick={() => {
                      nav.pick(floor);
                      onClose();
                    }}
                  >
                    <span>#{floor}</span>
                    <small>{i === nav.currentIndex ? '当前' : i === nav.total - 1 ? '最新' : ''}</small>
                  </button>
                ))}
              </div>
            )}
            {nav.isViewingHistory && (
              <button
                className="mato-sidebar__follow"
                onClick={() => {
                  nav.goLatest();
                  onClose();
                }}
              >
                回到最新楼层
              </button>
            )}
          </section>

          <section className="mato-sidebar__group">
            <h3>本楼</h3>
            <div className="mato-sidebar__grid">
              <button id="btn-floor-regen" disabled={isGenerating || targetFloorId == null} onClick={() => void regenerate()}>
                <RotateCw size={16} />
                <strong>重新生成</strong>
                <small>REDO</small>
              </button>
              <button
                id="btn-floor-delete"
                data-danger="true"
                disabled={isGenerating}
                onClick={() => openModal('delete')}
              >
                <Trash2 size={16} />
                <strong>删除楼层</strong>
                <small>PURGE</small>
              </button>
            </div>
          </section>
        </div>

        <footer className="mato-sidebar__foot">
          <button id="btn-nav-fullscreen" className="mato-sidebar__exit" onClick={onToggleFullscreen}>
            <Minimize size={16} />
            <span>返回标题</span>
            <small>EXIT</small>
          </button>
        </footer>
      </div>
    </div>
  );
}

export default MatoSidebar;
