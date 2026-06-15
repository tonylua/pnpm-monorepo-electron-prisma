<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useStore } from './stores'
import type { Account, Thread } from 'db_client'
import useDB from './hooks/useDB'

const store = useStore()
const { getAccount, createNewThread, listThreads } = useDB()
const list = ref<Thread[]>([])

onMounted(() => {
  document.body.classList.add('is-electron')
  // @ts-ignore TODO
  window.electron.ipcRenderer.on('set-title', (_, title) => {
    store.setPackageName(title)
  })
  // @ts-ignore TODO
  window.electron.ipcRenderer.on('db-status', async (_, status) => {
    console.log('db is ready', status)
  })

  setTimeout(async () => {
      const account: Account | null = await getAccount('FAKE_USER')

      if (!account) return;

      await createNewThread(account)
      await createNewThread(account)
      await createNewThread(account)

      const threads: Thread[] = await listThreads(account)
      console.log(threads)
      list.value = threads
  }, 1000);
})

</script>

<template>
  <ul>
    <li v-for="thread in list" :key="thread.id">{{ thread.name }}</li>
  </ul>
</template>

<style lang="less"></style>
