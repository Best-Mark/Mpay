/**
 * 经营类目（与后端 BizCategory 保持一致）
 *
 * risky=true 的类目是支付机构风控重点：虚拟充值 / 预付费 / 游戏。
 * 这些必须单独进件、单独商户号 —— 与普通业务共号会连坐：
 * 一个号被风控，同号下所有项目同时断收。
 */
export const BIZ_CATEGORIES = [
  { value: 'general', label: '一般类(软件/技术服务)' },
  { value: 'retail', label: '实物电商' },
  { value: 'offline', label: '线下门店/本地生活' },
  { value: 'virtual', label: '虚拟充值', risky: true },
  { value: 'prepaid', label: '预付费/储值', risky: true },
  { value: 'game', label: '游戏', risky: true },
  { value: 'education', label: '教育/知识付费' },
  { value: 'content', label: '数字内容/文娱' },
];

/** 类目中文名（列表展示用） */
export function bizCategoryLabel(value) {
  if (!value) return '-';
  return BIZ_CATEGORIES.find((c) => c.value === value)?.label || value;
}

/** 是否高风险类目（UI 上标红提示） */
export function isRiskyCategory(value) {
  return !!BIZ_CATEGORIES.find((c) => c.value === value)?.risky;
}
