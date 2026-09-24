/**
 * 数据字典接口封装（/api/dictionaries）。
 */
import type {
  Dictionary,
  DictionaryCategory,
  DictionaryCategoryOption,
  DictionaryItem,
  DictionaryItemBatchResult,
  DictionaryItemListResponse,
  DictionaryItemPayload,
  DictionaryItemUpdatePayload,
  DictionaryListResponse,
  DictionaryOptionsResponse,
  DictionaryPayload,
  DictionaryStatus,
  DictionaryUpdatePayload,
} from '#/types/med';

import { patchRequest } from '#/api/med/_utils';
import { requestClient } from '#/api/request';

export interface DictionaryQuery {
  category?: DictionaryCategory;
  keyword?: string;
  page?: number;
  pageSize?: number;
  status?: DictionaryStatus;
}

export interface DictionaryItemQuery {
  keyword?: string;
  page?: number;
  pageSize?: number;
  status?: DictionaryStatus;
}

/** 字典分类枚举（前端筛选器用） */
export function getDictionaryCategories() {
  return requestClient.get<DictionaryCategoryOption[]>(
    '/dictionaries/categories',
  );
}

/** 按编码取启用中的选项，供其它页面下拉复用 */
export function getDictionaryOptions(dictCode: string) {
  return requestClient.get<DictionaryOptionsResponse>(
    `/dictionaries/options/${encodeURIComponent(dictCode)}`,
  );
}

export function getDictionaries(query: DictionaryQuery = {}) {
  return requestClient.get<DictionaryListResponse>('/dictionaries', {
    params: {
      category: query.category,
      keyword: query.keyword,
      page: query.page,
      page_size: query.pageSize,
      status: query.status,
    },
  });
}

export function createDictionary(payload: DictionaryPayload) {
  return requestClient.post<Dictionary>('/dictionaries', payload);
}

export function updateDictionary(id: number, payload: DictionaryUpdatePayload) {
  return patchRequest<Dictionary>(`/dictionaries/${id}`, payload);
}

export function deleteDictionary(id: number) {
  return requestClient.delete<{ ok: boolean }>(`/dictionaries/${id}`);
}

export function getDictionaryItems(
  dictId: number,
  query: DictionaryItemQuery = {},
) {
  return requestClient.get<DictionaryItemListResponse>(
    `/dictionaries/${dictId}/items`,
    {
      params: {
        keyword: query.keyword,
        page: query.page,
        page_size: query.pageSize,
        status: query.status,
      },
    },
  );
}

export function createDictionaryItem(
  dictId: number,
  payload: DictionaryItemPayload,
) {
  return requestClient.post<DictionaryItem>(
    `/dictionaries/${dictId}/items`,
    payload,
  );
}

/** 批量导入：每行 `编码,显示名[,值]` */
export function batchCreateDictionaryItems(dictId: number, text: string) {
  return requestClient.post<DictionaryItemBatchResult>(
    `/dictionaries/${dictId}/items/batch`,
    { text },
  );
}

export function updateDictionaryItem(
  itemId: number,
  payload: DictionaryItemUpdatePayload,
) {
  return patchRequest<DictionaryItem>(`/dictionaries/items/${itemId}`, payload);
}

export function deleteDictionaryItem(itemId: number) {
  return requestClient.delete<{ ok: boolean }>(`/dictionaries/items/${itemId}`);
}
