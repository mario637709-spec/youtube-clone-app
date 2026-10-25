const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');

const VIDEO1_URL = 'http://localhost:3000/watch/ukJAOlghGMI'; // 2025-10-14_12-20-06_UTC
const VIDEO2_URL = 'http://localhost:3000/watch/4BJqpZgWY7c'; // 2025-10-15_11-29-33_UTC
const CHROME_PROFILE_DIR = path.join(os.homedir(), 'Desktop', 'server-bot-profile');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const runLoadTest = async () => {
  console.log("=================================================");
  console.log("🔥 INITIATING MULTI-TAB STREAM PERFORMANCE TEST (10 TABS)");
  console.log("=================================================");

  const browser = await puppeteer.launch({
    headless: 'new', // Background check
    channel: 'chrome',
    userDataDir: CHROME_PROFILE_DIR,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const tabs = [];
  const results = [];

  // Prepare 10 tab configurations
  for (let i = 0; i < 10; i++) {
    const isVideo1 = i < 5;
    tabs.push({
      id: i + 1,
      url: isVideo1 ? VIDEO1_URL : VIDEO2_URL,
      name: isVideo1 ? "Video 1 (2025-10-14_12-20-06_UTC)" : "Video 2 (2025-10-15_11-29-33_UTC)"
    });
  }

  console.log(`\n📬 Opening 10 tabs concurrently in Chrome...`);
  const startAll = Date.now();

  const tabPromises = tabs.map(async (tabInfo) => {
    const page = await browser.newPage();
    // Set a good viewport
    await page.setViewport({ width: 1280, height: 720 });
    
    // Spoof User Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const result = {
      tabId: tabInfo.id,
      videoName: tabInfo.name,
      loadSuccess: false,
      timeToPlayMs: null,
      qualitySwitchSuccess: false,
      errorMessage: null
    };

    try {
      const startLoad = Date.now();
      console.log(`[Tab ${tabInfo.id}] Navigating to watch page...`);
      await page.goto(tabInfo.url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Click the play overlay if it's there
      try {
        await page.waitForSelector('.play-button-overlay', { timeout: 3000 });
        await page.click('.play-button-overlay');
        console.log(`[Tab ${tabInfo.id}] Play overlay clicked.`);
      } catch (e) {
        // Overlay might not be present or autoplay clicked
      }

      // Check if video starts playing
      console.log(`[Tab ${tabInfo.id}] Waiting for video playback to start...`);
      const playStart = Date.now();
      
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && video.currentTime > 0.1 && !video.paused;
      }, { timeout: 25000 });

      const timeToPlay = Date.now() - startLoad;
      result.loadSuccess = true;
      result.timeToPlayMs = timeToPlay;
      console.log(`[Tab ${tabInfo.id}] ✅ Video started playing in ${(timeToPlay / 1000).toFixed(2)}s.`);

      // Wait 5 seconds to buffer a bit
      await sleep(5000);

      // Verify Quality selector functionality
      console.log(`[Tab ${tabInfo.id}] Testing quality selector...`);
      
      // 1. Click gear/settings button
      await page.waitForSelector('button.gear-btn', { timeout: 5000 });
      await page.click('button.gear-btn');
      await sleep(500);

      // 2. Click Quality menu item (should contain "Quality")
      const qualityMenuClicked = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.yt-settings-menu-item'));
        const qualItem = items.find(item => item.innerText && item.innerText.includes('Quality'));
        if (qualItem) {
          qualItem.click();
          return true;
        }
        return false;
      });

      if (!qualityMenuClicked) {
        throw new Error("Could not find Quality settings submenu item");
      }
      await sleep(500);

      // 3. Click "480p" quality option
      const qualityOptionClicked = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.yt-settings-sub-item'));
        const option = items.find(item => item.innerText && item.innerText.toUpperCase().includes('480P'));
        if (option) {
          option.click();
          return true;
        }
        return false;
      });

      if (!qualityOptionClicked) {
        throw new Error("Could not find 480p quality option in submenu");
      }
      console.log(`[Tab ${tabInfo.id}] Quality selector set to 480p. Waiting for reload...`);
      await sleep(2000);

      // Verify playback continues or resumes in 480p
      await page.waitForFunction(() => {
        const video = document.querySelector('video');
        return video && video.currentTime > 0.5 && !video.paused;
      }, { timeout: 15000 });

      result.qualitySwitchSuccess = true;
      console.log(`[Tab ${tabInfo.id}] ✅ Quality switched and video playing successfully!`);

      // Let it play for 5 more seconds
      await sleep(5000);

    } catch (err) {
      result.errorMessage = err.message;
      console.error(`[Tab ${tabInfo.id}] ❌ Error during test:`, err.message);
      
      // Save error screenshot
      try {
        await page.screenshot({ path: path.join(__dirname, `error_tab_${tabInfo.id}.png`) });
      } catch (screenshotErr) {}
    } finally {
      await page.close();
    }

    results.push(result);
  });

  await Promise.all(tabPromises);
  const totalDuration = Date.now() - startAll;

  console.log(`\n=================================================`);
  console.log(`📊 PERFORMANCE LOAD TEST COMPLETE (${(totalDuration / 1000).toFixed(2)}s)`);
  console.log(`=================================================`);

  // Print summary report
  console.log("\nSummary Table:");
  console.log("Tab | Video Name | Success | Time to Play (s) | Quality Switch");
  console.log("---------------------------------------------------------------");
  let successfulLoads = 0;
  let successfulQualitySwitches = 0;
  let sumTimeToPlay = 0;

  results.sort((a, b) => a.tabId - b.tabId).forEach(r => {
    const playTime = r.timeToPlayMs ? (r.timeToPlayMs / 1000).toFixed(2) + "s" : "N/A";
    console.log(`${r.tabId.toString().padEnd(3)} | ${r.videoName.substring(0, 30).padEnd(30)} | ${r.loadSuccess ? "✅ YES" : "❌ NO "} | ${playTime.padEnd(17)} | ${r.qualitySwitchSuccess ? "✅ YES" : "❌ NO"}`);
    if (r.loadSuccess) {
      successfulLoads++;
      sumTimeToPlay += r.timeToPlayMs;
    }
    if (r.qualitySwitchSuccess) {
      successfulQualitySwitches++;
    }
  });

  const avgPlayTime = successfulLoads > 0 ? ((sumTimeToPlay / successfulLoads) / 1000).toFixed(2) : "N/A";
  console.log("---------------------------------------------------------------");
  console.log(`Successful Playback: ${successfulLoads}/10 tabs`);
  console.log(`Average Startup Delay: ${avgPlayTime}s`);
  console.log(`Successful Quality Switches: ${successfulQualitySwitches}/10 tabs`);

  await browser.close();
};

runLoadTest().then(() => process.exit(0)).catch(err => {
  console.error("Load test failed to execute:", err);
  process.exit(1);
});
