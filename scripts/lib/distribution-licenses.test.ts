import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stageDistributionLicenses } from "./distribution-licenses";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("stageDistributionLicenses", () => {
  it("collects the production dependency graph and stages project notices", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "agent-group-license-fixture-"));
    for (const app of ["desktop", "server", "web"]) {
      const appRoot = join(repoRoot, "apps", app);
      mkdirSync(appRoot, { recursive: true });
      writeJson(join(appRoot, "package.json"), {
        name: `@fixture/${app}`,
        private: true,
        dependencies: app === "web" ? { alpha: "1.0.0" } : {},
      });
    }

    const alphaRoot = join(repoRoot, "node_modules", "alpha");
    const betaRoot = join(repoRoot, "node_modules", "beta");
    mkdirSync(alphaRoot, { recursive: true });
    mkdirSync(betaRoot, { recursive: true });
    writeJson(join(alphaRoot, "package.json"), {
      name: "alpha",
      version: "1.0.0",
      license: "MIT",
      dependencies: { beta: "2.0.0" },
    });
    writeJson(join(betaRoot, "package.json"), {
      name: "beta",
      version: "2.0.0",
      license: "Apache-2.0",
    });
    writeFileSync(join(alphaRoot, "LICENSE"), "Alpha license\n");
    writeFileSync(join(repoRoot, "LICENSE"), "Project license\n");
    writeFileSync(join(repoRoot, "NOTICE.md"), "Project notice\n");
    writeFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "Third-party policy\n");

    const destinationDirectory = join(repoRoot, "staged-legal");
    const result = stageDistributionLicenses({ repoRoot, destinationDirectory });

    expect(result.packageCount).toBe(2);
    expect(result.packagesWithoutLicenseFiles).toEqual(["beta@2.0.0"]);
    expect(existsSync(join(destinationDirectory, "LICENSE.txt"))).toBe(true);
    expect(existsSync(join(destinationDirectory, "NOTICE.txt"))).toBe(true);
    expect(existsSync(join(destinationDirectory, "third-party", "alpha__1.0.0", "LICENSE"))).toBe(
      true,
    );
    expect(readFileSync(join(destinationDirectory, "THIRD_PARTY_NOTICES.txt"), "utf8")).toContain(
      "Package: beta@2.0.0",
    );
  });
});
