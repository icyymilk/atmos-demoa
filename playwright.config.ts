import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/ui', fullyParallel:false, workers:1, timeout:45000,
  expect:{timeout:10000}, reporter:'list',
  use:{baseURL:process.env.ATMOS_TEST_URL||'http://localhost:5173',browserName:'chromium',channel:process.env.ATMOS_BROWSER_CHANNEL||undefined,viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:process.env.ATMOS_TEST_URL?undefined:{command:'npm run dev',url:'http://localhost:5173/api/health',reuseExistingServer:!process.env.CI,timeout:90000},
});
