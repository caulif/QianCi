import type { ManifestV3Export } from '@crxjs/vite-plugin';

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: '潜词',
  version: '0.1.1',
  description: '极简英文网页单词预判与查词扩展',
  permissions: ['storage', 'contextMenus', 'tabs', 'alarms'],
  host_permissions: ['http://*/*', 'https://*/*'],
  background: {
    service_worker: 'src/background/worker.ts',
    type: 'module'
  },
  action: {
    default_title: '潜词',
    default_popup: 'src/popup/index.html'
  },
  options_page: 'src/options/index.html',
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ]
};

export default manifest;
