<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useStore } from "./stores";
import type { Account, Thread } from "@app/common";
import useDB from "./hooks/useDB";

const store = useStore();
const { getAccount, createNewThread, listThreads } = useDB();
const list = ref<Thread[]>([]);
// true = multi-db mode is active (analyticsAction exposed by preload)
const isMultiDb = ref(
  typeof (window as any).api?.analyticsAction === "function",
);
const analyticsEvents = ref<
  { id: string; type: string; timestamp: Date; data: string | null }[]
>([]);

async function loadThreads() {
  const account: Account | null = await getAccount("FAKE_USER");
  if (!account) return;
  const threads: Thread[] = await listThreads(account);
  list.value = threads;
}

async function clearThreads() {
  try {
    await window.api.persistenceAction("Thread", "delete", {});
    list.value = [];
  } catch (err) {
    console.error("Clear threads failed:", err);
  }
}

async function addThread() {
  try {
    const account: Account | null = await getAccount("FAKE_USER");
    if (!account) return;
    await createNewThread(account);
    await loadThreads();
  } catch (err) {
    console.error("Add thread failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function loadAnalyticsEvents() {
  try {
    analyticsEvents.value = await window.api.analyticsAction(
      "AnalyticsEvent",
      "where",
      {},
    );
  } catch (err) {
    console.error("Load analytics failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function clearAnalyticsEvents() {
  try {
    await window.api.analyticsAction("AnalyticsEvent", "delete", {});
    analyticsEvents.value = [];
  } catch (err) {
    console.error("Clear analytics failed:", err);
  }
}

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

    // Clear previous threads to avoid accumulation on each restart
    await clearThreads();

    // Create fresh threads
    await createNewThread(account);
    await createNewThread(account);
    await createNewThread(account);

    await loadThreads();
  }, 1000);
});
</script>

<template>
  <div>
    <div class="db-section">
      <h3>Main Database (Threads)</h3>
      <div class="actions">
        <button class="btn btn-primary" @click="addThread">Add Thread</button>
        <button class="btn btn-danger" @click="clearThreads">
          Clear All Threads
        </button>
      </div>
      <ul class="thread-list">
        <li v-for="thread in list" :key="thread.id">{{ thread.name }}</li>
      </ul>
    </div>

    <!-- Multi-database hint: dynamically switches between setup/teardown -->
    <aside class="multi-db-hint">
      <template v-if="!isMultiDb">
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
      </template>
      <template v-else>
        <p class="multi-db-hint__title">Multi-database mode is active</p>
        <p class="multi-db-hint__body">
          This scaffold is running with two databases (main + analytics).
        </p>

        <!-- Show analytics events from the second DB -->
        <div v-if="analyticsEvents.length > 0" class="analytics-section">
          <div class="analytics-header">
            <p class="analytics-label">Analytics Events (from 2nd database):</p>
            <button class="btn btn-sm" @click="clearAnalyticsEvents">
              Clear Events
            </button>
          </div>
          <ul class="analytics-list">
            <li
              v-for="event in analyticsEvents"
              :key="event.id"
              class="analytics-item"
            >
              <span class="event-type">{{ event.type }}</span>
              <span class="event-time">{{
                new Date(event.timestamp).toLocaleTimeString()
              }}</span>
            </li>
          </ul>
        </div>
        <div v-else class="analytics-section">
          <p class="analytics-label">
            No analytics events yet. They will appear on app launch.
          </p>
        </div>

        <p class="multi-db-hint__body" style="margin-top: 12px">
          To revert back to single-database mode, run:
        </p>
        <code class="multi-db-hint__cmd">pnpm common teardown:multi-db</code>
        <p class="multi-db-hint__note">
          Then <code>pnpm common build</code> and restart. See the README for
          details.
        </p>
      </template>
    </aside>
  </div>
</template>

<style lang="less">
.db-section {
  margin: 20px 0;
  padding: 16px 20px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  max-width: 520px;

  h3 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 600;
    color: #333;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .thread-list {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      padding: 8px 12px;
      margin-bottom: 4px;
      background: #f5f5f5;
      border-radius: 4px;
      font-size: 14px;

      &:last-child {
        margin-bottom: 0;
      }
    }
  }
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;

  &.btn-primary {
    background: #0366d6;
    color: white;

    &:hover {
      background: #0256c2;
    }
  }

  &.btn-danger {
    background: #d73a49;
    color: white;

    &:hover {
      background: #cb2431;
    }
  }

  &.btn-sm {
    padding: 4px 8px;
    font-size: 11px;
  }
}

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

  .analytics-section {
    margin: 12px 0;
    padding: 12px;
    background: #f0f7ff;
    border: 1px solid #d0e4ff;
    border-radius: 6px;
  }

  .analytics-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .analytics-label {
    margin: 0;
    font-weight: 600;
    font-size: 12px;
    color: #0366d6;
  }

  .analytics-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .analytics-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    margin-bottom: 4px;
    background: white;
    border-radius: 4px;
    font-size: 12px;

    &:last-child {
      margin-bottom: 0;
    }

    .event-type {
      font-weight: 500;
      color: #0366d6;
    }

    .event-time {
      color: #666;
      font-family: ui-monospace, monospace;
    }
  }
}
</style>
