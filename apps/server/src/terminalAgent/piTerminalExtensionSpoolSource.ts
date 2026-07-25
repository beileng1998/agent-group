/** Runtime JS injected into the generated Pi extension. */
export const PI_TERMINAL_EXTENSION_SPOOL_SOURCE = String.raw`
  const MAX_SPOOL_FILES = 32;
  const MAX_SPOOL_BYTES = 8 * MAX_BYTES;
  const MAX_ASSISTANT_BYTES = 512 * 1024;
  const TRUNCATED_SUFFIX = "\n[Agent Group: assistant output truncated.]";

  function truncateUtf8(value, maxBytes) {
    if (Buffer.byteLength(value) <= maxBytes) return value;
    const suffixBytes = Buffer.byteLength(TRUNCATED_SUFFIX);
    let prefix = Buffer.from(value).subarray(0, maxBytes - suffixBytes).toString("utf8");
    while (Buffer.byteLength(prefix) + suffixBytes > maxBytes) {
      prefix = prefix.slice(0, -1);
    }
    return prefix + TRUNCATED_SUFFIX;
  }

  function boundLifecycleInput(input) {
    return typeof input.assistant_text === "string"
      ? {
          ...input,
          assistant_text: truncateUtf8(input.assistant_text, MAX_ASSISTANT_BYTES)
        }
      : input;
  }

  async function writePrivateText(filePath, encoded) {
    if (Buffer.byteLength(encoded) > MAX_BYTES) {
      throw new Error("Private runtime payload too large.");
    }
    const temporaryPath = filePath + "." + randomUUID() + ".tmp";
    await fs.writeFile(temporaryPath, encoded, { mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }

  async function writePrivateJson(filePath, value) {
    await writePrivateText(filePath, JSON.stringify(value));
  }

  async function writeSpool(input) {
    if (!spoolDir) throw new Error("Spool unavailable.");
    const payload = {
      runtimeInstanceId,
      eventId: input.event_id,
      input
    };
    const encoded = JSON.stringify(payload);
    const encodedBytes = Buffer.byteLength(encoded);
    if (encodedBytes > MAX_BYTES) throw new Error("Spool event too large.");

    await fs.mkdir(spoolDir, { recursive: true, mode: 0o700 });
    await fs.chmod(spoolDir, 0o700);
    const entries = await Promise.all(
      (await fs.readdir(spoolDir))
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map(async (name) => ({
          name,
          bytes: (await fs.stat(path.join(spoolDir, name))).size
        }))
    );
    let totalBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
    while (
      entries.length >= MAX_SPOOL_FILES ||
      totalBytes + encodedBytes > MAX_SPOOL_BYTES
    ) {
      const stale = entries.shift();
      if (!stale) break;
      await fs.rm(path.join(spoolDir, stale.name), { force: true });
      totalBytes -= stale.bytes;
    }
    const filePath = path.join(
      spoolDir,
      String(Date.now()).padStart(13, "0") + "-" + input.event_id + ".json"
    );
    await writePrivateText(filePath, encoded);
  }
`;
