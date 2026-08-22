import { expect, test } from "@playwright/test";

test("Checkout totals", async ({ page }) => {
  await test.step("Open local page", async () => {
    await page.goto("about:blank");
  });
  await test.step("Load checkout fixture", async () => {
    await page.setContent(`
    <main>
      <h1>Checkout</h1>
      <label>Coupon <input name='coupon' /></label>
      <button data-testid='apply-coupon'>Apply</button>
      <p data-testid='order-total'>$100.00</p>
    </main>
    <script>
      const input = document.querySelector('[name="coupon"]');
      const button = document.querySelector('[data-testid="apply-coupon"]');
      const total = document.querySelector('[data-testid="order-total"]');
      button.addEventListener('click', () => {
        total.textContent = input.value === 'SPRING25' ? '$75.00' : '$100.00';
      });
    </script>
    `);
  });
  await test.step("Fill coupon", async () => {
    await page.locator("[name=\"coupon\"]").fill("SPRING25");
  });
  await test.step("Apply coupon", async () => {
    await page.getByTestId("apply-coupon").click();
  });
  await test.step("Discounted total appears", async () => {
    await expect(page.getByTestId("order-total")).toContainText("$75.00");
  });
});
