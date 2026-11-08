import type { GraphNode } from './types';

/** Left-hand company list groups. Order is the display order. */
export const CATEGORIES = [
  { id: 'labs', title: 'AI model companies', hint: 'Main payers for compute' },
  { id: 'hyperscalers', title: 'Hyperscalers', hint: 'Large cloud and platform companies' },
  { id: 'chips', title: 'Chipmakers', hint: 'Accelerators and networking' },
  { id: 'neoclouds', title: 'Neoclouds', hint: 'GPU cloud providers' },
  { id: 'developers', title: 'Data centre developers & landlords', hint: 'Build or own the sites' },
  { id: 'vehicles', title: 'SPVs & projects', hint: 'Financing vehicles, JVs and project facilities' },
  { id: 'capital', title: 'Investors, private credit & banks', hint: 'Equity, loans and bonds; * = aggregated, unnamed' },
] as const;
export type CategoryId = (typeof CATEGORIES)[number]['id'];

const BY_ID: Record<string, CategoryId> = {
  OpenAI: 'labs', Anthropic: 'labs', 'Anthropic（最终归因待证）': 'labs', Mistral: 'labs', 'SpaceX.AI': 'labs', '未具名/多客户（汇总）': 'labs',
  Microsoft: 'hyperscalers', Amazon: 'hyperscalers', Google: 'hyperscalers', Meta: 'hyperscalers', Oracle: 'hyperscalers',
  NVIDIA: 'chips', AMD: 'chips', Broadcom: 'chips',
  CoreWeave: 'neoclouds', Nebius: 'neoclouds', Lambda: 'neoclouds', Nscale: 'neoclouds', Firmus: 'neoclouds', Fluidstack: 'neoclouds', Crusoe: 'neoclouds', IREN: 'neoclouds',
  TeraWulf: 'developers', Cipher: 'developers', 'Applied Digital': 'developers', 'Hut 8': 'developers', Vantage: 'developers', Nexus: 'developers',
  'Meridian Arc': 'developers', Stargate: 'developers', 'Related / Blackstone平台': 'developers', 'Crusoe / Blue Owl平台': 'developers',
  'QTS / Blackstone平台': 'developers', 'Blue Owl管理平台': 'developers',
  'AI XPV': 'vehicles', '新Broadcom-Anthropic SPV': 'vehicles', 'Hyperion JV': 'vehicles', 'El Paso结构': 'vehicles', 'Abernathy项目': 'vehicles', 'SpaceX / Valor': 'vehicles',
  'Apollo管理基金及关联方': 'capital', 'Blackstone管理基金及相关资金方': 'capital', 'Blue Owl管理基金': 'capital', BofA: 'capital', Citi: 'capital', 'Morgan Stanley': 'capital',
  SoftBank: 'capital', MGX: 'capital',
};

/** Category for a node: explicit mapping first, then by kind (projects → vehicles, aggregated funders → capital). */
export function categoryOf(n: Pick<GraphNode, 'id' | 'kind'>): CategoryId {
  if (BY_ID[n.id]) return BY_ID[n.id];
  if (n.kind === 'project') return 'vehicles';
  if (n.kind === 'funding_category' || /（汇总）$/.test(n.id)) return 'capital';
  return 'vehicles';
}
