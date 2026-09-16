import React, { useState } from 'react';
import { ART } from '../../data/art';
import { MAP_SECTORS } from '../../data/mapSectors';
import type { ScriptLine } from '../../scriptParser';

const PEOPLE = [
  { id: 'kyoka', name: '羽前京香', en: 'KYOUKA UZEN', unit: '第七组', rank: '组长', ability: '无穷之锁', jp: '無窮の鎖', art: ART.kyoka },
  { id: 'himari', name: '东日万凛', en: 'HIMARI AZUMA', unit: '第七组', rank: '副组长', ability: '学习', jp: 'ラーニング', art: ART.himari },
  { id: 'shushu', name: '骏河朱朱', en: 'SHUSHU SURUGA', unit: '第七组', rank: '队员', ability: '玉体革命', jp: 'パラダイムシフト', art: ART.shushu },
  { id: 'nei', name: '大川村宁', en: 'NEI OKAWAMURA', unit: '第七组', rank: '队员', ability: '一定会找到你', jp: 'きっと見つける', art: ART.nei },
  { id: 'tenka', name: '出云天花', en: 'TENKA IZUMO', unit: '第六组', rank: '组长', ability: '天御鸟命', jp: 'アメノミトリ', art: ART.tenka },
];
export function ArchivePanel() {
  const [selected, setSelected] = useState('kyoka');
  const person = PEOPLE.find(p => p.id === selected)!;
  return <div className="mato-archive"><nav aria-label="人物选择">{PEOPLE.map((p, i) => <button key={p.id} aria-pressed={p.id === selected} onClick={() => setSelected(p.id)}><small>{String(i + 1).padStart(2, '0')}</small><span>{p.name}</span><em>{p.unit}</em></button>)}</nav>
    <div className="mato-archive__portrait"><span aria-hidden="true">{person.unit === '第七组' ? '七' : '六'}</span><img src={person.art} alt={person.name} /></div>
    <div className="mato-archive__identity"><span>{person.unit} · {person.rank}</span><h3>{person.name}</h3><small>{person.en}</small><div className="mato-archive__ability"><span>能力</span><strong>{person.ability}</strong><small>{person.jp}</small></div></div>
  </div>;
}
export function SettingsPanel({ speed, setSpeed, textScale, setTextScale }: { speed: number; setSpeed: (n: number) => void; textScale: number; setTextScale: (n: number) => void }) {
  return <div className="mato-settings">
    <div className="mato-settings__row"><div><small>01</small><h3>文字速度</h3></div><div className="mato-segment">{['即刻', '慢速', '标准', '快速'].map((v, i) => <button key={v} id={i === 2 ? 'btn-text-speed' : undefined} aria-pressed={speed === i} onClick={() => setSpeed(i)}>{v}</button>)}</div></div>
    <div className="mato-settings__row"><div><small>02</small><h3>正文字号</h3></div><div className="mato-segment">{['小', '标准', '大'].map((v, i) => <button key={v} aria-pressed={textScale === i} onClick={() => setTextScale(i)}>{v}</button>)}</div></div>
    <div className="mato-settings__sample"><span>羽前京香</span><p style={{ fontSize: [18, 21, 25][textScale] }}>魔防队，第七组。</p></div>
  </div>;
}
const THREAT: Record<string, string> = { NONE: '安全', LOW: '低危', MEDIUM: '警戒', HIGH: '高危' };
export function TerritoryPanel() {
  return <div className="mato-territories">{MAP_SECTORS.map((s, i) => <article key={s.id} data-threat={s.threat}><div className="mato-territories__number">{String(i + 1).padStart(2, '0')}</div><header><small>{s.code}</small><span>{THREAT[s.threat]}</span></header><h3>{s.name}</h3><footer><span>驻防</span><strong>{s.squad}</strong></footer></article>)}</div>;
}
export function HistoryPanel({ lines }: { lines: ScriptLine[] }) {
  return <div className="mato-history">{lines.map((line, i) => <article key={i} data-type={line.type}><span className="mato-history__index">{String(i + 1).padStart(2, '0')}</span><h3>{line.speaker ?? '旁白'}</h3><p>{line.text}</p></article>)}</div>;
}
