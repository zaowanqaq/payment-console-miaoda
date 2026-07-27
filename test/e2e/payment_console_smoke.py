from pathlib import Path

from playwright.sync_api import sync_playwright


ARTIFACT_DIR = Path(__file__).resolve().parents[2] / "test-artifacts"
ARTIFACT_DIR.mkdir(exist_ok=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors: list[str] = []
    page_errors: list[str] = []
    failed_requests: list[str] = []

    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "requestfailed",
        lambda request: failed_requests.append(
            f"{request.method} {request.url}: {request.failure}"
        ),
    )

    page.goto("http://127.0.0.1:5173/test/e2e/smoke.html?demo=1")
    page.wait_for_timeout(1500)
    if page.get_by_role("heading", name="付款提审台").count() == 0:
        page.screenshot(
            path=str(ARTIFACT_DIR / "payment-console-reconnaissance.png"),
            full_page=True,
        )
        raise AssertionError(
            "Payment console did not render. "
            f"url={page.url}; body={page.locator('body').inner_text()!r}; "
            f"console_errors={console_errors}; page_errors={page_errors}; "
            f"failed_requests={failed_requests}"
        )
    page.get_by_role("heading", name="付款提审台").wait_for()
    page.locator(".loading-state").wait_for(state="detached")

    assert page.get_by_role("heading", name="付款提审台").is_visible()
    assert page.get_by_text("3条明细").is_visible()
    assert page.get_by_text("¥18,650.00").is_visible()
    assert page.locator("tbody tr").count() == 3
    assert page.get_by_text("审批关联已校验").count() == 3

    submit_button = page.get_by_role("button", name="确认发起审批")
    assert submit_button.is_enabled()
    submit_button.click()

    dialog = page.get_by_role("dialog")
    assert dialog.get_by_role("heading", name="确认发起付款审批").is_visible()
    assert dialog.get_by_text("3 条付款明细，合计 ¥18,650.00").is_visible()
    assert dialog.get_by_text("【测试】云账户批量付款资源（仅达人）").is_visible()
    assert dialog.get_by_text("早晚").is_visible()
    dialog.get_by_role("button", name="取消").click()
    assert dialog.count() == 0

    page.get_by_title("刷新").click()
    page.locator(".loading-state").wait_for(state="detached")
    assert page.locator("tbody tr").count() == 3

    page.screenshot(path=str(ARTIFACT_DIR / "payment-console-smoke.png"), full_page=True)
    browser.close()

    assert not console_errors, f"Browser console errors: {console_errors}"
    assert not page_errors, f"Page errors: {page_errors}"
    assert not failed_requests, f"Failed requests: {failed_requests}"

print("PASS: payment console demo smoke test")
