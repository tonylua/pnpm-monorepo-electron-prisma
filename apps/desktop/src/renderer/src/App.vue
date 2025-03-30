<script setup lang="ts">
import { onMounted, ref, type Component } from 'vue'
import { useStore } from './stores'
import AppHeader from './components/AppHeader.vue'
import type { Thread } from '@prisma/client'
import useDB from './hooks/useDB'

const store = useStore()
const header = ref<Component | null>(null)
const { getAccount, createNewThread, listThreads } = useDB()
const list = ref([])

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
    window.electron.ipcRenderer.on('db-status', async (_, status) => {
      console.log('db is ready', status)

      const account = await getAccount('FAKE_USER')

      await createNewThread(account)
      await createNewThread(account)
      await createNewThread(account)

      const threads: Thread[] = await listThreads(account)
      console.log(threads)
      list.value = threads
    })
  }
})
</script>

<template>
  <component :is="header"></component>
  <ul>
    <li v-for="thread in list" :key="thread.id">{{ thread.name }}</li>
  </ul>
</template>

<style lang="less"></style>
