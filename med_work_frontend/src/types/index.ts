/**
 * 全局类型定义
 */

// ==================== 认证 ====================
/** 角色信息 */
export interface AuthRole {
  role_code: string;
  role_name: string;
  data_scope: string;
}

/** 登录用户信息（对接后端 /api/auth/login 返回） */
export interface AuthUser {
  id: number;
  username: string;
  real_name: string;
  status: string;
  roles: AuthRole[];
  /** 功能权限点编码集合（由角色授权派生，登录/me 下发；旧会话缓存可能缺省） */
  permissions?: string[];
}

/** 登录成功返回结构 */
export interface AuthResponse {
  token: string;
  user: AuthUser;
}

/** 登录参数 */
export interface LoginPayload {
  account: string;
  password: string;
}

/** 注册参数 */
export interface RegisterPayload {
  name: string;
  account: string;
  password: string;
}

/** 后端动态菜单节点（后端 /api/auth/menus 扁平列表已保证父节点先出现） */
export interface DynamicMenu {
  id: number;
  key: string;
  routeKey?: string | null;
  parentKey?: string | null;
  title: string;
  icon?: string | null;
  badge?: string | null;
  collapsible?: boolean;
  phase2: boolean;
  sortOrder: number;
}

/** 动态菜单接口响应 */
export interface MenuListResponse {
  items: DynamicMenu[];
}

// ==================== 路由 ====================
export type PageKey =
  | 'dashboard'
  | 'analysis'
  | 'patients'
  | 'documents'
  | 'wxGroups'
  | 'assistant'
  | 'entities'
  | 'retrieval'
  | 'dictionaries'
  | 'accounts'
  | 'permissions'
  | 'audit'
  | 'ai-connections';

// ==================== AI 供应商配置 ====================
export type ApiConnectionStatus = 'connected' | 'ready' | 'testing' | 'error' | 'disabled';

export type AiProtocol = 'openai' | 'anthropic';

/** 旧 /api/ai/connections 投影（Assistant 模型下拉在用，保留兼容）。 */
export interface AIConnectionResponse {
  id: string;
  provider: string;
  name: string;
  protocol: string;
  base_url: string;
  active_model: string;
  models: string[];
  status: ApiConnectionStatus;
  enabled: boolean;
  has_api_key: boolean;
}

/** /api/ai/providers 列表项（不含明文凭据）。 */
export interface AiProviderItem {
  id: number;
  provider: string;
  display_name: string;
  protocol: AiProtocol;
  base_url: string;
  default_model: string;
  cached_models: string[];
  is_active: boolean;
  status: 'active' | 'disabled';
  sort_order: number;
  has_api_key: boolean;
  api_key_last4: string | null;
}

export interface AiProviderCreateInput {
  provider: string;
  display_name: string;
  protocol: AiProtocol;
  base_url: string;
  api_key?: string;
  default_model?: string;
  sort_order?: number;
}

/** 全字段可选；api_key 为 null 表示保持原值。 */
export interface AiProviderUpdateInput {
  display_name?: string;
  protocol?: AiProtocol;
  base_url?: string;
  api_key?: string | null;
  default_model?: string;
  sort_order?: number;
  status?: 'active' | 'disabled';
}

export interface AiProviderProbeResult {
  provider: string;
  ok: boolean;
  latency_ms: number | null;
  models: string[];
  error: string | null;
}

export interface ActiveAIProviderResponse {
  active_provider: string;
}

// ==================== 数据字典 ====================
/** 字典分类 */
export type DictionaryCategory = 'clinical' | 'lab' | 'coding' | 'business';
/** 启用状态（字典与字典项通用） */
export type DictionaryStatus = 'active' | 'disabled';

/** 字典（对接 /api/dictionaries） */
export interface Dictionary {
  id: number;
  hospital_id: number;
  dict_code: string;
  dict_name: string;
  category: DictionaryCategory;
  description: string | null;
  status: DictionaryStatus;
  builtin: boolean;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** 字典项数量（列表接口附加，非表字段） */
  item_count: number;
}

/** 字典分页列表响应 */
export interface DictionaryListResponse {
  items: Dictionary[];
  total: number;
  page: number;
  page_size: number;
}

/** 新建/更新字典参数 */
export interface DictionaryPayload {
  dict_code: string;
  dict_name: string;
  category: DictionaryCategory;
  description?: string | null;
  status: DictionaryStatus;
  sort_order: number;
}

export type DictionaryUpdatePayload = Partial<DictionaryPayload>;

/** 字典项（对接 /api/dictionaries/{id}/items） */
export interface DictionaryItem {
  id: number;
  dictionary_id: number;
  item_code: string;
  item_label: string;
  item_value: string | null;
  sort_order: number;
  status: DictionaryStatus;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

/** 字典项分页列表响应 */
export interface DictionaryItemListResponse {
  items: DictionaryItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 新建字典项参数 */
export interface DictionaryItemPayload {
  item_code: string;
  item_label: string;
  item_value?: string | null;
  sort_order: number;
  status: DictionaryStatus;
  remark?: string | null;
}

export type DictionaryItemUpdatePayload = Partial<DictionaryItemPayload>;

/** 批量导入结果 */
export interface DictionaryItemBatchResult {
  ok: boolean;
  created: number;
}

/** 下拉选项（对接 /api/dictionaries/options/{code}） */
export interface DictionaryOption {
  code: string;
  label: string;
  value: string;
}

export interface DictionaryOptionsResponse {
  dict_code: string;
  dict_name: string;
  options: DictionaryOption[];
}

/** 分类枚举项（对接 /api/dictionaries/categories） */
export interface DictionaryCategoryOption {
  value: DictionaryCategory;
  label: string;
}

// ==================== 业务状态 ====================
/** 任务状态 */
export type TaskStatus = 'review' | 'running' | 'done' | 'failed' | 'pending';
/** 患者状态 */
export type PatientStatus = 'in' | 'out';
/** 状态键（组件通用） */
export type StatusKey = TaskStatus | PatientStatus;

// ==================== 工作台 ====================
export interface KpiItem {
  label: string;
  value: string;
  unit?: string;
  trend?: string;
  trendDir?: 'up' | 'down' | '';
  desc?: string;
  icon?: string;
  iconColor?: string;
}

// ==================== AI 病历分析 ====================
export interface PatientInfo {
  name: string;
  gender: string;
  age: number;
  id: string;
  chiefComplaint: string;
  admission: string;
  dept: string;
  doctor: string;
  allergy: string;
  history: string[];
}

export interface LabMetric {
  label: string;
  value: string;
  unit: string;
  trend: string;
  level: 'critical' | 'warn' | 'ok';
  ref: string;
}

export interface AiConclusion {
  model: string;
  version: string;
  confidence: number;
  time: string;
  summary: string;
  suggestion: string;
}

export interface DiagnosisItem {
  code: string;
  name: string;
  conf: number;
}

export interface DrugRiskItem {
  drugs: string;
  level: string;
  desc: string;
  levelType: 'error' | 'warning' | 'ok';
}

export interface CurrentMedItem {
  name: string;
  cls: string;
  note: string;
  warn?: boolean;
}

export interface RagSourceItem {
  type: string;
  title: string;
  meta: string;
  score: number;
}

// ==================== 患者档案 ====================
export interface PatientRowItem {
  id: string;
  name: string;
  gender: string;
  age: number;
  dept: string;
  bed: string;
  diag: string;
  admission: string;
  count: number;
  doctor: string;
  status: PatientStatus;
}

/** 患者档案（真实接口数据） */
export interface PatientItem {
  id: number;
  patient_no: string;
  name: string;
  gender: string;
  age: number;
  /** 出生日期（YYYY-MM-DD），可空 */
  birth_date: string | null;
  /** 档案层常驻过敏史（与逐次病历的 allergy_history 区分） */
  allergy_history: string | null;
  /** 档案层常驻既往史 */
  past_history: string | null;
  height: number | null;
  weight: number | null;
  bmi: number | null;
  waistline: number | null;
  phone: string | null;
  primary_diag: string;
  dept: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** 患者详情中绑定的企微群 */
export interface PatientGroupItem {
  group_id: number;
  chat_id: string;
  name: string;
  member_count: number;
  bind_at: string | null;
}

/** 患者详情 */
export interface PatientDetailItem extends PatientItem {
  groups: PatientGroupItem[];
}

/** 患者新增 / 编辑表单 */
export interface PatientPayload {
  name: string;
  gender: string;
  age: number;
  /** 出生日期（YYYY-MM-DD），可空 */
  birth_date?: string | null;
  /** 档案层常驻过敏史 */
  allergy_history?: string | null;
  /** 档案层常驻既往史 */
  past_history?: string | null;
  height?: number | null;
  weight?: number | null;
  waistline?: number | null;
  phone?: string;
  primary_diag: string;
  dept: string;
  status: string;
}

/** 患者列表查询参数 */
export interface PatientListQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  dept?: string;
  status?: string;
}

/** 患者列表响应 */
export interface PatientListResponse {
  items: PatientItem[];
  total: number;
  page: number;
  page_size: number;
}

// ==================== 账号管理 ====================
/** 账号角色摘要（列表行内展示） */
export interface AccountRoleBrief {
  id: number;
  role_code: string;
  role_name: string;
  data_scope: string;
  is_system: boolean;
}

export type AccountStatus = 'pending' | 'active' | 'locked' | 'disabled';
export type AccountGender = 'male' | 'female' | 'unknown';

/** 账号（对接 /api/accounts） */
export interface AccountItem {
  id: number;
  username: string;
  real_name: string;
  employee_no: string | null;
  gender: AccountGender | null;
  professional_title: string | null;
  primary_department_id: number | null;
  department_name: string | null;
  department_code: string | null;
  roles: AccountRoleBrief[];
  status: AccountStatus;
  must_change_password: boolean;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
}

/** 创建账号响应：password 为一次性明文初始密码 */
export interface AccountCreateResult extends AccountItem {
  password?: string | null;
}

export interface AccountListQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  status?: string;
  role_code?: string;
  department_id?: number;
}

export interface AccountListResponse {
  items: AccountItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 新建账号参数 */
export interface AccountPayload {
  username: string;
  real_name: string;
  employee_no?: string | null;
  gender?: AccountGender | null;
  professional_title?: string | null;
  department_id?: number | null;
  role_ids?: number[];
  /** 留空由后端自动生成强密码 */
  password?: string | null;
  status?: AccountStatus;
}

export interface AccountUpdatePayload {
  real_name?: string;
  employee_no?: string | null;
  gender?: AccountGender | null;
  professional_title?: string | null;
  /** 主科室 ID，传 null 表示不设置主科室 */
  department_id?: number | null;
  /** 覆盖式角色 ID 列表，null 表示不修改 */
  role_ids?: number[] | null;
}

export interface AccountResetResult {
  ok: boolean;
  password: string;
}

/** 角色下拉选项 */
export interface RoleOption {
  id: number;
  role_code: string;
  role_name: string;
  description: string | null;
  data_scope: string;
  is_system: boolean;
}

/** 科室下拉选项 */
export interface DepartmentOption {
  id: number;
  department_code: string;
  department_name: string;
  parent_id: number | null;
  department_type: string;
  tree_level: number;
}

export interface AccountOptions {
  roles: RoleOption[];
  departments: DepartmentOption[];
}

export interface AccountImportFailure {
  line: number;
  reason: string;
}

/** 批量导入成功的账号行（含一次性明文初始密码） */
export interface AccountImportCreated {
  username: string;
  real_name: string;
  password: string;
}

export interface AccountBatchImportResult {
  ok: boolean;
  created: number;
  accounts: AccountImportCreated[];
  failed: AccountImportFailure[];
}

// ==================== 权限管理（角色） ====================
export type RoleStatus = 'active' | 'disabled';
export type DataScopeCode = 'self' | 'department' | 'department_tree' | 'hospital';

/** 角色（对接 /api/roles） */
export interface RoleItem {
  id: number;
  role_code: string;
  role_name: string;
  description: string | null;
  data_scope: string;
  is_system: boolean;
  status: RoleStatus;
  member_count: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface RoleListQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  status?: RoleStatus | '';
}

export interface RoleListResponse {
  items: RoleItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 菜单授权树节点（menu_key 作 key） */
export interface RoleMenuTreeNode {
  key: string;
  title: string;
  badge?: string | null;
  phase2?: boolean;
  children?: RoleMenuTreeNode[];
}

/** 功能权限点授权树节点（模块作父节点，权限点编码作叶子） */
export interface RolePermissionTreeNode {
  key: string;
  title: string;
  selectable?: boolean;
  description?: string | null;
  children?: RolePermissionTreeNode[];
}

export interface RoleDetailItem extends RoleItem {
  /** 已授权菜单 key（含全选父节点） */
  menu_keys: string[];
  /** 已授权功能权限点编码（叶子节点） */
  permission_keys: string[];
}

/** 新建角色参数 */
export interface RolePayload {
  role_code: string;
  role_name: string;
  description?: string | null;
  data_scope: DataScopeCode;
  status: RoleStatus;
  /** 覆盖式菜单授权，可为空 */
  menu_keys: string[];
  /** 覆盖式功能权限点授权，可为空 */
  permission_keys: string[];
}

export interface RoleUpdatePayload {
  role_name?: string;
  description?: string | null;
  data_scope?: DataScopeCode;
  status?: RoleStatus;
  menu_keys?: string[];
  permission_keys?: string[];
}

// ==================== 病历记录 ====================
/** 病历记录（对接 /api/patients/{id}/medical-records） */
export interface MedicalRecordItem {
  id: number;
  patient_id: number;
  chief_complaint: string;
  present_illness: string;
  past_history: string;
  allergy_history: string;
  drug_allergy_history: string;
  family_history: string;
  physical_exam: string;
  treatment_advice: string;
  lab_tests: string;
  examinations: string;
  treatment: string;
  medications: string;
  supplements: string;
  health_education: string;
  /** 归档的 AI 分析结论快照（由某次分析归档写入） */
  ai_conclusion: AnalysisResult | null;
  /** 结论归档时间 */
  ai_conclusion_at: string | null;
  /** 结论来源分析记录 ID */
  ai_conclusion_source_id: number | null;
  created_at: string;
  updated_at: string;
}

/** 病历记录新建 / 编辑表单（字段均为可空长文本） */
export interface MedicalRecordPayload {
  chief_complaint?: string;
  present_illness?: string;
  past_history?: string;
  allergy_history?: string;
  drug_allergy_history?: string;
  family_history?: string;
  physical_exam?: string;
  treatment_advice?: string;
  lab_tests?: string;
  examinations?: string;
  treatment?: string;
  medications?: string;
  supplements?: string;
  health_education?: string;
}

/** 病历记录列表响应 */
export interface MedicalRecordListResponse {
  items: MedicalRecordItem[];
  total: number;
}

/** 病历文件 AI 解析结果（字段与创建入参一致，均可选） */
export interface MedicalRecordParseResult extends MedicalRecordPayload {
  /** 解析来源：image / pdf / word / text */
  source: 'image' | 'pdf' | 'word' | 'text';
}

// ==================== 企业微信群管理 ====================
/** 外部群列表项（附带当前医院绑定的患者） */
export interface WxGroupItem {
  id: number;
  chat_id: string;
  name: string;
  owner: string;
  owner_name: string;
  member_count: number;
  webhook_url: string | null;
  wecomapi_room_id: string | null;
  external_count: number;
  status: number;
  last_sync_at: string | null;
  patient_id: string | null;
  patient_name: string | null;
}

/** 手动添加群请求参数 */
export interface WxGroupCreatePayload {
  name: string;
  owner?: string;
  owner_name?: string;
  member_count?: number;
  webhook_url?: string;
  wecomapi_room_id?: string;
}

/** 更新群信息请求参数（webhook_url / wecomapi_room_id 传空字符串可清空） */
export interface WxGroupUpdatePayload {
  name?: string;
  owner?: string;
  owner_name?: string;
  member_count?: number;
  webhook_url?: string | null;
  wecomapi_room_id?: string | null;
}

/** 群详情（含绑定时间） */
export interface WxGroupDetail extends WxGroupItem {
  bind_at: string | null;
  bind_by: number | null;
}

/** 群同步结果统计 */
export interface WxSyncResult {
  total: number;
  added: number;
  updated: number;
  failed: number;
  synced_at: string | null;
}

/** 企业微信集成状态（不含任何凭证） */
export interface WxStatus {
  configured: boolean;
  sync_enabled: boolean;
  last_sync_at: string | null;
  group_count: number;
}

/** 群发推送记录 */
export interface WxMessageItem {
  id: number;
  group_id: number;
  group_name: string;
  patient_id: string | null;
  patient_name: string | null;
  msg_type: 'text' | 'link';
  title: string | null;
  content: string | null;
  url: string | null;
  picurl: string | null;
  sender: string;
  status: 'pending' | 'sent' | 'fail';
  fail_reason: string | null;
  sent_at: string | null;
  created_at: string | null;
}

/** 发起群发的请求参数 */
export interface WxMessageCreatePayload {
  group_id: number;
  msg_type: 'text' | 'link';
  content?: string;
  title?: string;
  url?: string;
  picurl?: string;
  desc?: string;
}

// ==================== wecomapi 第三方通道（试点） ====================

/** wecomapi 通道状态（不含凭证） */
export interface WecomApiStatus {
  configured: boolean;
  token_set: boolean;
  online: boolean;
  nickname: string;
  corp_name: string;
  message: string;
}

/** 创建设备 + 登录二维码响应 */
export interface WecomApiDevice {
  guid: string;
  qrcode_base64: string;
  configured: boolean;
  message: string;
}

/** 扫码登录状态（轮询） */
export interface WecomApiLoginStatus {
  guid: string;
  status: number;
  done: boolean;
  nickname: string;
  corp_name: string;
  message: string;
}

/** wecomapi 平台群（导入候选） */
export interface WecomApiRoomItem {
  room_id: string;
  room_name: string;
  member_count: number;
}

/** wecomapi 群列表（分页） */
export interface WecomApiRooms {
  items: WecomApiRoomItem[];
  has_more: boolean;
  next_start_index: number;
}

/** 把选中的 wecomapi 平台群导入到本地群列表 */
export interface WecomApiGroupImportPayload {
  room_ids: string[];
  sync_all?: boolean;
}

/** wecomapi 平台单条群消息（聊天记录） */
export interface WecomApiChatMessageItem {
  msg_server_id: number;
  from_room_id: string;
  is_room_notice: boolean;
  sender_id: string;
  sender_name: string;
  content: string;
  msg_type: number;
  timestamp: number;
  seq: number;
}

/** wecomapi 群聊天记录 */
export interface WecomApiRoomMessages {
  items: WecomApiChatMessageItem[];
  total: number;
}

export interface WecomApiProfile {
  user_id: string;
  nickname: string;
  avatar_url: string;
  alias: string;
  mobile: string;
}

export interface WecomApiContactItem {
  user_id: string;
  nickname: string;
  avatar_url: string;
}

export interface WecomApiContactsBatch {
  items: WecomApiContactItem[];
}

export interface WecomApiRoomMember {
  user_id: string;
  nickname: string;
  avatar_url: string;
  room_remark: string;
  is_admin: boolean;
  join_time: number;
}

export interface WecomApiRoomMembers {
  room_name: string;
  items: WecomApiRoomMember[];
}

// ==================== 知识库 ====================
export interface DocCompositionItem {
  name: string;
  count: string;
  ratio: number;
}

export interface RecentDocItem {
  title: string;
  type: string;
  source: string;
  uploader: string;
  time: string;
  status: TaskStatus;
}

export interface EntityDistributionItem {
  name: string;
  value: number;
  count: string;
}

export interface KbQualityItem {
  label: string;
  value: string;
  ratio: number;
  color: string;
}

// ==================== 文档管理 ====================
export interface DocRowItem {
  name: string;
  type: string;
  size: string;
  chunks: number;
  status: TaskStatus;
  time: string;
  uploader: string;
}

export interface DocTypeItem {
  key: string;
  label: string;
  count: number;
}

// ==================== 知识库（真实接口） ====================
/**
 * 文档索引进度状态
 * uploaded：已登记但未索引（IMA 两步式导入的第一步，等待手动触发）
 */
export type KnowledgeDocStatus = 'uploaded' | 'parsing' | 'ready' | 'failed';

/** 知识库文档（对接 /api/knowledge/documents） */
export interface KnowledgeDocument {
  id: number;
  title: string;
  file_name: string;
  file_ext: string;
  file_size: number;
  doc_type: string;
  sub_type: string | null;
  summary: string | null;
  source: string;
  source_type: string;
  /** 来源媒体 ID（IMA 两步式导入二次取回内容用） */
  source_media_id?: string | null;
  remark: string | null;
  status: KnowledgeDocStatus;
  chunk_count: number;
  vector_count: number;
  error_message: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** 文档分页列表响应 */
export interface DocumentListResponse {
  items: KnowledgeDocument[];
  total: number;
  page: number;
  page_size: number;
}

export interface DocTypeDistributionItem {
  doc_type: string;
  label: string;
  count: number;
}

export interface StatusDistributionItem {
  status: string;
  label: string;
  count: number;
}

/** 知识库总览（对接 /api/knowledge/overview） */
export interface KnowledgeOverview {
  total_documents: number;
  ready_documents: number;
  parsing_documents: number;
  failed_documents: number;
  total_chunks: number;
  total_vectors: number;
  total_size_bytes: number;
  doc_type_distribution: DocTypeDistributionItem[];
  status_distribution: StatusDistributionItem[];
  recent_documents: KnowledgeDocument[];
  embedding_model: string;
  embedding_ready: boolean;
  vector_db_connected: boolean;
  upload_dir: string;
}

/** 语义检索命中项（对接 /api/knowledge/search） */
export interface SearchHit {
  document_id: number;
  title: string;
  file_name: string;
  doc_type: string;
  content: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  total: number;
}

/** 上传文档参数 */
export interface UploadDocumentPayload {
  file: File;
  title?: string;
  doc_type?: string;
  sub_type?: string;
  source?: string;
  remark?: string;
}

/** 文档分块（详情展示） */
export interface KnowledgeDocumentChunk {
  id: number;
  chunk_index: number;
  title: string | null;
  content: string;
  char_count: number;
}

/** 文档详情响应（对接 /api/knowledge/documents/{id}） */
export interface DocumentDetailResponse {
  document: KnowledgeDocument;
  chunks: KnowledgeDocumentChunk[];
}

// ==================== IMA 外部集成 ====================
/** IMA 远程知识库条目（对接 /api/knowledge/ima/knowledge-bases） */
export interface ImaKnowledgeBase {
  id: string;
  name: string;
  /** 知识库类型：个人知识库 / 共享知识库 / 我加入的订阅知识库 */
  base_type?: string | null;
  /** 当前账号角色：创建者 / 普通成员 等 */
  role_type?: string | null;
  member_count?: number;
  content_count?: number;
}

/** IMA 知识库列表响应（configured=false 表示未配置） */
export interface ImaKnowledgeBaseListResponse {
  configured: boolean;
  items: ImaKnowledgeBase[];
  error: string | null;
}

/** IMA 检索命中条目（对接 /api/knowledge/ima/search） */
export interface ImaSearchHit {
  knowledge_base: string;
  title: string;
  snippet: string;
  media_id: string | null;
  url: string | null;
}

/** IMA 检索响应（configured=false 表示未配置） */
export interface ImaSearchResponse {
  configured: boolean;
  query: string;
  hits: ImaSearchHit[];
  total: number;
  error: string | null;
}

/** IMA 知识库目录条目（文件夹或文档，media_type=99 为文件夹） */
export interface ImaKnowledgeItem {
  media_id: string;
  title: string;
  media_type: number;
  is_folder: boolean;
  parent_folder_id: string | null;
  file_number: number;
  folder_number: number;
}

/** IMA 知识库目录面包屑节点（顶层为知识库根，media_id 为 null） */
export interface ImaKnowledgePathNode {
  folder_id: string;
  media_id: string | null;
  name: string;
}

/** IMA 知识库目录浏览响应（configured=false 表示未配置） */
export interface ImaKnowledgeContentResponse {
  configured: boolean;
  kb_id: string;
  folder_id: string | null;
  current_path: ImaKnowledgePathNode[];
  items: ImaKnowledgeItem[];
  error: string | null;
}

/** IMA 媒体（文件）详情，content 为清洗后的纯文本 */
export interface ImaMediaDetailResponse {
  configured: boolean;
  media_id: string;
  media_type: number | null;
  content: string;
  truncated: boolean;
  url: string;
  note_id: string;
  error: string | null;
}

/** IMA 文档搬运（同步到本地知识库）提交结果 */
export interface ImaImportResponse {
  configured: boolean;
  media_id: string;
  title: string;
  submitted: boolean;
  error: string | null;
}

// ==================== AI 病历分析 ====================
/** AI 关注点条目（level：高 / 中 / 低） */
export interface AnalysisAttentionItem {
  title: string;
  description: string;
  level: string;
}

/** 循证依据条目：document_id 存在时表示命中本机构知识库，可下载原文；snippet 为命中文本片段 */
export interface EvidenceItem {
  source?: string;
  relevance?: number;
  document_id?: number;
  snippet?: string;
}

/** AI 助手回答引用的知识库条目（对接 /chat 的 citations） */
export interface ChatCitation {
  document_id: number;
  title: string;
  score: number;
  snippet: string;
}

/** 病历分析结构化结果（对接 /api/analysis/record） */
export interface AnalysisResult {
  summary: Record<string, string>;
  attention: AnalysisAttentionItem[];
  evidence: EvidenceItem[];
}

/** 分析记录项（历史列表 / 详情） */
export interface AnalysisRecordItem {
  id: number;
  patient_id: number;
  patient_name: string;
  medical_record_id: number;
  analysis_type: string;
  model: string;
  status: 'done' | 'failed';
  result: AnalysisResult | null;
  error: string | null;
  created_at: string;
}

/** 分析记录列表响应（分页） */
export interface AnalysisRecordListResponse {
  items: AnalysisRecordItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 分析记录列表查询参数 */
export interface AnalysisRecordListQuery {
  status?: 'done' | 'failed';
  analysis_type?: string;
  keyword?: string;
}

/** 分析任务统计（对接 /api/analysis/records/stats） */
export interface AnalysisStats {
  total: number;
  done: number;
  failed: number;
  today: number;
}

/** 分析任务趋势点（对接 /api/analysis/records/trend） */
export interface AnalysisTrendItem {
  date: string;
  count: number;
}

export interface AnalysisTrendResponse {
  days: number;
  items: AnalysisTrendItem[];
}

/** 创建病历分析请求参数 */
export interface AnalysisCreatePayload {
  patient_id: number;
  medical_record_id: number;
  analysis_type: string;
}

/** 分析类型选项（展示用） */
export const ANALYSIS_TYPES = [
  { value: 'record', label: '病历结构化' },
  { value: 'medication', label: '用药审核' },
  { value: 'risk', label: '风险评估' },
  { value: 'exam', label: '检查解读' },
] as const;

// ==================== 操作审计日志 ====================
/** 审计操作结果 */
export type AuditResult = 'success' | 'failure' | 'denied';

/** 审计日志（对接 /api/audit/logs） */
export interface AuditLogItem {
  id: number;
  user_id: number | null;
  username: string | null;
  real_name: string | null;
  ip: string | null;
  module: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  result: AuditResult | string;
  created_at: string;
}

/** 审计日志分页列表响应 */
export interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}

/** 审计日志查询参数 */
export interface AuditLogListQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  module?: string;
  action?: string;
  result?: string;
  start_date?: string;
  end_date?: string;
}

/** 审计筛选选项（对接 /api/audit/options） */
export interface AuditOptionsResponse {
  modules: string[];
  actions: string[];
}

/** 模块 / 操作的中文展示名（与后端埋点值对应） */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  auth: '认证',
  patient: '患者档案',
  medical_record: '病历记录',
  analysis: 'AI 分析',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: '登录',
  logout: '登出',
  register: '注册',
  view: '查看',
  create: '新建',
  update: '更新',
  delete: '删除',
  parse: 'AI 解析',
  export: '导出',
  archive: '归档',
};

export const AUDIT_RESULT_LABELS: Record<string, string> = {
  success: '成功',
  failure: '失败',
  denied: '拒绝',
};

// ==================== 患者时间线 / 报告导出 ====================
/** 时间线事件类型：病历记录 / AI 分析 */
export type TimelineEventType = 'medical_record' | 'analysis';

/** 患者时间线事件（对接 /api/patients/{id}/timeline） */
export interface PatientTimelineEvent {
  event_type: TimelineEventType;
  event_id: number;
  time: string;
  title: string;
  summary: string;
  status: string;
  medical_record_id: number | null;
  analysis_type: string;
  model: string;
  operator: string;
  /** 分析事件携带完整结论（{summary, attention, evidence}），复用分析结果类型 */
  detail: AnalysisResult | null;
}

export interface PatientTimelineResponse {
  items: PatientTimelineEvent[];
  total: number;
}

/** 时间线 / 报告导出的时间范围（YYYY-MM-DD） */
export interface PatientReportRange {
  start_date?: string;
  end_date?: string;
}

/** 报告导出格式：Word（可编辑）/ PDF（便于打印归档） */
export type ReportFormat = 'docx' | 'pdf';

// ==================== 分析结论演变（跨次分析对比） ====================
/** 单个关注点在历次分析中的出现记录 */
export interface EvolutionPoint {
  analysis_id: number;
  time: string;
  level: string;
  description: string;
}

/** 关注点演变：同一关注点在各次分析中的等级轨迹 */
export interface AttentionTrendItem {
  title: string;
  points: EvolutionPoint[];
  latest_level: string;
  /** up 加重 / down 减轻 / flat 持平 / new 首次出现 */
  trend: 'up' | 'down' | 'flat' | 'new';
}

/** 诊断结论演变节点（取分析 summary 中诊断类 key） */
export interface DiagnosisPoint {
  analysis_id: number;
  time: string;
  key: string;
  value: string;
}

/** 患者维度分析演变（对接 /api/patients/{id}/analysis-evolution） */
export interface AnalysisEvolutionResponse {
  patient_id: number;
  analyses: {
    id: number;
    time: string;
    analysis_type: string;
    model: string;
    status: string;
  }[];
  attention_trend: AttentionTrendItem[];
  diagnosis_timeline: DiagnosisPoint[];
}

// ==================== 站内通知 ====================
export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  content: string;
  resource_type: string | null;
  resource_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  unread: number;
}

// ==================== 分析结论归档到病历 ====================
export interface ArchiveAnalysisPayload {
  analysis_id: number;
}

