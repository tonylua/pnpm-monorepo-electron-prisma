import { defineStore } from 'pinia'

export const useStore = defineStore('counter', {
  state: () => {
    return {
      packageName: 'myApp',
    }
  },
  actions: {
    setPackageName(name: string) {
      this.packageName = name
    },
  }
})
