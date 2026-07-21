import { execFile } from "node:child_process";

type DialogCommand = {
  readonly executable: string;
  readonly args: readonly string[];
};

type ExecFileError = Error & {
  code?: string | number;
  stderr?: string;
};

const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = 'Choose a folder'",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

function runCommand(command: DialogCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command.executable,
      [...command.args],
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          (error as ExecFileError).stderr = stderr;
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isMissingExecutable(error: unknown): boolean {
  return (error as ExecFileError | undefined)?.code === "ENOENT";
}

function isCancellation(error: unknown, platform: NodeJS.Platform): boolean {
  const candidate = error as ExecFileError | undefined;
  if (platform === "darwin") return candidate?.stderr?.includes("(-128)") === true;
  return platform === "linux" && candidate?.code === 1 && !candidate.stderr?.trim();
}

async function runDialog(
  command: DialogCommand,
  platform: NodeJS.Platform,
): Promise<string | null> {
  try {
    const output = await runCommand(command);
    const path = output.replace(/[\r\n]+$/, "");
    return path.length > 0 ? path : null;
  } catch (error) {
    if (isCancellation(error, platform)) return null;
    throw error;
  }
}

export async function pickHostFolder(
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (platform === "darwin") {
    return runDialog(
      {
        executable: "osascript",
        args: ["-e", 'POSIX path of (choose folder with prompt "Choose a folder")'],
      },
      platform,
    );
  }

  if (platform === "win32") {
    return runDialog(
      {
        executable: "powershell.exe",
        args: ["-NoProfile", "-STA", "-Command", WINDOWS_SCRIPT],
      },
      platform,
    );
  }

  if (platform === "linux") {
    try {
      return await runDialog(
        {
          executable: "zenity",
          args: ["--file-selection", "--directory", "--title=Choose a folder"],
        },
        platform,
      );
    } catch (error) {
      if (!isMissingExecutable(error)) throw error;
    }

    try {
      return await runDialog(
        { executable: "kdialog", args: ["--getexistingdirectory", "."] },
        platform,
      );
    } catch (error) {
      if (!isMissingExecutable(error)) throw error;
      throw new Error("Folder picker requires zenity or kdialog on Linux.", { cause: error });
    }
  }

  throw new Error(`Folder picker is unsupported on ${platform}.`);
}
