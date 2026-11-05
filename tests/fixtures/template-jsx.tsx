import { createApp, ref } from 'vue'
/** Exercises the template's JSX plugin without changing the production pages. */
export function mountFixture(host: HTMLElement) {
  const count = ref(0)
  const app = createApp({ setup: () => () => <button onClick={() => count.value++}>JSX {count.value}</button> })
  app.mount(host)
  return () => app.unmount()
}
