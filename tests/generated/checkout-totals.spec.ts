import { expect, test } from '@playwright/test';

test("Checkout totals", async ({ page }) => {
  await page.goto("about:blank");
  // Snippet: Load checkout fixture
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
  await page.locator("[name=\"coupon\"]").fill("SPRING25");
  await page.locator("[data-testid=\"apply-coupon\"]").click();
  await expect(page.locator("[data-testid=\"order-total\"]")).toContainText("$75.00");
});
