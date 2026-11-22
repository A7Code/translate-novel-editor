// 把不依賴 vscode 的純邏輯測試打包後，用 Node 內建測試執行器執行，不需要啟動 VS Code。
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "..");
const testDir = path.join(root, "src", "test");
const outDir = path.join(root, "out", "unit-tests");

async function main() {
  const entryPoints = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => path.join(testDir, name));

  fs.rmSync(outDir, { recursive: true, force: true });
  await esbuild.build({
    entryPoints,
    outdir: outDir,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: "inline",
    logLevel: "warning"
  });

  const files = fs
    .readdirSync(outDir)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => path.join(outDir, name));
  const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
