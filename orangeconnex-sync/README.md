# OrangeConnex → 飞书多维表格 全自动同步

橙联海外仓没有开放 API。本项目用 Playwright 登录真实前端，再在登录后的页面上下文里调用内部接口，把 5 张表同步到飞书多维表格：

- 实时库存
- 库存流水
- 入库单列表
- 订单管理
- 库龄表

## 取数方案

统一入口是 `https://ef-web-sg.orangeconnex.com/api/app/seller`。脚本先通过 `https://fulfillment-cn.orangeconnex.com/seller/login` 登录 UI，再导航到已登录业务页，最后用 `page.evaluate(fetch(...))` 发起同源会话请求，避免裸请求返回“系统繁忙”。

| 飞书表 | OC 取数页面 | 数据获取方式 | 同步语义 |
|---|---|---|---|
| 实时库存 | `/sku/InventoryStatus` | `POST /weaver-service/sku/warehouse/v1/inventory/query`，按仓配中心分页 | 按「仓配中心 + 卖家SKUID」upsert |
| 库存流水 | `/sku/InventoryHistory` | `POST /weaver-service/sku/warehouse/v1/statement/query`，默认近 90 天 | 按「订单号 + OC SKUID」upsert |
| 入库单列表 | `/inbound` | `POST /slark-inbound/inbound/v1/queryInboundOrderList` | 按「入库单号」upsert |
| 订单管理 | `/order` | `POST /seller-bff/meepo/outboundOrder/v1/order/page`，固定近 30 天 | 按「出库单号」upsert，并删除窗口外旧记录 |
| 库龄表 | `/sku/InventoryStatus` 的「导出库龄明细」 | 创建异步导出任务，轮询下载中心，下载并解析 Excel | 全量快照 replace |

库龄导出的两个内部接口是：

1. `POST /api/app/seller-bff/export/v1/excel/async`，`exportType=inventory-aging-list-export`
2. `POST /api/app/seller-bff/downloadCenter/v1/query`，从 `downloadPath` 下载 XLSX

全仓导出使用 `warehouseRegionCodes`，当前样本约 394 行。Excel 使用 openpyxl 常规模式解析；不要用 `read_only=True`，因为源文件的 XML dimension 不准确，会导致误判为空表。

## 模块划分

### 通用模块

- `oc_client.py`
  - Playwright 无头登录。
  - 登录态 token / Cookie 读取。
  - 页面上下文 API 请求 `_fetch()`。
  - 通用分页 `_paginate()`。
  - 仓配中心发现 `list_warehouse_regions()`。
  - 库龄异步导出、下载中心轮询、XLSX 解析。
- `feishu_base.py`
  - tenant token 获取与缓存。
  - 飞书 Base API 请求。
  - 表/记录读取。
  - 批量 create / update / delete。
  - 通用 upsert 与快照 replace。
- `setup_base.py`
  - 幂等建表。
  - 幂等补齐字段。
  - 输出需要写回配置的 table id。

### 单独配置模块

- `config.py`：OC 账号、飞书 App 凭证、Base token、5 张表 table id。该文件含密钥，已被 `.gitignore` 排除。
- `sync.py`：
  - 各表字段映射。
  - 状态/运输方式等业务枚举转换。
  - 每张表的主键字段。
  - 库存流水 90 天窗口。
  - 订单管理 30 天窗口。
- `oc_client.py` 内各 `list_*()` 方法：
  - 每个接口的请求体。
  - 分页结果字段名。
  - 接口限制与导出超时时间。

## 安装

```powershell
pip install playwright requests openpyxl
python -m playwright install chromium
```

## 首次配置

1. 复制 `config.example.py` 为 `config.py`，填入账号、飞书凭证和 Base token。
2. 在飞书 Base 中给应用授予「可编辑」权限。
3. 建表并写回 table id：

```powershell
python setup_base.py
```

## 运行

```powershell
python sync.py
```

Windows 计划任务示例：

```powershell
schtasks /Create /TN "OrangeConnex-Feishu-Sync" /SC DAILY /ST 08:00 /TR ^
  "python D:\UserData\zhangzhongyi\Documents\通用插件\orangeconnex-sync\sync.py"
```

## 当前验证结果

- 实时库存：506 条。
- 库存流水：12,129 条以上，随流水新增。
- 入库单列表：455 条。
- 订单管理：4,102 条，30 天窗口，无空主键、无重复主键。
- 库龄表：394 条，全仓快照，无空主键、无重复主键。
