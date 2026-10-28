export async function retry(times, label, fn) {
  let lastError;
  for (let attempt = 1; attempt <= times; attempt++) {
    console.log(`\n=== ${label} (${attempt}/${times}) ===`);
    try {
      const result = await fn(attempt);
      console.log(`=== ${label} succeeded on attempt ${attempt} ===`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`${label} attempt ${attempt} failed: ${err.message}`);
      if (attempt < times) {
        console.log("Retrying...");
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastError;
}
