/**
 * 通用工具函数
 */

/** 拼接 className，过滤 falsy 值 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** 数字千分位格式化 */
export function formatNumber(value: number | string): string {
  return Number(value).toLocaleString('zh-CN');
}
