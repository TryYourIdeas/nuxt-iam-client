export default defineEventHandler(async (event) => {
  const session = await getIamSession(event)
  if (!session) {
    iamDebugLog('session', 'session check: no active session')
    return { user: null }
  }
  iamDebugLog('session', 'session check: active session', { email: session.email })
  return {
    user: {
      username: session.username,
      email: session.email,
    },
  }
})
