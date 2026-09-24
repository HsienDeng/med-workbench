/**
 * Markdown 渲染工具（迁移自 med-work-frontend XMarkdown）：
 * 基于 markdown-it 解析，highlight.js 处理代码块高亮，
 * 在此之上做两件事：
 *   1. 「归一化」模型输出，去掉中文字符之间的多余空白、还原被压平的列表项，
 *      避免 "你 好 ！"、"** 加粗" 因换行丢失而原样显示；
 *   2. 代码块 fence 默认带语言提示，缺省标为 text 以便 highlight.js 兜底。
 */
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';

/** 代码兜底转义（避免引用 md 造成类型循环推导） */
function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (char) =>
      ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[char] ?? char,
  );
}

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  typographer: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const result = hljs.highlight(code, { ignoreIllegals: true, language: lang });
        return `<pre class="hljs"><code class="language-${lang}">${result.value}</code></pre>`;
      } catch {
        /* 语言识别失败时走自动高亮 */
      }
    }
    try {
      const result = hljs.highlightAuto(code);
      return `<pre class="hljs"><code>${result.value}</code></pre>`;
    } catch {
      return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
    }
  },
});

/** 给所有链接自动加 target=_blank，避免占用工作台 */
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (!token) return defaultLinkOpen(tokens, idx, options, env, self);
  const hrefIndex = token.attrIndex('href');
  const href = hrefIndex >= 0 ? String(token.attrs?.[hrefIndex]?.[1] ?? '') : '';
  if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

const CJK_CHAR = '[\\u4e00-\\u9fff\\u3000-\\u303f\\uff01-\\uff5e]';

/**
 * 归一化模型输出后再交给 markdown-it 渲染。
 *
 * 部分模型/网关会在中文 token 之间带出空格、把换行压成空格，导致：
 *   1. 「你 好 ！」式的字间空白；
 *   2. Markdown 列表（"- "）、加粗（**）因失去换行/行首而解析失效，原样显示。
 *
 * 处理（``` 围栏内的代码块保持原样）：
 *   - 「句末标点 + 空白 + "- "」→ 换行 + "- "，恢复被压平的列表；
 *   - 去掉中文字符之间的空格与换行。
 */
export function normalizeModelText(raw: string): string {
  return raw
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(
          new RegExp(`([。；！：])[ \\t\\r\\n]+-(?=[ \\t*\\u4e00-\\u9fff])`, 'g'),
          '$1\n- ',
        )
        .replace(
          new RegExp(`(?<=${CJK_CHAR})[ \\t\\r\\n]+(?=${CJK_CHAR})`, 'g'),
          '',
        );
    })
    .join('');
}

export function renderMarkdown(raw: string): string {
  return md.render(normalizeModelText(raw ?? ''));
}
