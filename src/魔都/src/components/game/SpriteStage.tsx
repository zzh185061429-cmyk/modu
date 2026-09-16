import React, { useMemo } from 'react';
import type { ScriptLine } from '../../scriptParser';
import { findCastMember } from '../../data/cast';
import { CHARACTER_ART } from '../../data/art';
interface SpriteStageProps { lines: ScriptLine[]; index: number; playerName?: string }
function actorsOnStage(lines: ScriptLine[], index: number) {
  const current = lines[index];
  if (!current) return [];
  const scenePath = current.location?.path;
  const ordered: string[] = [];
  for (let i = index; i >= 0; i--) {
    const line = lines[i];
    if (scenePath !== undefined && i < index && line.location?.path !== scenePath) break;
    if (line.type === 'narrator' || !line.speaker || line.isPlayer || findCastMember(line.speaker)?.isSystem) continue;
    if (!ordered.includes(line.speaker)) ordered.unshift(line.speaker);
  }
  const activeSpeaker = current.speaker && !current.isPlayer ? current.speaker : undefined;
  return ordered.slice(-3).map(speaker => {
    let sprite: string | undefined;
    for (let i = index; i >= 0; i--) {
      if (lines[i].speaker === speaker && lines[i].emotionKey) { sprite = lines[i].sprite; break; }
    }
    return { speaker, sprite: sprite ?? CHARACTER_ART[speaker] ?? CHARACTER_ART[findCastMember(speaker)?.name ?? ''], isActive: speaker === activeSpeaker };
  });
}
export const SpriteStage = React.memo(function SpriteStage({ lines, index }: SpriteStageProps) {
  const actors = useMemo(() => actorsOnStage(lines, index), [lines, index]);
  return <div data-mato-stage="sprites" className="mato-sprites" data-count={actors.filter(a => a.sprite).length}>
    {actors.filter(actor => actor.sprite).map(actor => <div key={actor.speaker} className="mato-sprites__actor" data-active={actor.isActive}>
      <img src={actor.sprite} alt={actor.speaker} onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
    </div>)}
  </div>;
});
export default SpriteStage;
