/** med_work_backend 用户信息（/api/auth/me、登录响应中的 user 字段） */

export interface MedRoleOut {
  role_code: string;
  role_name: string;
  data_scope: string;
}

export interface MedUserOut {
  id: number;
  username: string;
  real_name: string;
  status: string;
  roles: MedRoleOut[];
  /** 功能权限点编码集合（由角色授权派生） */
  permissions: string[];
}
