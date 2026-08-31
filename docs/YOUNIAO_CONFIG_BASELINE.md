# 游鸟科技 - 付款提审台配置基线 (Config Baseline)

游鸟科技当前租户（Youniao Media）已生效的飞书自引擎、妙搭、多维表格及审批流映射配置。
此文档作为电脑缘管理权移交、系统维护、复刻到新企业的基准参照。涉密配置已隐藏，请以游鸟科技飞书管理员在后台查询为准。

## 1. 应用资产基本信息 (Asset Info)
| 资产类型 | 标识 / ID | 说明 |
| --- | --- | --- |
| 妙搭应用 ID | `app_17amh1nnnm0` | 系统核心全栈应用 |
| 飞书自建应用 AppID | `cli_aad5818479381cf8` | 提供 OpenAPI 交互能力 |
| 游鸟科技自建应用 AppID | `cli_9cb844403dbb9108` | 审批小程序专用 AppID |
| 系统部署域名 | `https://vcnmbg6s629d.feishuapp.com/app/app_17amh1nnnom` | 多维表格侧边栏/独立访问页 |

---

## 2. 环境变量配置 (Environment Variables)
以下为游鸟科技生产所需的全部环境变量映射，需在妙搭应用后台的环境变量配置中逐一校验：
| 变量名 | 当前值 / 引用内容 | 说明 / 注意事项 |
| --- | --- | --- |
| `FEISHU_APP_ID` | `cli_aad5818479381cf8` | 飞书自建应用 ID |
| `FEISHU_APP_SECRET` | *(涉密已隐藏)* | 飞书自建应用密钥 |
| `PAYMENT_SESSION_SECRET` | *(涉密已隐藏)* | 登录会话盐值 |
| `CLIENT_BASE_PATH` | `/app/app_17amh1nnnm0` | 前端基础路由 |
| `PAYMENT_BASE_TOKEN` | *(涉密已隐藏)* | 业务核心多维表格 BaseToken (JK12...) |
| `PROJECT_SYNC_TABLE_ID` | *(需确认)* | 项目汇总数据表 ID |
| `RESOURCE_SYNC_TABLE_ID` | *(需确认)* | 资源入库/供应商数据表 ID |
| `PAYMENT_TABLE_ID` | `tblH40tCQefhuCwb` | 付款执行明细数据表 ID |
| `PAYMENT_SYNC_TABLE_ID` | *(需确认)* | 对公付款结果回填表 |
| `CLOUD_SYNC_TABLE_ID` | *(需确认)* | 云账户付款回填表 |
| `WALLET_SYNC_TABLE_ID` | *(需确认)* | 小荷包付款回填表 |
| `CLOSURE_SYNC_TABLE_ID` | `tblXgn1a9o4GzKAf` | 项目结项回填表 |
| `CONTRACT_SYNC_TABLE_ID` | `tbliBFC0mP9c15fS` | 合同关联表 ID |
| `PROJECT_APPROVAL_CODE` | `2B620A6D-C277-447A-9165-734FDBDD6BC4` | 对公支付审批流 Code |
| `WALLET_APPROVAL_CODE` | `B371918A-58C5-469D-99DF-76FB02F9BCFA` | 小荷包支付审批流 Code |
| `CLOUD_APPROVAL_CODE` | `2F29FCB6-ED2D-48AB-A064-C1C27FD4F988` | 云账户批量付款审批流 Code |
| `CLOUD_SINGLE_APPROVAL_CODE` | `AEB9B736-C8CF-486F-88C5-12A017592E58` | 云账户单人付款审批流 Code |
| `CLOSURE_APPROVAL_CODE` | `7EE85661-DE6F-4D64-8E76-D4FDBA6686FE` | 项目结项审批流 Code |
| `WALLET_DEPARTMENT_OPEN_ID` | `od-fbaa82826fa4370666c21145fcea9bc0` | 小荷包审批默认部门 |

---

## 3. 业务枚举与字典 (Business Enumerations)
### 付款主体兜底选项 (paymentEntityOptions)
`游鸟科技`, `游鸟文化`, `HS`, `YD`, `新枝`, `火勺`, `虫乾`, `膜多`, `皮娃`, `平河`, `迈越文`

### 云账户标准服务费率 (cloudFeeRate)
机票/酒店固定扣点：实际打款金额 = 票面成本 × 1.0665
