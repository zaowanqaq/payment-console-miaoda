import json
import time
import urllib.request


from config import FEISHU_APP_ID, FEISHU_APP_SECRET

APP_ID = FEISHU_APP_ID
APP_SECRET = FEISHU_APP_SECRET
FEISHU_API = "https://open.feishu.cn"

_token_cache = {"token": None, "expires_at": 0}


def get_tenant_token():
    if _token_cache["token"] and time.time() < _token_cache["expires_at"]:
        return _token_cache["token"]

    body = json.dumps({"app_id": APP_ID, "app_secret": APP_SECRET}).encode()
    req = urllib.request.Request(
        f"{FEISHU_API}/open-apis/auth/v3/tenant_access_token/internal",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    resp = urllib.request.urlopen(req, timeout=15)
    result = json.loads(resp.read().decode())
    if result.get("code") != 0:
        raise RuntimeError(f"Failed to get tenant token: {result}")

    token = result["tenant_access_token"]
    expire = result.get("expire", 7200)
    _token_cache["token"] = token
    _token_cache["expires_at"] = time.time() + expire - 120
    return token


def api_request(method, path, body=None):
    token = get_tenant_token()
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        FEISHU_API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
        },
    )
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read().decode())
    if result.get("code") != 0:
        raise RuntimeError(f"Feishu API error: {result}")
    return result.get("data", {})


def list_tables(base_token):
    items = []
    page_token = ""
    while True:
        path = f"/open-apis/bitable/v1/apps/{base_token}/tables?page_size=100"
        if page_token:
            path += f"&page_token={page_token}"
        result = api_request("GET", path)
        items.extend(result.get("items", []))
        if not result.get("has_more"):
            break
        page_token = result.get("page_token", "")
    return items


def list_records(base_token, table_id):
    records = []
    page_token = ""
    while True:
        path = (
            f"/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}"
            f"/records?page_size=500"
        )
        if page_token:
            path += f"&page_token={page_token}"
        result = api_request("GET", path)
        records.extend(result.get("items", []))
        if not result.get("has_more"):
            break
        page_token = result.get("page_token", "")
    return records


def _chunks(values, size=200):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def batch_create_records(base_token, table_id, records):
    for chunk in _chunks(records):
        api_request(
            "POST",
            f"/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records/batch_create",
            {"records": [{"fields": record} for record in chunk]},
        )


def batch_update_records(base_token, table_id, updates):
    for chunk in _chunks(updates):
        api_request(
            "POST",
            f"/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records/batch_update",
            {"records": chunk},
        )


def batch_delete_records(base_token, table_id, record_ids):
    for chunk in _chunks(record_ids):
        api_request(
            "POST",
            f"/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records/batch_delete",
            {"records": chunk},
        )


def delete_records_where(base_token, table_id, predicate):
    """Delete records whose fields satisfy predicate(fields) -> bool."""
    existing = list_records(base_token, table_id)
    targets = [
        record["record_id"]
        for record in existing
        if predicate(record.get("fields", {}))
    ]
    if targets:
        batch_delete_records(base_token, table_id, targets)
    return len(targets)


def replace_records(base_token, table_id, records):
    """Snapshot replace: create new rows first, then remove the previous rows."""
    existing = list_records(base_token, table_id)
    batch_create_records(base_token, table_id, records)
    old_ids = [record["record_id"] for record in existing]
    batch_delete_records(base_token, table_id, old_ids)
    return {"created": len(records), "deleted": len(old_ids)}


def _cell_key(value):
    if isinstance(value, list):
        return "".join(
            item.get("text", "") if isinstance(item, dict) else str(item)
            for item in value
        )
    return str(value or "")


def upsert_records(base_token, table_id, records, key_fields):
    existing = list_records(base_token, table_id)
    matched = {}
    duplicates = []
    for record in existing:
        fields = record.get("fields", {})
        key = tuple(_cell_key(fields.get(field, "")) for field in key_fields)
        if key in matched:
            duplicates.append(record["record_id"])
        else:
            matched[key] = record["record_id"]

    creates = []
    updates = []
    for record in records:
        key = tuple(_cell_key(record.get(field, "")) for field in key_fields)
        record_id = matched.get(key)
        if record_id:
            updates.append({"record_id": record_id, "fields": record})
        else:
            creates.append(record)

    batch_create_records(base_token, table_id, creates)
    batch_update_records(base_token, table_id, updates)
    if duplicates:
        batch_delete_records(base_token, table_id, duplicates)
    return {
        "created": len(creates),
        "updated": len(updates),
        "duplicates_deleted": len(duplicates),
    }


# Backward-compatible alias for the original helper name.
def _get_tenant_token():
    return get_tenant_token()
