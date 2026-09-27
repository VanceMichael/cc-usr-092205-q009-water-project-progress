import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDomain } from '../src/domain.js';

const raw = await readFile(new URL('../fixtures/domain.json', import.meta.url), 'utf8');
const domain = parseDomain(raw);

test('样例领域标识正确', () => {
  assert.equal(domain.domain, 'water-project-progress');
  assert.ok(domain.constraints.length >= 2);
});

test('承包商、监理、财务职责分离', () => {
  assert.deepEqual(domain.roles.map((role) => role.name), ['承包商', '监理', '财务']);
  const responsibilities = domain.roles.map((role) => role.responsibility);
  assert.equal(new Set(responsibilities).size, responsibilities.length);
});

test('七类凭证来源齐全且各自对应证明对象', () => {
  assert.equal(domain.evidence_sources.length, 7);
  const names = domain.evidence_sources.map((source) => source.name);
  for (const expected of ['批复概算', '合同清单', '北斗车辆记录', '监理计量', '现场影像', '设计变更', '付款凭证']) {
    assert.ok(names.includes(expected), `缺少凭证来源：${expected}`);
  }
  assert.ok(domain.evidence_sources.every((source) => source.proves.length > 0));
});

test('核对规则覆盖付款口径、重复确认、代签与单价保密', () => {
  const rules = domain.reconciliation_rules.join('\n');
  assert.match(rules, /付款额不得代替完成量/);
  assert.match(rules, /不得重复/);
  assert.match(rules, /不得互相代签/);
  assert.match(rules, /隐藏合同敏感单价/);
});

test('月结输出偏差、关键线路、责任标段与可追回工程量', () => {
  assert.equal(domain.monthly_close.outputs.length, 4);
  const outputs = domain.monthly_close.outputs.join('\n');
  assert.match(outputs, /偏差/);
  assert.match(outputs, /关键线路/);
  assert.match(outputs, /责任标段/);
  assert.match(outputs, /可追回/);
  assert.match(domain.monthly_close.purpose, /调整资源/);
});

test('缺少必要字段时报错', () => {
  assert.throws(() => parseDomain('{}'), /共享资料缺少必要字段/);
  const withoutClose = { ...domain, monthly_close: undefined };
  assert.throws(() => parseDomain(JSON.stringify(withoutClose)), /月结/);
});
