<script lang="ts" setup>
/**
 * 本地文档上传弹窗：单次仅上传一个文件，含标题/类型/子类型/来源/备注元信息。
 * 迁移自 med-work-frontend UploadDocumentModal。
 */
import { reactive, ref, watch } from 'vue';

import { ElMessage } from 'element-plus';
import {
  Document as DocumentIcon,
  FolderAdd,
  MagicStick,
} from '@element-plus/icons-vue';

import { uploadDocumentApi } from '#/api/med/documents';
import {
  DICT_DOC_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
} from '#/constants/med/dictionary';
import { useDictionaryOptions } from '#/hooks/use-dictionary-options';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const props = defineProps<Props>();

const { options: docTypeOptions } = useDictionaryOptions(
  DICT_DOC_TYPE,
  FALLBACK_DOC_TYPE_OPTIONS,
);

const form = reactive<{
  doc_type: string;
  file: File | null;
  remark: string;
  source: string;
  sub_type: string;
  title: string;
}>({
  doc_type: 'guide',
  file: null,
  remark: '',
  source: '',
  sub_type: '',
  title: '',
});

const submitting = ref(false);
const formRef = ref();

const ALLOWED_EXT = [
  '.pdf', '.docx', '.doc', '.txt', '.md', '.markdown',
  '.html', '.htm', '.xlsx', '.xls', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.bmp', '.webp',
];

function reset() {
  form.doc_type = 'guide';
  form.file = null;
  form.remark = '';
  form.source = '';
  form.sub_type = '';
  form.title = '';
  formRef.value?.clearValidate();
}

watch(
  () => props.open,
  (v) => {
    if (v) reset();
  },
);

function onFileChange(file: { raw?: File }) {
  if (!file?.raw) return;
  const name = file.raw.name;
  if (!ALLOWED_EXT.some((ext) => name.toLowerCase().endsWith(ext))) {
    ElMessage.error('不支持的文件类型：' + name);
    form.file = null;
    return;
  }
  form.file = file.raw;
  if (!form.title) form.title = name.replace(/\.[^.]+$/, '');
}

async function handleSubmit() {
  if (!form.file) {
    ElMessage.warning('请选择要上传的文件');
    return;
  }
  submitting.value = true;
  try {
    const res = await uploadDocumentApi({
      doc_type: form.doc_type,
      file: form.file,
      remark: form.remark.trim() || undefined,
      source: form.source.trim() || undefined,
      sub_type: form.sub_type || undefined,
      title: form.title.trim() || undefined,
    });
    ElMessage.success(res.message || '文档已加入上传任务');
    props.onSuccess();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="open"
    title="上传文档到本地知识库"
    :width="520"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="(v: boolean) => !v && onClose()"
  >
    <el-form
      ref="formRef"
      :model="form"
      label-position="top"
      @submit.prevent
    >
      <el-form-item label="文档文件">
        <el-upload
          class="med-doc-upload"
          drag
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onFileChange"
          :accept="ALLOWED_EXT.join(',')"
        >
          <div v-if="!form.file" class="med-doc-upload-empty">
            <el-icon class="med-doc-upload-icon" style="color: var(--el-color-primary)">
              <FolderAdd />
            </el-icon>
            <div class="med-doc-upload-title">点击或拖拽文件到此处</div>
            <div class="med-doc-upload-sub">
              支持 PDF / Word / PPT / Excel / Markdown / HTML / 图片 等
            </div>
          </div>
          <div v-else class="med-doc-upload-filled">
            <el-icon class="med-doc-upload-icon" style="color: var(--el-color-primary)">
              <DocumentIcon />
            </el-icon>
            <div class="med-doc-upload-meta">
              <div class="med-doc-upload-name">{{ form.file.name }}</div>
              <div class="med-doc-upload-sub">
                {{ (form.file.size / 1024).toFixed(1) }} KB
              </div>
            </div>
            <span class="med-doc-upload-cta">点击替换 →</span>
          </div>
        </el-upload>
      </el-form-item>

      <el-form-item label="文档标题">
        <el-input
          v-model="form.title"
          placeholder="选填，默认使用文件名（不含扩展名）"
          :maxlength="255"
        />
      </el-form-item>

      <el-form-item label="文档类型">
        <el-select v-model="form.doc_type" placeholder="请选择文档类型" style="width: 100%">
          <el-option
            v-for="o in docTypeOptions"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="子类型">
        <el-input
          v-model="form.sub_type"
          placeholder="选填，进一步细分（如有）"
          :maxlength="64"
        />
      </el-form-item>

      <el-form-item label="来源">
        <el-input
          v-model="form.source"
          placeholder="选填，如：腾讯IMA / 协和指南 / 科室投稿"
          :maxlength="64"
        />
      </el-form-item>

      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          placeholder="选填，对该文档的补充说明"
          :maxlength="500"
        />
      </el-form-item>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="上传后自动进入「上传任务」异步处理：解析 → 文本分块 → bge 向量化 → Qdrant 索引"
      />
    </el-form>
    <template #footer>
      <el-button @click="onClose">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :icon="MagicStick"
        @click="handleSubmit"
      >
        开始上传
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.med-doc-upload :deep(.el-upload) {
  width: 100%;
}

.med-doc-upload :deep(.el-upload-dragger) {
  padding: 18px 16px;
  border-radius: 10px;
  border-style: dashed;
}

.med-doc-upload-empty,
.med-doc-upload-filled {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.med-doc-upload-filled {
  flex-direction: row;
  align-items: center;
  text-align: left;
  gap: 12px;
}

.med-doc-upload-icon {
  font-size: 28px;
}

.med-doc-upload-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--el-color-primary);
}

.med-doc-upload-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.med-doc-upload-meta {
  flex: 1;
  min-width: 0;
}

.med-doc-upload-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.med-doc-upload-cta {
  color: var(--el-color-primary);
  font-size: 12.5px;
  font-weight: 600;
  flex-shrink: 0;
}
</style>
