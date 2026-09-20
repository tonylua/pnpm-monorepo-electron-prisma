<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useStore } from "./stores";
import type { Account, Thread } from "@app/common";
import useDB from "./hooks/useDB";

const store = useStore();
const { getAccount, createNewThread, listThreads } = useDB();
const list = ref<Thread[]>([]);

onMounted(() => {
  document.body.classList.add("is-electron");
  // @ts-ignore TODO
  window.electron.ipcRenderer.on("set-title", (_, title) => {
    store.setPackageName(title);
  });
  // @ts-ignore TODO
  window.electron.ipcRenderer.on("db-status", async (_, status) => {
    console.log("db is ready", status);
  });

  setTimeout(async () => {
    const account: Account | null = await getAccount("FAKE_USER");

    if (!account) return;

    await createNewThread(account);
    await createNewThread(account);
    await createNewThread(account);

    const threads: Thread[] = await listThreads(account);
    console.log(threads);
    list.value = threads;
  }, 1000);
});
</script>

<template>
  <ul>
    <li v-for="thread in list" :key="thread.id">{{ thread.name }}</li>
  </ul>

  <!-- Multi-database hint: this scaffold ships with a single DB by default.
       Run the command below to scaffold a second (analytics) database. -->
  <aside class="multi-db-hint">
    <p class="multi-db-hint__title">Need more than one database?</p>
    <p class="multi-db-hint__body">
      This scaffold uses a single database by default. To add a second one
      (analytics example), run:
    </p>
    <code class="multi-db-hint__cmd">pnpm common setup:multi-db</code>
    <p class="multi-db-hint__note">
      Then <code>pnpm common build</code> and restart. See the README for
      details.
    </p>
  </aside>
</template>

<style lang="less">
.multi-db-hint {
  margin-top: 24px;
  padding: 16px 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
  max-width: 520px;

  &__title {
    margin: 0 0 8px;
    font-weight: 600;
    font-size: 14px;
  }

  &__body,
  &__note {
    margin: 0 0 8px;
    font-size: 13px;
    color: #555;
  }

  &__note {
    margin-bottom: 0;
  }

  &__cmd {
    display: inline-block;
    padding: 6px 10px;
    margin-bottom: 8px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    background: #1e1e1e;
    color: #7ee787;
    border-radius: 4px;
    user-select: all;
  }

  code {
    font-family: ui-monospace, monospace;
    background: #eee;
    padding: 1px 4px;
    border-radius: 3px;
  }
}
</style>
