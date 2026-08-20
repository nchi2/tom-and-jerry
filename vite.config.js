import { defineConfig } from 'vite';

// GitHub Pages는 https://<user>.github.io/<repo>/ 아래에 뜨므로 base 경로가 필요하다.
// 로컬 개발(dev)에서는 '/' 로 두고, 빌드할 때만 저장소 이름을 붙인다.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tom-and-jerry/' : '/',
  build: { outDir: 'dist' },
  // tools/ 는 검증 하니스다. 여기를 고칠 때마다 페이지가 리로드되면
  // 진행 중인 헤드리스 런이 날아가므로 감시에서 뺀다.
  server: { watch: { ignored: ['**/tools/**'] } },
}));
