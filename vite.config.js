import { defineConfig } from 'vite';

// GitHub Pages는 https://<user>.github.io/<repo>/ 아래에 뜨므로 base 경로가 필요하다.
// 로컬 개발(dev)에서는 '/' 로 두고, 빌드할 때만 저장소 이름을 붙인다.
// `npm run preview`도 배포와 **같은 base**로 띄운다 (isPreview).
// 안 그러면 preview는 '/'로 서빙하는데 index.html은 '/tom-and-jerry/'를 가리켜 404가 나고,
// "빌드가 실제로 Pages에서 도는가"를 로컬에서 확인할 방법이 없어진다.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/tom-and-jerry/' : '/',
  build: { outDir: 'dist' },
  // tools/ 는 검증 하니스다. 여기를 고칠 때마다 페이지가 리로드되면
  // 진행 중인 헤드리스 런이 날아가므로 감시에서 뺀다.
  server: { watch: { ignored: ['**/tools/**'] } },
}));
