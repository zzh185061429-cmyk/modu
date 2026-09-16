import React from 'react';
interface AtmosphereLayerProps { intensity?: number; motes?: boolean }
export const AtmosphereLayer = React.memo(function AtmosphereLayer({ intensity = 1 }: AtmosphereLayerProps) {
  return <div className="mato-atmosphere" aria-hidden="true" style={{ opacity: intensity }} />;
});
export default AtmosphereLayer;
