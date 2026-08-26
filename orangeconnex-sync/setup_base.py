"""Create the 3 OrangeConnex tables in the configured Feishu Base.

Usage: python setup_base.py
Idempotent: existing tables are kept, missing fields are added.
"""

from config import FEISHU_BASE_TOKEN
from feishu_base import api_request, list_tables

TEXT = {"type": 1, "ui_type": "Text"}
NUMBER = {"type": 2, "ui_type": "Number", "property": {"formatter": "0"}}
NUMBER2 = {"type": 2, "ui_type": "Number", "property": {"formatter": "0.00"}}
DATETIME = {"type": 5, "ui_type": "DateTime", "property": {"date_formatter": "yyyy/MM/dd HH:mm"}}


def f(name, **kw):
    out = {"field_name": name}
    out.update(kw)
    return out


FIELDS_REALTIME = [
    f("仓配中心", **TEXT),
    f("商品名称", **TEXT),
    f("卖家SKUID", **TEXT),
    f("OC SKUID", **TEXT),
    f("SKU货型", **TEXT),
    f("在途", **NUMBER),
    f("到仓", **NUMBER),
    f("可售", **NUMBER),
    f("冻结", **NUMBER),
    f("不可售", **NUMBER),
    f("已售15天", **NUMBER),
    f("已售总计", **NUMBER),
    f("同步时间", **DATETIME),
]

FIELDS_FLOW = [
    f("仓配中心", **TEXT),
    f("卖家SKUID", **TEXT),
    f("OC SKUID", **TEXT),
    f("商品名称", **TEXT),
    f("变化原因", **TEXT),
    f("订单类型", **TEXT),
    f("订单号", **TEXT),
    f("上架批次号", **TEXT),
    f("操作时间", **DATETIME),
    f("变动数量", **NUMBER),
    f("结余可售", **NUMBER),
    f("同步时间", **DATETIME),
]

FIELDS_INBOUND = [
    f("送仓预约编号", **TEXT),
    f("入库单号", **TEXT),
    f("状态", **TEXT),
    f("重量kg", **NUMBER2),
    f("入库参考单号", **TEXT),
    f("创建时间", **DATETIME),
    f("仓配中心", **TEXT),
    f("清关文件审核状态", **TEXT),
    f("头程运输方式", **TEXT),
    f("入库方式", **TEXT),
    f("箱数", **NUMBER),
    f("预报数量", **NUMBER),
    f("同步时间", **DATETIME),
]

FIELDS_ORDER = [
    f("出库单号", **TEXT),
    f("商品明细", **TEXT),
    f("尾程承运商/单号", **TEXT),
    f("实际重量g", **NUMBER),
    f("计费重量g", **NUMBER),
    f("总体积cm3", **NUMBER2),
    f("总运费", **NUMBER2),
    f("币种", **TEXT),
    f("仓配中心", **TEXT),
    f("目的国家/地址", **TEXT),
    f("下单服务", **TEXT),
    f("配送服务", **TEXT),
    f("eBay卖家编码", **TEXT),
    f("eBay买家编码", **TEXT),
    f("eBay订单编号/平台订单号", **TEXT),
    f("卖家订单编号", **TEXT),
    f("下单日期", **DATETIME),
    f("eBay下单时间", **DATETIME),
    f("订单状态", **TEXT),
    f("订单渠道", **TEXT),
    f("出库单来源", **TEXT),
    f("备注", **TEXT),
    f("包含退货商品", **TEXT),
    f("同步时间", **DATETIME),
]

FIELDS_AGING = [
    f("仓配中心", **TEXT),
    f("上架批次号", **TEXT),
    f("上架时间", **DATETIME),
    f("OC SKUID", **TEXT),
    f("卖家SKUID", **TEXT),
    f("商品名称", **TEXT),
    f("数量", **NUMBER),
    f("库龄（天）", **NUMBER),
    f("同步时间", **DATETIME),
]

TABLES = {
    "实时库存": FIELDS_REALTIME,
    "库存流水": FIELDS_FLOW,
    "入库单列表": FIELDS_INBOUND,
    "订单管理": FIELDS_ORDER,
    "库龄表": FIELDS_AGING,
}


def ensure_table(base_token, name, fields):
    for table in list_tables(base_token):
        if table["name"] == name:
            print(f"table exists: {name} {table['table_id']}")
            return table["table_id"]
    result = api_request(
        "POST",
        f"/open-apis/bitable/v1/apps/{base_token}/tables",
        {"table": {"name": name, "fields": fields}},
    )
    table_id = result["table_id"]
    print(f"table created: {name} {table_id}")
    return table_id


def ensure_fields(base_token, table_id, definitions):
    result = api_request(
        "GET",
        f"/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/fields?page_size=100",
    )
    existing = {item["field_name"] for item in result["items"]}
    for definition in definitions:
        if definition["field_name"] in existing:
            continue
        body = {
            "field_name": definition["field_name"],
            "type": definition["type"],
            "ui_type": definition.get("ui_type"),
        }
        if definition.get("property") is not None:
            body["property"] = definition["property"]
        api_request(
            "POST",
            f"/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/fields",
            body,
        )
        print(f"  field added: {definition['field_name']}")


def main():
    base = FEISHU_BASE_TOKEN
    if not base:
        raise SystemExit("Set FEISHU_BASE_TOKEN in config.py first")
    ids = {}
    for name, fields in TABLES.items():
        table_id = ensure_table(base, name, fields)
        ensure_fields(base, table_id, fields)
        ids[name] = table_id
    print("\nPaste into config.py:")
    print(f'TABLE_INVENTORY_REALTIME = "{ids["实时库存"]}"')
    print(f'TABLE_INVENTORY_FLOW = "{ids["库存流水"]}"')
    print(f'TABLE_INBOUND_LIST = "{ids["入库单列表"]}"')
    print(f'TABLE_ORDER_MANAGEMENT = "{ids["订单管理"]}"')
    print(f'TABLE_INVENTORY_AGING = "{ids["库龄表"]}"')


if __name__ == "__main__":
    main()
