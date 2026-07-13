export function isFeishuAdmin({ openId = '', config = {} } = {}) {
  const adminOpenIds = Array.isArray(config.adminOpenIds) ? config.adminOpenIds : [];
  if (adminOpenIds.length === 0) return false;
  return adminOpenIds.includes(String(openId || '').trim());
}

export function canExecuteFeishuCommand({ commandKey = '', openId = '', config = {} } = {}) {
  const key = String(commandKey || '').trim();
  if (!key) return false;
  if (key === 'help' || key === 'status') return true;
  if (key === 'daily' || key === 'logs' || key === 'backup' || key === 'restart') {
    return isFeishuAdmin({ openId, config });
  }
  return false;
}
