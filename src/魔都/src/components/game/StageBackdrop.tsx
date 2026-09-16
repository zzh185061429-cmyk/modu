import React from 'react';
import { ART } from '../../data/art';
import type { SceneLocation } from '../../scriptParser';
interface StageBackdropProps { location?: SceneLocation; sceneImage?: string }
export const StageBackdrop = React.memo(function StageBackdrop({ location, sceneImage }: StageBackdropProps) {
  return <div data-mato-stage="backdrop" className="mato-stage" aria-hidden="true">
    {sceneImage ? <img className="mato-stage__scene" src={sceneImage} alt="" /> : <>
      <div className="mato-stage__wash" /><div className="mato-stage__circle" />
      <span className="mato-stage__word">魔都</span>
      <img src={ART.chains} className="mato-stage__chain" alt="" />
      <div className="mato-stage__stripe" />
    </>}
    <div className="mato-stage__location"><span>{location?.displayName ?? '魔都'}</span></div>
  </div>;
});
export default StageBackdrop;
