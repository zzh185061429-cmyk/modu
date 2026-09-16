/**
 * S1 验收脚本 —— 剧本解析器单测（纯本地，不需要酒馆）
 *
 * 做法：用 typescript 的 transpileModule 把三个源文件转译成 CommonJS 到
 * .probe-tmp/parser-build/（保持相对目录结构），再 require 跑断言。
 * 这样不必给项目引入测试框架，也不必改 tsconfig。
 *
 * 跑法：node src/魔都/scripts/verify-parser.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projRoot = path.resolve(here, '..');
const srcDir = path.join(projRoot, 'src');
const repoRoot = path.resolve(projRoot, '..', '..');
const outDir = path.join(repoRoot, '.probe-tmp', 'parser-build');

const ENTRIES = ['utils/stripThinking.ts', 'data/cast.ts', 'scriptParser.ts'];

function transpileAll() {
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const rel of ENTRIES) {
    const from = path.join(srcDir, rel);
    const to = path.join(outDir, rel.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const { outputText } = ts.transpileModule(fs.readFileSync(from, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: from,
    });
    fs.writeFileSync(to, outputText);
  }
}

transpileAll();
const { parseScriptContent, parseOptions } = require(path.join(outDir, 'scriptParser.js'));

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

// ── 夹具 1：完整楼层（思维链 + content + 变量块 + 引号旁白 + 场景 + 情绪 + 玩家）──
const FLOOR_FULL = `<thinking>
用户在站台，我要给出一段压迫感。
格式示例：羽前京香[冷静]:"这条示例在思维链里，不该进剧本"
</thinking>

<content>
[scene:魔都/第七区/废弃车站/站台]
雨点打在铁皮棚顶上，声音密得像有人在敲电报。
羽前京香[冷静]:"信号确认。优希，你那边能看到什么？"
和仓优希[疲惫]:"雾太厚了，可视距离不到二十米。"
羽前京香[严厉]:*这孩子又没睡。*
<user>:"要我往前探吗？"
他说"我陪你"——但声音是从耳机里传来的，人并不在。
羽前京香[某种不存在的情绪]:"别逞强。"
</content>

<UpdateVariable>
<Analysis>好感度上升</Analysis>
_.set('好感度', 12);
</UpdateVariable>

<options>
<option>原地待命，继续观测</option>
<option>沿铁轨向前推进</option>
</options>`;

console.log('\n[1] 完整楼层解析');

const lines = parseScriptContent(FLOOR_FULL, '测试员');

check('行数与内容行一致（控制行/思维链/变量块/选项块都不产生可播行）', () => {
  assert.equal(lines.length, 7, `期望 7 行，实得 ${lines.length}：${JSON.stringify(lines.map(l => l.text))}`);
});

check('思维链不进剧本', () => {
  const joined = lines.map(l => l.text).join('\n');
  assert.ok(!joined.includes('格式示例'), '思维链内容漏进了剧本');
  assert.ok(!joined.includes('压迫感'), '思维链内容漏进了剧本');
});

check('变量更新块不进剧本', () => {
  const joined = lines.map(l => l.text).join('\n');
  assert.ok(!joined.includes('好感度'), '变量块漏进了剧本');
});

check('第 1 行是旁白', () => {
  assert.equal(lines[0].type, 'narrator');
  assert.ok(lines[0].text.startsWith('雨点打在铁皮棚顶上'));
});

check('对话行：说话人 / 情绪 / 情绪 key / 主题色', () => {
  const l = lines[1];
  assert.equal(l.type, 'dialog');
  assert.equal(l.speaker, '羽前京香');
  assert.equal(l.emotion, '冷静');
  assert.equal(l.emotionKey, 'calm');
  assert.equal(l.theme, 'rose');
  assert.equal(l.text, '信号确认。优希，你那边能看到什么？');
});

check('玩家行：别名命中 isPlayer，且不占立绘位', () => {
  const l = lines[2];
  assert.equal(l.speaker, '和仓优希');
  assert.equal(l.isPlayer, true);
  assert.equal(l.sprite, undefined, '玩家不该有立绘');
});

check('内心独白行识别正确', () => {
  const l = lines[3];
  assert.equal(l.type, 'thought');
  assert.equal(l.speaker, '羽前京香');
  assert.equal(l.text, '这孩子又没睡。');
});

check('<user> 标记的玩家行：名牌显示玩家名而非协议标记', () => {
  const l = lines[4];
  assert.equal(l.type, 'dialog');
  assert.equal(l.speaker, '测试员', '`<user>` 是协议标记，不该泄漏到名牌');
  assert.equal(l.isPlayer, true);
  assert.equal(l.text, '要我往前探吗？');
});

check('旁白里的引号台词不被误认成对话', () => {
  const l = lines[5];
  assert.equal(l.type, 'narrator', '含引号的旁白被误判为对话行');
  assert.ok(l.text.includes('我陪你'));
});

check('未知情绪回落到 default（不丢行）', () => {
  const l = lines[6];
  assert.equal(l.type, 'dialog');
  assert.equal(l.speaker, '羽前京香');
  assert.equal(l.emotionKey, 'default');
});

check('场景控制行不产生可播行，且被后续行继承', () => {
  assert.ok(!lines.some(l => l.text.includes('scene:')), '场景标签漏进了剧本');
  for (const l of lines) {
    assert.equal(l.location?.path, '魔都/第七区/废弃车站/站台');
    assert.equal(l.location?.displayName, '站台');
  }
});

check('立绘资产待定：sprite 恒为 undefined（结构在、资产空）', () => {
  assert.equal(lines[1].sprite, undefined);
});

console.log('\n[2] 无 <content> 标签的降级路径');

const linesDegrade = parseScriptContent(
  `<thinking>内部思考不该出现</thinking>\n羽前京香[微笑]:"没有 content 标签也要能播。"`,
  '测试员',
);

check('降级后仍能解析出对话行', () => {
  assert.equal(linesDegrade.length, 1);
  assert.equal(linesDegrade[0].speaker, '羽前京香');
  assert.equal(linesDegrade[0].emotionKey, 'smile');
  assert.ok(!linesDegrade[0].text.includes('内部思考'));
});

console.log('\n[3] 场景切换的继承语义');

const linesScene = parseScriptContent(
  `<content>\n[scene:魔都/第七区/站台]\n甲[冷静]:"第一句。"\n[scene:魔都/第九区/地下管道]\n乙[冷静]:"第二句。"\n</content>`,
);

check('控制行「从此生效直到下一个控制行」', () => {
  assert.equal(linesScene[0].location?.displayName, '站台');
  assert.equal(linesScene[1].location?.displayName, '地下管道');
});

console.log('\n[4] 行首标签前缀归一化');

const linesTag = parseScriptContent(`<content>\n[队员:甲,状态=警戒][紧张]:"有动静。"\n</content>`);

check('标签前缀被剥离，角色名提到行首', () => {
  assert.equal(linesTag.length, 1);
  assert.equal(linesTag[0].type, 'dialog');
  assert.equal(linesTag[0].speaker, '甲');
  assert.equal(linesTag[0].text, '有动静。');
});

console.log('\n[5] 选项三路并取');

check('路 1：<options> 块内 <option> 包裹', () => {
  const opts = parseOptions(`<options>\n<option>选项甲</option>\n<option>选项乙</option>\n</options>`);
  assert.deepEqual(opts, ['选项甲', '选项乙']);
});

check('路 2：<options> 块内 > 前缀行', () => {
  const opts = parseOptions(`<options>\n> 选项甲\n> 选项乙\n</options>`);
  assert.deepEqual(opts, ['选项甲', '选项乙']);
});

check('路 3：<choice> 块级（含序号剥离）', () => {
  const opts = parseOptions(`<choice>\n1. 选项甲\n2. 选项乙\n</choice>`);
  assert.deepEqual(opts, ['选项甲', '选项乙']);
});

check('路 3b：多个独立 <choice>', () => {
  const opts = parseOptions(`<choice>选项甲</choice>\n<choice>选项乙</choice>`);
  assert.deepEqual(opts, ['选项甲', '选项乙']);
});

check('去重', () => {
  const opts = parseOptions(`<options>\n<option>重复项</option>\n<option>重复项</option>\n</options>`);
  assert.deepEqual(opts, ['重复项']);
});

check('选项块不污染剧本正文', () => {
  const l = parseScriptContent(`<content>\n甲[冷静]:"正文。"\n</content>\n<options>\n<option>不该出现</option>\n</options>`);
  assert.equal(l.length, 1);
  assert.ok(!l[0].text.includes('不该出现'));
});

console.log('\n[6] 边界');

check('空输入返回空数组', () => {
  assert.deepEqual(parseScriptContent(''), []);
  assert.deepEqual(parseOptions(''), []);
});

check('只有标签没有正文时返回空数组', () => {
  assert.deepEqual(parseScriptContent(`<thinking>只有思考</thinking>`), []);
});

check('纯文本楼层全部按旁白处理', () => {
  const l = parseScriptContent('第一段。\n第二段。');
  assert.equal(l.length, 2);
  assert.ok(l.every(x => x.type === 'narrator'));
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
