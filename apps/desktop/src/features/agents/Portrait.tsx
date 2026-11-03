import type { CharacterAppearance } from '@agentville/domain';
import { useMemo } from 'react';
import { portraitUrl } from '../../game/engine/textures';

export function Portrait({ appearance, size = 40, className = '' }: { appearance: CharacterAppearance; size?: number; className?: string }) {
  const src = useMemo(() => portraitUrl(appearance), [appearance]);
  return <img src={src} width={size} height={size} alt="" aria-hidden className={`pixelated shrink-0 ${className}`} draggable={false} />;
}
