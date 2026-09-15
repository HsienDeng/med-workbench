import { useEffect, useMemo, useRef, useState } from 'react';
import { getDictionaryOptions } from '@/services/api';
import type { DictOptionItem } from '@/constants/dictionary';

export interface DictionaryOptionsResult {
  /** 选项列表（label/value），供 Select 等下拉复用 */
  options: DictOptionItem[];
  /** value → label 映射，供 Tag / 表格展示复用 */
  labels: Record<string, string>;
  loading: boolean;
}

/**
 * 从数据字典服务加载指定字典的启用选项。
 * @param dictCode 字典编码，如 doc_type / index_status / source_type
 * @param fallback 字典不可用或尚未加载时的兜底选项（避免页面空下拉）
 */
export function useDictionaryOptions(dictCode: string, fallback: DictOptionItem[] = []): DictionaryOptionsResult {
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const [options, setOptions] = useState<DictOptionItem[]>(fallback);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getDictionaryOptions(dictCode)
      .then((res) => {
        if (alive) {
          setOptions(res.options.map((o) => ({ label: o.label, value: o.value })));
        }
      })
      .catch(() => {
        if (alive) {
          setOptions(fallbackRef.current);
        }
      })
      .finally(() => {
        if (alive) {
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [dictCode]);

  const labels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of options) map[o.value] = o.label;
    return map;
  }, [options]);

  return { options, labels, loading };
}
