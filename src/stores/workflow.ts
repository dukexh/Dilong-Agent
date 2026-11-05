import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { S } from '../services/workflows'

export const useWorkflowStore = defineStore('workflow', () => {
  const tick = ref(0)
  S.subscribe(() => { tick.value++ })
  const from = <T>(read: () => T) => computed(() => { void tick.value; return read() })
  return { tick, assets: from(() => [...S.assets]), tasks: from(() => [...S.tasks]), inkRuns: from(() => [...S.inkRuns]),
    all: from(() => S.all()), stats: from(() => S.stats()), operations: from(() => Object.fromEntries(Object.entries(S.operations).map(([key,value]) => [key,{...value}]))),
    designRuns: from(() => new Map(Array.from(S.designRuns, ([key,value]) => [key,{...value}]))), statsView: from(() => S.statsView), editSession: from(() => S.editSession) }
})
