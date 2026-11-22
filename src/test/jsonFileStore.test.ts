import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { JsonFileStore, JsonFileUnreadableError } from "../core/jsonFileStore";
import { NodeFileOps } from "../core/nodeFileOps";

let root: string;
let store: JsonFileStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-store-"));
  store = new JsonFileStore(new NodeFileOps(root));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test("區分檔案不存在與內容損毀", async () => {
  assert.equal((await store.readJson("a/data.json")).kind, "missing");
  await fs.mkdir(path.join(root, "a"));
  await fs.writeFile(path.join(root, "a/data.json"), "{ broken");
  assert.equal((await store.readJson("a/data.json")).kind, "unreadable");
});

test("損毀的檔案不會被 updateJson 覆蓋", async () => {
  await fs.writeFile(path.join(root, "data.json"), "{ broken");
  await assert.rejects(
    store.updateJson<number[]>("data.json", [], (value) => [...value, 1]),
    JsonFileUnreadableError
  );
  assert.equal(await fs.readFile(path.join(root, "data.json"), "utf8"), "{ broken");
});

test("連續更新依序執行且不留下暫存檔", async () => {
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      store.updateJson<number[]>("data.json", [], (value) => [...value, index])
    )
  );
  const result = await store.readJson<number[]>("data.json");
  assert.deepEqual(result.kind === "ok" ? result.value : [], Array.from({ length: 30 }, (_, index) => index));
  assert.deepEqual(await fs.readdir(root), ["data.json"]);
});

test("備份會略過相同內容、拒絕損毀檔並限制份數", async () => {
  const at = (second: number) => new Date(Date.UTC(2026, 10, 22, 0, 0, second));
  await store.writeJson("data.json", { value: 0 });
  assert.ok(await store.backup("data.json", "backups", "data", 2, at(0)));
  assert.equal(await store.backup("data.json", "backups", "data", 2, at(1)), undefined);

  for (const value of [1, 2]) {
    await store.writeJson("data.json", { value });
    await store.backup("data.json", "backups", "data", 2, at(value + 1));
  }
  assert.equal((await store.listBackups("backups", "data")).length, 2);

  await fs.writeFile(path.join(root, "data.json"), "{ broken");
  await assert.rejects(store.backup("data.json", "backups", "data", 2, at(9)));
  assert.equal((await store.listBackups("backups", "data")).length, 2);
});

test("還原時保留損毀檔案的副本", async () => {
  await store.writeJson("data.json", { value: "good" });
  const name = await store.backup("data.json", "backups", "data", 5);
  await fs.writeFile(path.join(root, "data.json"), "{ broken");

  await store.restore("data.json", "backups", name!, "data");

  const restored = await store.readJson<{ value: string }>("data.json");
  assert.deepEqual(restored.kind === "ok" ? restored.value : undefined, { value: "good" });
  const corrupt = (await fs.readdir(path.join(root, "backups"))).find((file) => file.startsWith("corrupt-data-"));
  assert.ok(corrupt);
  assert.equal(await fs.readFile(path.join(root, "backups", corrupt), "utf8"), "{ broken");
});
