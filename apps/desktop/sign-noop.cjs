module.exports = async function sign(configuration) {
  // 故意留空：不调用 signtool，不产生签名。
  console.log(`[sign-noop] 跳过内置签名（交由外部 sign.exe 处理）: ${configuration && configuration.path}`)
}
