<template>
  <div class="header text-white">
    <span>{{ title }}</span>
    <div class="btn-opt text-white" style="-webkit-app-region: no-drag">
      <a class="btn-min" href="javascript:;" @click="toMin"></a>
      <a class="btn-max" href="javascript:;" @click="toMax"></a>
      <a class="btn-close" href="javascript:;" @click="toClose"></a>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useStore } from '@renderer/stores'
import { WindowActions } from '@main/utils/constants'

const store = useStore()

const title = computed(() => store.packageName)

const toMin = () => window.api.windowAction(window.windowId, WindowActions.MIN)
const toMax = () => window.api.windowAction(window.windowId, WindowActions.MAX)
const toClose = () => window.api.windowAction(window.windowId, WindowActions.CLOSE)
</script>

<style scoped lang="less">
.header {
  -webkit-app-region: drag;
  height: var(--app-header-height);
  line-height: var(--app-header-height);
  font-weight: 700;
  font-size: 16px;
  padding-left: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  color: black;
}
.btn-opt {
  height: 32px;
}
.btn-opt > a {
  display: inline-block;
  background-repeat: no-repeat;
  width: 46px;
  height: 32px;
  background-size: contain;
}
.btn-min {
  background-image: url('@renderer/assets/min.svg');
}
.btn-max {
  background-image: url('@renderer/assets/max.svg');
}
.btn-close {
  background-image: url('@renderer/assets/close.svg');
}
</style>
