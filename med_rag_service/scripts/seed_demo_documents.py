"""种子演示文档：生成一批中文医学知识文档并上传到本机 RAG 服务（8002）建立索引。

用途：
- 知识库冷启动演示/测试数据（guide / drug / norm / case 多类型覆盖）；
- 为 scripts/eval_retrieval.py 的检索质量评测提供被检索语料。

使用（在 med_rag_service 目录下，用本服务 .venv）：
    .venv\\Scripts\\python.exe scripts\\seed_demo_documents.py
    .venv\\Scripts\\python.exe scripts\\seed_demo_documents.py --base http://127.0.0.1:8002 --hospital-id 1

说明：
- 直连服务 B 内部接口（仅本机内网），不经过登录鉴权；
- 幂等：按标题检查已存在（未软删）的文档则跳过；
- 每篇上传后轮询状态直到 ready/failed；
- python-docx 可用时额外生成 1 篇 .docx，用于覆盖 Word 解析链路。
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8002"
HOSPITAL_ID = 1
POLL_TIMEOUT_SEC = 600
POLL_INTERVAL_SEC = 3

SOURCE = "内部演示数据"


def _doc(title: str, doc_type: str, sub_type: str, content: str, as_docx: bool = False) -> dict:
    return {
        "title": title,
        "doc_type": doc_type,
        "sub_type": sub_type,
        "content": content.strip(),
        "as_docx": as_docx,
    }


DOCS: list[dict] = [
    _doc(
        "中国高血压防治指南（2024年修订版）要点摘编",
        "guide", "心血管",
        """
# 中国高血压防治指南（2024年修订版）要点摘编

## 一、诊断标准与分级

诊室血压（非同日三次测量）收缩压≥140mmHg 和/或舒张压≥90mmHg 即可诊断为高血压。
家庭自测血压诊断阈值为≥135/85mmHg，24小时动态血压平均值为≥130/80mmHg。

血压水平分级：
- 正常血压：收缩压<120mmHg 且舒张压<80mmHg；
- 正常高值：收缩压120-139mmHg 和/或舒张压80-89mmHg；
- 1级高血压（轻度）：收缩压140-159mmHg 和/或舒张压90-99mmHg；
- 2级高血压（中度）：收缩压160-179mmHg 和/或舒张压100-109mmHg；
- 3级高血压（重度）：收缩压≥180mmHg 和/或舒张压≥110mmHg；
- 单纯收缩期高血压：收缩压≥140mmHg 且舒张压<90mmHg，老年人多见。

## 二、生活方式干预

所有高血压患者均应长期坚持生活方式干预：
1. 减少钠盐摄入，每人每日食盐摄入量逐步降至5g以下，增加富钾食物摄入；
2. 控制体重，BMI尽量维持在18.5-23.9，男性腰围<90cm、女性<85cm；
3. 规律运动，每周4-7次中等强度有氧运动，每次30-60分钟；
4. 限酒戒烟；
5. 减轻精神压力，保证充足睡眠。

## 三、降压药物治疗

常用降压药包括钙通道阻滞剂（CCB）、血管紧张素转换酶抑制剂（ACEI）、
血管紧张素Ⅱ受体拮抗剂（ARB）、噻嗪类利尿剂和β受体阻滞剂五类，
以及由上述药物组成的单片复方制剂（SPC）。

起始治疗原则：
- 血压≥160/100mmHg 或高于目标值20/10mmHg的高危患者，可起始联合治疗；
- 一般患者采用常规剂量，老年人从小剂量开始；
- 优先选用长效制剂，平稳降压、减少血压波动。

降压目标：一般高血压患者应降至<140/90mmHg；能耐受者和部分高危及年轻患者
可进一步降至<130/80mmHg；80岁以上高龄患者可放宽至<150/90mmHg。

## 四、特殊人群要点

- 老年高血压：注意体位性低血压，避免过快过度降压；
- 合并糖尿病者目标<130/80mmHg，首选ACEI/ARB；
- 妊娠期高血压：可选用拉贝洛尔、硝苯地平，禁用ACEI/ARB。
""",
    ),
    _doc(
        "中国2型糖尿病防治指南（2020年版）核心要点",
        "guide", "内分泌",
        """
# 中国2型糖尿病防治指南（2020年版）核心要点

## 一、诊断标准

糖尿病诊断切点（静脉血浆葡萄糖，典型糖尿病症状+随机血糖或OGTT）：
- 典型糖尿病症状（烦渴多饮、多尿、多食、不明原因体重下降）且随机血糖≥11.1mmol/L；
- 空腹血糖≥7.0mmol/L；
- OGTT 2小时血糖≥11.1mmol/L；
- 糖化血红蛋白（HbA1c）≥6.5%（采用标准化检测方法）。
无糖尿病典型症状者，需改日复测确认。

正常空腹血糖<6.1mmol/L；空腹血糖6.1-7.0mmol/L称为空腹血糖受损（IFG），
OGTT 2小时血糖7.8-11.1mmol/L称为糖耐量减低（IGT），统称糖尿病前期。

## 二、综合控制目标

- 血糖：空腹4.4-7.0mmol/L，非空腹<10.0mmol/L；
- HbA1c：一般控制目标<7.0%；年轻、病程短、无并发症且预期寿命长者可放宽至<6.5%甚至接近正常；
  老年、有严重低血糖史或预期寿命有限者可适当放宽至<8.0%甚至8.5%；
- 血压：<130/80mmHg（若不能耐受可放宽至<140/90mmHg）；
- 血脂：以LDL-C为主要靶点，合并心血管疾病者<1.8mmol/L，未合并者<2.6mmol/L；
- 体重：超重/肥胖者建议3-6个月内减轻5%-10%。

## 三、药物治疗路径

生活方式干预是2型糖尿病的基础治疗，贯穿始终。

1. 首选药物：二甲双胍是2型糖尿病首选一线用药，如无禁忌证且可耐受，应一直保留在治疗方案中。
2. 二联治疗：单药控制不佳时可加用磺脲类、α-糖苷酶抑制剂、DPP-4抑制剂、
   SGLT2抑制剂、TZD或胰岛素等；合并动脉粥样硬化性心血管疾病（ASCVD）或高危因素、
   心力衰竭、慢性肾脏病者，优先联合GLP-1受体激动剂或SGLT2抑制剂。
3. 胰岛素治疗：HbA1c很高（如≥9.0%）或高血糖症状明显时可启起始短期胰岛素强化治疗。

## 四、低血糖防治与随访

使用胰岛素或胰岛素促泌剂者需警惕低血糖（血糖<3.9mmol/L即属低血糖），
处理原则为“15-15法则”：进食15g快速碳水，15分钟后复测。
建议每3个月复查HbA1c，每年评估眼底、尿白蛋白/肌酐比值、足部与血脂。
""",
    ),
    _doc(
        "阿司匹林肠溶片药品说明书（摘要）",
        "drug", "心血管",
        """
# 阿司匹林肠溶片药品说明书（摘要）

## 成分与规格

本品主要成分为阿司匹林。常见规格：100mg/片（肠溶衣片）。

## 适应证

1. 降低急性心肌梗死疑似患者的发病风险；
2. 预防心肌梗死复发、卒中的二级预防；
3. 降低稳定性/不稳定性心绞痛患者发病风险；
4. 动脉外科手术或介入手术后（如PCI、旁路移植）的血栓预防；
5. 大剂量用于解热镇痛抗炎（现已少用）。

## 用法用量

- 心脑血管疾病一级/二级预防：每日75-100mg，每日一次，餐前空腹服用
  （肠溶片空腹服用利于药片快速进入肠道、减少胃部停留）；
- 急性心肌梗死急诊：首次嚼服300mg负荷剂量。
- 应整片吞服，不可掰开或嚼碎（急救负荷量除外）。

## 不良反应

- 胃肠道：恶心、呕吐、上腹不适，长期使用可致胃肠道溃疡、出血，为最常见不良反应；
- 出血风险：抑制血小板聚集，可增加出血倾向，手术前需按医嘱停药；
- 过敏：对阿司匹林过敏者禁用，可出现哮喘（阿司匹林哮喘）、荨麻疹、血管性水肿，
  严重者可发生过敏性休克；
- 瑞氏综合征：儿童病毒感染发热时使用阿司匹林可能诱发，16岁以下慎用；
- 其他：耳鸣、听力下降（大剂量）、肝肾功能损害。

## 禁忌与注意事项

- 对本品任何成分过敏者禁用；活动性消化道溃疡/出血者禁用；
- 严重肝肾功能不全、出血性疾病（如血友病）者禁用；
- 哺乳期妇女、孕晚期禁用；
- 与抗凝药（华法林）、其他NSAIDs、糖皮质激素合用增加出血风险；
- 服药期间如出现黑便、呕血、皮肤瘀斑等应及时就医。
""",
    ),
    _doc(
        "盐酸二甲双胍片药品说明书（摘要）",
        "drug", "内分泌",
        """
# 盐酸二甲双胍片药品说明书（摘要）

## 成分与规格

主要成分为盐酸二甲双胍。常见规格：0.25g、0.5g/片。

## 适应证

用于2型糖尿病，特别是肥胖或超重者；可单药使用，亦可与磺脲类、
胰岛素等联合。不用于1型糖尿病的单独治疗（可作辅助）。

## 用法用量

- 起始剂量：通常一次0.5g，每日2次；或0.25g每日3次，随餐服用
  （随餐或餐后服用可减轻胃肠道反应）；
- 剂量调整：每1-2周根据血糖逐步加量，常用最大剂量一日2.0g；
- 缓释剂型每日1-2次，晚餐时服用；
- 老年人及肾功能减退者需减量，应根据eGFR调整：
  eGFR 45-59ml/min/1.73m² 可继续使用并减量监测；eGFR<45 禁用。

## 不良反应

- 胃肠道反应最常见：腹泻、恶心、呕吐、腹胀、金属味、食欲下降；
  多为一过性，从小剂量起始、随餐服用可减轻；
- 长期使用可影响维生素B12吸收，建议定期监测；
- 乳酸酸中毒：罕见但严重，多见于肾功能不全、缺氧、酗酒、造影检查前后未停药者。

## 禁忌

- 对本品过敏者；
- 严重肾功能不全（eGFR<45）、急性代谢性酸中毒、糖尿病酮症酸中毒；
- 严重缺氧状态（如急性心衰、呼吸衰竭）、严重感染、外伤、大手术围手术期；
- 酗酒者；碘造影检查当日及之后48小时内应暂停本品（肾功能正常者遵医嘱）。

## 注意事项

单用二甲双胍一般不引起低血糖；与磺脲类或胰岛素联用时低血糖风险增加。
出现呕吐、腹泻等脱水情况时应暂停用药并就医。
""",
    ),
    _doc(
        "硝苯地平控释片药品说明书（摘要）",
        "drug", "心血管",
        """
# 硝苯地平控释片药品说明书（摘要）

## 成分与规格

主要成分为硝苯地平，控释片常见规格30mg、60mg/片。

## 适应证

1. 高血压；
2. 冠心病：慢性稳定性心绞痛及血管痉挛性心绞痛（变异型心绞痛）。

## 用法用量

- 高血压：起始剂量30mg，每日一次，晨服；必要时可增至60mg每日一次；
- 整片吞服，不可掰开、咀嚼或碾碎（控释外壳不吸收，空壳随粪便排出）；
- 服药不受进餐影响。

## 不良反应

- 面部潮红、头痛、心悸、心动过速（血管扩张所致），多见于起始或加量期；
- 踝部水肿，为毛细血管前小动脉扩张所致，利尿剂效果有限，联合ACEI/ARB可减轻；
- 牙龈增生（长期使用）；一过性低血压，老年人注意体位性低血压。

## 禁忌与注意事项

- 对硝苯地平过敏者禁用；心源性休克者禁用；
- 急性心肌梗死时慎用，严重主动脉瓣狭窄者慎用（后负荷骤降风险）；
- 不建议与利福平合用（显著降低血药浓度）；
- 与β受体阻滞剂联用需警惕严重低血压与心功能抑制；
- 妊娠期权衡利弊，哺乳期避免使用。
""",
    ),
    _doc(
        "社区获得性肺炎诊疗规范（院内试行版）",
        "norm", "呼吸",
        """
# 社区获得性肺炎（CAP）诊疗规范（院内试行版）

## 一、定义

社区获得性肺炎是指在医院外罹患的感染性肺实质炎症，包括具有明确潜伏期的
病原体感染而在入院后平均潜伏期内发病的肺炎。

## 二、常见病原体

CAP常见致病菌包括：
- 肺炎链球菌：仍是最常见的典型病原体；
- 肺炎支原体、肺炎衣原体：非典型病原体，青壮年多见；
- 流感嗜血杆菌、卡他莫拉菌；
- 金黄色葡萄球菌：流感后多见；
- 铜绿假单胞菌等革兰阴性杆菌：多有结构性肺病、反复住院、近期抗生素使用史等危险因素；
- 流感病毒、新冠病毒等呼吸道病毒亦占相当比例，可合并细菌感染。

## 三、病情评估

使用CURB-65评分评估严重程度（意识混乱、尿素>7mmol/L、呼吸频率≥30次/分、
低血压、年龄≥65岁，每项1分）：0-1分门诊治疗；2分住院或密切随访下门诊；
≥3分住院，必要时ICU。同时结合血氧饱和度、胸部影像评估。

## 四、抗感染治疗

1. 门诊青壮年、无基础病：可选用青霉素类、第一代/二代头孢菌素，
   或多西环素/米诺环素；考虑非典型病原体时首选呼吸喹诺酮或大环内酯类；
2. 门诊有基础病或老年人：β-内酰胺类联合大环内酯类，或呼吸喹诺酮单药；
3. 住院非重症：β-内酰胺类±大环内酯类，或呼吸喹诺酮单药；
4. 需要入住ICU的重症：β-内酰胺类联合大环内酯类或呼吸喹诺酮；
   有铜绿假单胞菌危险因素者使用抗假单胞菌β-内酰胺类±抗假单胞菌喹诺酮/氨基糖苷类。

## 五、疗程

抗感染疗程取决于病原体与病情：
- 一般CAP抗感染治疗5-7天；
- 非典型病原体（如肺炎支原体、军团菌）疗程可延长至10-14天；
- 金黄色葡萄球菌、铜绿假单胞菌、厌氧菌等特殊病原体疗程常需14-21天；
- 停药指征：体温正常≥48-72小时、症状明显改善、生命体征平稳，
  不以影像学完全吸收作为停药标准（影像吸收常滞后2-6周）。

## 六、预防

接种肺炎链球菌疫苗与流感疫苗；戒烟；流感季节注意手卫生。
""",
    ),
    _doc(
        "急性ST段抬高型心肌梗死区域协同救治流程",
        "guide", "心血管",
        """
# 急性ST段抬高型心肌梗死（STEMI）区域协同救治流程

## 一、识别与诊断

STEMI的黄金救治理念是“时间就是心肌，时间就是生命”。
心电图是诊断关键：≥2个相邻导联ST段弓背向上抬高，或新发左束支传导阻滞
伴典型缺血症状，应立即启动救治流程。溶栓或介入再灌注每延迟30分钟，
1年死亡率相对增加约7.5%。

## 二、急救与转运流程

1. 患者发病后呼叫120，急救人员10分钟内完成首份心电图并远程传输确诊；
2. 确诊后“绕行急诊/CCU”，直达导管室；
3. 转运途中：阿司匹林300mg嚼服（无禁忌时）、建立静脉通路、持续心电监护，
   备除颤仪；剧烈胸痛者予硝酸甘油（收缩压>90mmHg时）与镇痛处理；
4. 预计首份心电图至导丝通过（D2B时间）>120分钟且无法及时转运PCI者，
   在发病12小时内、无禁忌时行静脉溶栓，溶栓后2-24小时内常规转运造影。

## 三、再灌注治疗

- 直接PCI（首选）：发病12小时内，D2B目标≤90分钟（直接就诊）/
  ≤120分钟（转运）；梗死相关动脉行支架植入；
- 静脉溶栓：发病≤12小时，年龄<75岁者常用阿替普酶加速给药方案；
  溶栓再通标准：胸痛缓解、ST段回落≥50%、出现再灌注心律失常。

## 四、院内后续治疗

双联抗血小板（阿司匹林+P2Y12抑制剂）、他汀强化调脂、
ACEI/ARB（改善重构）、β受体阻滞剂（无禁忌时逐步滴定）。
监测恶性心律失常、机械并发症与心功能。出院前评估左室射血分数，
制定心脏康复计划。出院后二级预防长期随访，控制血压、血脂、血糖，戒烟。
""",
    ),
    _doc(
        "急性缺血性脑卒中静脉溶栓操作规范",
        "norm", "神经",
        """
# 急性缺血性脑卒中静脉溶栓操作规范

## 一、时间窗

静脉溶栓是急性缺血性脑卒中再灌注治疗的重要手段：
- 发病4.5小时内：重组组织型纤溶酶原激活剂（rt-PA，阿替普酶）标准时间窗；
- 发病4.5-6小时：部分患者可考虑替奈普酶或尿激酶（按院内规范评估）；
- 超时间窗者（6-24小时）需经灌注影像筛选后评估机械取栓。

## 二、rt-PA 使用条件（适应证）

1. 年龄≥18岁；
2. 临床诊断为急性缺血性脑卒中，神经功能缺损症状明确（NIHSS适当评分范围）；
3. 发病4.5小时以内（DWI-FLAIR错配者可放宽至4.5-9小时，需专家评估）；
4. 头颅CT已排除颅内出血，且无大面积梗死早期影像学改变；
5. 患者或家属签署知情同意书。

## 三、禁忌证（要点）

- 颅内出血（包括CT可疑）、蛛网膜下腔出血史；
- 近3个月严重头颅外伤或卒中史；颅内肿瘤、动静脉畸形、动脉瘤；
- 活动性内出血或出血性疾病；血小板<100×10⁹/L，INR>1.7，48小时内肝素治疗且APTT超正常；
- 血压控制不理想：收缩压>185mmHg或舒张压>110mmHg（积极降压后可再评估）；
- 血糖<2.8mmol/L或>22.2mmol/L（纠正后可再评估）。

## 四、给药与监护

- rt-PA剂量0.9mg/kg（最大90mg），10%静推1分钟，其余90%静滴1小时；
- 用药期间及24小时内：神经功能评分每15分钟×2小时、其后每30-60分钟；
  血压每15分钟×2小时、其后每30-60分钟；收缩压维持<180mmHg；
- 溶栓24小时内不使用抗血小板/抗凝药物，24小时复查头颅CT无出血后启动抗栓；
- 出现神经功能恶化、剧烈头痛、呕吐、血压急升时，警惕症状性颅内出血：
  立即停药、急查CT、按出血预案处理（可用氨甲环酸等拮抗并请专科会诊）。

## 五、疗效评估

溶栓后90天mRS评分评估预后；记录2小时、24小时NIHSS变化。
""",
    ),
    _doc(
        "慢性阻塞性肺疾病稳定期管理要点",
        "guide", "呼吸",
        """
# 慢性阻塞性肺疾病（COPD）稳定期管理要点

## 一、诊断与评估

慢阻肺的诊断依据危险因素暴露史、症状（慢性咳嗽咳痰、活动后呼吸困难）
及肺功能检查：吸入支气管舒张剂后FEV1/FVC<0.70即可确定存在持续气流受限。
症状评估采用mMRC呼吸困难评分与CAT评分；急性加重风险评估：
过去1年急性加重≥2次或因急性加重住院≥1次者为高危组。

## 二、稳定期药物治疗

1. 支气管舒张剂是控制症状的核心：
   - β2受体激动剂：短效（SABA，如沙丁胺醇按需使用）、长效（LABA，如沙美特罗、福莫特罗）；
   - 抗胆碱能药：短效（SAMA，异丙托溴铵）、长效（LAMA，如噻托溴铵、格隆溴铵）；
   - 联合吸入：LAMA+LABA适用于中重度患者；合并哮喘或嗜酸粒细胞升高者用ICS+LABA；
2. 吸入糖皮质激素（ICS）：适用于反复急性加重且血嗜酸粒细胞较高或合并哮喘特征者；
3. 磷酸二酯酶4抑制剂（罗氟司特）：慢性支气管炎、频繁加重伴FEV1较低者；
4. 长期家庭氧疗：静息PaO2≤55mmHg或SpO2≤88%者，每日≥15小时；
5. 祛痰药（氨溴索、羧甲司坦等）可用于痰多黏稠者。

## 三、非药物管理

- 戒烟是最有效的干预；避免粉尘与有害气体暴露；
- 肺康复训练（呼吸操、步行训练）改善运动耐量；
- 接种流感疫苗、肺炎链球菌疫苗与新冠疫苗接种；
- 营养支持：消瘦者保证热量与蛋白摄入。

## 四、急性加重的预防

识别并处理诱因（感染、空气污染、不规则用药）；
规范使用维持吸入药物、掌握吸入装置技术；
急性加重高风险患者可考虑大环内酯类长期预防（权衡QT延长与耐药风险）。
""",
    ),
    _doc(
        "病历书写基本规范（院内执行版）",
        "norm", "医务管理",
        """
# 病历书写基本规范（院内执行版）

## 一、基本要求

病历书写应当客观、真实、准确、及时、完整、规范。使用蓝黑墨水或电子病历
规范录入，文字工整、表述准确、语句通顺、标点正确。书写过程中出现错字时，
应当用双线划在错字上，保留原记录清楚可辨，注明修改时间，不得采用刮、粘、涂等方法掩盖。

## 二、时限要求（重点）

1. 首次病程记录：患者入院后8小时内完成；
2. 入院记录：入院后24小时内完成；
3. 主治医师首次查房记录：患者入院48小时内完成；
4. 日常病程记录：病情稳定者至少每3天记录一次；病危患者至少每天1次、
   病重患者至少每2天1次，病情变化时随时记录；
5. 手术记录：术后24小时内完成（术者书写）；
6. 术后首次病程记录：术后即时完成；
7. 出院记录：出院后24小时内完成；
8. 抢救记录：抢救结束后6小时内据实补记，注明抢救开始时间与参加人员；
9. 死亡记录：死亡后24小时内完成；死亡病例讨论：死后1周内完成；
10. 交（接）班记录、转科记录：转出/转入前书写完成（转科记录在患者转入后24小时内完成交接记录）。

## 三、知情同意文书

手术、麻醉、特殊检查、特殊治疗、病危通知等须签署知情同意书，
由患方本人或法定代理人签字并注明与患者关系及签署时间。

## 四、电子病历管理

电子病历系统操作留痕，修改记录可追溯；打印病历由相应医务人员手写签名。
归档病历不得随意修改，确需更正的按《医疗纠纷预防和处理条例》规定办理。

## 五、质控

科室每月抽查运行病历；病案室对归档病历进行终末质控，
甲级病历率纳入科室质量考核指标。
""",
    ),
    _doc(
        "中国成人血脂异常防治指南（2023年修订版）要点",
        "guide", "心血管",
        """
# 中国成人血脂异常防治指南（2023年修订版）要点

## 一、血脂检测与分层

临床血脂检测常规项目：总胆固醇（TC）、甘油三酯（TG）、
低密度脂蛋白胆固醇（LDL-C）、高密度脂蛋白胆固醇（HDL-C）。
LDL-C是干预的首要靶点；非HDL-C可作为次要靶点。
建议40岁以下成人每2-5年检测一次血脂，40岁及以上每年至少一次。

## 二、危险分层与LDL-C目标值

按ASCVD风险确定LDL-C控制目标：
- 超高危（ASCVD合并多种高危因素）：LDL-C<1.4mmol/L 且较基线降幅≥50%；
- 极高危（已诊断ASCVD，含心肌梗死、卒中、PAD等）：LDL-C<1.8mmol/L 且降幅≥50%；
- 高危（糖尿病≥40岁或LDL-C≥4.9mmol/L等）：LDL-C<2.6mmol/L；
- 中/低危：LDL-C<3.4mmol/L。

## 三、生活方式干预（基石）

1. 膳食：限制饱和脂肪酸与反式脂肪酸摄入，增加膳食纤维（全谷物、蔬菜），
   每日胆固醇摄入<300mg；TG升高者严格限酒并控制精制碳水；
2. 控制体重、规律有氧运动每周≥150分钟；
3. 戒烟、限盐（<5g/日）。

## 四、药物治疗

1. 他汀类药物是降LDL-C的首选：中等强度他汀降低LDL-C约30%-50%。
   常见不良反应：肌肉疼痛/乏力（肌酸激酶升高，横纹肌溶解罕见）、
   肝酶升高、新发糖尿病风险轻度增加；用药4-8周复查血脂、肝酶与肌酶；
2. 强效降脂联合：单药不达标可联合依折麦布（肠溶吸收抑制剂，再降约18%）；
   仍不达标或家族性高胆固醇血症联合PCSK9抑制剂（evolocumab等）；
3. 高甘油三酯血症：TG≥5.6mmol/L时优先贝特类药物防治急性胰腺炎，
   联合他汀时警惕肌病风险并加强监测。

## 五、随访

起始药物治疗后4-8周复查血脂与安全指标，达标后每6-12个月随访一次。
""",
    ),
    _doc(
        "2型糖尿病合并慢性肾脏病诊疗病例讨论",
        "case", "内分泌",
        """
# 2型糖尿病合并慢性肾脏病诊疗病例讨论

## 病例摘要

患者男性，58岁，公司职员。2型糖尿病病史12年， currently 使用二甲双胍0.5g每日2次、
格列美脲2mg每日一次降糖，血糖控制欠佳，HbA1c 8.9%。
高血压病史8年，服用缬沙坦氨氯地平片。吸烟20年，已戒2年。

## 检查

- 尿白蛋白/肌酐比值（UACR）320mg/g，24小时尿蛋白1.1g；
- 血肌酐 132μmol/L，eGFR 48ml/min/1.73m²；
- 空腹血糖9.6mmol/L，餐后2小时血糖14.2mmol/L；
- HbA1c 8.9%；LDL-C 3.2mmol/L；
- 眼底：双眼糖尿病视网膜病变（中度非增殖期）；
- 肾脏B超：双肾实质回声稍增强，大小正常。

## 诊断

1. 2型糖尿病伴多个并发症（糖尿病肾病，CKD G3a A3期；糖尿病视网膜病变）；
2. 高血压3级（很高危）；
3. 血脂异常。

## 讨论要点

1. 降糖方案调整：二甲双胍在eGFR 45-59时可继续使用但需减量并监测；
   该患者eGFR 48，二甲双胍减为0.5g每日1次；磺脲类（格列美脲）在肾功能不全时
   低血糖风险增加，建议停用；优先加用SGLT2抑制剂（有肾脏与心血管获益，
   eGFR≥20可启用）或GLP-1受体激动剂；
2. 血压目标：<130/80mmHg，首选ACEI/ARB（已有肾脏保护证据），该患者已在用复方制剂；
3. 血脂：合并ASCVD高危，LDL-C目标<1.8mmol/L，起始中等强度他汀±依折麦布；
4. 随访：每3个月评估UACR、eGFR、HbA1c；每年眼科会诊；避免肾毒性药物（NSAIDs、造影剂防护）；
5. 患者教育：低盐优质低蛋白饮食（蛋白0.8g/kg/日）、自我血糖监测、足部护理。

## 随访结果

3个月后复查：HbA1c 7.6%，UACR降至180mg/g，eGFR稳定（50），血压136/78mmHg。
继续当前方案并加强生活方式管理。
""",
    ),
]


def _build_docx(content: str, out_path: Path) -> None:
    """用 python-docx 把 Markdown 风格文本转成简单 docx（# → 标题样式）。"""
    import docx  # type: ignore
    from docx.shared import Pt  # type: ignore

    d = docx.Document()
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("## "):
            p = d.add_heading(line[3:], level=2)
            p.runs and setattr(p.runs[0].font, "size", Pt(14))
        elif line.startswith("# "):
            d.add_heading(line[2:], level=1)
        else:
            d.add_paragraph(line)
    d.save(str(out_path))


def list_existing(client: httpx.Client) -> dict[str, dict]:
    """返回 {title: {id, status}}（未软删的全部文档）。"""
    result: dict[str, dict] = {}
    page = 1
    while True:
        resp = client.get(
            f"{BASE}/internal/documents",
            params={"hospital_id": HOSPITAL_ID, "page": page, "page_size": 50},
        )
        resp.raise_for_status()
        body = resp.json()
        for item in body.get("items") or []:
            result[str(item.get("title") or "")] = {
                "id": item.get("id"),
                "status": item.get("status"),
            }
        if page * 50 >= int(body.get("total") or 0):
            break
        page += 1
    return result


def reindex_and_wait(client: httpx.Client, doc_id: int) -> tuple[str, str]:
    """对已有记录重建索引并轮询到终态。"""
    resp = client.post(
        f"{BASE}/internal/documents/{doc_id}/reindex",
        params={"hospital_id": HOSPITAL_ID},
    )
    resp.raise_for_status()
    status = resp.json().get("status")
    if status == "failed":
        return "failed", f"doc_id={doc_id}"
    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        detail = client.get(
            f"{BASE}/internal/documents/{doc_id}",
            params={"hospital_id": HOSPITAL_ID},
        )
        detail.raise_for_status()
        status = detail.json()["document"]["status"]
        if status != "parsing":
            err = detail.json()["document"].get("error_message") or ""
            return status, f"doc_id={doc_id} {err}".strip()
        time.sleep(POLL_INTERVAL_SEC)
    return "timeout", f"doc_id={doc_id} 轮询超时"


def upload_and_wait(client: httpx.Client, doc: dict) -> tuple[str, str]:
    """上传一篇文档并轮询到终态，返回 (状态, 信息)。"""
    title = doc["title"]
    content = doc["content"]
    if doc.get("as_docx"):
        tmp = Path(__file__).parent / "_tmp_seed.docx"
        _build_docx(content, tmp)
        file_name = f"{title}.docx"
        data = tmp.read_bytes()
        tmp.unlink(missing_ok=True)
    else:
        file_name = f"{title}.md"
        data = content.encode("utf-8")

    resp = client.post(
        f"{BASE}/internal/documents/upload",
        data={
            "hospital_id": str(HOSPITAL_ID),
            "title": title,
            "doc_type": doc["doc_type"],
            "sub_type": doc["sub_type"],
            "source": SOURCE,
        },
        files={"file": (file_name, data, "application/octet-stream")},
    )
    resp.raise_for_status()
    document = resp.json()["document"]
    doc_id = document["id"]

    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        detail = client.get(
            f"{BASE}/internal/documents/{doc_id}",
            params={"hospital_id": HOSPITAL_ID},
        )
        detail.raise_for_status()
        status = detail.json()["document"]["status"]
        if status != "parsing":
            err = detail.json()["document"].get("error_message") or ""
            return status, f"doc_id={doc_id} {err}".strip()
        time.sleep(POLL_INTERVAL_SEC)
    return "timeout", f"doc_id={doc_id} 轮询超时"


def main() -> int:
    global BASE, HOSPITAL_ID
    parser = argparse.ArgumentParser(description="上传种子演示文档到 RAG 服务")
    parser.add_argument("--base", default=BASE)
    parser.add_argument("--hospital-id", type=int, default=HOSPITAL_ID)
    parser.add_argument(
        "--docx", action="store_true", default=True, help="生成一篇 docx（需 python-docx）"
    )
    args = parser.parse_args()
    BASE = args.base.rstrip("/")
    HOSPITAL_ID = args.hospital_id

    docs = [dict(d) for d in DOCS]
    docs[6]["as_docx"] = args.docx  # STEMI 流程用 docx 覆盖 Word 解析链路

    with httpx.Client(timeout=60) as client:
        try:
            existing = list_existing(client)
        except Exception as exc:  # noqa: BLE001
            print(f"[ERROR] 无法连接 RAG 服务（{BASE}）：{exc}")
            return 1

        results: list[tuple[str, str, str]] = []
        for doc in docs:
            title = doc["title"]
            prev = existing.get(title)
            if prev is not None and prev["status"] == "ready":
                print(f"[SKIP] 已索引：{title}")
                results.append(("skipped", title, ""))
                continue
            if prev is not None:
                # failed/uploaded：不重复建记录，直接重建索引
                status, info = reindex_and_wait(client, int(prev["id"]))
            else:
                status, info = upload_and_wait(client, doc)
            tag = "[OK]" if status == "ready" else "[FAIL]"
            print(f"{tag} {title} → {status} {info}")
            results.append((status, title, info))

        ready = sum(1 for r in results if r[0] == "ready")
        skipped = sum(1 for r in results if r[0] == "skipped")
        failed = [r for r in results if r[0] not in ("ready", "skipped")]
        print("\n==== 汇总 ====")
        print(f"共 {len(results)} 篇：ready={ready}, skipped={skipped}, failed={len(failed)}")
        for status, title, info in failed:
            print(f"  - [{status}] {title}: {info}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
