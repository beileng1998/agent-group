export function missingCliOption(
  helpText: string,
  options: ReadonlyArray<string>,
): string | undefined {
  return options.find((option) => {
    const escaped = option.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return !new RegExp(`(?:^|\\s)${escaped}(?=\\s|,|=|$)`, "mu").test(helpText);
  });
}
