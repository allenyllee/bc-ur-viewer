import { defineConfig } from 'vite';

function getBasePath() {
  if (!process.env.GITHUB_ACTIONS) return '/';
  const repo = (process.env.GITHUB_REPOSITORY || '').split('/')[1] || '';
  if (!repo || repo.endsWith('.github.io')) return '/';
  return `/${repo}/`;
}

export default defineConfig({
  base: getBasePath(),
  server: {
    allowedHosts: ['.trycloudflare.com']
  },
  preview: {
    allowedHosts: ['.trycloudflare.com']
  }
});
