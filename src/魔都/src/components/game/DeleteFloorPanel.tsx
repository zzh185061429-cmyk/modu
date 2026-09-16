import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useGameContext } from '../../store/GameContext';

/**
 * 删除楼层 —— 按范围彻底删除（`/cut start-end`）。
 *
 * 对齐幻璃镜的"焚卷抽条"：删除是破坏性动作，不做成一键删当前楼，
 * 而是让玩家明确指定起止楼层、看清后果再动手。
 */
export function DeleteFloorPanel({ onDone }: { onDone: () => void }) {
  const cutFloorRange = useGameContext(c => c.cutFloorRange);
  const floors = useGameContext(c => c.floors);
  const targetFloorId = useGameContext(c => c.targetFloorId);
  const isGenerating = useGameContext(c => c.isGenerating);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);

  // 默认填当前楼层，玩家只改需要的部分
  useEffect(() => {
    if (targetFloorId == null) return;
    setStart(String(targetFloorId));
    setEnd(String(targetFloorId));
  }, [targetFloorId]);

  const from = Number.parseInt(start, 10);
  const to = Number.parseInt(end, 10);
  const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from;

  const handleDelete = async () => {
    if (!valid || busy || isGenerating) return;
    setBusy(true);
    try {
      await cutFloorRange(from, to);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mato-purge">
      <div className="mato-purge__warning">
        <AlertTriangle size={18} />
        <div>
          <strong>将彻底删除指定范围内的楼层</strong>
          <p>楼层即存档：正文与其中的剧情进度会一并移除，且不可恢复。</p>
        </div>
      </div>

      <div className="mato-purge__fields">
        <label>
          <span>起始楼层</span>
          <input
            type="number"
            min={0}
            value={start}
            placeholder="如 5"
            disabled={busy}
            onChange={event => setStart(event.target.value)}
          />
        </label>
        <label>
          <span>结束楼层</span>
          <input
            type="number"
            min={0}
            value={end}
            placeholder="如 10"
            disabled={busy}
            onChange={event => setEnd(event.target.value)}
          />
        </label>
      </div>

      <p className="mato-purge__hint">
        当前共 {floors.length} 层
        {floors.length > 0 ? `（#${floors[0]} – #${floors[floors.length - 1]}）` : ''}
      </p>

      <button className="mato-purge__submit" onClick={handleDelete} disabled={!valid || busy || isGenerating}>
        <Trash2 size={16} />
        <span>{busy ? '删除中…' : '确认删除'}</span>
      </button>
    </div>
  );
}

export default DeleteFloorPanel;
