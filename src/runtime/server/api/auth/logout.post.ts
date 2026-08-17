export default defineEventHandler(async (event) => {
  iamDebugLog('logout', 'logout requested')
  await destroyIamSession(event)
  return { ok: true }
})
