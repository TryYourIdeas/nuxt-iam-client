export default defineEventHandler(async (event) => {
  const instanceId = event.context.iamInstanceId as string
  iamDebugLog('logout', 'logout requested', { instanceId })
  await destroyIamSession(event, instanceId)
  return { ok: true }
})
