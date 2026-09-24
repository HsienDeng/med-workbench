import { defineConfig } from '@vben/vite-config';

// 说明：Element Plus 组件在 src/bootstrap.ts 中全量注册（app.use(ElementPlus)），
// 样式由 `element-plus/dist/index.css` 整体引入，因此不再需要 unplugin-element-plus 按需注入样式。
export default defineConfig(async () => {
  return {
    application: {},
    vite: {
      plugins: [],
      server: {
        proxy: {
          '/api': {
            changeOrigin: true,
            // med_work_backend (FastAPI)，路由自带 /api 前缀，不做 rewrite
            target: 'http://localhost:8001',
            ws: true,
          },
        },
      },
    },
  };
});
