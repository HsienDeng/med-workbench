import type { RouteRecordRaw } from 'vue-router';

/**
 * med 工作台业务路由（frontend 访问模式）
 *
 * 菜单可见性由 meta.authority（med 后端权限码，见 permission_service.PERMISSION_CATALOG）
 * 与用户权限点（getUserInfoApi 返回的 UserInfo.roles）匹配决定；
 * 按钮级权限使用 v-access:code 指令 + accessCodes。
 */
const routes: RouteRecordRaw[] = [
  {
    // 临床工作台
    meta: {
      icon: 'mdi:robot-outline',
      order: 100,
      title: '临床工作台',
    },
    name: 'MedClinical',
    path: '/clinical',
    redirect: '/assistant',
    children: [
      {
        component: () => import('#/views/med/assistant/index.vue'),
        meta: {
          hideChildrenInMenu: true,
          icon: 'mdi:chat-processing-outline',
          keepAlive: true,
          title: 'AI 助手',
        },
        name: 'MedAssistant',
        path: '/assistant',
      },
    ],
  },
  {
    // 业务管理
    meta: {
      icon: 'mdi:briefcase-outline',
      order: 200,
      title: '业务管理',
    },
    name: 'MedBusiness',
    path: '/business',
    redirect: '/patients',
    children: [
      {
        component: () => import('#/views/med/patients/index.vue'),
        meta: {
          authority: ['patient:view'],
          icon: 'mdi:account-group-outline',
          keepAlive: true,
          title: '患者档案',
        },
        name: 'MedPatients',
        path: '/patients',
      },
      {
        component: () => import('#/views/med/documents/index.vue'),
        meta: {
          authority: ['knowledge:view'],
          icon: 'mdi:folder-open-outline',
          keepAlive: true,
          title: '文档管理',
        },
        name: 'MedDocuments',
        path: '/documents',
      },
      {
        component: () => import('#/views/med/prompts/index.vue'),
        meta: {
          icon: 'mdi:text-box-edit-outline',
          keepAlive: true,
          title: '提示词管理',
        },
        name: 'MedPrompts',
        path: '/prompts',
      },
    ],
  },
  {
    // 系统管理
    meta: {
      icon: 'mdi:cog-outline',
      order: 300,
      title: '系统管理',
    },
    name: 'MedSystem',
    path: '/system',
    redirect: '/dictionaries',
    children: [
      {
        component: () => import('#/views/med/dictionaries/index.vue'),
        meta: {
          authority: ['dictionary:view'],
          icon: 'mdi:book-open-variant',
          title: '字典管理',
        },
        name: 'MedDictionaries',
        path: '/dictionaries',
      },
      {
        component: () => import('#/views/med/accounts/index.vue'),
        meta: {
          authority: ['organization:user:view'],
          icon: 'mdi:account-key-outline',
          title: '账号管理',
        },
        name: 'MedAccounts',
        path: '/accounts',
      },
      {
        component: () => import('#/views/med/permissions/index.vue'),
        meta: {
          authority: ['organization:role:view'],
          icon: 'mdi:shield-account-outline',
          title: '权限管理',
        },
        name: 'MedPermissions',
        path: '/permissions',
      },
      {
        component: () => import('#/views/med/audit/index.vue'),
        meta: {
          authority: ['audit:view'],
          icon: 'mdi:file-document-check-outline',
          title: '审计日志',
        },
        name: 'MedAudit',
        path: '/audit',
      },
    ],
  },
];

export default routes;
