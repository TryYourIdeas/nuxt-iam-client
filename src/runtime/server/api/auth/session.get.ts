export default defineEventHandler(async (event) => {
  const session = await getIamSession(event)
  if (!session) {
    return { user: null }
  }
  return {
    user: {
      username: session.username,
      email: session.email,
    },
  }
})
