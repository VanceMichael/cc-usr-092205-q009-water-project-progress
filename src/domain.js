// 读取并检查项目共享的领域资料。
export function parseDomain(raw) {
  const value = JSON.parse(raw);
  if (!value.domain || !value.version || !value.sample_id || !Array.isArray(value.actors) || value.actors.length < 2 || !Array.isArray(value.facts) || value.facts.length < 2 || !Array.isArray(value.constraints) || value.constraints.length < 2) {
    throw new Error('共享资料缺少必要字段');
  }
  if (!Array.isArray(value.roles) || value.roles.length < 3 || value.roles.some((role) => !role || !role.name || !role.responsibility)) {
    throw new Error('共享资料缺少角色职责');
  }
  if (!Array.isArray(value.evidence_sources) || value.evidence_sources.length < 7 || value.evidence_sources.some((source) => !source || !source.name || !source.proves)) {
    throw new Error('共享资料缺少凭证来源');
  }
  if (!Array.isArray(value.reconciliation_rules) || value.reconciliation_rules.length < 2) {
    throw new Error('共享资料缺少核对规则');
  }
  if (!value.monthly_close || !Array.isArray(value.monthly_close.outputs) || value.monthly_close.outputs.length < 4 || !value.monthly_close.purpose) {
    throw new Error('共享资料缺少月结输出');
  }
  return value;
}
