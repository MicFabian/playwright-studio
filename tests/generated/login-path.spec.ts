import { expect, test } from "@playwright/test";

test("Login path", async ({ page }) => {
  await test.step("Open local page", async () => {
    await page.goto("about:blank");
  });
  await test.step("Load login fixture", async () => {
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
  });
  await test.step("Fill email", async () => {
    await page.locator("[name=\"email\"]").fill("qa@example.com");
  });
  await test.step("Fill password", async () => {
    await page.locator("[name=\"password\"]").fill("super-secret-password");
  });
  await test.step("Submit login", async () => {
    await page.getByTestId("submit-login").click();
  });
  await test.step("Dashboard loads", async () => {
    await expect(page.getByTestId("dashboard-title")).toContainText("Dashboard");
  });
  await test.step("Wait for dashboard", async () => {
    const headline = "Dashboard";
    await expect(page.locator('[data-testid="dashboard-title"]')).toContainText(headline);
  });
});
