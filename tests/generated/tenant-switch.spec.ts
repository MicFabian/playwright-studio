import { expect, test } from '@playwright/test';

test("Tenant switch", async ({ page }) => {
  await page.goto("about:blank");
  // Snippet: Load tenant fixture
  await page.setContent(`
<main>
  <button aria-haspopup='listbox'>Workspace</button>
  <ul role='listbox' hidden>
    <li role='option'>Acme Europe</li>
    <li role='option'>Acme US</li>
  </ul>
  <p data-testid='current-tenant'>None</p>
</main>
<script>
  const trigger = document.querySelector('button[aria-haspopup="listbox"]');
  const list = document.querySelector('[role="listbox"]');
  const currentTenant = document.querySelector('[data-testid="current-tenant"]');
  trigger.addEventListener('click', () => {
    list.hidden = !list.hidden;
  });
  list.querySelectorAll('[role="option"]').forEach((option) => {
    option.addEventListener('click', () => {
      currentTenant.textContent = option.textContent || '';
      list.hidden = true;
    });
  });
</script>
`);
  // Snippet: Switch tenant
  const tenantName = "Acme Europe";
  await page.getByRole('button', { name: 'Workspace' }).click();
  const option = page.getByRole('option', { name: tenantName });
  await option.waitFor({ state: 'visible' });
  await option.click();
  await expect(page.locator("[data-testid=\"current-tenant\"]")).toContainText("Acme Europe");
});
