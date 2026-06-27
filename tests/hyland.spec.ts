import { test, expect, Page, FrameLocator, Locator } from '@playwright/test';

/** Page or iframe context — both expose the same locator APIs */
type JobsHost = Page | FrameLocator;

/** Log a major step with a consistent prefix for easy filtering */
function logStep(message: string): void {
  console.log(`[Hyland Test] ${message}`);
}

/**
 * Attempt to dismiss cookie consent banners using multiple locator strategies.
 * Silently continues if no banner is present.
 */
async function dismissCookieConsent(page: Page): Promise<void> {
  const cookieAcceptors: Locator[] = [
    page.getByRole('button', { name: /Accept All Cookies/i }),
    page.getByRole('button', { name: /Accept all cookies/i }),
    page.getByRole('button', { name: /Accept/i }),
    page.getByRole('button', { name: 'Close' }).filter({ has: page.locator('[aria-label*="Cookie"], [class*="cookie"]') }),
    page.locator('button#onetrust-accept-btn-handler'),
  ];

  for (const locator of cookieAcceptors) {
    try {
      if (await locator.first().isVisible({ timeout: 3_000 })) {
        logStep('Cookie consent popup detected — accepting/closing it.');
        await locator.first().click();
        await expect(locator.first()).toBeHidden({ timeout: 10_000 });
        return;
      }
    } catch {
      // Try the next alternative locator strategy
    }
  }

  logStep('No cookie consent popup detected (or already dismissed).');
}

/**
 * Click the first visible locator from a list of fallback strategies.
 */
async function clickFirstVisible(description: string, locators: Locator[]): Promise<void> {
  for (const locator of locators) {
    try {
      const target = locator.first();
      await expect(target).toBeVisible({ timeout: 15_000 });
      logStep(`Clicking "${description}" using fallback locator.`);
      await target.click();
      return;
    } catch {
      // Continue to the next locator strategy
    }
  }

  throw new Error(`Unable to click "${description}" — all locator strategies failed.`);
}

/**
 * Resolve the iCIMS jobs host — either an embedded iframe or the top-level page.
 */
async function resolveJobsHost(page: Page): Promise<JobsHost> {
  const iframeSelectors = [
    'iframe[name="icims_content_iframe"]',
    'iframe[id*="icims"]',
    'iframe[src*="icims"]',
    'iframe[title*="iCIMS"]',
  ];

  for (const selector of iframeSelectors) {
    try {
      const iframe = page.locator(selector).first();
      if (await iframe.isVisible({ timeout: 5_000 })) {
        logStep(`iCIMS content found inside iframe: ${selector}`);
        return page.frameLocator(selector);
      }
    } catch {
      // Try the next iframe selector
    }
  }

  if (/icims\.com/i.test(page.url())) {
    logStep('iCIMS jobs portal loaded as a top-level page (no iframe).');
    return page;
  }

  logStep('Falling back to default iCIMS iframe selector.');
  return page.frameLocator('iframe[name="icims_content_iframe"]');
}

/**
 * Locate the job search text box inside the iCIMS jobs host.
 */
async function getSearchBox(host: JobsHost): Promise<Locator> {
  const searchBoxCandidates: Locator[] = [
    host.getByRole('textbox', { name: /Start your job search here/i }),
    host.getByPlaceholder(/search/i),
    host.locator('input[type="search"]'),
    host.locator('input[name*="keywords"]'),
    host.locator('#jsb_form_keyword_i'),
  ];

  for (const locator of searchBoxCandidates) {
    try {
      const target = locator.first();
      await expect(target).toBeVisible({ timeout: 15_000 });
      return target;
    } catch {
      // Try next candidate
    }
  }

  throw new Error('Job search text box not found inside iCIMS jobs portal.');
}

/** Locator for visible job listing rows after a search */
function getJobResultsLocator(host: JobsHost): Locator {
  return host.locator(
    '.iCIMS_JobListingRow a[href*="jobs/"], .iCIMS_JobsTable a[href*="jobs/"], a.iCIMS_JobTitle, h3.iCIMS_JobTitle a'
  );
}

/**
 * Submit a keyword search via Enter key or the Search button.
 */
async function submitJobSearch(host: JobsHost, searchBox: Locator): Promise<void> {
  const resultsTable = host.locator(
    '.iCIMS_JobsTable, .container-fluid.iCIMS_JobsTable, [class*="JobsTable"], .iCIMS_JobListingRow'
  );

  try {
    logStep('Submitting search via Enter key.');
    await searchBox.press('Enter');
    await expect(resultsTable.first()).toBeVisible({ timeout: 30_000 });
    return;
  } catch {
    logStep('Enter key search did not produce results — trying Search button.');
  }

  const searchButtonCandidates: Locator[] = [
    host.getByRole('button', { name: /Search/i }),
    host.locator('input[type="submit"][value="Search"]'),
    host.locator('#jsb_form_submit_i'),
  ];

  for (const locator of searchButtonCandidates) {
    try {
      const button = locator.first();
      await expect(button).toBeVisible({ timeout: 10_000 });
      await button.click({ force: true });
      await expect(resultsTable.first()).toBeVisible({ timeout: 30_000 });
      return;
    } catch {
      // Try next button locator
    }
  }

  throw new Error('Unable to submit job search — Enter and Search button strategies failed.');
}

/**
 * Extract Job ID text from the job details page using multiple selectors.
 */
async function extractJobId(host: JobsHost): Promise<string> {
  const jobIdCandidates: Locator[] = [
    host.locator('dd.iCIMS_JobHeaderData span'),
    host.locator('.iCIMS_JobHeaderData span'),
    host.locator('dt:has-text("Job ID") + dd'),
    host.locator('dt:has-text("Requisition ID") + dd'),
    host.getByText(/Job ID/i).locator('..').locator('dd, span').last(),
  ];

  for (const locator of jobIdCandidates) {
    try {
      const target = locator.first();
      await expect(target).toBeVisible({ timeout: 10_000 });
      const text = (await target.textContent())?.trim() ?? '';
      if (text.length > 0) {
        return text;
      }
    } catch {
      // Try next candidate
    }
  }

  return '';
}

/**
 * Hyland careers automation:
 * homepage → careers → job search → job details → Job ID extraction.
 */
test('Hyland Playwright Assignment', async ({ page, context }) => {
  let careersPage: Page = page;

  try {
    // --- Step 1: Navigate to Hyland homepage and wait for full load ---
    logStep('Launching browser and navigating to https://www.hyland.com');
    await page.goto('https://www.hyland.com', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    logStep('Homepage loaded successfully.');

    // --- Step 2: Handle cookie consent if present ---
    await dismissCookieConsent(page);

    // --- Step 3: Click the Careers link from the homepage ---
    logStep('Clicking the Careers link from the homepage.');
    try {
      await clickFirstVisible('Careers link', [
        page.getByRole('link', { name: 'Careers', exact: true }),
        page.locator('a[href*="/company/careers"]'),
        page.getByRole('contentinfo').getByRole('link', { name: 'Careers' }),
      ]);
    } catch {
      // Alternative: open Careers via the Company navigation menu
      logStep('Direct Careers link not found — trying Company menu.');
      await page.getByRole('button', { name: 'Company' }).click();
      await page.getByRole('link', { name: 'Careers' }).click();
    }

    await expect(page).toHaveURL(/careers/i, { timeout: 30_000 });
    await page.waitForLoadState('networkidle');
    logStep('Careers page loaded successfully.');

    await dismissCookieConsent(page);

    // --- Step 4: Dismiss marketing popups that may block interactions ---
    try {
      const popupDismiss = page.locator('[id*="_qualified-offer-dismiss-button"]');
      if (await popupDismiss.first().isVisible({ timeout: 3_000 })) {
        logStep('Dismissing marketing popup.');
        await popupDismiss.first().click();
      }
    } catch {
      logStep('No marketing popup to dismiss.');
    }

    // --- Step 5: Click "Join Us in Our Team" / "Join our team" ---
    logStep('Clicking "Join Us in Our Team" (Join our team) link.');
    const joinTeamLink = page.getByRole('link', { name: /Join (Us in )?[Oo]ur [Tt]eam/i }).first();

    await expect(joinTeamLink).toBeVisible({ timeout: 20_000 });

    // The link may open a new tab (popup) or navigate in the same tab
    const popupPromise = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
    await joinTeamLink.click();
    const popupPage = await popupPromise;

    careersPage = popupPage ?? page;
    await careersPage.waitForLoadState('domcontentloaded');
    await careersPage.waitForLoadState('networkidle');
    logStep('Jobs portal page opened and loaded.');

    await dismissCookieConsent(careersPage);

    // --- Step 6: Interact with the iCIMS jobs portal job search ---
    const jobsHost = await resolveJobsHost(careersPage);
    logStep('Locating the job search text box.');
    const searchBox = await getSearchBox(jobsHost);

    logStep('Entering search keyword: "playwright".');
    await searchBox.fill('playwright');

    await submitJobSearch(jobsHost, searchBox);
    logStep('Search results displayed.');

    // --- Step 7: Verify at least one search result is present ---
    const jobResultLinks = getJobResultsLocator(jobsHost);
    await expect(jobResultLinks.first()).toBeVisible({ timeout: 30_000 });
    const resultCount = await jobResultLinks.count();
    expect(resultCount).toBeGreaterThan(0);
    logStep(`Verified ${resultCount} search result(s) for "playwright".`);

    // --- Step 8: Click the first job in the search results ---
    logStep('Clicking the first job in the search results.');
    await jobResultLinks.first().click();
    await careersPage.waitForLoadState('networkidle');
    logStep('Job details page loaded.');

    // --- Step 9: Extract and verify Job ID ---
    const jobId = await extractJobId(jobsHost);
    console.log(`Job ID: ${jobId}`);
    expect(jobId, 'Job ID should not be empty').not.toBe('');
    logStep(`Extracted Job ID: "${jobId}"`);

  } catch (error) {
    console.error('[Hyland Test] Test failed with error:', error);
    throw error;
  }
});
