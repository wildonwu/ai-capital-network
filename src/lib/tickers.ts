import type { GraphNode } from './types';

/**
 * Exchange tickers for listed companies (fund and platform nodes use the listed manager's ticker).
 * Private companies keep their names. Edit here when a company lists or a mapping is wrong.
 */
export const TICKERS: Record<string, string> = {
  NVIDIA: 'NVDA', AMD: 'AMD', Broadcom: 'AVGO',
  Microsoft: 'MSFT', Google: 'GOOGL', Amazon: 'AMZN', Meta: 'META', Oracle: 'ORCL',
  CoreWeave: 'CRWV', Nebius: 'NBIS', IREN: 'IREN',
  TeraWulf: 'WULF', Cipher: 'CIFR', 'Applied Digital': 'APLD', 'Hut 8': 'HUT',
  SoftBank: '9984.T', BofA: 'BAC', Citi: 'C', 'Morgan Stanley': 'MS',
  'SpaceX.AI': 'SPCX (xAI)', 'SpaceX / Valor': 'SPCX / Valor',
  'Blackstone管理基金及相关资金方': 'BX funds', 'Apollo管理基金及关联方': 'APO funds', 'Blue Owl管理基金': 'OWL funds',
  'Blue Owl管理平台': 'OWL platform', 'Related / Blackstone平台': 'Related / BX', 'QTS / Blackstone平台': 'QTS / BX', 'Crusoe / Blue Owl平台': 'Crusoe / OWL',
};

/** Company names that appear inside project labels, replaced by their tickers. Longest first. */
const IN_LABEL: [RegExp, string][] = [
  ['Applied Digital', 'APLD'], ['Blue Owl', 'OWL'], ['Blackstone', 'BX'], ['CoreWeave', 'CRWV'], ['Microsoft', 'MSFT'],
  ['TeraWulf', 'WULF'], ['Broadcom', 'AVGO'], ['Nebius', 'NBIS'], ['Cipher', 'CIFR'], ['Apollo', 'APO'], ['Hut 8', 'HUT'], ['Meta', 'META'],
].map(([n, t]) => [new RegExp(`\\b${n}\\b`, 'g'), t] as [RegExp, string]);

export function tickerize(label: string): string {
  return IN_LABEL.reduce((s, [re, t]) => s.replace(re, t), label);
}

/** Short display name: ticker for listed companies, otherwise the English label with tickers substituted. */
export function shortName(n: Pick<GraphNode, 'id' | 'label_en'> | undefined, id?: string): string {
  if (!n) return id ?? '';
  return TICKERS[n.id] ?? tickerize(n.label_en.replace(/\n.*/s, ''));
}
