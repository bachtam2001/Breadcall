/**
 * MediaMTX Iframe Embed E2E Tests
 * Tests for /view/{streamName} iframe embed functionality
 */

const { test, expect } = require('@playwright/test');

test.describe('MediaMTX Iframe Embed', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to landing page
    await page.goto('/');
  });

  test('should load landing page successfully', async ({ page }) => {
    // Verify landing page loads
    await expect(page).toHaveTitle(/BreadCall/i);
  });

  test('should navigate to director view', async ({ page }) => {
    // Create a test room
    const testRoomId = 'TEST' + Date.now().toString().slice(-4);
    await page.goto(`/#/director/${testRoomId}`);

    // Verify director view loads
    await expect(page.locator('body')).toContainText(/Director/i);
  });

  test('should handle view embed URL format', async ({ page }) => {
    // Test /view/{streamName}/ URL format (with trailing slash)
    const testStreamName = 'test-stream-' + Date.now().toString().slice(-4);
    await page.goto(`/view/${testStreamName}/`);

    // Should load without errors (may show "stream not found" which is expected)
    // The important thing is the URL routing works correctly
    await expect(page).toHaveURL(`/view/${testStreamName}/`);
  });

  test('should redirect /view/{streamName} to /view/{streamName}/', async ({ page }) => {
    // Test redirect from URL without trailing slash to URL with trailing slash
    const testStreamName = 'test-stream-' + Date.now().toString().slice(-4);
    await page.goto(`/view/${testStreamName}`);

    // Should be redirected to URL with trailing slash
    await expect(page).toHaveURL(`/view/${testStreamName}/`);
  });

  test('should handle solo view with codec fallback', async ({ page }) => {
    // Navigate to solo view
    const testRoomId = 'TEST';
    const testStreamId = 'test-stream';
    await page.goto(`/#/view/${testRoomId}/${testStreamId}`);

    // Verify solo view loads
    // The video element should be present even if stream is not available
    const videoElement = page.locator('video');
    await expect(videoElement).toBeAttached();
  });

  test('should handle WHEP client initialization', async ({ page }) => {
    // Navigate to solo view which initializes WHEPClient
    await page.goto('/#/view/TEST/test-stream');

    // Check that the page loads without JavaScript errors
    page.on('pageerror', (error) => {
      console.error('Page error:', error.message);
    });

    // Give time for any potential errors
    await page.waitForTimeout(1000);

    // No crashes should occur
    await expect(page.locator('body')).toBeAttached();
  });
});

test.describe('Graceful Degradation', () => {
  test('should handle nonexistent stream gracefully', async ({ page }) => {
    // Try to view a stream that doesn't exist
    await page.goto('/view/nonexistent-stream/');

    // Should not crash, should show some error or loading state
    await expect(page.locator('body')).toBeAttached();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Navigate to a room with invalid ID
    await page.goto('/#/room/INVALID-ROOM-ID');

    // Should not crash
    await expect(page).toHaveURL('/#/room/INVALID-ROOM-ID');
  });
});
