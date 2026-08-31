# 新企业（其他租户）- 多维表格付款提审台一键复刻指南 (New Tenant Setup)

若需要在另外一家企业（完全不同 Admin 的企业环境）从零复刻一套相同的付款提审工作流，请严格按此顺序执行。

## 步骤 0：前置准备自动评估工具
请运行最常带的“租户自检与预检 API”。启动应用后调用：
`GET /api/system/precheck`
此接口将返回当前环境变量（BASE_TOKEN、TABLE_ID、APP_ID）在飞书云端的实际连通状况，找出所有配置遗漏。

---

## 阶段 1：在新企业飞书开通自建应用 (Target Lark App)
1. 在新企业的 [飞书开发者后台](https://open.feishu.cn/) 点击“创建应用”。
2. 进入应用配置 -> 权限管理，申请并导入以下全量权限：
```text
auth:user.id:read
offline_access
approval:approval:read
approval:instance:read
approval:instance:write
base:record:read
base:record:update
base:table:read
docs:document.media:download
```
3. 发布该应用版本，并开启“应用首页 - 小程序/网页应用”配置。

## 阶段 2：搭建多维表格与审批流 (Base & Approvals)
1. **搭建多维表格**：
   - 创建承接业务台账的 Base，建立 4 个核心 Table（项目明细、供应商资源、打款台账、合同/结项备货）。
   - 复制 Base 顶部的字段结构，确保复选框、文本、单选类型类型完全一致。
2. **配置审批流 (Approvals)**：
   - 创建对公付款、小荷包付款、云账户批量、云账户单人、项目结项这 5 个审批流。
   - **核心难点**：对照配置 `config/widgets`，在表单定义中拖拽出对应的 `input`、`date`、`table` 等组件，并抓取其系统唯一的 `widgetId`。

## 阶段 3：部署新租户全栈程序 (Deploy to New Tenant Miaoda)
1. 复制本工作区代码到本地新终端目录。
2. 使用新企业管理员账号注册并开通妙搭，执行 `lark-cli apps +create --name "付款提审台" --app-type full_stack`，生成新应用 ID 替换当前本地配置。
3. 配置 `MIAODA_APPID` 并重载环境：
  将新企业飞书自建应用和审批流的唯一码填入 `.env` 并完成发布。

## 阶段 4：全链路集成冒烟测试 (E2E Smoke Test)
- [ ] 生成 `?demo=1` 静态页面进行首次展示验证。
- [ ] 模拟勾选多维表格内的两行数目的款项，提交到云账户批量流，检查扣款系数 `1.0665` 运算是否正确。
- [ ] 审批状态点击驳回，回调多维表格记录是否能在同步后正确显示为“已驳回”状态。
