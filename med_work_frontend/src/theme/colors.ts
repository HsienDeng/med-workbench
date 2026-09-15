/**
 * 设计令牌：色板
 */
export const colors = {
  primary: '#2D6CDF',
  primaryHover: '#2458BD',
  primaryLight: '#EBF2FC',
  primaryBorder: '#B8CCEF',
  ai: '#0FA595',
  aiLight: '#E6F7F5',
  aiDark: '#0B7A70',
  purple: '#8B5CF6',
  purpleLight: '#F1EBFE',
  warning: '#F59E0B',
  warningLight: '#FFF7E8',
  error: '#EF4444',
  errorLight: '#FDECEC',
  success: '#16A34A',
  successLight: '#E8F8EF',
  info: '#0EA5E9',
  infoLight: '#E6F6FE',
  text: '#1B2537',
  textSecondary: '#3E4B63',
  textMuted: '#98A3B8',
  border: '#E6EAF1',
  bg: '#F5F7FB',
  bgSecondary: '#F8FAFC',
  chart1: '#2D6CDF',
  chart2: '#0FA595',
  chart3: '#8B5CF6',
  chart4: '#F59E0B',
  chart5: '#EF4444',
  chart6: '#0EA5E9',
} as const;

export type ColorKey = keyof typeof colors;
