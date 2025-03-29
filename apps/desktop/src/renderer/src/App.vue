<script setup lang="ts">
import { onMounted, ref, type Component } from 'vue'
import { useStore } from './stores'
import AppHeader from './components/AppHeader.vue'

const store = useStore()
const header = ref<Component | null>(null)

onMounted(() => {
  if (__WEB__) {
    document.body.classList.add('is-web')

    const isMobileUA = /Mobi|Android/i.test(navigator.userAgent)
    if (isMobileUA) {
      document.body.classList.add('is-mobile')
    }
  }
  if (__ELECTRON__) {
    header.value = AppHeader
    document.body.classList.add('is-electron')
    // @ts-ignore TODO
    window.electron.ipcRenderer.on('set-title', (_, title) => {
      store.setPackageName(title)
    })
    // @ts-ignore TODO
    window.electron.ipcRenderer.on('db-status', (_, status) => {
      console.log('db is ready', status)
    })
  }
})
</script>

<template>
  <component :is="header"></component>
  <div>hello</div>
</template>

<style lang="less"></style>
