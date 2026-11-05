/// <reference types="vite/client" />
export {}
declare global {
  interface Window { HSStaticMethods?: { autoInit: (collection?: string | string[]) => void } }
}
