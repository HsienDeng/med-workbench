/**
 * 主题配置：统一入口
 */
import type { ThemeConfig } from 'antd';
import { colors } from './colors';

export { colors } from './colors';
export type { ColorKey } from './colors';

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: colors.primary,
    colorInfo: colors.primary,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,
    colorText: colors.text,
    colorTextSecondary: colors.textSecondary,
    colorTextTertiary: colors.textMuted,
    colorBorder: colors.border,
    colorBorderSecondary: colors.border,
    colorBgLayout: colors.bg,
    colorBgContainer: '#FFFFFF',
    borderRadius: 8,
    borderRadiusLG: 12,
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    controlHeight: 36,
  },
  components: {
    Layout: {
      siderBg: '#FFFFFF',
      headerBg: '#FFFFFF',
      bodyBg: colors.bg,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: colors.primaryLight,
      itemSelectedColor: colors.primary,
      itemColor: colors.textSecondary,
      itemHoverColor: colors.text,
      itemHeight: 38,
      itemMarginInline: 8,
      itemBorderRadius: 8,
    },
    Table: {
      headerBg: colors.bgSecondary,
      headerColor: colors.textSecondary,
      headerSplitColor: 'transparent',
      rowHoverBg: '#F7F9FC',
    },
    Card: {
      paddingLG: 20,
    },
    Tabs: {
      inkBarColor: colors.primary,
      itemSelectedColor: colors.primary,
      itemColor: colors.textSecondary,
      titleFontSize: 14,
    },
    Button: {
      fontWeight: 500,
    },
    Tag: {
      borderRadiusSM: 6,
    },
  },
};
