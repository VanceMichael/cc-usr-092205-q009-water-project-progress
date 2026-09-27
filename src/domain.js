// 读取并检查项目共享的领域资料。
// 资料约定见 contracts/domain.schema.json；此处用零依赖方式做关键不变量校验，
// 保证不引入 JSON Schema 运行时依赖也能在测试与 CI 中拦截结构错误。

const ACTOR_IDS = ['contractor', 'supervisor', 'finance'];
const EVIDENCE_IDS = [
  'approved_estimate',
  'contract_boq',
  'beidou_vehicle_log',
  'supervisor_measurement',
  'site_imagery',
  'design_change',
  'payment_voucher',
];
const REVIEW_KEYS = [
  'fund_physical_deviation',
  'critical_path',
  'responsible_section',
  'recoverable_quantity',
];

function fail(message) {
  throw new Error(message);
}

function checkArray(value, key, min) {
  if (!Array.isArray(value) || value.length < min) {
    fail(`共享资料字段 ${key} 必须为至少 ${min} 项的数组`);
  }
}

export function parseDomain(raw) {
  const value = JSON.parse(raw);

  for (const key of ['domain', 'version', 'sample_id']) {
    if (!value[key]) fail(`共享资料缺少必要字段 ${key}`);
  }
  if (typeof value.version !== 'number' || value.version < 2) {
    fail('共享资料 version 必须为不小于 2 的整数');
  }
  for (const key of ['segregation_rule']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) {
      fail(`共享资料字段 ${key} 必须为非空字符串`);
    }
  }
  checkArray(value.actors, 'actors', 3);
  checkArray(value.facts, 'facts', 2);
  checkArray(value.constraints, 'constraints', 2);
  checkArray(value.evidence_chain, 'evidence_chain', 7);
  checkArray(value.excluded_from_reconfirmation, 'excluded_from_reconfirmation', 3);
  checkArray(value.public_redaction, 'public_redaction', 1);
  checkArray(value.milestones, 'milestones', 1);
  checkArray(value.monthly_review_required, 'monthly_review_required', 4);

  // 角色分权：三类角色齐全且互不代签。
  const actorIds = value.actors.map((a) => {
    if (!a.id || !a.name || !a.commits || !Array.isArray(a.may_not) || a.may_not.length === 0) {
      fail('每个角色必须包含 id、name、commits 和至少一条 may_not 约束');
    }
    return a.id;
  });
  for (const id of ACTOR_IDS) {
    if (!actorIds.includes(id)) fail(`缺少必需角色：${id}`);
  }
  if (new Set(actorIds).size !== actorIds.length) fail('角色不得重复');

  // 七类证据链齐全，彼此对应。
  const evidenceIds = value.evidence_chain.map((e) => {
    if (!e.id || !e.name || !e.confirms) fail('证据链条目必须包含 id、name、confirms');
    return e.id;
  });
  for (const id of EVIDENCE_IDS) {
    if (!evidenceIds.includes(id)) fail(`缺少证据链环节：${id}`);
  }

  // 月结四要素齐全。
  const reviewKeys = value.monthly_review_required.map((r) => {
    if (!r.key || !r.name || !r.states) fail('月结要素必须包含 key、name、states');
    return r.key;
  });
  for (const key of REVIEW_KEYS) {
    if (!reviewKeys.includes(key)) fail(`月结缺少必备要素：${key}`);
  }

  // 进度组织口径：施工段、工程量；付款额不得作为完成量。
  const basis = value.progress_basis;
  if (!basis || !basis.organize_by?.includes('施工段') || !basis.organize_by?.includes('工程量')) {
    fail('进度必须按施工段和工程量组织');
  }
  if (!basis.must_not_use_as_completion?.some((x) => x.includes('付款'))) {
    fail('必须明确付款额不得代替完成量');
  }

  // 关键节点日期格式 MM-DD。
  for (const m of value.milestones) {
    if (!/^\d{2}-\d{2}$/.test(m.deadline)) fail(`节点 ${m.id} 日期必须为 MM-DD`);
  }

  validateMonthlyReport(value.sample_monthly_report);

  return value;
}

// 校验样例月报：资金与实物量分账、跨标段调拨只计一次、返工剔除、单价脱敏。
function validateMonthlyReport(report) {
  if (!report || !Array.isArray(report.sections) || report.sections.length === 0) return;

  let transferredOut = 0;
  let transferredIn = 0;
  let anyCriticalOffTrack = false;

  for (const s of report.sections) {
    if (!s.section_id) fail('月报施工段缺少 section_id');
    const qty = s.boq_items ?? [];
    if (qty.length === 0) fail(`标段 ${s.section_id} 缺少合同清单工程量`);

    for (const item of qty) {
      if (item.supervisor_confirmed_qty > item.planned_qty) {
        fail(`标段 ${s.section_id} 子目 ${item.item_code} 确认量超过计划量`);
      }
      if (item.unit_price !== 'REDACTED_IN_PUBLIC') {
        fail(`标段 ${s.section_id} 子目 ${item.item_code} 公开版单价必须脱敏`);
      }
    }

    const funds = s.funds ?? {};
    if (funds.payment_not_completion !== true) {
      fail(`标段 ${s.section_id} 必须声明付款不等于完成量`);
    }

    transferredOut += s.materials_transferred_out_qty ?? 0;
    transferredIn += s.materials_transferred_in_qty ?? 0;
    if ((s.rework_qty_excluded ?? 0) < 0 || (s.late_visa_pending ?? 0) < 0) {
      fail(`标段 ${s.section_id} 返工量与待处理签证数不得为负`);
    }

    const confirmed = qty.reduce((sum, i) => sum + i.supervisor_confirmed_qty, 0);
    const planned = qty.reduce((sum, i) => sum + i.planned_qty, 0);
    if (s.remaining_qty !== planned - confirmed) {
      fail(`标段 ${s.section_id} 剩余工程量须等于计划量减监理确认量`);
    }
    if (s.critical_path_to && s.on_track_for_milestone === false) anyCriticalOffTrack = true;
  }

  if (transferredOut !== transferredIn) {
    fail(`跨标段调拨不平：调出 ${transferredOut}，调入 ${transferredIn}`);
  }
  if (!report.note || !report.note.includes('示意')) {
    fail('样例月报须注明金额与工程量为示意值');
  }

  return { anyCriticalOffTrack };
}

// 计算月结资金—实物量偏差：预付款不构成完成量对应的应支付进度款。
export function summarizeMonthlyReport(report) {
  if (!report) return null;
  return report.sections.map((s) => {
    const confirmed = (s.boq_items ?? []).reduce((sum, i) => sum + i.supervisor_confirmed_qty, 0);
    const planned = (s.boq_items ?? []).reduce((sum, i) => sum + i.planned_qty, 0);
    const funds = s.funds ?? {};
    return {
      section_id: s.section_id,
      confirmed_qty: confirmed,
      remaining_qty: planned - confirmed,
      prepayment_paid: funds.prepayment_paid ?? 0,
      progress_payment_approved: funds.progress_payment_approved ?? 0,
      on_track: s.on_track_for_milestone !== false,
      recoverable_next_period_qty: s.recoverable_next_period_qty ?? 0,
    };
  });
}
