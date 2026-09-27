import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDomain, summarizeMonthlyReport } from '../src/domain.js';

const load = async () =>
  parseDomain(await readFile(new URL('../fixtures/domain.json', import.meta.url), 'utf8'));

test('样例领域标识与版本正确', async () => {
  const v = await load();
  assert.equal(v.domain, 'water-project-progress');
  assert.ok(v.version >= 2);
});

test('三类角色分权且不得互相代签', async () => {
  const v = await load();
  assert.deepEqual(v.actors.map((a) => a.id).sort(), ['contractor', 'finance', 'supervisor']);
  for (const a of v.actors) {
    assert.ok(a.may_not.length >= 1);
  }
  assert.match(v.segregation_rule, /不能互相代签/);
  const finance = v.actors.find((a) => a.id === 'finance');
  assert.ok(finance.may_not.some((x) => x.includes('预付款')));
});

test('七类证据链齐全', async () => {
  const v = await load();
  assert.deepEqual(
    v.evidence_chain.map((e) => e.id).sort(),
    [
      'approved_estimate',
      'beidou_vehicle_log',
      'contract_boq',
      'design_change',
      'payment_voucher',
      'site_imagery',
      'supervisor_measurement',
    ],
  );
});

test('进度按施工段和工程量组织，付款额不得代替完成量', async () => {
  const v = await load();
  assert.deepEqual(v.progress_basis.organize_by, ['施工段', '工程量']);
  assert.ok(v.progress_basis.must_not_use_as_completion.some((x) => /付款|预付款/.test(x)));
});

test('重复确认排除项覆盖调拨、返工、迟到签证', async () => {
  const v = await load();
  const text = v.excluded_from_reconfirmation.join('；');
  for (const kw of ['调拨', '返工', '迟到签证']) assert.match(text, new RegExp(kw));
});

test('月结四要素齐全', async () => {
  const v = await load();
  assert.deepEqual(
    v.monthly_review_required.map((r) => r.key).sort(),
    ['critical_path', 'fund_physical_deviation', 'recoverable_quantity', 'responsible_section'],
  );
});

test('冬灌关键节点存在且日期为 MM-DD', async () => {
  const v = await load();
  const m = v.milestones.find((x) => x.id === 'qtg-1031-lining');
  assert.ok(m);
  assert.equal(m.deadline, '10-31');
  assert.equal(m.critical_path, true);
});

test('公开版隐藏敏感单价', async () => {
  const v = await load();
  assert.ok(v.public_redaction.join('').includes('单价'));
  for (const s of v.sample_monthly_report.sections) {
    for (const item of s.boq_items) {
      assert.equal(item.unit_price, 'REDACTED_IN_PUBLIC');
      assert.equal(typeof item.supervisor_confirmed_qty, 'number');
    }
  }
});

test('月报：资金与实物量分账，预付款不计完成量', async () => {
  const v = await load();
  const rows = summarizeMonthlyReport(v.sample_monthly_report);
  const sg01 = rows.find((r) => r.section_id === 'SG-01');
  // 已付300万预付款，但监理仅确认720/1200m3且未批进度款：典型资金>实物量偏差
  assert.equal(sg01.prepayment_paid, 300);
  assert.equal(sg01.progress_payment_approved, 0);
  assert.equal(sg01.confirmed_qty, 720);
  assert.equal(sg01.remaining_qty, 480);
  assert.equal(sg01.on_track, false);
  assert.ok(sg01.recoverable_next_period_qty <= sg01.remaining_qty);
});

test('月报：跨标段调拨只计一次且账实平衡', async () => {
  const v = await load();
  const out = v.sample_monthly_report.sections.reduce(
    (n, s) => n + (s.materials_transferred_out_qty ?? 0),
    0,
  );
  const inbound = v.sample_monthly_report.sections.reduce(
    (n, s) => n + (s.materials_transferred_in_qty ?? 0),
    0,
  );
  assert.equal(out, inbound);
  assert.match(v.sample_monthly_report.cross_section_note, /计量一次/);
  // 返工量被剔除，不进入确认量
  const sg01 = v.sample_monthly_report.sections.find((s) => s.section_id === 'SG-01');
  assert.ok(sg01.rework_qty_excluded > 0);
  assert.ok(sg01.boq_items[0].supervisor_confirmed_qty <= sg01.boq_items[0].planned_qty);
});

test('缺少必要字段时解析失败', () => {
  assert.throws(() => parseDomain('{"domain":"x"}'), /必要字段/);
});

test('角色缺失或代签结构被拒绝', () => {
  const base = () => {
    const v = JSON.parse(JSON.stringify(require_fixture()));
    return v;
  };
  const broken = base();
  // 用重复角色顶掉 finance：绕过数组下限，触发必需角色校验
  broken.actors = broken.actors.map((a) =>
    a.id === 'finance' ? { ...a, id: 'contractor' } : a,
  );
  assert.throws(() => parseDomain(JSON.stringify(broken)), /缺少必需角色：finance/);
});

test('调拨不平时解析失败', () => {
  const v = require_fixture();
  delete v.sample_monthly_report.sections[1].materials_transferred_out_qty;
  assert.throws(() => parseDomain(JSON.stringify(v)), /跨标段调拨不平/);
});

test('公开版泄露单价时解析失败', () => {
  const v = require_fixture();
  v.sample_monthly_report.sections[0].boq_items[0].unit_price = 520;
  assert.throws(() => parseDomain(JSON.stringify(v)), /单价必须脱敏/);
});

// 测试辅助：同步读取夹具（测试目录下无其他 IO 需求，直接读 fs）。
import { readFileSync } from 'node:fs';
function require_fixture() {
  return JSON.parse(readFileSync(new URL('../fixtures/domain.json', import.meta.url), 'utf8'));
}
