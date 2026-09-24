import type { MaybeRefOrGetter, Ref } from 'vue';

import { computed, ref, toValue, watchEffect } from 'vue';

import { getDictionaryOptions } from '#/api/med/dictionaries';
import type { DictOptionItem } from '#/constants/med/dictionary';

export interface DictionaryOptionsResult {
  /** 选项列表（label/value），供 Select 等下拉复用 */
  options: Ref<DictOptionItem[]>;
  /** value → label 映射，供 Tag / 表格展示复用 */
  labels: Ref<Record<string, string>>;
  loading: Ref<boolean>;
}

/**
 * 从数据字典服务加载指定字典的启用选项。
 *
 * - dictCode 支持传字符串或 ref / getter（响应式变化时自动重新加载）；
 * - 请求失败或字典不可用时回退到 fallback，避免页面空下拉；
 * - 组件卸载（或 dictCode 变化触发 effect 重跑）后，旧请求返回不再更新状态。
 *
 * @param dictCode 字典编码，如 doc_type / index_status / source_type
 * @param fallback 字典不可用或尚未加载时的兜底选项
 */
export function useDictionaryOptions(
  dictCode: MaybeRefOrGetter<string>,
  fallback: DictOptionItem[] = [],
): DictionaryOptionsResult {
  const options = ref<DictOptionItem[]>([...fallback]) as Ref<DictOptionItem[]>;
  const loading = ref(false);

  watchEffect(async (onCleanup) => {
    let alive = true;
    onCleanup(() => {
      alive = false;
    });

    loading.value = true;
    try {
      const res = await getDictionaryOptions(toValue(dictCode));
      if (!alive) return;
      options.value = res.options.map((o) => ({
        label: o.label,
        value: o.value,
      }));
    } catch {
      if (!alive) return;
      options.value = [...fallback];
    } finally {
      if (alive) {
        loading.value = false;
      }
    }
  });

  const labels = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const o of options.value) {
      map[o.value] = o.label;
    }
    return map;
  });

  return { labels, loading, options };
}
