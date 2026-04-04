import { expect, test } from '@playwright/test';

test("Login path", async ({ page }) => {
  await page.goto("about:blank");
  // Snippet: Load login fixture
  await page.setContent(`
<main>
  <label>Email <input name='email' /></label>
  <label>Password <input name='password' type='password' /></label>
  <button data-testid='submit-login'>Sign in</button>
  <h1 data-testid='dashboard-title'>Signed out</h1>
</main>
<script>
  const email = document.querySelector('[name="email"]');
  const password = document.querySelector('[name="password"]');
  const submit = document.querySelector('[data-testid="submit-login"]');
  const title = document.querySelector('[data-testid="dashboard-title"]');
  submit.addEventListener('click', () => {
    title.textContent = email.value && password.value ? 'Dashboard' : 'Signed out';
  });
</script>
`);
  await page.locator("[name=\"email\"]").fill("qa@example.com");
  await page.locator("[name=\"password\"]").fill("super-secret-password");
  await page.locator("[data-testid=\"submit-login\"]").click();
  await expect(page.locator("[data-testid=\"dashboard-title\"]")).toContainText("Dashboard");
  // Snippet: Wait for dashboard
  const headline = "Dashboard";
  await page.waitForLoadState('domcontentloaded');
  const dashboardText = (await page.locator('[data-testid="dashboard-title"]').textContent()) || '';
  if (!dashboardText.includes(headline)) {
    throw new Error(`Dashboard headline mismatch: ${dashboardText}`);
  }
});
