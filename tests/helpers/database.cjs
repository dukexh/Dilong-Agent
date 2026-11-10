// Read the real IndexedDB records in an isolated test browser context.
async function records(page, store) {
  return page.evaluate(async store => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('dilong-workflows', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(store).objectStore(store).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  }, store)
}
async function untilRecords(page, store, predicate) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const rows = await records(page, store)
    if (predicate(rows)) return rows
    await page.waitForTimeout(100)
  }
  throw Error(`等待 ${store} 状态超时`)
}
module.exports = { records, untilRecords }
