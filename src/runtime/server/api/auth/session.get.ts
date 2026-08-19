export default defineEventHandler(async (event) => {
  const instanceId = event.context.iamInstanceId as string
  const session = await getIamSession(event, instanceId)
  if (!session) {
    iamDebugLog('session', 'session check: no active session', { instanceId })
    return { user: null }
  }
  iamDebugLog('session', 'session check: active session', { instanceId, email: session.email })
  return {
    user: {
      username: session.username,
      email: session.email,
    },
  }
})
