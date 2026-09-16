import { useCallback, useMemo } from 'react';
import { useGameContext } from './GameContext';

/**
 * 楼层导航的派生视图（抽屉列表 + 文本框控制条共用）。
 *
 * 逻辑与原先 FloorNav 组件内联的版本一致，只把「算」和「画」拆开：
 * 本 hook 负责可见楼层、当前序号、上下卷与跟随，组件只负责排版。
 * 规则不变：生成期间裁掉正在生成的楼层；选到最后一层即回跟随模式。
 */
export interface FloorNavState {
  visibleFloors: number[];
  currentIndex: number;
  total: number;
  currentFloorId: number | null;
  isViewingHistory: boolean;
  canPrev: boolean;
  canNext: boolean;
  pick: (floorId: number) => void;
  goPrev: () => void;
  goNext: () => void;
  goLatest: () => void;
}

export function useFloorNav(): FloorNavState {
  const floors = useGameContext(c => c.floors);
  const viewingFloorId = useGameContext(c => c.viewingFloorId);
  const lastAssistantFloorId = useGameContext(c => c.lastAssistantFloorId);
  const generatingFloorId = useGameContext(c => c.generatingFloorId);
  const isGenerating = useGameContext(c => c.isGenerating);
  const isViewingHistory = useGameContext(c => c.isViewingHistory);
  const setViewingFloor = useGameContext(c => c.setViewingFloor);

  const visibleFloors = useMemo(
    () => (isGenerating && generatingFloorId != null ? floors.filter(f => f < generatingFloorId) : floors),
    [floors, isGenerating, generatingFloorId],
  );

  const currentFloorId = viewingFloorId ?? lastAssistantFloorId;

  const currentIndex = useMemo(() => {
    if (currentFloorId == null) return visibleFloors.length - 1;
    const i = visibleFloors.indexOf(currentFloorId);
    return i >= 0 ? i : visibleFloors.length - 1;
  }, [visibleFloors, currentFloorId]);

  const pick = useCallback(
    (floorId: number) => {
      // 选到最新一层就交还跟随权（viewingFloorId = null）
      setViewingFloor(floorId === visibleFloors[visibleFloors.length - 1] ? null : floorId);
    },
    [setViewingFloor, visibleFloors],
  );

  const goPrev = useCallback(() => {
    if (currentIndex > 0) pick(visibleFloors[currentIndex - 1]);
  }, [currentIndex, pick, visibleFloors]);

  const goNext = useCallback(() => {
    if (currentIndex < visibleFloors.length - 1) pick(visibleFloors[currentIndex + 1]);
  }, [currentIndex, pick, visibleFloors]);

  const goLatest = useCallback(() => setViewingFloor(null), [setViewingFloor]);

  return {
    visibleFloors,
    currentIndex,
    total: visibleFloors.length,
    currentFloorId,
    isViewingHistory,
    canPrev: currentIndex > 0,
    canNext: currentIndex < visibleFloors.length - 1,
    pick,
    goPrev,
    goNext,
    goLatest,
  };
}

export default useFloorNav;
