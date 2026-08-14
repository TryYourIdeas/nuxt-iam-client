export default defineEventHandler(async (event) => {
  await destroyIamSession(event)
  return { ok: true }
})
