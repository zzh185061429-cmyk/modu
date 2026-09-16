/** Tavern Helper declarations: @types/function/variables.d.ts (runtime acceptance pending).
 * Only a chat-scoped, namespaced field is owned here. Never rename the user's ST persona.
 */
export const PLAYER_NAME_KEY = 'mato_player_name';

export function validatePlayerName(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('请填写 1–12 个字符的名字。');
  const name = raw.trim();
  if (!name || Array.from(name).length > 12 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('请填写 1–12 个字符的名字。');
  }
  return name;
}

export function canPersistPlayerName(): boolean {
  return typeof getVariables === 'function' && typeof updateVariablesWith === 'function';
}

export function readPlayerName(): string {
  try {
    if (typeof getVariables !== 'function') return '';
    return validatePlayerName(getVariables({ type: 'chat' })[PLAYER_NAME_KEY]);
  } catch { return ''; }
}

export function savePlayerName(raw: string): void {
  const name = validatePlayerName(raw);
  // A standalone preview has no chat. Never leak identity to cross-chat localStorage.
  if (!canPersistPlayerName()) {
    if (window.parent === window) return;
    throw new Error('聊天变量接口尚未就绪，请确认酒馆助手已启用后重试。');
  }
  try {
    updateVariablesWith(variables => ({ ...variables, [PLAYER_NAME_KEY]: name }), { type: 'chat' });
    if (readPlayerName() !== name) throw new Error('readback mismatch');
  } catch {
    throw new Error('姓名未能保存到当前聊天，请重试；其他变量不会被替换。');
  }
}
