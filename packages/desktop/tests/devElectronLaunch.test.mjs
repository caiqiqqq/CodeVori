import assert from "node:assert/strict";
import test from "node:test";
import {
  createDevElectronLaunch,
  findDevElectronProcesses,
  signalDevElectronApplication,
} from "../scripts/devElectronLaunch.mjs";

const options = {
  platform: "darwin",
  executablePath: "/fixture/ZCode Dev.app/Contents/MacOS/Electron",
  appPath: "/fixture/ZCode Dev.app",
  cwd: "/fixture/project/packages/desktop",
  rendererUrl: "http://localhost:5174",
  env: { ZCODE_ENV: "production", EXAMPLE_PRIVATE_TOKEN: "not-for-argv" },
};

test("macOS uses LaunchServices without putting inherited credentials in argv", () => {
  const launch = createDevElectronLaunch(options);
  assert.equal(launch.command, "/usr/bin/open");
  assert.ok(launch.args.includes("-W"));
  assert.ok(launch.args.includes("-n"));
  assert.deepEqual(launch.args.slice(-2), ["--args", options.cwd]);
  assert.equal(launch.env.ELECTRON_RENDERER_URL, options.rendererUrl);
  assert.equal(launch.env.ZCODE_ENV, "production");
  assert.ok(!launch.args.join(" ").includes("not-for-argv"));
});

test("Windows and Linux keep direct Electron launch", () => {
  for (const platform of ["win32", "linux"]) {
    const launch = createDevElectronLaunch({ ...options, platform });
    assert.equal(launch.command, options.executablePath);
    assert.deepEqual(launch.args, ["."]);
  }
});

test("LaunchServices launch does not redirect through parent process file descriptors", () => {
  const launch = createDevElectronLaunch(options);
  for (const argument of ["--stdout", "--stderr", "/dev/stdout", "/dev/stderr"]) {
    assert.ok(!launch.args.includes(argument));
  }
});

test("cleanup collects only descendants of a freshly resolved application PID", () => {
  const rows = ["100 1 100", "101 100 100", "102 101 100", "200 1 200", "201 200 200"].join("\n");
  assert.deepEqual(
    findDevElectronProcesses(rows, 100).map((p) => p.pid),
    [100, 101, 102],
  );
  assert.deepEqual(findDevElectronProcesses(rows, 999), []);
});

test("LaunchServices cleanup excludes existing instances and rechecks exact executable identity", async () => {
  const killed = [];
  const old = "ASN:0x0-0x100";
  const owned = "ASN:0x0-0x101";
  const run = async (command, args) => {
    if (args[0] === "find") return { stdout: `${old}: ${owned}:` };
    if (args[0] === "info")
      return { stdout: `executable path=${JSON.stringify(options.executablePath)}\npid = 100` };
    assert.equal(command, "/bin/ps");
    return { stdout: "100 1 100\n101 100 100\n200 1 200" };
  };
  const result = await signalDevElectronApplication({
    executablePath: options.executablePath,
    existingAsns: new Set([old]),
    signal: "SIGTERM",
    run,
    kill: (...args) => killed.push(args),
  });
  assert.deepEqual([...result], [owned]);
  assert.deepEqual(killed, [[-100, "SIGTERM"]]);
  await signalDevElectronApplication({
    executablePath: options.executablePath,
    existingAsns: new Set([old]),
    ownedAsns: result,
    signal: "SIGKILL",
    run: async (command, args) =>
      args[0] === "info"
        ? { stdout: 'executable path="/other/Electron"\npid = 100' }
        : run(command, args),
    kill: (...args) => killed.push(args),
  });
  assert.equal(killed.length, 1);
});
