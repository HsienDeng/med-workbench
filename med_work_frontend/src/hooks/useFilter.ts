import { useMemo, useState } from 'react';

/**
 * 列表关键词过滤 Hook
 * @param data 原始数据
 * @param predicate 过滤谓词 (item, keyword) => boolean
 */
export function useFilter<T>(data: T[], predicate: (item: T, keyword: string) => boolean) {
  const [keyword, setKeyword] = useState('');

  const filtered = useMemo(() => {
    const kw = keyword.trim();
    if (!kw) return data;
    return data.filter((item) => predicate(item, kw));
  }, [data, keyword, predicate]);

  return { keyword, setKeyword, filtered };
}
