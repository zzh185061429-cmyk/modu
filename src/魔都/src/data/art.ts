import kyoka from '../assets/kyoka.png?url';
import himari from '../assets/himari.png?url';
import tenka from '../assets/tenka.png?url';
import shushu from '../assets/shushu.png?url';
import nei from '../assets/nei.png?url';
import chains from '../assets/chains.png?url';

export const ART = { kyoka, himari, tenka, shushu, nei, chains } as const;
export const CHARACTER_ART: Record<string, string> = {
  羽前京香: kyoka, 京香: kyoka, 羽前组长: kyoka, 组长: kyoka,
  东日万凛: himari, 日万凛: himari,
  出云天花: tenka, 天花: tenka,
  骏河朱朱: shushu, 骏河朱々: shushu, 朱朱: shushu, 朱々: shushu,
  大川村宁: nei, 宁: nei,
};
