import { defineConfig } from 'vite';

// GitHub Pages는 https://<user>.github.io/<repo>/ 아래에 뜨므로 base 경로가 필요하다.
// 로컬 개발(dev)에서는 '/' 로 두고, 빌드할 때만 저장소 이름을 붙인다.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tom-and-jerry/' : '/',
  build: { outDir: 'dist' },
}));
