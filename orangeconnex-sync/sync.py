"""Sync OrangeConnex inventory data into Feishu Base (API interception).

Usage:
    python sync.py
"""

import time
from datetime import datetime

from config import (
    FEISHU_BASE_TOKEN,
    TABLE_INBOUND_LIST,
    TABLE_INVENTORY_FLOW,
    TABLE_INVENTORY_REALTIME,
    TABLE_INVENTORY_AGING,
    TABLE_ORDER_MANAGEMENT,
)
from feishu_base import delete_records_where, replace_records, upsert_records
from oc_client import OCClient


def _ts_now():
    return int(time.time() * 1000)


def _datetime_ms(value):
    if not value:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if str(value).isdigit():
        return int(value)
    if isinstance(value, datetime):
        return int(value.timestamp() * 1000)
    return int(datetime.fromisoformat(str(value)).timestamp() * 1000)


# ---------- 实时库存 ----------
def map_inventory(row, region):
    return {
        "仓配中心": row.get("warehouseRegionName") or region or "",
        "商品名称": row.get("skuName") or "",
        "卖家SKUID": row.get("sellerSkuId") or "",
        "OC SKUID": row.get("skuId") or "",
        "SKU货型": row.get("dimensionTypeCode") or "",
        "在途": row.get("inTransitQuantity") or 0,
        "到仓": row.get("receivedQuantity") or 0,
        "可售": row.get("availableQuantity") or 0,
        "冻结": row.get("reservedAllocatedQuantity") or 0,
        "不可售": (row.get("suspendQuantity") or 0) + (row.get("unfulfillableQuantity") or 0),
        "已售15天": row.get("recentlyOneMonth") or 0,
        "已售总计": row.get("totalOutboundCount") or 0,
        "同步时间": _ts_now(),
    }


# ---------- 库存流水 ----------
def map_statement(row, region):
    ts = row.get("tradeTimestamp")
    return {
        "仓配中心": row.get("warehouseRegionName") or region or "",
        "卖家SKUID": row.get("sellerSkuId") or "",
        "OC SKUID": row.get("skuId") or "",
        "商品名称": row.get("skuName") or "",
        "变化原因": row.get("changeReason") or "",
        "订单类型": row.get("tradeType") or "",
        "订单号": row.get("tradeNumber") or "",
        "上架批次号": str(row.get("batchNumber") or ""),
        "操作时间": int(ts) if ts else None,
        "变动数量": row.get("quantity") or 0,
        "结余可售": row.get("leftQuantity") or 0,
        "同步时间": _ts_now(),
    }


# ---------- 入库单列表 ----------
def map_inbound(row):
    status_map = {
        "0": "草稿", "10": "待预约", "20": "待到仓", "30": "已到仓",
        "40": "上架中", "50": "上架完成", "60": "已取消",
    }
    audit_map = {"0": "未提交", "4": "无需审核"}
    transport_map = {"OF": "海运", "AF": "空运", "RL": "铁路", "TL": "陆运"}
    mode_map = {"TK": "自送/卡车", "EX": "商家自选快递"}

    status = str(row.get("status") or "")
    audit = str(row.get("inboundDocumentAuditStatus") or "")
    transport = transport_map.get(row.get("transportMethod"), row.get("transportMethod"))
    mode = mode_map.get(row.get("transpotationMode"), row.get("transpotationMode"))

    return {
        "送仓预约编号": row.get("bookingNumber") or "",
        "入库单号": row.get("orderNumber") or "",
        "状态": status_map.get(status, status),
        "重量kg": row.get("totalWeight") or 0,
        "入库参考单号": row.get("inboundReferenceNumber") or "",
        "创建时间": int(row["createTime"]) if row.get("createTime") else None,
        "仓配中心": row.get("warehouseArea") or row.get("warehouseCode") or "",
        "清关文件审核状态": audit_map.get(audit, audit),
        "头程运输方式": transport or "",
        "入库方式": mode or "",
        "箱数": row.get("cartonQty") or 0,
        "预报数量": row.get("skuQuantity") or 0,
        "同步时间": _ts_now(),
    }


# ---------- 订单管理 ----------
def map_order(row):
    sku_parts = []
    carrier_info = []
    for pkg in (row.get("trackingNumbers") or []):
        c = pkg.get("carrier") or ""
        t = pkg.get("trackingNumber") or ""
        if c or t:
            carrier_info.append(f"{c} / {t}")
        for item in (pkg.get("packageSkuList") or []):
            sku = item.get("sellerSkuId") or ""
            name = item.get("skuName") or ""
            qty = item.get("quantity") or 0
            sku_parts.append(f"{sku} x{qty} {name}")

    status_raw = str(row.get("orderStatus") or "")
    return {
        "出库单号": row.get("orderNumber") or "",
        "商品明细": "\n".join(sku_parts),
        "尾程承运商/单号": "; ".join(carrier_info),
        "仓配中心": row.get("warehouseRegionCode") or "",
        "目的国家/地址": row.get("warehouseRegionCountry") or "",
        "下单服务": str(row.get("serviceType") or ""),
        "配送服务": row.get("distributionProductOuterName") or "",
        "eBay卖家编码": row.get("ebayBuyerId") or "",
        "eBay订单编号/平台订单号": row.get("platformOrderId") or "",
        "卖家订单编号": row.get("referenceNumber") or "",
        "下单日期": _datetime_ms(row.get("submissionDate")),
        "eBay下单时间": _datetime_ms(row.get("ebayDate")),
        "订单状态": status_raw,
        "订单渠道": row.get("orderPlatform") or "",
        "出库单来源": row.get("orderSource") or "",
        "备注": row.get("remark") or "",
        "包含退货商品": "是" if row.get("containsReturnGoods") else "否",
        "同步时间": _ts_now(),
    }


# ---------- 库龄表 ----------
def _excel_datetime_ms(value):
    return _datetime_ms(value)


def map_inventory_aging(row):
    quantity = row.get("数量")
    aging_days = row.get("库龄（天）")
    return {
        "仓配中心": row.get("仓配中心") or "",
        "上架批次号": str(row.get("上架批次号") or ""),
        "上架时间": _excel_datetime_ms(row.get("上架时间")),
        "OC SKUID": row.get("OC SKUID") or "",
        "卖家SKUID": row.get("卖家SKUID") or "",
        "商品名称": row.get("商品名称") or "",
        "数量": int(float(quantity)) if quantity not in (None, "") else 0,
        "库龄（天）": int(float(aging_days)) if aging_days not in (None, "") else 0,
        "同步时间": _ts_now(),
    }


# ---------- main ----------
def sync(client: OCClient, days=90, order_days=30):
    now_ms = int(time.time() * 1000)
    from_ms = now_ms - days * 86400 * 1000

    # ---- 实时库存 ----
    regions = client.list_warehouse_regions()
    print(f"regions: {regions}")
    all_rows = []
    for r in regions:
        rows = client.list_inventory(r)
        all_rows.extend(rows)
        print(f"  inventory {r}: {len(rows)}")
    records = [map_inventory(r, None) for r in all_rows]
    stats = upsert_records(FEISHU_BASE_TOKEN, TABLE_INVENTORY_REALTIME, records,
                           key_fields=["仓配中心", "卖家SKUID"])
    print(f"实时库存 upsert: {stats}")

    # ---- 库存流水 ----
    all_rows = []
    for r in regions:
        rows = client.list_statement(r, from_ms, now_ms)
        all_rows.extend(rows)
        print(f"  statement {r}: {len(rows)}")
    records = [map_statement(r, None) for r in all_rows]
    stats = upsert_records(FEISHU_BASE_TOKEN, TABLE_INVENTORY_FLOW, records,
                           key_fields=["订单号", "OC SKUID"])
    print(f"库存流水 upsert: {stats}")

    # ---- 入库单列表 ----
    raw = client.list_inbound()
    records = [map_inbound(r) for r in raw if r]
    print(f"入库单: {len(records)}")
    stats = upsert_records(FEISHU_BASE_TOKEN, TABLE_INBOUND_LIST, records,
                           key_fields=["入库单号"])
    print(f"入库单 upsert: {stats}")

    # ---- 订单管理 ----
    raw = client.list_orders(order_days)
    records = [map_order(r) for r in raw if r]
    print(f"订单管理: {len(records)}")
    stats = upsert_records(FEISHU_BASE_TOKEN, TABLE_ORDER_MANAGEMENT, records,
                           key_fields=["出库单号"])
    print(f"订单管理 upsert: {stats}")

    order_cutoff_ms = now_ms - order_days * 86400 * 1000

    def outside_order_window(fields):
        order_time = fields.get("下单日期")
        return isinstance(order_time, (int, float)) and order_time < order_cutoff_ms

    deleted = delete_records_where(
        FEISHU_BASE_TOKEN, TABLE_ORDER_MANAGEMENT, outside_order_window
    )
    print(f"订单管理窗口清理: {deleted}")

    # ---- 库龄表 ----
    raw = client.list_inventory_aging()
    records = [map_inventory_aging(r) for r in raw if r]
    print(f"库龄表: {len(records)}")
    stats = replace_records(FEISHU_BASE_TOKEN, TABLE_INVENTORY_AGING, records)
    print(f"库龄表 replace: {stats}")


def main():
    with OCClient() as client:
        sync(client)


if __name__ == "__main__":
    main()
